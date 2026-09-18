---
description: "Opt-in loop-hygiene guard that caps how many tool calls one agent may spend between human inputs, for deployments bounding runaway tool loops by count."
kind: "package-reference"
---

# @deepseek-ai/dsh-call-budget

English | [中文](README.zh.md)

## Summary

An agent that cannot reach its goal can keep calling tools forever — retrying a failing command, or running one variant of a command after another — and no reminder helps when every call is different. `dsh-call-budget` bounds that failure by count: you configure a maximum number of tool calls per budget window: calls that fit the cap execute normally, and the first attempted call beyond it is denied while the guard cancels the turn. The limit is a cost control, not a progress judge: it cannot tell useful work from a loop, so caps belong on deployments that know their normal call volume. The guard ships nothing enabled; mounting the plugin with at least one limit is the entire opt-in.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the guard when one agent's tool spending must stop at a known ceiling even when every call is different. Keep `repeat-tool-reminder` mounted alongside it: the reminder advises on exact repeats and never blocks, while the budget is the hard backstop that ends the turn.

### When to choose it

Choose it for autonomous or scheduled runs where a stuck agent burns real resources — shell executions, page navigations, billable tool calls — faster than a human notices. Avoid it when legitimate work has no predictable call count, because an agent that hits the cap mid-task has its turn stopped even if it was about to finish; raising the cap is the only relief.

### Minimal configuration

One entry in a `cordis.yml` or `--patch` overlay; at least one limit is required:

```yaml
- insert:
    - id: call-budget
      name: '@deepseek-ai/dsh-call-budget'
      config:
        total: 24          # every tool call of one window, across all tools
        tools:
          bash: 8          # calls of one window per matching tool name
          'mcp_*': 12      # `*`-wildcard patterns name tool sets
```

| Field | Default | Meaning |
|---|---|---|
| `total` | — | Maximum tool calls counted in one budget window, across every tool; at least one of `total`/`tools` is required |
| `tools` | — | Per-pattern caps in one budget window, keyed by `*`-wildcard tool-name patterns; a call matching several patterns consumes each cap |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-call-budget) is the exhaustive source for every accepted field.

### The budget window

A window opens when the agent's turn starts from a human-authored message and spans everything the agent does until the next human message, including turns that machine drivers continue automatically. Machine-continued work therefore cannot reset the budget and resume spinning; a step continued from plugin input while the window is stopped is rejected before any model request is spent. A new human message opens a fresh window with the full budget. Counters live in memory per agent: different agents never share a window, and a session resumed into a new process starts with a fresh window.

### What happens at the cap

The call that would exceed a cap is denied — its result is the visible error `Error: tool call budget exhausted: …` — and the agent's turn is cancelled through the standard cancel path, carrying the same reason. The turn ends as `aborted` with a `hook` cause naming the spent cap, so the stop reason is visible in the transcript and reconstructable from the log. Calls already dispatched finish and record their results normally; calls still queued in the cancelling batch receive recorded aborted results, so every logged call has its result. Pending inbox work survives for a later turn.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the guard counts and stops, and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Deterministic, not heuristic.** A cap counts calls; it never judges progress, inspects arguments for similarity, or reads the prompt. The only inputs are the tool name and the configured numbers.
- **Reserve in the ordered stage.** Counting happens in `tools/pre-execute`, which the scheduler runs sequentially per call even inside a parallel batch — each call's reservation completes before the next call's starts, so a batch cannot over-issue against the remaining budget.
- **Stop through the supported lifecycle.** Reaching a cap calls `agent.cancel({kind: 'hook', reason}, {keepInbox: true})`, which aborts the turn signal synchronously; a listener running inside the scheduler cannot deadlock on a stop that waits for tools. The scheduler's own abort handling drains started calls and records synthetic results for skipped ones.
- **Fail loud at load.** A mount without limits, a cap below 1, a non-integer cap, or an empty pattern throws at plugin load, never a silent change of behavior.

### What counts

Every call that reaches `tools/pre-execute` with an agent counts, in these groups: model-initiated calls, PTC `run_code` nested sub-dispatches (they forward the agent through the same stage), and calls a later listener denies. A direct `ctx.tools.execute()` caller without an agent is not part of any turn and does not count. A call that reserves and is then denied still consumed its reservation. Counters are exact at window scope; there is no look-back into a finished window.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, fail-loud validation, reservation and window listeners |
| — | No runtime invariant companion is published; the counters are private to one plugin instance and expose no package-owned snapshot for an independent companion to observe. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough: the tool-call pipeline the guard hooks, the advisory sibling guard, and the exhaustive configuration reference.

- [Tools subsystem reference](../../../docs/subsystems/tools.md) — the `tools/pre-execute` waterfall and the cancel-driven turn end the guard builds on.
- [Repeat-tool reminder](../repeat-tool-reminder/README.md) — the advisory exact-repeat guard that complements a budget.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-call-budget) — every accepted config field and its source declaration.
- [guard group map](../README.md) — the sibling guard packages and the loop-hygiene family.

-----

<a id="model-experience"></a>
## Model Experience

### Denied call at the cap

#### What the model sees

The over-budget call returns an error result quoting the spent cap; the turn ends at that step, no tool schema or prompt text is added, and later calls in the same batch receive recorded aborted-before-dispatch results.

##### Denial result text

```markdown
Error: tool call budget exhausted: the total budget of 24 tool calls for this turn is spent
```

#### Token effect

The denial text is a one-line error result in retained history; it replaces the tool output the call would otherwise have produced.

#### KV Cache effect

Append-only; the denial follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the guard is a poor fit. They are current package constraints, not a task backlog.

- **A cost cap, not a progress judge** — the guard stops spending at the configured count whether or not the work was productive; choosing safe caps is the deployment's responsibility.
- **Windows are in-memory and per process** — a session resumed into a new process starts with a fresh window; the budget is not a durable quota.
- **Only pre-execute arrivals count** — a call an earlier `tools/pre-execute` listener denies before the guard's listener runs is not counted; order depends on the surrounding composition.
- **Machine drivers can re-wake a stopped agent** — each re-wake is rejected before any model request, but a driver that loops on wake produces empty blocked turns until its own retry policy gives up.
- **No per-window reporting** — the guard exposes no usage surface; audit consumption from the session log's tool calls.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [call-budget feature note](../../../.agents/notes/implemented/feature/2026-09-08-call-budget.md) records the design alternatives — advisory escalation, `concludesTurn` marking, per-turn keys — and why the cancel lifecycle plus the human-reset window won.

</details>
