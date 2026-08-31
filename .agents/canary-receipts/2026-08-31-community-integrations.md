# Community integrations canary receipt — 2026-08-31

## Scope and evidence boundary

- Repository: `/Users/geesh/AI/deepseek-harness`
- Branch: `codex/community-integrations`
- Base HEAD: `430aea34869c662e262ca44b8edc9552466d5efb`
- Window: `2026-08-31T07:39:20Z` through `2026-08-31T08:36:59Z`
- Host: macOS 26.5.2 (25F84), arm64; Node 24.8.0; pnpm 11.7.0; Docker 28.4.0
- Policy: proceed from keyless/read-only checks to isolated local state, local services, and finally credentialed external calls. No secret value was printed or retained.
- Credential presence at the external-call gate: `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GOOGLE_API_KEY` were all absent.

This receipt proves only the executions listed below. Local fixtures and protocol round trips do not prove a third-party deployment, provider response, model quality, production durability, or acceptance of an external side effect.

## Results in risk order

| Risk | Integration | Result | Retained evidence |
| --- | --- | --- | --- |
| R0 | Repository/runtime baseline | PASS | Clean branch at start; exact HEAD and host versions above. Existing Docker containers were inventoried and not touched. |
| R1 | OpenTelemetry | PASS, local wire | `vitest` package checks plus the real Loader child-process e2e completed. The focused unit batch was 33/33 across OTel, A2A, and Promptfoo; the separate OTel Loader e2e was 3/3. The e2e used a local OTLP collector and exercised redaction and feedback modes. |
| R1 | A2A provider | PASS, loopback | Five package tests used the official `@a2a-js/sdk`, a real loopback HTTP Agent Card/JSON-RPC server, authorization propagation, result mapping, unsafe URL rejection, and cross-origin header withholding. No remote A2A deployment was contacted. |
| R1 | Promptfoo adapter | PASS, SDK fixture only | Three tests ran one sample through the real DSH SDK wire protocol and retained session/event metadata. The Promptfoo CLI and a real model provider were not run. |
| R1 | Inspect adapter | PASS, framework import only | `inspect-ai==0.3.260` was installed in an ephemeral uv environment; `python/sdk/tests/test_inspect_model_support.py` passed 3/3. No Inspect task invoked a model. |
| R2 | ToolHive 0.46.0 | PASS | Built `thv` from `github.com/stacklok/toolhive/cmd/thv@v0.46.0`; created group/workload `dsh-canary-20260831` / `dsh-canary-toolhive-20260831`; ran `server-everything:2026.7.4` on `127.0.0.1:50431`; exposed only `echo`; MCP `listTools` returned only `echo`; call returned `Echo: dsh-toolhive-canary-20260831`. Image digest: `sha256:35525e18bcd0d35d524fd34fe786d100085bc3594eca77860c5de16c892f3adb`. |
| R2 | Playwright MCP 0.0.79 | PASS | Started the pinned MCP server over stdio with `--headless --isolated --sandbox --block-service-workers` and an allowlist containing only `http://127.0.0.1:50432`. A temporary loopback page was navigated and snapshotted; 24 tools were discovered and the title, heading, and button were observed. |
| R3 | Microsandbox MCP 0.6.16 | PASS | `runtime_check` reported server 0.6.16, Darwin arm64, host-path allowlist, and dangerous tools disabled. A network-disabled `alpine:3.22` microVM ran with 1 CPU and 128 MiB and returned `dsh-microsandbox-canary-20260831`, exit code 0. The ephemeral sandbox was absent immediately afterward. One earlier response was lost because the canary passed MCP request options in the schema argument position; a name audit proved that ephemeral run had also been destroyed before the corrected call. |
| R4 | Graphiti MCP `mcp-v1.0.2` | PASS, compatibility image and local read-only protocol | Source tag resolved to `19e44a97a929ebf121294f97f26966f0379d8e30`. The published combined and standalone recipes first failed as detailed below. The checked-in compatibility Dockerfile then built image `sha256:4ed5123106d8dfdde71e16f0ed214990484adcd7126d3ab1b941e20a6e47a00e` with pinned base digests, Graphiti Core 0.28.2, `httpx` 0.28.1, and MCP 1.26.0. FalkorDB 4.20.4 and the MCP server ran on a Docker internal network; `/health` returned healthy, Redis returned `PONG`, MCP initialization listed nine tools, and `get_status` reported an active FalkorDB connection. No graph write or model call was attempted. |
| R4 | Temporal SDK 1.23.0 | PASS, orchestration fixture | A real local Temporal CLI 1.8.2 / Server 1.31.2 used in-memory persistence. Worker 1.23.0 completed workflow `dsh-canary-temporal-workflow-20260831`, run `01a056e5-a687-73eb-961a-b229c7a2ebe3`, with 11 history events and a fixed no-side-effect Activity receipt. The Worker and server shut down through `TestWorkflowEnvironment.teardown()`. This proves dispatch, Activity completion, result retention, and history; the Activity did not launch a model-backed DSH runtime. Downloaded binary SHA-256: `e16fc1396c19f87e29e453a78b6be62249397fea06ed0207d1c5f205eb5042bb`. |
| R5 | DeepSeek/model-backed DSH, Promptfoo/Inspect scoring, Graphiti write/recall | BLOCKED | Required provider credentials were absent. The focused real-model e2e reported 1 test file and 1 test skipped. No external model request, billable call, graph mutation, or remote side effect was attempted. |

