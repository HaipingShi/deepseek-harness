/**
 * Remote A2A subagent provider. Agent discovery, transport selection, and wire
 * validation belong to the official A2A JavaScript SDK; this package adapts
 * one blocking text request to the Harness subagent lifecycle.
 * @module @deepseek-ai/dsh-subagent-a2a
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  type Artifact,
  type Message,
  type Part,
  Role,
  type SendMessageRequest,
  type SendMessageResult,
  type Task,
  TaskState,
} from '@a2a-js/sdk'
import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from '@a2a-js/sdk/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  NO_START_CAPABILITIES,
  type ResolvedSubagentStartRequest,
  type SubagentProvider,
  type SubagentResult,
  type SubagentRun,
} from '@deepseek-ai/dsh-subagent'

export const name = 'subagent-a2a'
export const inject = ['subagents']

/** Connection settings for one remote A2A agent. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `a2a`). */
  providerName: string
  /** Absolute HTTP(S) base URL used to discover the remote Agent Card. */
  agentUrl: string
  /** Agent Card path relative to `agentUrl` (default `/.well-known/agent-card.json`). */
  agentCardPath: string
  /** Additional absolute origins allowed for Agent Card-declared interfaces. */
  allowedOrigins: string[]
  /** Explicit HTTP headers sent to Agent Card and message endpoints. */
  headers: Record<string, string>
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('a2a'),
  agentUrl: z.string().required(),
  agentCardPath: z.string().default('/.well-known/agent-card.json'),
  allowedOrigins: z.array(z.string()).default([]),
  headers: z.dict(z.string()).default({}),
})

type ResolvedConfig = Required<Config>

/** A stable, model-safe failure category for a published A2A run. */
type FailureCategory = 'transport' | 'remote-state' | 'unsupported-output'

function diagnostic(category: FailureCategory, state?: string): string {
  const stateField = state === undefined ? '' : `; state: ${state}`
  return `Subagent failure (provider: A2A; category: ${category}${stateField})`
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

function assertAgentUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch (cause) {
    throw new TypeError('subagent-a2a agentUrl must be an absolute HTTP(S) URL', { cause })
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new TypeError('subagent-a2a agentUrl must use HTTPS, except for a loopback HTTP endpoint')
  }
  return url
}

function assertOrigin(value: string): string {
  const url = assertAgentUrl(value)
  if (url.href !== `${url.origin}/`) {
    throw new TypeError('subagent-a2a allowedOrigins entries must be absolute origins without paths, queries, or fragments')
  }
  return url.origin
}

function assertAgentCardPath(value: string): void {
  if (!value.startsWith('/') || value.startsWith('//')) {
    throw new TypeError('subagent-a2a agentCardPath must be an absolute URL path')
  }
  const parsed = new URL(value, 'https://a2a.invalid')
  if (parsed.origin !== 'https://a2a.invalid' || parsed.pathname !== value || parsed.search !== '' || parsed.hash !== '') {
    throw new TypeError('subagent-a2a agentCardPath must contain only an absolute URL path')
  }
}

function authenticatedFetch(
  headers: Readonly<Record<string, string>>,
  allowedOrigins: ReadonlySet<string>,
  operationSignal: AbortSignal,
): typeof fetch {
  const configured = new Headers(headers)
  return async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (!allowedOrigins.has(url.origin)) {
      throw new Error('A2A request origin is not allowed')
    }
    const merged = new Headers(configured)
    if (input instanceof Request) {
      input.headers.forEach((value, key) => { merged.set(key, value) })
    }
    new Headers(init?.headers).forEach((value, key) => { merged.set(key, value) })
    const initialSignal = init?.signal
    const signal = initialSignal === undefined || initialSignal === null
      ? operationSignal
      : AbortSignal.any([operationSignal, initialSignal])
    const response = await fetch(input, { ...init, headers: merged, signal, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new Error('A2A HTTP redirects are not allowed')
    }
    return response
  }
}

function assertCanStart(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('subagent request was aborted before the A2A agent started')
}

function promptParts(content: readonly ContentBlock[]): Part[] {
  const parts: Part[] = []
  for (const block of content) {
    if (block.type !== 'text') {
      throw new TypeError(`subagent-a2a accepts text prompt blocks only; received ${block.type}`)
    }
    parts.push({
      content: { $case: 'text', value: block.text },
      metadata: undefined,
      filename: '',
      mediaType: 'text/plain',
    })
  }
  if (parts.length === 0) throw new TypeError('subagent-a2a requires at least one text prompt block')
  return parts
}

function messageRequest(parts: Part[]): SendMessageRequest {
  return {
    tenant: '',
    message: {
      messageId: randomUUID(),
      contextId: '',
      taskId: '',
      role: Role.ROLE_USER,
      parts,
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    },
    configuration: {
      acceptedOutputModes: ['text/plain'],
      taskPushNotificationConfig: undefined,
      returnImmediately: false,
    },
    metadata: undefined,
  }
}

function textOutput(parts: readonly Part[]): ContentBlock[] | undefined {
  const output: ContentBlock[] = []
  for (const part of parts) {
    if (part.content?.$case !== 'text') return undefined
    output.push({ type: 'text', text: part.content.value })
  }
  return output
}

