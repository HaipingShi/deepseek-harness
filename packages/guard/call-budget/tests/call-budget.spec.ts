import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Config } from '@deepseek-ai/dsh-call-budget'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import * as ToolCallBudget from '@deepseek-ai/dsh-call-budget'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Behavior suite for the tool-call budget guard: deterministic caps over
 * varying-argument sequences, parallel-batch reservation, durable stop reason,
 * per-agent isolation, human-reset vs machine-continuation gating, PTC nested
 * sub-dispatch accounting, and fail-loud config validation — all driven
 * through a real agent loop against a scripted mock adapter (no network, no
 * shell).
 */

/** A scriptable in-repo CodeRuntime (mirrors the PTC unit tier's fake runtime). */
class FakeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fake'
  behavior: (request: CodeRunRequest) => Promise<CodeRunResult> = () => Promise.resolve({ logs: [] })

  run(request: CodeRunRequest): Promise<CodeRunResult> {
    return this.behavior(request)
  }
}

/** Boot the core spine + the guard; the caller registers adapters. */
async function harness(config: Config, options: { tools?: { mode: 'ptc' | 'native' | 'both' } } = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, options.tools === undefined ? {} : { tools: options.tools })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolCallBudget, config)
  if (options.tools !== undefined) await ctx.plugin(FakeRuntime)
  return ctx
}

/** Mount a counting `shell` fixture tool whose executions the test can audit. */
async function mountCountingShell(ctx: Context): Promise<{ executions: () => number }> {
  let executed = 0
  ctx.tools.register(defineContentToolFixture({
    name: 'shell',
    description: 's',
    parameters: {},
    async execute() {
      executed += 1
      return [{ type: 'text', text: `ok ${executed}` }]
    },
  }))
  return { executions: () => executed }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

/** Create an agent and run one user turn from `script`. */
async function runUserTurn(ctx: Context, id: string, adapter: MockAdapter, prompt: string): Promise<Agent> {
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
  await waitForIdle(ctx, agent)
  return agent
}

function eventsOf(agent: Agent): readonly SessionEvent[] {
  return agent.session.snapshotEvents()
}

/** The durable reason of the agent's last turn, typed for assertions. */
function lastTurnEnd(agent: Agent): { turn: number; reason: unknown } {
  const event = eventsOf(agent).findLast((e): e is SessionEvent<'turn/end'> => e.type === 'turn/end')
  if (event === undefined) throw new Error('no turn/end recorded')
  return { turn: event.data.turn, reason: event.data.reason }
}

/** Paired call/result audit: every tool/call seq is cited by exactly one tool/result. */
function callResultPairs(agent: Agent): { calls: number; results: number; unpaired: number } {
  const events = eventsOf(agent)
  const callSeqs = new Set(events.filter(e => e.type === 'tool/call').map(e => e.seq))
  let unpaired = 0
  let results = 0
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    results += 1
    const sources = event.sourceEventSeqs ?? []
    if (!sources.some(seq => callSeqs.has(seq))) unpaired += 1
  }
  return { calls: callSeqs.size, results, unpaired }
}

/** Script chunks for one assistant message that issues several tool calls in one parallel batch. */
function parallelCallsResponse(calls: { id: string; name: string; args?: object }[]): StreamChunk[] {
  const chunks: StreamChunk[] = []
  calls.forEach((call, index) => {
    const argumentsJson = JSON.stringify(call.args ?? {})
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id: ToolCallId(call.id), name: call.name, argumentsDelta: argumentsJson },
      { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: argumentsJson } },
    )
  })
  chunks.push({ type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } })
  chunks.push({ type: 'finish', reason: { kind: 'tool-calls' } })
  return chunks
}

