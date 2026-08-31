# Agent Note: Graphiti MCP memory example

Status: implemented

English | [中文](2026-08-31-graphiti-mcp-memory-example.zh.md)

## Problem

The existing memory MCP examples cover local stores but not a temporal knowledge graph that extracts entities and relationships through configured model providers. Graphiti offers that surface over MCP, yet its reviewed HTTP server has no endpoint authentication and its database, model calls, asynchronous ingestion, telemetry, and destructive maintenance tools create materially different operational obligations.

## Decision

Add Graphiti MCP `mcp-v1.0.2` as a fourth default-off memory overlay. The overlay connects through the generic Streamable HTTP client, requires an explicit `DSH_GRAPHITI_MCP_URL`, accepts only plain HTTP on a loopback hostname, sends no headers or provider credentials, and fails loud when startup cannot discover the service. Graphiti and its database run under separate operator supervision.

The guide records the tag commit, its Graphiti Core 0.28.2+ security floor, the upstream telemetry opt-out, asynchronous ingestion, group scoping, and the complete read/write/delete/maintenance tool surface. A network deployment requires a separate authenticated ingress decision and is intentionally not expressible by this loopback reference.

## Validation

The keyless memory suite parses all four examples, checks each pin and generic MCP fields, rejects missing and non-loopback Graphiti endpoints through the real Loader activation path, connects the checked-in HTTP transport to the package-owned fixture, and observes a discovered tool. The existing transport-substitution matrix also proves Graphiti's row can load under the generic client without contacting a third party.

The test does not run Graphiti, a graph database, an LLM or embedding provider, asynchronous extraction, persistence, deletion, authentication, or telemetry. A live acceptance still requires write, fresh-session recall, and use evidence under one reviewed group id.

## Alternatives considered

**Add a Graphiti-specific DSH plugin.** Rejected because MCP already carries the provider's tool schemas and calls; a dedicated plugin would make Graphiti configuration and lifecycle a maintained DSH interface without improving the connection boundary.

**Offer a remote HTTP example with an empty header map.** Rejected because the reviewed server has no endpoint authentication. A copyable network example would normalize exposing read, write, delete, and maintenance operations without an identity decision.

**Start Graphiti and its database from the DSH overlay.** Rejected because one MCP child row cannot responsibly own the database, model credentials, migrations, persistence, health, and cleanup of a multi-service deployment.

## Consequences

DSH gains an inspectable integration path without adopting Graphiti schemas or lifecycle. Operators own service and database versions, model and embedding credentials, endpoint protection, tenant isolation, quotas, retention, backups, provider cost, and graph cleanup. Updating the reference pin requires repeating both the keyless checks and the live memory acceptance.
