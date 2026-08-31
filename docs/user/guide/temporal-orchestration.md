# Orchestrate DSH tasks with Temporal

English | [中文](temporal-orchestration.zh.md)

## Summary

The repository provides a default-off Temporal `1.23.0` Activity adapter and Workflow example for long-lived external orchestration. A Temporal Worker runs each `runDshTask` Activity in one owned DSH SDK runtime, returns the final answer plus a session receipt, heartbeats while the turn is active, closes the runtime on cancellation, and always reaps it before settlement. The deterministic Workflow contains no DSH or model calls and sets `maximumAttempts: 1`, because replay-safe orchestration does not make an agent turn or its tool effects idempotent.

This integration complements rather than replaces DSH's built-in workflow capability. Use the in-process worker-thread engine for model-written fan-out within one live Harness. Use Temporal when an application already needs durable external scheduling, histories, cancellation, and operator-managed workers across process restarts.

## Table of Contents

- [Prepare an integration project](#prepare-an-integration-project)
- [Run the worker](#run-the-worker)
- [Start a Workflow](#start-a-workflow)
- [Cancellation and retries](#cancellation-and-retries)
- [Verify the integration](#verify-the-integration)
- [Security and ownership](#security-and-ownership)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

-----

<a id="prepare-an-integration-project"></a>
## Prepare an integration project

The examples are source references, not published SDK files. Copy them into an operator-owned TypeScript or ESM worker project and install the reviewed versions there:

```sh
pnpm add @deepseek-ai/dsh-sdk-client \
  @temporalio/activity@1.23.0 \
  @temporalio/client@1.23.0 \
  @temporalio/worker@1.23.0 \
  @temporalio/workflow@1.23.0
```

Use one dedicated Harness home for the Worker deployment and initialize its selected SDK profile before accepting tasks:

```sh
export DSH_TEMPORAL_HOME='/absolute/path/to/dedicated-dsh-home'
export DSH_TEMPORAL_TASK_QUEUE='dsh-agent-tasks'
export TEMPORAL_ADDRESS='localhost:7233'
export TEMPORAL_NAMESPACE='default'
```

Keep model credentials in the Worker environment or its secret manager. Temporal receives Workflow and Activity inputs and results; DSH separately records the model-visible prompt, tool calls, tool results, and final response under the dedicated Harness home.

<a id="run-the-worker"></a>
## Run the worker

Start the copied worker entry with the Node version required by DSH:

```sh
node temporal-worker.mjs
```

The worker registers `dshTaskWorkflow` and `runDshTask`. The Activity adapter requires `DSH_TEMPORAL_HOME`, creates a fresh DSH session and runtime for each attempt, emits a Temporal heartbeat immediately and every ten seconds, and returns `{ finalResponse, receipt: { sessionId, eventCount, turnEndReason } }`. One runtime per Activity costs startup time but gives every attempt explicit ownership and cleanup.

<a id="start-a-workflow"></a>
## Start a Workflow

From an application with a Temporal client, start the exported Workflow on the same task queue and pass serializable input:

```js
const handle = await client.workflow.start(dshTaskWorkflow, {
  taskQueue: 'dsh-agent-tasks',
  workflowId: 'review-change-123',
  args: [{ prompt: 'Review the checked-out change and return a concise report.' }],
})
const result = await handle.result()
```

Store both Temporal's Workflow id/run id and the returned DSH session id. The Temporal history proves orchestration and the Activity result; the DSH log proves what entered the model and what tools executed. Neither receipt alone proves that an external side effect was accepted by its target system.

<a id="cancellation-and-retries"></a>
## Cancellation and retries

The example sets a 30-second heartbeat timeout, so the Worker receives cancellation while a long DSH turn is running. The adapter reacts by closing the SDK runtime; the current DSH SDK has no mid-turn cancel method, so process teardown is the cancellation mechanism. Temporal's default wait-for-cancellation-completion behavior then waits for Activity cleanup before the Workflow observes cancellation.

The Workflow fixes `retry.maximumAttempts` to `1`. Do not increase it merely because Temporal can retry Activities: a second attempt creates a new DSH session and can repeat model cost, messages, file edits, browser actions, purchases, or other tool effects. Enable retries only after the entire task has an application-level idempotency key and every reachable effect either deduplicates that key or is proven read-only. Timeouts and Worker crashes can still leave uncertainty about effects completed immediately before failure.

<a id="verify-the-integration"></a>
## Verify the integration

Before production use:

1. Run one harmless prompt and retain the Temporal history plus the returned DSH session log.
2. Cancel a running Workflow and confirm the Activity heartbeats, closes its runtime, and leaves no child process.
3. Stop the Worker between Workflow tasks, restart it, and confirm Temporal dispatches outstanding work without repeating a completed Activity.
4. Force an Activity failure after one tool effect and confirm `maximumAttempts: 1` prevents a duplicate agent run.
5. Exercise retention, redaction, and access controls on both Temporal history and the DSH home.

The repository's keyless test imports the real Activity adapter, validates input and isolated-home requirements, checks receipt projection and cleanup, covers cancellation before and during launch, and asserts the pinned Workflow's heartbeat and no-retry settings. It does not run a Temporal Server or Worker, call a model provider, execute a tool, replay a Workflow history, or prove crash recovery.

<a id="security-and-ownership"></a>
## Security and ownership

Temporal inputs and results may contain prompts, model output, DSH session ids, paths, and business data. Configure Temporal payload encryption, namespace access, retention, and visibility policy for that data. A dedicated DSH home isolates Harness records from personal sessions but does not isolate concurrent Activities from a shared workspace, credentials, external account, or network; allocate those resources per task when effects can conflict.

DSH owns the agent runtime, model route, tools, session log, and subprocess cleanup. The adapter owns the one-Activity-to-one-runtime mapping and receipt projection. Temporal owns Workflow history, task dispatch, heartbeat delivery, cancellation, and Worker recovery. The application owns Workflow ids, idempotency, authorization, task queues, secrets, data retention, and acceptance of external effects.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Temporal Activity adapter](../../../packages/sdk/client/examples/temporal-activity.mjs) — DSH runtime ownership, heartbeat context, cancellation, and receipt mapping.
- [Temporal Workflow](../../../packages/sdk/client/examples/temporal-workflow.mjs) — deterministic proxy call with retries disabled.
- [Temporal Worker](../../../packages/sdk/client/examples/temporal-worker.mjs) — task queue and Worker assembly.
- [TypeScript SDK](../../../packages/sdk/client/README.md) — run, result, timeout, and cleanup semantics.
- [Built-in workflow engine](../../../packages/workflow/workflow-worker-thread/README.md) — live in-Harness orchestration and its containment limits.
- [Temporal TypeScript SDK](https://docs.temporal.io/develop/typescript) — upstream deployment and durability guidance.

<a id="dev-note"></a>
## Dev Note

Keep the five Temporal package versions aligned in the operator project. A first-class DSH Temporal backend would need durable correlation, idempotency vocabulary, resume semantics, SDK cancellation, and external-server integration tests; these source examples intentionally do not add that product surface or a repository dependency.