describe('deterministic caps over varying arguments', () => {
  it('stops a varying-argument sequence at the total cap and records the stop reason durably', async () => {
    const ctx = await harness({ total: 8 })
    const shell = await mountCountingShell(ctx)
    // The loop pattern from the field incident: every call differs (`echo step1`,
    // `echo step2`, …), so exact-match repeat detection never fires.
    const script = [
      ...Array.from({ length: 9 }, (_, i) => toolCallResponse(`c${i}`, 'shell', { command: `echo step${i + 1}` })),
      textResponse('never reached'),
    ]
    const adapter = new MockAdapter(script)
    const agent = await runUserTurn(ctx, 'varying', adapter, 'run steps')

    expect(shell.executions()).toBe(8)
    expect(adapter.requests).toHaveLength(9) // the denying step still spent its request; no request 10

    const end = lastTurnEnd(agent)
    expect(end.reason).toMatchObject({
      kind: 'aborted',
      reason: { kind: 'hook', reason: 'tool call budget exhausted: the total budget of 8 tool calls for this turn is spent' },
    })
    // The over-budget call's visible result quotes the same reason.
    const lastResult = eventsOf(agent).findLast((e): e is SessionEvent<'tool/result'> => e.type === 'tool/result')
    const resultBlock = lastResult?.data.message.content[0]
    expect(resultBlock).toMatchObject({ type: 'tool-result', isError: true })
    expect(resultBlock?.type === 'tool-result' && resultBlock.content[0]).toMatchObject({
      type: 'text',
      text: 'Error: tool call budget exhausted: the total budget of 8 tool calls for this turn is spent',
    })
    // Complete call/result pairing across the aborted turn.
    const pairs = callResultPairs(agent)
    expect(pairs.calls).toBe(9)
    expect(pairs.results).toBe(9)
    expect(pairs.unpaired).toBe(0)
  })

  it('executes a within-budget sequence fully, including legitimate repeated calls', async () => {
    const ctx = await harness({ total: 8 })
    const shell = await mountCountingShell(ctx)
    const adapter = new MockAdapter([
      ...Array.from({ length: 4 }, (_, i) => toolCallResponse(`c${i}`, 'shell', { command: 'poll status' })),
      textResponse('done'),
    ])
    const agent = await runUserTurn(ctx, 'within', adapter, 'poll')

    expect(shell.executions()).toBe(4)
    expect(adapter.requests).toHaveLength(5)
    expect(lastTurnEnd(agent).reason).toMatchObject({ kind: 'completed' })
  }, 20_000)

  it('untracked tools pass when only a pattern cap is configured, and the pattern cap stops its own tool', async () => {
    const ctx = await harness({ tools: { 'mcp_*': 2 } })
    const shell = await mountCountingShell(ctx)
    let fetched = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'mcp_browser_navigate',
      description: 'n',
      parameters: {},
      async execute() {
        fetched += 1
        return [{ type: 'text', text: 'page' }]
      },
    }))
    const adapter = new MockAdapter([
      toolCallResponse('n1', 'mcp_browser_navigate', {}),
      toolCallResponse('n2', 'mcp_browser_navigate', {}),
      toolCallResponse('n3', 'mcp_browser_navigate', {}),
      textResponse('never reached'),
    ])
    const agent = await runUserTurn(ctx, 'pattern', adapter, 'navigate')

    expect(fetched).toBe(2)
    expect(shell.executions()).toBe(0)
    expect(lastTurnEnd(agent)).toMatchObject({
      reason: { kind: 'aborted', reason: { kind: 'hook', reason: 'tool call budget exhausted: the budget of 2 calls for "mcp_browser_navigate" is spent' } },
    })
  })
})

describe('parallel batches', () => {
  it('cannot over-issue: a batch larger than the remaining budget executes only the reserved prefix', async () => {
    const ctx = await harness({ total: 3 })
    const shell = await mountCountingShell(ctx)
    const adapter = new MockAdapter([
      parallelCallsResponse([
        { id: 'p1', name: 'shell', args: { n: 1 } },
        { id: 'p2', name: 'shell', args: { n: 2 } },
        { id: 'p3', name: 'shell', args: { n: 3 } },
        { id: 'p4', name: 'shell', args: { n: 4 } },
        { id: 'p5', name: 'shell', args: { n: 5 } },
      ]),
      textResponse('never reached'),
    ])
    const agent = await runUserTurn(ctx, 'parallel', adapter, 'batch')

    expect(shell.executions()).toBe(3)
    const pairs = callResultPairs(agent)
    expect(pairs.calls).toBe(5)
    expect(pairs.results).toBe(5) // 3 ok + 2 synthetic aborted results
    expect(pairs.unpaired).toBe(0)
    expect(lastTurnEnd(agent)).toMatchObject({ reason: { kind: 'aborted', reason: { kind: 'hook' } } })
  })
})

describe('PTC nested sub-dispatches', () => {
  it('count against the same budget: the over-budget nested call is denied and stops the turn', async () => {
    const ctx = await harness({ total: 3 }, { tools: { mode: 'ptc' } })
    let nestedExecutions = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'probe',
      description: 'p',
      parameters: {},
      async execute() {
        nestedExecutions += 1
        return [{ type: 'text', text: `probe ${nestedExecutions}` }]
      },
    }))
    const ctxWithRuntime = ctx as Context & { codeRuntime: FakeRuntime }
    // The program issues three nested probe calls; the third crosses the
    // budget (outer run_code + two nested calls = 3), so it is denied and the
    // turn stops before any further sub-dispatch or model request.
    ctxWithRuntime.codeRuntime.behavior = async (request: CodeRunRequest): Promise<CodeRunResult> => {
      const probe = request.bindings[0]!.functions.probe
      const outcomes: string[] = []
      for (let index = 0; index < 3; index++) {
        try {
          await probe!({})
          outcomes.push('ok')
        } catch (error) {
          outcomes.push(error instanceof Error && 'toolName' in error ? `denied:${String((error as { toolName: unknown }).toolName)}` : 'error')
        }
      }
      return { logs: [], value: outcomes.join(',') }
    }
    const adapter = new MockAdapter([
      toolCallResponse('rc1', 'run_code', { code: 'probe(); probe(); probe()', description: 'Nested budget scenario' }),
      textResponse('never reached'),
    ])
    const agent = await runUserTurn(ctx, 'ptc-nested', adapter, 'run the program')

    expect(nestedExecutions).toBe(2) // the third nested call was denied before dispatch
    expect(lastTurnEnd(agent)).toMatchObject({
      reason: { kind: 'aborted', reason: { kind: 'hook', reason: 'tool call budget exhausted: the total budget of 3 tool calls for this turn is spent' } },
    })
    // Model-visible pairing stays complete (run_code is the one model call);
    // the denied nested call is logged through the PTC dispatch events.
    const pairs = callResultPairs(agent)
    expect(pairs.calls).toBe(1)
    expect(pairs.results).toBe(1)
    expect(pairs.unpaired).toBe(0)
    const dispatchStarts = eventsOf(agent).filter(event => event.type === 'tool/code-dispatch-start')
    expect(dispatchStarts).toHaveLength(3) // two executed + one denied, each logged
  }, 20_000)
})

