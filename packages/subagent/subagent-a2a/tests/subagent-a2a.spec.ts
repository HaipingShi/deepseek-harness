import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  type AgentCard,
  type Message,
  Role,
  type Task,
  TaskState,
} from '@a2a-js/sdk'
import {
  AgentEvent,
  type AgentExecutor,
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '@a2a-js/sdk/server'
import {
  UserBuilder,
  agentCardHandler,
  jsonRpcHandler,
} from '@a2a-js/sdk/server/express'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as a2a from '../src/index.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  })))
})

function textPart(text: string) {
  return {
    content: { $case: 'text' as const, value: text },
    metadata: undefined,
    filename: '',
    mediaType: 'text/plain',
  }
}

function agentMessage(text: string): Message {
  return {
    messageId: 'reply-1',
    contextId: 'context-1',
    taskId: '',
    role: Role.ROLE_AGENT,
    parts: [textPart(text)],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  }
}

function task(state: TaskState, text = 'task output'): Task {
  return {
    id: 'task-1',
    contextId: 'context-1',
    status: { state, message: undefined, timestamp: undefined },
    artifacts: [{
      artifactId: 'artifact-1',
      name: '',
      description: '',
      parts: [textPart(text)],
      metadata: undefined,
      extensions: [],
    }],
    history: [],
    metadata: undefined,
  }
}

async function listenA2A(
  onAuthorization?: (value: string | undefined) => void,
  interfaceUrl?: string,
): Promise<string> {
  const app = express()
  const server = createServer(app)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const port = (server.address() as AddressInfo).port
  const baseUrl = `http://127.0.0.1:${String(port)}`
  const card: AgentCard = {
    name: 'Fixture agent',
    description: 'A keyless A2A fixture.',
    supportedInterfaces: [{
      url: interfaceUrl ?? `${baseUrl}/a2a`,
      protocolBinding: 'JSONRPC',
      tenant: '',
      protocolVersion: '1.0',
    }],
    provider: undefined,
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false, extensions: [] },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  }
  const executor: AgentExecutor = {
    async execute(request, bus) {
      const input = request.userMessage.parts.map(part => part.content?.$case === 'text' ? part.content.value : '').join('')
      bus.publish(AgentEvent.message({
        ...agentMessage(`remote:${input}`),
        messageId: 'remote-reply',
        contextId: request.contextId,
      }))
      bus.finished()
    },
    async cancelTask(_taskId, bus) {
      bus.finished()
    },
  }
  const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), executor)
  app.use((req, _res, next) => {
    onAuthorization?.(req.header('authorization'))
    next()
  })
  app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: handler }))
  app.use('/a2a', jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }))
  return baseUrl
}

function parent(): Agent {
  return { id: SessionId('parent') } as unknown as Agent
}

async function setup(agentUrl: string, headers: Record<string, string> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(a2a, {
    providerName: 'a2a',
    agentUrl,
    agentCardPath: '/.well-known/agent-card.json',
    allowedOrigins: [],
    headers,
  })
  return ctx
}

describe('A2A result mapping', () => {
  it('maps direct messages and terminal tasks', () => {
    expect(a2a.a2aResult(agentMessage('direct'))).toEqual({
      output: [{ type: 'text', text: 'direct' }],
      stopReason: 'completed',
    })
    expect(a2a.a2aResult(task(TaskState.TASK_STATE_COMPLETED))).toMatchObject({
      output: [{ type: 'text', text: 'task output' }],
      stopReason: 'completed',
    })
    expect(a2a.a2aResult(task(TaskState.TASK_STATE_CANCELED))).toMatchObject({ stopReason: 'aborted' })
    expect(a2a.a2aResult(task(TaskState.TASK_STATE_REJECTED))).toMatchObject({
      stopReason: 'refusal',
      diagnostic: 'Subagent failure (provider: A2A; category: remote-state; state: rejected)',
    })
    expect(a2a.a2aResult(task(TaskState.TASK_STATE_FAILED))).toMatchObject({ stopReason: 'error' })
  })

  it('rejects non-text output and non-terminal task states', () => {
    const message = agentMessage('ignored')
    message.parts = [{
      content: { $case: 'data', value: { unsafe: true } },
      metadata: undefined,
      filename: '',
      mediaType: 'application/json',
    }]
    expect(a2a.a2aResult(message)).toEqual({
      output: [],
      stopReason: 'error',
      diagnostic: 'Subagent failure (provider: A2A; category: unsupported-output)',
    })
    expect(a2a.a2aResult(task(TaskState.TASK_STATE_WORKING))).toMatchObject({
      stopReason: 'error',
      diagnostic: 'Subagent failure (provider: A2A; category: remote-state; state: non-terminal)',
    })
  })
})

describe('A2A provider through the official SDK', () => {
  it('discovers the Agent Card, sends authorization, and completes a text run', async () => {
    const observedAuthorization: Array<string | undefined> = []
    const baseUrl = await listenA2A((value) => { observedAuthorization.push(value) })
    const ctx = await setup(baseUrl, { authorization: 'Bearer fixture-token' })
    const run = await ctx.subagents.start('a2a', {
      prompt: [{ type: 'text', text: 'hello' }],
      parent: parent(),
      signal: new AbortController().signal,
    })

    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'remote:hello' }],
      stopReason: 'completed',
    })
    expect(run.localAgent).toBeUndefined()
    expect(observedAuthorization).toEqual(['Bearer fixture-token', 'Bearer fixture-token'])
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('fails before publication for unsupported prompt content and unsafe URLs', async () => {
    const baseUrl = await listenA2A()
    const ctx = await setup(baseUrl)
    await expect(ctx.subagents.start('a2a', {
      prompt: [{ type: 'reasoning', text: 'private' }],
      parent: parent(),
      signal: new AbortController().signal,
    })).rejects.toThrow('accepts text prompt blocks only')
    await ctx.fiber.dispose()

    const unsafe = new Context()
    await unsafe.plugin(SessionProjectionRegistry)
    await unsafe.plugin(SubagentRuntime)
    await expect(unsafe.plugin(a2a, {
      providerName: 'a2a',
      agentUrl: 'http://example.com',
      agentCardPath: '/.well-known/agent-card.json',
      allowedOrigins: [],
      headers: {},
    })).rejects.toThrow(
      'must use HTTPS, except for a loopback HTTP endpoint',
    )
    await unsafe.fiber.dispose()
  })

  it('does not send configured headers to an unapproved Agent Card interface origin', async () => {
    const observedAuthorization: Array<string | undefined> = []
    const baseUrl = await listenA2A(
      (value) => { observedAuthorization.push(value) },
      'https://unapproved.example/a2a',
    )
    const ctx = await setup(baseUrl, { authorization: 'Bearer fixture-token' })
    const run = await ctx.subagents.start('a2a', {
      prompt: [{ type: 'text', text: 'hello' }],
      parent: parent(),
      signal: new AbortController().signal,
    })

    await expect(run.result).resolves.toEqual({
      output: [],
      stopReason: 'error',
      diagnostic: 'Subagent failure (provider: A2A; category: transport)',
    })
    expect(observedAuthorization).toEqual(['Bearer fixture-token'])
    await run.dispose()
    await ctx.fiber.dispose()
  })
})
