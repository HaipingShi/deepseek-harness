---
description: "The remote A2A subagent provider for users and maintainers connecting a Harness composition to an A2A v1.0 agent."
kind: "package-reference"
---

# @deepseek-ai/dsh-subagent-a2a

English | [中文](README.zh.md)

## Summary

`dsh-subagent-a2a` registers one remote A2A agent as a one-shot Harness subagent provider. The official `@a2a-js/sdk` discovers the Agent Card, selects JSON-RPC or HTTP+JSON from its declared interfaces, validates wire values, and sends one blocking message. The Harness provider owns text projection, cancellation, terminal-state mapping, safe diagnostics, and the shared subagent lifecycle. The remote agent receives no parent transcript, local tool authority, filesystem path, or Harness configuration unless the task text itself contains it.

## Table of Contents

- [Use this package](#use-this-package)
- [Protocol and lifecycle](#protocol-and-lifecycle)
- [Security and evidence](#security-and-evidence)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the subagent seam before this provider. The repository includes a default-off overlay at [`apps/cli/config/examples/subagent-a2a/cordis.yml`](../../../apps/cli/config/examples/subagent-a2a/cordis.yml):

```sh
export DSH_A2A_AGENT_URL='https://reviewed-agent.example'
pnpm dsh --profile headless \
  --patch apps/cli/config/examples/subagent-a2a/cordis.yml \
  'Delegate the bounded task to the a2a provider.'
```

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `a2a` | Registry name on `ctx.subagents` |
| `agentUrl` | required | Absolute Agent Card base URL; HTTPS is required except on loopback |
| `agentCardPath` | `/.well-known/agent-card.json` | Absolute path containing no query or fragment |
| `allowedOrigins` | `[]` | Additional exact origins authorized for Agent Card-declared interfaces |
| `headers` | `{}` | Explicit headers sent during discovery and message calls |

Supply credentials from deployment configuration, for example `authorization: !!js process.env.DSH_A2A_AUTHORIZATION`. Never commit a bearer token. By default, requests and headers remain on the `agentUrl` origin. Add another exact HTTPS origin only after reviewing an interface declared there. Redirects are rejected instead of forwarding a request through an unreviewed hop. Headers authenticate the caller but do not prove that the discovered card, its declared endpoint, or the remote implementation is trusted.

<a id="protocol-and-lifecycle"></a>
## Protocol and lifecycle

Provider startup validates configuration and text-only input, then resolves the Agent Card through the official SDK. Successful discovery is the publication boundary. The published run sends one message with `returnImmediately: false`, accepts `text/plain`, and passes the run's cancellation signal through the SDK. Disposal aborts the local HTTP operation and waits for the result to settle.

A direct agent message or a completed task becomes `completed`. Canceled, rejected, and failed tasks become `aborted`, `refusal`, and `error`. `input-required`, `auth-required`, non-terminal tasks, unknown output media, and transport failures become `error` with a bounded fixed diagnostic. Task artifacts are preferred; otherwise the status message and latest agent history message are considered. Remote exception text, response payloads, URLs, headers, and task content never enter the diagnostic.

<a id="security-and-evidence"></a>
## Security and evidence

The Agent Card is discovery metadata, not authorization. Review its origin, supported interface URL, protocol version, security requirements, declared skills, retention policy, and every downstream system that can receive the task. Use a dedicated credential and send only data approved for that remote operator. HTTPS is mandatory for non-loopback endpoints; loopback HTTP remains available for local development. Discovery observes the run cancellation signal, and both discovery and message requests reject HTTP redirects.

The keyless integration test boots an official A2A JSON-RPC server on loopback, serves a real Agent Card, verifies header forwarding, sends a text message through the official client, and checks the Harness result. It also proves unsafe HTTP URLs, non-text prompts, non-text output, and non-terminal states fail closed. This is interoperability evidence for the fixture, not an external deployment canary or A2A conformance certification.

No runtime invariant companion is published because the subagent seam owns provider registration and run lifecycle, while the official SDK validates A2A wire values; this adapter exposes no second local observation that can detect drift independently.

<a id="model-experience"></a>
## Model Experience

### Remote child request

#### What the model sees

The remote A2A agent receives the delegated text blocks and its own server-side composition. It receives no parent conversation or local Harness capabilities. Non-text blocks and optional Harness subagent capabilities are rejected before dispatch.

#### Token effect

The remote agent pays for an independent context. Its token accounting is not projected into the parent session.

#### KV Cache effect

Independent of the parent request cache. Remote cache behavior belongs to the A2A server and its model provider.

### Parent tool result, indirectly

#### What the model sees

Through `dsh-tool-subagent`, the parent receives the remote final text or the consumer's error presentation. Agent Card fields, intermediate task state, and transport payloads are not model-visible.

#### Token effect

The final result or error is appended to the parent conversation and retained until compaction.

#### KV Cache effect

Append-only; the result follows the existing reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One-shot text only** — images, files, data parts, streaming, follow-up turns, `input-required`, and `auth-required` flows are not projected.
- **No remote task cancellation after acknowledgement** — disposal aborts the local request; a server that continues after client disconnect needs its own execution and retention policy.
- **No Agent Card signature policy** — the SDK parses card signatures, but this provider does not configure a trust root or require verification.
- **No inbound A2A server** — this package delegates outward only; exposing Harness agents requires a separately authenticated, tenant-aware server with durable task ownership.
- **No optional Harness start capabilities** — agent options, structured output, depth limits, tool filters, and personas cannot be imposed across this protocol adapter.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
