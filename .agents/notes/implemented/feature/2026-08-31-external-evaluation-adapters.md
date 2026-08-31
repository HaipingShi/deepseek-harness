# Agent Note: External evaluation adapters

Status: implemented

English | [中文](2026-08-31-external-evaluation-adapters.zh.md)

## Problem

Promptfoo and Inspect can score agent output, but calling the underlying model API directly would bypass the composed DSH prompt, tools, session log, provider route, and lifecycle. A loose shell wrapper would return text without a stable session receipt, error taxonomy, or proven child-process cleanup.

## Decision

Provide two default-off repository examples over the existing TypeScript and Python SDKs. The Promptfoo custom provider maps one rendered prompt to a fresh DSH runtime and session, returns the committed assistant text, and places the session id, event count, and turn-end reason in response metadata. The Inspect `ModelAPI` serializes ordered text messages with explicit roles into one DSH prompt, rejects Inspect-defined tools, runs one fresh runtime and session, maps only known stop reasons, and records the same receipt metadata.

Both examples require a dedicated `DSH_EVAL_HOME`, keep third-party installation outside repository dependencies, and pin the reviewed instructions to Promptfoo `0.122.2` and Inspect AI `0.3.260`. They omit token usage and cost because the SDK result has no authoritative aggregate for those fields.

## Validation

The Promptfoo test dynamically loads the same ESM file that Promptfoo consumes, executes it through the real TypeScript SDK JSON-RPC transport against its package-owned scripted runtime, then checks output, receipt metadata, pre-launch cancellation, and the explicit-home requirement. The Python test executes message serialization and stop-reason mapping without an Inspect dependency. A separate compatibility smoke imported and constructed the adapter with the official `inspect-ai 0.3.260` wheel. No test invokes a model provider or third-party scorer.

## Alternatives considered

**Point evaluators at the model provider directly.** Rejected because the result would measure a different application without DSH's composed context, tools, logs, or lifecycle.

**Expose an OpenAI-compatible HTTP façade.** Rejected because no current DSH service owns that protocol, authentication, streaming, cancellation, tenancy, or deployment lifecycle.

**Reuse one runtime for every parallel sample.** Rejected for the first integration because evaluator concurrency, cancellation, session ownership, and cleanup would become shared mutable state. A later throughput optimization must preserve independent sessions and bounded teardown.

**Project Inspect-defined tools into DSH.** Rejected because DSH tools are composition-owned, model-visible, logged capabilities; accepting evaluator schemas without a provider and executor would change identity and enforcement semantics.

## Consequences

The adapters add no runtime dependency and do not change a shipped profile. Each sample pays process startup cost, evaluator logs and DSH logs require separate retention policy, and users must preserve both artifacts for correlation. Image inputs, evaluator-defined tools, mid-turn cancellation, authoritative token/cost projection, and a release canary remain unsupported.
