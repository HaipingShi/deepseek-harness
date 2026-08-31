# Agent Note: Graphiti MCP memory example

Status: implemented

English | [中文](2026-08-31-graphiti-mcp-memory-example.zh.md)

## Problem

The existing memory MCP examples cover local stores but not a temporal knowledge graph that extracts entities and relationships through configured model providers. Graphiti offers that surface over MCP, yet its reviewed HTTP server has no endpoint authentication and its database, model calls, asynchronous ingestion, telemetry, and destructive maintenance tools create materially different operational obligations.

## Decision

Add Graphiti MCP `mcp-v1.0.2` as a fourth default-off memory overlay. The overlay connects through the generic Streamable HTTP client, requires an explicit `DSH_GRAPHITI_MCP_URL`, accepts only plain HTTP on a loopback hostname, sends no headers or provider credentials, and fails loud when startup cannot discover the service. Graphiti and its database run under separate operator supervision.

The reviewed tag's combined Dockerfile uses a mutable FalkorDB base, and its standalone Dockerfile discards the lock before resolving an unbounded MCP major and excludes an imported `httpx` dependency with the development group. Ship a compatibility Dockerfile beside the overlay, build it from the exact tag's `mcp_server` directory, and pin the Python and uv image digests, Graphiti Core 0.28.2, `httpx` 0.28.1, and MCP 1.26.0. The recipe takes a repository-owned named build context and installs `ZaiGraphitiClient` as an explicit `zai` provider into the pinned source; exact source anchors fail the build when upstream code drifts. This recipe remains operator-built and separately supervised; it does not move Graphiti lifecycle into DSH.

`ZaiGraphitiClient` accepts only Z.AI's documented general and Coding Plan base URLs, uses Chat Completions `json_object` mode with thinking disabled, validates the decoded object against Graphiti's requested Pydantic model, and makes one repair call only after JSON or schema validation fails. A second invalid result raises a content-free diagnostic, so Graphiti does not retry malformed output as an unbounded application loop or write an unvalidated value to the graph.

The guide records the tag commit, the compatibility pins, the upstream telemetry opt-out, asynchronous ingestion, group scoping, and the complete read/write/delete/maintenance tool surface. A network deployment requires a separate authenticated ingress decision and is intentionally not expressible by this loopback reference.

## Validation

The keyless memory suite parses all four examples, checks each pin and generic MCP field, statically rejects drift in the compatibility image's reviewed inputs, requires the named Z.AI build context and its build-time unit-test invocation, rejects missing and non-loopback Graphiti endpoints through the real Loader activation path, connects the checked-in HTTP transport to the package-owned fixture, and observes a discovered tool. The Python suite covers fenced objects, a repaired top-level array, a failed repair without output leakage, the Z.AI endpoint allowlist, and the exact-source factory installation. The existing transport-substitution matrix also proves Graphiti's row can load under the generic client without contacting a third party.

The default test does not run Graphiti, a graph database, an LLM or embedding provider, asynchronous extraction, persistence, deletion, authentication, or telemetry. A separate local canary builds the exact source commit, starts the pinned database and compatibility image on an internal network, waits for health, and discovers MCP tools through the loopback endpoint. The retained [canary receipt](../../../canary-receipts/2026-08-31-graphiti-glm53flash-siliconflow.md) records a successful model-backed write, persistence, and fresh-session semantic recall under one reviewed alphanumeric group id; it does not claim production readiness.

## Alternatives considered

**Add a Graphiti-specific DSH plugin.** Rejected because MCP already carries the provider's tool schemas and calls; a dedicated plugin would make Graphiti configuration and lifecycle a maintained DSH interface without improving the connection boundary.

**Offer a remote HTTP example with an empty header map.** Rejected because the reviewed server has no endpoint authentication. A copyable network example would normalize exposing read, write, delete, and maintenance operations without an identity decision.

**Start Graphiti and its database from the DSH overlay.** Rejected because one MCP child row cannot responsibly own the database, model credentials, migrations, persistence, health, and cleanup of a multi-service deployment.

**Rely on prompt instructions or a local runtime monkeypatch for Z.AI output.** Rejected because Z.AI documents JSON-object mode rather than OpenAI's JSON Schema response mode, and an unversioned monkeypatch cannot fail against a changed Graphiti factory. The dedicated provider validates the requested model and bounds repair independently of prompt compliance.

## Consequences

DSH gains an inspectable integration path without adopting Graphiti schemas or lifecycle. The compatibility recipe owns a narrow Z.AI adapter for the pinned Graphiti source, while operators own endpoint eligibility, service and database versions, model and embedding credentials, endpoint protection, tenant isolation, quotas, retention, backups, provider cost, and graph cleanup. A schema failure can double one logical extraction step's model calls. Updating the reference pin requires repeating the Python adapter tests, exact-source installation, keyless DSH checks, and live memory acceptance.