describe('budget windows', () => {
  it('a human followup opens a fresh window; a machine continuation is rejected at zero model cost', async () => {
    const ctx = await harness({ total: 2 })
    const shell = await mountCountingShell(ctx)
    const adapter = new MockAdapter([
      toolCallResponse('h1', 'shell', {}),
      toolCallResponse('h2', 'shell', {}),
      toolCallResponse('h3', 'shell', {}), // denied by the spent budget
      toolCallResponse('h4', 'shell', {}), // the fresh human window's call
      textResponse('done'),
    ])
    const agent = await runUserTurn(ctx, 'windows', adapter, 'start work')
    expect(lastTurnEnd(agent)).toMatchObject({ reason: { kind: 'aborted', reason: { kind: 'hook' } } })
    const requestsAfterStop = adapter.requests.length

    // Machine continuation (plugin-sourced followup): rejected before any request.
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'continue working' }],
      source: { kind: 'plugin', plugin: 'round-driver', form: 'notice', summary: 'continue' },
    }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(requestsAfterStop)
    expect(lastTurnEnd(agent)).toMatchObject({ reason: { kind: 'blocked' } })
    expect(shell.executions()).toBe(2)

    // Human followup: fresh window, the same tool runs again.
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go again' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(requestsAfterStop + 2) // the tool-call request plus its closing text request
    expect(shell.executions()).toBe(3)
    expect(lastTurnEnd(agent)).toMatchObject({ reason: { kind: 'completed' } })
  })

  it('keys budgets per agent: one agent exhausting its budget never disturbs another', async () => {
    const ctx = await harness({ total: 2 })
    const shell = await mountCountingShell(ctx)
    const adapter = new MockAdapter([
      toolCallResponse('a1', 'shell', {}),
      toolCallResponse('a2', 'shell', {}),
      toolCallResponse('a3', 'shell', {}), // the stopper's denied third call
      textResponse('never reached'),
      textResponse('other agent is fine'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)

    // Agent 1 spins until its budget stops the turn.
    const stopped = await ctx.agentLoop.create(SessionId('stopper'), { provider: 'mock', model: 'mock' })
    stopped.followup(createUserMessage({ content: [{ type: 'text', text: 'spin' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, stopped)
    expect(lastTurnEnd(stopped)).toMatchObject({ reason: { kind: 'aborted', reason: { kind: 'hook' } } })

    // Agent 2 (same guard instance, separate window) works unaffected.
    const healthy = await ctx.agentLoop.create(SessionId('healthy'), { provider: 'mock', model: 'mock' })
    healthy.followup(createUserMessage({ content: [{ type: 'text', text: 'normal work' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, healthy)
    expect(lastTurnEnd(healthy)).toMatchObject({ reason: { kind: 'completed' } })
    expect(shell.executions()).toBe(2) // only the stopped agent's two calls
  }, 20_000)

  it('interrupt after a budget stop and dispose complete without deadlock', async () => {
    const ctx = await harness({ total: 1 })
    await mountCountingShell(ctx)
    const adapter = new MockAdapter([
      toolCallResponse('i1', 'shell', {}),
      toolCallResponse('i2', 'shell', {}),
      textResponse('never reached'),
    ])
    const agent = await runUserTurn(ctx, 'interrupt', adapter, 'go')
    expect(lastTurnEnd(agent)).toMatchObject({ reason: { kind: 'aborted', reason: { kind: 'hook' } } })

    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    await ctx.fiber.dispose()
  })
})

describe('fail-loud configuration', () => {
  it('rejects a budget without limits, non-integer or sub-1 caps, and empty patterns', async () => {
    const expectReject = async (config: Config, message: string): Promise<void> => {
      await expect(new Context().plugin(ToolCallBudget, config)).rejects.toThrow(message)
    }
    await expectReject({}, 'at least one limit')
    await expectReject({ total: 0 }, 'invalid total 0')
    await expectReject({ total: 2.5 }, 'invalid total 2.5')
    await expectReject({ tools: { shell: 0 } }, 'invalid cap 0')
    await expectReject({ tools: { '': 3 } }, 'must not be empty')
  })
})

describe('load path', () => {
  it('has no default export and keeps name/Config/apply through unwrapExports', () => {
    expect('default' in ToolCallBudget).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(ToolCallBudget) as Record<string, unknown>
    expect(unwrapped).toBe(ToolCallBudget)
    expect(unwrapped.name).toBe('call-budget')
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })
})
