# Agent Note: A2A subagent provider

Status: implemented

English | [中文](2026-08-31-a2a-subagent-provider.zh.md)

## Problem

The subagent seam supported in-process children, local subprocess protocols, and separate Harness runtimes, but could not delegate a bounded task to a network A2A agent. Treating an Agent Card as a generic HTTP endpoint would duplicate protocol discovery and validation while obscuring which component owns remote identity, task state, cancellation, and credentials.

## Decision

Add `@deepseek-ai/dsh-subagent-a2a` as a one-shot remote provider using `@a2a-js/sdk` `1.1.0`. The official SDK owns Agent Card resolution, JSON-RPC or HTTP+JSON transport selection, protocol headers, and wire decoding. The provider accepts text blocks only, sends one blocking request, maps the official terminal task states to the shared subagent result, passes cancellation to the HTTP operation, and emits only fixed safe diagnostics.

Require HTTPS except for loopback HTTP. Send authentication only through explicit configured headers and apply those headers to discovery and message requests. Requests remain on the configured origin unless `allowedOrigins` explicitly authorizes another exact origin, and HTTP redirects are rejected. Advertise no optional Harness start capabilities and no parent-context inheritance. Do not infer that card discovery authorizes the remote endpoint or that request abortion cancels server-side execution.

## Validation

A keyless test starts the official Express JSON-RPC adapter with `DefaultRequestHandler`, serves a real Agent Card, observes discovery and message authorization headers, and executes a text round trip through the official client factory and the Harness subagent seam. Focused cases reject unsafe non-loopback HTTP, an unapproved interface origin, non-text input, non-text output, and non-terminal task results. No test contacts an external agent or model provider.

## Alternatives considered

**Implement A2A JSON-RPC directly.** Rejected because transport negotiation, protocol versions, wire validation, and future compatibility belong to the maintained protocol SDK.

**Expose every A2A content part as Harness text.** Rejected because URL, raw bytes, and structured data have different trust and rendering requirements. The first provider negotiates and accepts `text/plain` only.

**Treat request abortion as remote task cancellation.** Rejected because the blocking client may not receive a task id before disconnection, and HTTP cancellation does not prove the server stopped execution.

**Ship an inbound server in the same package.** Rejected because outbound delegation and public task hosting have different authentication, tenancy, persistence, rate limiting, and lifecycle owners. An inbound adapter requires its own design and acceptance evidence.

## Consequences

The package adds the official A2A JavaScript SDK as a runtime dependency and Express only as a test dependency for the SDK's server fixture. Every run performs Agent Card discovery, supports one text turn, and returns no remote token or cost accounting. Streaming, continuation, signed-card policy, inbound hosting, task polling, and server-confirmed cancellation remain explicit limitations.
