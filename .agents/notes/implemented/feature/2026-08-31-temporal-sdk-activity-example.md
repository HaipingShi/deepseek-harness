# Agent Note: Temporal SDK Activity example

Status: implemented

English | [中文](2026-08-31-temporal-sdk-activity-example.zh.md)

## Problem

DSH's workflow engine orchestrates live subagents inside one Harness process but intentionally has no journal or restart resume. Temporal can supply durable external orchestration, yet calling DSH from deterministic Workflow code would violate replay rules, and ordinary Temporal Activity retries can duplicate model cost and tool side effects.

## Decision

Provide source-only Temporal `1.23.0` examples beside the TypeScript SDK. A deterministic Workflow proxies one `runDshTask` Activity with a start-to-close timeout, heartbeat timeout, and `maximumAttempts: 1`. The Activity owns one fresh `DeepSeekHarness` runtime and session per attempt, requires a dedicated DSH home, emits heartbeats so cancellation is delivered, closes the runtime on cancellation, reaps it on every settlement path, and returns final text plus session id, event count, and turn-end reason.

The examples add no repository dependency and are not included in the published SDK package. Operators copy them into an integration project that owns aligned Temporal packages, Worker deployment, task queues, connection policy, and credentials.

## Validation

The keyless test imports the Activity adapter without installing Temporal by injecting the Activity context and Harness factory. It proves receipt mapping, immediate heartbeat, cleanup, input and home validation, pre-launch cancellation, active-run cancellation, and the checked-in Workflow's no-retry and heartbeat settings. It does not run a Temporal Server or Worker, replay history, call a model, execute a tool, or prove restart recovery.

## Alternatives considered

**Implement a Temporal workflow-engine provider.** Rejected because the current seam accepts one live caller-owned run and has no durable correlation or resume vocabulary; pretending Temporal fits it would hide incompatible lifecycle promises.

**Call DSH directly from Workflow code.** Rejected because process launch, model calls, current time, and tool effects are nondeterministic and must remain in Activities.

**Keep Temporal's default Activity retries.** Rejected because a new DSH session cannot deduplicate an earlier attempt's model call or external tool effects. Applications may opt into retries only with end-to-end idempotency.

**Reuse one DSH runtime across Activity attempts.** Rejected because ownership, cancellation, concurrent access, and crash recovery would become Worker-global and receipts could cross attempt boundaries.

## Consequences

Existing Temporal applications gain a concrete, tested adapter while DSH's built-in workflow behavior remains unchanged. Each Activity pays runtime startup and requires two evidence stores. Cancellation uses SDK process teardown because the wire has no mid-turn cancel method. First-class durable resume remains future work rather than an implied property of this example.
