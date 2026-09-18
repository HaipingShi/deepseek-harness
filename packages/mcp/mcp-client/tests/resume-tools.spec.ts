import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { Config } from '@deepseek-ai/dsh-mcp-client'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Keyless integration proof for the MCP bridge across a session resume: with
 * one composition held fixed, a NEW session's model request carries the
 * discovered MCP tools, a RESUMED session's request still carries them, and a
 * scripted model call reaches the real fixture MCP server over stdio and
 * returns a checkable result. This is the counter-evidence to the field
 * incident where a restart changed the composition and the MCP tools vanished:
 * under a constant composition, resume does not drop bridged tools.
 *
 * A fresh Context over the same persistence root is this repository's standard
 * cross-process simulation (see apps/cli headless resume e2e): only the JSONL
 * log on disk survives between the two runs.
 */

const fixtureServerPath = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))
const packageDir = fileURLToPath(new URL('..', import.meta.url))

function fixtureConfig(): Config {
  return {
    transport: 'stdio',
    serverName: 'fixture',
    command: process.execPath,
    args: [fixtureServerPath],
    env: {},
    cwd: packageDir,
    toolCallTimeoutMs: 15_000,
    failOnStartupError: true,
  }
}

async function mountComposition(persistenceRoot: string, adapter: LlmAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot })
  // The REAL plugin entry through a Loader-equivalent mount: discovery joins
  // the same tool registry that assembles every model request.
  await McpClient.apply(ctx, fixtureConfig())
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

/** Tool names advertised on the Nth model request (0-based). */
function requestedTools(adapter: MockAdapter, request: number): string[] {
  return (adapter.requests[request]?.tools ?? []).map(schema => schema.name)
}

const SESSION_ID = 'mcp-resume-tools'

let ctx: Context | undefined
let root: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('mcp-client: bridged tools survive a resume under one composition', () => {
  it('keeps discovered tools on new and resumed requests and completes a scripted tool call', async () => {
    root = await mkdtemp(join(tmpdir(), 'mcp-resume-tools-'))

    // Run 1: a new session. The very first request must already carry the
    // fixture server's discovered tools (A1), and a scripted MCP call (A3)
    // must reach the real stdio fixture server and log its result.
    const firstAdapter = new MockAdapter([
      toolCallResponse('t1', 'mcp__fixture__greet', { name: 'resume-proof' }),
      textResponse('done'),
    ])
    ctx = await mountComposition(root, firstAdapter)
    const first = await ctx.agentLoop.create(SessionId(`session-${SESSION_ID}`), { provider: 'mock', model: 'mock' })
    first.followup(createUserMessage({ content: [{ type: 'text', text: 'greet via mcp' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, first)

    expect(requestedTools(firstAdapter, 0)).toContain('mcp__fixture__greet')
    const greetResult = first.session.snapshotEvents().findLast(e => e.type === 'tool/result')
    expect(JSON.stringify(greetResult?.data)).toContain('Hello, resume-proof!')
    await ctx.fiber.dispose()
    ctx = undefined

    // Run 2: a brand-new context (fresh registries, fresh MCP server process)
    // over the SAME persistence root resumes the session. The resumed turn's
    // request must still carry the bridged tools (A2) and a fresh scripted
    // call must reach the NEW server process (A6).
    const secondAdapter = new MockAdapter([
      toolCallResponse('t2', 'mcp__fixture__greet', { name: 'second-process' }),
      textResponse('resumed done'),
    ])
    ctx = await mountComposition(root, secondAdapter)
    const resumedHandle = await ctx.agentLoop.resume(ctx, {
      resumeSessionId: SessionId(`session-${SESSION_ID}`),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const resumed = resumedHandle.agent
    resumed.followup(createUserMessage({ content: [{ type: 'text', text: 'greet again via mcp' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, resumed)

    expect(requestedTools(secondAdapter, 0)).toContain('mcp__fixture__greet')
    const resumedResult = resumed.session.snapshotEvents().findLast(e => e.type === 'tool/result')
    expect(JSON.stringify(resumedResult?.data)).toContain('Hello, second-process!')
  }, 60_000)
})