## Commands and notable diagnostics

The successful focused checks were:

```text
pnpm exec vitest run packages/session/session-telemetry-otel/tests/otel.spec.ts packages/session/session-telemetry-otel/tests/loader-composition.e2e.ts packages/subagent/subagent-a2a/tests/subagent-a2a.spec.ts packages/sdk/client/tests/promptfoo-provider.spec.ts
pnpm exec vitest run --config vitest.e2e.config.ts packages/session/session-telemetry-otel/tests/loader-composition.e2e.ts
uv run --project python/sdk --with 'inspect-ai==0.3.260' pytest -q python/sdk/tests/test_inspect_model_support.py
pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/profiles/headless/tests/real-model.e2e.ts
```

ToolHive initially rejected `--group dsh-canary-20260831` because groups must be created first. The group was then explicitly created. ToolHive logged that the proxy had no request authentication; this canary remained loopback-only and was removed immediately after the MCP call. Its retained raw log is `/Users/geesh/Library/Application Support/toolhive/logs/dsh-canary-toolhive-20260831.log`, SHA-256 `861d93a857ff74583e5568946b1f3fe290ad255c2360d5405bfc0e2fefab5157`.

Temporal dependency installation required explicit approval of the `@swc/core` and `protobufjs` install scripts inside the disposable test project. No repository dependency or lockfile changed.

The initial Graphiti compatibility investigation preserved the upstream failure sequence. The combined Dockerfile's mutable `falkordb/falkordb:latest` base resolved to Trixie and failed while configuring `procps`; the standalone Dockerfile built Graphiti Core 0.28.2 as image `sha256:9e2d2bbfc83f085d8434f769f6e751c1aa8960abe8f94c29bcd8f0d654b646cb` but omitted the imported `httpx`; and a canary-only derivative adding `httpx==0.28.1`, image `sha256:b659f91f9e31042b592e192b975c6c85b8f5da91b9cf5b9c1e4d7040f30d3ee5`, selected incompatible MCP 2.1.1 after the upstream recipe deleted its lock. The repository compatibility Dockerfile fixed those reviewed inputs without changing the DSH MCP client or taking ownership of the upstream services.

The successful Graphiti continuation used `falkordb/falkordb@sha256:adbddd418916c25618564ff8597a919b08bc76452ebeb74eb985c38d7281df62`, no named volume, no host-mounted path, telemetry disabled, a fake provider key, and an internal Docker network with no egress. MCP discovery returned `add_memory`, `clear_graph`, `delete_entity_edge`, `delete_episode`, `get_entity_edge`, `get_episodes`, `get_status`, `search_memory_facts`, and `search_nodes`; only `get_status` was called. Two preliminary orchestration attempts learned that Docker Desktop does not publish a host port from this internal network, and one inline client attempt had a Python quoting error; every attempt used the same exact-name cleanup trap before the successful in-container MCP client run.

## Cleanup and residual state

- No canary container, Docker network, listening port, browser process, Microsandbox process, ToolHive proxy, Temporal Server, or Worker remained after execution.
- The ToolHive workload, its auxiliary DNS container, and its group were removed by exact name. The temporary ToolHive build directory was moved to the macOS Trash and is recoverable there.
- The Microsandbox sandbox self-destroyed and its empty host directory was removed.
- Graphiti MCP/database containers and the internal Docker network were removed by exact name after every attempt. The final residue checks reported zero matching containers and zero matching networks. No named data volume was created.
- Package-manager caches, Go module/build caches, pulled base layers, and the three image tags listed above remain. They are cache artifacts, not running services.
- The Graphiti and Temporal disposable source/project directories were moved to the macOS Trash after this receipt was written and remain recoverable there; their material execution identifiers and hashes are retained above.

## Acceptance decision

ToolHive, Playwright MCP, Microsandbox MCP, local OTel export, loopback A2A, local Temporal orchestration, and Graphiti's pinned compatibility image have executable canary evidence. Promptfoo and Inspect have adapter/framework compatibility evidence only. Graphiti's health, tool discovery, and database status pass locally, but its model-backed write and fresh-session recall remain unproven. All model-backed and remote-service acceptance remains pending credentials and an explicitly reviewed destination, dataset, cost ceiling, and cleanup policy.