function messageOutput(message: Message | undefined): ContentBlock[] | undefined {
  if (message === undefined || message.role !== Role.ROLE_AGENT) return undefined
  return textOutput(message.parts)
}

function artifactOutput(artifacts: readonly Artifact[]): ContentBlock[] | undefined {
  const output: ContentBlock[] = []
  for (const artifact of artifacts) {
    const blocks = textOutput(artifact.parts)
    if (blocks === undefined) return undefined
    output.push(...blocks)
  }
  return output
}

function taskOutput(task: Task): ContentBlock[] | undefined {
  if (task.artifacts.length > 0) return artifactOutput(task.artifacts)
  const status = messageOutput(task.status?.message)
  if (status !== undefined) return status
  for (let index = task.history.length - 1; index >= 0; index -= 1) {
    const output = messageOutput(task.history[index])
    if (output !== undefined) return output
  }
  return []
}

/**
 * Convert one official-SDK response into the Harness terminal vocabulary.
 * @param response - validated A2A message or task returned by the SDK.
 * @returns a non-rejecting subagent result.
 */
export function a2aResult(response: SendMessageResult): SubagentResult {
  if ('messageId' in response) {
    const output = messageOutput(response)
    return output === undefined
      ? { output: [], stopReason: 'error', diagnostic: diagnostic('unsupported-output') }
      : { output, stopReason: 'completed' }
  }

  const output = taskOutput(response)
  if (output === undefined) {
    return { output: [], stopReason: 'error', diagnostic: diagnostic('unsupported-output') }
  }
  switch (response.status?.state) {
    case TaskState.TASK_STATE_COMPLETED:
      return { output, stopReason: 'completed' }
    case TaskState.TASK_STATE_CANCELED:
      return { output, stopReason: 'aborted' }
    case TaskState.TASK_STATE_REJECTED:
      return { output, stopReason: 'refusal', diagnostic: diagnostic('remote-state', 'rejected') }
    case TaskState.TASK_STATE_FAILED:
      return { output, stopReason: 'error', diagnostic: diagnostic('remote-state', 'failed') }
    case TaskState.TASK_STATE_INPUT_REQUIRED:
      return { output, stopReason: 'error', diagnostic: diagnostic('remote-state', 'input-required') }
    case TaskState.TASK_STATE_AUTH_REQUIRED:
      return { output, stopReason: 'error', diagnostic: diagnostic('remote-state', 'auth-required') }
    case TaskState.TASK_STATE_UNSPECIFIED:
    case TaskState.TASK_STATE_SUBMITTED:
    case TaskState.TASK_STATE_WORKING:
    case TaskState.UNRECOGNIZED:
    case undefined:
      return { output, stopReason: 'error', diagnostic: diagnostic('remote-state', 'non-terminal') }
  }
}

function startRun(
  request: ResolvedSubagentStartRequest,
  parts: Part[],
  client: Awaited<ReturnType<ClientFactory['createFromUrl']>>,
): SubagentRun {
  const id = SessionId(randomUUID())
  const controller = new AbortController()
  const signal = AbortSignal.any([request.signal, controller.signal])
  const result = client.sendMessage(messageRequest(parts), { signal })
    .then(a2aResult)
    .catch((): SubagentResult => {
      if (signal.aborted) return { output: [], stopReason: 'aborted' }
      return {
        output: [],
        stopReason: 'error',
        diagnostic: diagnostic('transport'),
      }
    })
  let disposed: Promise<void> | undefined
  return {
    id,
    localAgent: undefined,
    result,
    dispose: () => {
      disposed ??= (async () => {
        controller.abort(new Error('A2A subagent disposed'))
        await result
      })()
      return disposed
    },
  }
}

class A2ASubagentProvider implements SubagentProvider {
  readonly capabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly agentUrl: string,
    private readonly agentCardPath: string,
    private readonly headers: Readonly<Record<string, string>>,
    private readonly allowedOrigins: ReadonlySet<string>,
  ) {}

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    assertCanStart(request.signal)
    const parts = promptParts(request.prompt)
    const fetchImpl = authenticatedFetch(this.headers, this.allowedOrigins, request.signal)
    const factory = new ClientFactory({
      transports: [
        new JsonRpcTransportFactory({ fetchImpl }),
        new RestTransportFactory({ fetchImpl }),
      ],
      cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
    })
    let client: Awaited<ReturnType<ClientFactory['createFromUrl']>>
    try {
      client = await factory.createFromUrl(this.agentUrl, this.agentCardPath)
    } catch (cause) {
      assertCanStart(request.signal)
      throw new Error('A2A subagent discovery failed', { cause })
    }
    assertCanStart(request.signal)
    return startRun(request, parts, client)
  }
}

/** Register one remote A2A agent as a one-shot subagent provider. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  const parsedAgentUrl = assertAgentUrl(resolved.agentUrl)
  const agentUrl = parsedAgentUrl.href
  assertAgentCardPath(resolved.agentCardPath)
  const allowedOrigins = new Set([parsedAgentUrl.origin, ...resolved.allowedOrigins.map(assertOrigin)])
  ctx.subagents.registerProvider(new A2ASubagentProvider(
    resolved.providerName,
    agentUrl,
    resolved.agentCardPath,
    Object.freeze({ ...resolved.headers }),
    allowedOrigins,
  ))
}
