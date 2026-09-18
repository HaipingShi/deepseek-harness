/**
 * Deterministic per-agent tool-call budget guard. A mounted budget caps how
 * many tool calls one agent may dispatch between human inputs; reaching a cap
 * cancels the active turn through the supported cancel lifecycle and denies
 * the over-budget call. Configuration semantics live in the package README;
 * the rationale lives in the call-budget Agent Note.
 * @module @deepseek-ai/dsh-call-budget
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'call-budget'

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: a limit below 1,
 * an empty pattern, or a budget without any limit throws at plugin load,
 * never a silent fall-back). `tools` keys are `*`-wildcard predicates over
 * tool names at call time, not references to registry entries — a pattern
 * matching no currently registered tool is valid (`tools: { mcp_*: 4 }` must
 * stay legal in a deployment that loads no MCP tools).
 */
export interface Config {
  /** Maximum tool calls counted in one budget window, across every tool. */
  total?: number
  /** Per-pattern call caps in one budget window, keyed by `*`-wildcard tool-name patterns. */
  tools?: Record<string, number>
}

export const Config: z<Config> = z.object({
  total: z.number(),
  tools: z.dict(z.number()),
})

/**
 * One agent's budget window: the counters accumulate from one human input to
 * the next. `stopped` latches once a reservation was refused, so machine
 * drivers that immediately continue the agent cannot burn further model
 * requests — the next non-human step is rejected instead.
 */
interface Budget {
  total: number
  perTool: number[]
  stopped: false | string
}

/** Compile one `*`-wildcard pattern to an anchored RegExp (every other regex metacharacter is matched literally). */
function compilePattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/**
 * Validate the config per the fail-loud contract and compile the tool-name
 * patterns once at load.
 * @param config - raw plugin config.
 * @returns the total cap (or `undefined`) and the compiled pattern/cap pairs.
 */
function resolveBudget(config: Config): {
  total: number | undefined
  patterns: ReadonlyArray<{ readonly pattern: RegExp; readonly cap: number }>
} {
  const { total, tools } = config
  if (total === undefined && (tools === undefined || Object.keys(tools).length === 0)) {
    throw new Error('call-budget: mount with at least one limit — `total`, non-empty `tools`, or both')
  }
  if (total !== undefined && (!Number.isInteger(total) || total < 1)) {
    throw new Error(`call-budget: invalid total ${total} — must be an integer >= 1`)
  }
  const patterns: { pattern: RegExp; cap: number }[] = []
  for (const [key, cap] of Object.entries(tools ?? {})) {
    if (key.length === 0) throw new Error('call-budget: `tools` patterns must not be empty')
    if (!Number.isInteger(cap) || cap < 1) {
      throw new Error(`call-budget: invalid cap ${cap} for pattern "${key}" — must be an integer >= 1`)
    }
    patterns.push({ pattern: compilePattern(key), cap })
  }
  return { total, patterns }
}

/**
 * Reserve one call against every matching cap. The reservation is synchronous
 * and runs inside the ordered pre-execute stage, so a parallel batch cannot
 * over-issue: each call's reservation completes before the next call's starts.
 * An over-budget call still consumes the counters it fits under, because the
 * window is stopping anyway and the attempt was made.
 * @returns the refusal text for the first exceeded cap, or `undefined` when
 *   every matching cap had room.
 */
function reserve(budget: Budget, total: number | undefined, toolName: string,
  patterns: ReadonlyArray<{ readonly pattern: RegExp; readonly cap: number }>): string | undefined {
  let refusal: string | undefined
  if (total !== undefined) {
    budget.total += 1
    if (budget.total > total && refusal === undefined) {
      refusal = `tool call budget exhausted: the total budget of ${total} tool calls for this turn is spent`
    }
  }
  for (const [index, { pattern, cap }] of patterns.entries()) {
    if (!pattern.test(toolName)) continue
    const spent = (budget.perTool[index] ?? 0) + 1
    budget.perTool[index] = spent
    if (spent > cap && refusal === undefined) {
      refusal = `tool call budget exhausted: the budget of ${cap} calls for "${toolName}" is spent`
    }
  }
  return refusal
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; limits are re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config): void {
  const { total, patterns } = resolveBudget(config)

  // Per-agent isolation: one agent's spending never trips another's budget.
  // Object lifetime bounds the weak entry without a disposal listener; a
  // session resumed into a fresh Agent object starts with a fresh window.
  const budgets = new WeakMap<Agent, Budget>()

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    // A direct `ctx.tools.execute()` caller belongs to no model turn; only
    // agent-loop calls (model calls and PTC nested sub-dispatches, which
    // forward the agent) participate.
    if (!exec.agent) return next()
    let budget = budgets.get(exec.agent)
    if (budget === undefined) {
      budget = { total: 0, perTool: patterns.map(() => 0), stopped: false }
      budgets.set(exec.agent, budget)
    }
    const refusal = reserve(budget, total, exec.name, patterns)
    if (refusal === undefined) return next()
    // Stop the turn through the supported cancel lifecycle: `cancel` aborts
    // the turn signal synchronously (no await, so a listener inside the
    // scheduler cannot self-deadlock) and keeps queued work for a later turn.
    // The scheduler then drains started calls normally and records synthetic
    // aborted results for unstarted ones, so call/result pairs stay complete.
    budget.stopped = refusal
    exec.agent.cancel({ kind: 'hook', reason: refusal }, { keepInbox: true })
    return { kind: 'deny', reason: refusal }
  })

  ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
    // A human input opens a fresh window: whatever ran before answered its
    // instruction; the new instruction gets the full budget again.
    if (messages.some(message => message.source.kind === 'user')) {
      budgets.delete(agent)
      return next()
    }
    // A machine-continued step (plugin steering or followup) neither resets
    // the window nor may spend a model request on an already-stopped window:
    // reject the step so the turn closes `blocked` at zero model cost.
    if (budgets.get(agent)?.stopped && messages.length > 0) {
      return { kind: 'reject' }
    }
    return next()
  })
}
