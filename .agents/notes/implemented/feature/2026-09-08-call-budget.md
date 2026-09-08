# Agent Note: Tool-call budget guard

Status: implemented

English | [中文](2026-09-08-call-budget.zh.md)

## Problem

A 2026-09-08 session-diagnosis pass found an agent whose tool list had lost every MCP tool across a process restart and then spent three turns issuing `bash` calls whose commands differed on every invocation (`echo step1`, `echo focus1`, …). The shipped `repeat-tool-reminder` never fired: it detects only exact repeats, and every call was different. Nothing in the composition could bound the run by count, and an advisory nudge was never going to catch a loop whose calls never repeat. Deployments needed a deterministic, explicit way to stop unbounded tool spending without asking another model whether progress was being made.

## Decision

`@deepseek-ai/dsh-call-budget` (packages/guard/call-budget) is an opt-in guard plugin. Mounted with at least one limit, it counts each agent's tool calls between human-authored messages and stops the turn when an attempted call would exceed the configured cap — the call that fits the cap still executes.

- **Counting** happens in the `tools/pre-execute` waterfall. That stage runs sequentially per call even inside a parallel batch, so a reservation is made strictly before the next call's check — a parallel batch cannot over-issue. A call counts when it reaches the stage with an agent attached: model calls, PTC nested sub-dispatches (they forward the agent), and calls a later listener denies. Agent-less direct executions do not count.
- **Stopping** uses the supported cancel lifecycle: `agent.cancel({kind: 'hook', reason}, {keepInbox: true})` plus a deny whose reason text matches. `cancel` aborts the turn signal synchronously, so a listener inside the scheduler cannot self-deadlock on a stop that waits for tools; the scheduler drains started calls and records synthetic results for skipped ones, keeping call/result pairs complete. The durable `turn/end` carries `{kind: 'aborted', reason: {kind: 'hook', reason}}`, making the stop reason user-visible and reconstructable.
- **Windows** reset when an `agent/pre-step` claim contains a `user`-sourced message. A claim without a user message while the window is stopped is rejected, ending the turn `blocked` before any model request — machine drivers that continue a stopped agent cannot buy more requests, and a human's next message always opens a fresh window. Counters live in a per-agent `WeakMap`; different agents are isolated, and a resumed process starts fresh.
- **Configuration** is `total` (calls per window across all tools) plus `tools` (`*`-wildcard pattern → cap). Values must be integers ≥ 1, at least one limit is required, and violations throw at load.

## Alternatives considered

- **Escalate `repeat-tool-reminder` to blocking.** Rejected: the reminder's contract is advice-only and its detection is exact-match by design; a blocking escalation would still miss every varying-argument loop and would muddy one plugin's two unrelated behaviors.
- **Mark a fabricated success with `concludesTurn`.** Rejected: `concludesTurn` exists only on successful tool results, and fabricating a successful result from a policy denial would lie to the model and the log. The cancel path produces honest denied/aborted results.
- **Count per turn number.** Rejected: machine continuation mechanisms (goal drivers, followups) open new turn numbers, so a per-turn counter resets with every automatic continuation and the loop resumes; the window keyed to human input is the smallest unit that bounds machine-driven spinning.
- **Semantic progress judgment by another LLM.** Rejected: it is non-deterministic, costs the very tokens the guard exists to save, and cannot be audited from the log the way a counter can.

## Consequences

Deployments gain a hard, auditable ceiling on tool spending for loops that no similarity heuristic can catch, at the price of a stopping rule that cannot distinguish productive volume from a loop — a mid-task stop is possible whenever a cap is set too low, and raising the cap is the only relief. The window is in-memory per process, so the budget is not a durable quota and resume restarts it. Counting begins at the guard's listener, so a call denied by an earlier `tools/pre-execute` listener escapes the count, and a machine driver that keeps re-waking a stopped agent produces zero-cost blocked turns until the driver's own retry policy gives up. `repeat-tool-reminder` stays mounted and unchanged: advice on exact repeats remains advisory, and the budget is the backstop.

## Testing

`packages/guard/call-budget/tests/call-budget.spec.ts` drives a real agent loop with a scripted mock adapter: varying-argument sequences stop at `total` with exact denial text, durable `turn/end` reason, complete call/result pairing, and no further model requests; a parallel batch larger than the remaining budget executes only the reserved prefix; within-budget repeated calls pass untouched; pattern caps stop their own tool set; a human followup reopens the window while a plugin followup is rejected at zero model cost; budgets stay per agent; interrupt-plus-dispose after a stop completes; configuration fails loud; a PTC `run_code` scenario proves nested sub-dispatches count against the same budget; the keyless recorded-session scenario `snapshots/session/call-budget-stop/` boots the real `dsh --profile headless` through the snapshot lane and pins the persisted budget stop; and the module keeps its namespace shape through the Loader's `unwrapExports`.
