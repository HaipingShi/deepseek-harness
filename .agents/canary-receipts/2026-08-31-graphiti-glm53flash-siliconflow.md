# Graphiti GLM 5.3 Flash and SiliconFlow canary receipt

## Outcome

**PASS with the repository-owned `ZaiGraphitiClient` and FalkorDB group-filter repair.** The initial operator override reached Z.AI but failed when `glm-5.3-flash` returned a top-level array instead of Graphiti Core's required object. The dedicated client uses Chat Completions with thinking disabled, validates the requested Pydantic model, and permits one bounded repair call. The version-locked installer also escapes allowed hyphens in both Graphiti Core FalkorDB full-text query builders. The rebuilt service persisted an episode under an unchanged hyphenated group id through SiliconFlow embeddings, and a fresh MCP session recalled the expected verification command.

This receipt records the failed baseline and both successful continuations executed on 2026-08-31 in Asia/Shanghai. The final state was captured at `2026-08-31T23:11:44+0800`.

## Reviewed scope

| Item | Value |
|---|---|
| Graphiti MCP source | `mcp-v1.0.2`, commit `19e44a97a929ebf121294f97f26966f0379d8e30` |
| Graphiti image | `dsh-graphiti-mcp:mcp-v1.0.2-zai`, image `sha256:d9d5c19d32ab7babbdbe52457c4e516e37e27c4dcda6fe3d4233592b94dcb1ea` |
| Graphiti Core | `0.28.2` |
| FalkorDB image | `sha256:adbddd418916c25618564ff8597a919b08bc76452ebeb74eb985c38d7281df62` |
| LLM | Z.AI Coding Plan, `glm-5.3-flash`, `https://api.z.ai/api/coding/paas/v4` |
| Embedder | SiliconFlow, `BAAI/bge-m3`, 1024 dimensions, `https://api.siliconflow.cn/v1` |
| Failed baseline group | `dsh-canary-20260831-glm53flash-bgem3` |
| Dedicated-client group | `dshcanary20260831zaiclientv1` |
| Dedicated-client text | `In project CanaryJuniper, the verification command is pnpm run verify-zai-adapter and the maintainer runs it before creating a commit.` |
| Hyphen-compatibility group | `dsh-canary-20260831-zai-client-hyphen-v2` |
| Hyphen-compatibility text | `In project CanaryCedar, the verification command is pnpm run verify-hyphen-group and the maintainer runs it before creating a commit.` |
| Host MCP endpoint | `http://127.0.0.1:8010/mcp/` |
| Persistent volume | `dsh_graphiti_falkordb_data` |

The canaries sent only their canary text and Graphiti extraction prompts to Z.AI. During the final hyphen-compatibility continuation, service logs recorded four HTTP 200 Chat Completions responses from Z.AI and twelve HTTP 200 embedding responses from SiliconFlow, including the fresh-session search embedding. Provider response identifiers and billing data were not retained, so this receipt does not claim exact provider-side billing or cost.

## Runtime controls

The Compose project is `dsh-graphiti-live`. FalkorDB has no host-published port and is reachable only through the internal `graphiti-backend` network. Graphiti joins that network and a provider-egress network, publishes only `127.0.0.1:8010`, drops all Linux capabilities, sets `no-new-privileges`, limits each service to 2 GiB and 2 CPUs, disables Graphiti telemetry, and sets `SEMAPHORE_LIMIT=1`.

Credentials remain outside the repository in `/Users/geesh/.dsh/graphiti/zai.env` and `/Users/geesh/.dsh/graphiti/siliconflow.env`; both files were mode `0600`, and their parent directory was mode `0700`. No credential value was printed or written to this receipt.

The running image contains the repository-owned compatibility installer from `apps/cli/config/examples/mcp-memory/graphiti-zai/`. It adds the explicit `zai` provider to the pinned Graphiti MCP v1.0.2 source, installs `ZaiGraphitiClient`, validates structured output against Graphiti's requested Pydantic model, allows at most one application repair call, and escapes hyphens in both Graphiti Core 0.28.2 FalkorDB full-text group-filter implementations. The previous `/Users/geesh/.dsh/graphiti/overrides/sitecustomize.py` remains on disk as baseline evidence but is not mounted or present in the Graphiti container's `PYTHONPATH`.

Configuration hashes at receipt time:

- `config.yaml`: `8a5aa9f3a0f94c0160046c3b70517900d8ec5305b7e67e3cd678aa3cec6da0ee`
- `compose.yaml`: `0959b63f2e4fe6721828b4784fa9b618f918931c3711628b56fb0b147442bf55`
- `overrides/sitecustomize.py`: `fa4fd8cd68efd077bf4297189e168babd423e8d4f43954a451903a341cfc83d6`

## Failed baseline evidence

1. `docker compose config --quiet` passed. Static assertions confirmed loopback-only port `8010`, no FalkorDB host port, and an internal database network.
2. Both containers became healthy. `/health` returned `{"status":"healthy","service":"graphiti-mcp"}`.
3. MCP initialization negotiated protocol `2025-11-25`, listed nine Graphiti tools, and `get_status` reported an active FalkorDB connection.
4. The first episode attempt used Graphiti's default OpenAI Responses client and made three requests to `https://api.z.ai/api/coding/paas/v4/responses`; each returned HTTP 404.
5. Selecting `OpenAIGenericClient` moved requests to `/chat/completions`. Z.AI returned HTTP 200, but thinking consumed the short diagnostic response and Graphiti received empty content.
6. The official Z.AI `thinking.type=disabled` parameter produced a completed response. The raw response was `finish_reason=stop`, contained JSON inside a Markdown fence, and reported 24 prompt tokens plus 25 completion tokens for the captured minimal probe.
7. After the bounded fence adapter, the same local structured probe returned `{'ok': True}`.
8. The final real `add_memory` request was accepted asynchronously, and Z.AI returned HTTP 200 for extraction. Queue processing then failed with `graphiti_core.prompts.extract_nodes.ExtractedEntities() argument after ** must be a mapping, not list`.
9. The canary polling client was stopped after the queue error. A fresh `get_episodes` call returned `No episodes found`; direct FalkorDB queries returned 0 nodes and 0 relationships for the canary graph.

Health and protocol discovery prove only local service readiness. They do not satisfy model-backed write, persistence, or fresh-session recall acceptance.

## Dedicated-client continuation

1. Five client behavior tests passed for direct schema success, complete Markdown-fence removal, one successful repair, rejection after one invalid repair, and Z.AI base URL rejection. The installer test first failed without `install.py`, then passed against Graphiti MCP v1.0.2 with Graphiti Core 0.28.2. The final image build reran all six Python tests and an explicit provider-factory smoke test.
2. The focused repository configuration suite passed all 11 tests. It verifies the pinned upstream commit, named Docker build context, build-time adapter tests, installer invocation, explicit factory smoke, and documented `zai` provider configuration.
3. The image was rebuilt from Graphiti MCP commit `19e44a97a929ebf121294f97f26966f0379d8e30`. Only the Graphiti container was recreated; the healthy FalkorDB container and named volume were preserved. Startup reported `LLM: zai / glm-5.3-flash`, `Creating Z.AI client`, and successful Graphiti initialization.
4. A first dedicated-client canary used group `dsh-canary-20260831-zai-client-v1`. Z.AI and SiliconFlow both returned HTTP 200, proving the request crossed the prior structured-output blocker, but Graphiti's FalkorDB query failed because hyphens in this group identifier produced a RediSearch parse error. The polling client was stopped, and direct queries confirmed 0 nodes and 0 relationships for this graph.
5. The canary was repeated without changing code or provider configuration under group `dshcanary20260831zaiclientv1`. `add_memory` accepted the episode, and `get_episodes` observed the persisted CanaryJuniper episode on the third five-second poll.
6. A separately initialized MCP client called `search_memory_facts` with the question `What command should the CanaryJuniper maintainer run before creating a commit?`. It returned two facts containing `pnpm run verify-zai-adapter`, including `The maintainer runs pnpm run verify-zai-adapter before creating a commit`.
7. Direct FalkorDB queries for the successful group returned 4 nodes and 5 relationships. This establishes model-backed extraction, embedding, persistence, and fresh-session semantic recall for this canary input.

## Hyphen-compatibility continuation

1. The failure reproduced directly against the populated FalkorDB index: `(@group_id:"dsh-canary-20260831-zai-client-v1")` returned `RediSearch: Syntax error at offset 15 near dsh`, while otherwise identical filters with each hyphen encoded as `\-` executed successfully. Graphiti Core 0.28.2 validates hyphens as allowed group-id characters but its two FalkorDB query builders only enclosed values in quotes.
2. A failing installer test copied the pinned Graphiti Core package, installed the compatibility patch, and required both the legacy driver and operations-based query builder to produce `(@group_id:"dsh\-canary\-v1") (Canary)`. The test failed before the repair and passed after the installer applied the same exact-anchor replacement to both files.
3. The rebuilt image reran all six Python tests and the provider-factory smoke. The running container reported image `sha256:d9d5c19d32ab7babbdbe52457c4e516e37e27c4dcda6fe3d4233592b94dcb1ea`; only Graphiti was recreated, while FalkorDB and its named volume remained attached.
4. The live canary used group `dsh-canary-20260831-zai-client-hyphen-v2` without rewriting it. `add_memory` queued the CanaryCedar episode, and `get_episodes` observed it on the third five-second poll. No RediSearch or queue-processing error appeared in the service logs.
5. A separately initialized MCP client asked which command CanaryCedar's maintainer should run before committing. `search_memory_facts` returned two facts containing `pnpm run verify-hyphen-group`, and both retained the exact hyphenated group id.
6. Direct FalkorDB queries returned 5 nodes and 6 relationships for the hyphenated graph. This establishes extraction, embedding, persistence, and fresh-session semantic recall for the previously failing identifier class.

Official references: [Z.AI API endpoints and Coding Plan restriction](https://docs.z.ai/api-reference/introduction), [Chat Completions request fields](https://docs.z.ai/api-reference/llm/chat-completion), and [thinking mode](https://docs.z.ai/guides/capabilities/thinking-mode).

## Residual state and risk

`dsh-graphiti-live-falkordb-1` and `dsh-graphiti-live-graphiti-1` remain running and healthy. The named volume remains attached. The original failed graphs remain present with 0 nodes and 0 relationships; the successful alphanumeric graph remains present with 4 nodes and 5 relationships; the successful hyphenated graph remains present with 5 nodes and 6 relationships. No cleanup or destructive Graphiti tool was called.

Z.AI documents the Coding Plan endpoint for supported coding tools and recommends the general API for other uses; Graphiti eligibility under the Coding Plan remains operator-owned and unverified by this technical canary. The canary covers short English memories and semantic queries, not multilingual quality, long episodes, sustained concurrency, rate limits, failure recovery, provider billing, or production availability. The group-filter repair is locked to the reviewed Graphiti Core 0.28.2 source and must be revalidated or removed when that dependency changes.

## Acceptance status

- Local containers, network isolation, health, MCP discovery, and database connection: **PASS**
- Z.AI authentication and Chat Completions reachability for `glm-5.3-flash`: **PASS**
- Dedicated `ZaiGraphitiClient` schema validation and bounded repair behavior: **PASS**
- SiliconFlow embedding request and vector persistence: **PASS**
- Graphiti episode extraction and persistence: **PASS**
- Fresh-session semantic recall: **PASS**
- Hyphenated Graphiti group identifiers: **PASS with the version-locked two-path FalkorDB repair**
- Production readiness: **NOT CLAIMED; provider eligibility and broader operational acceptance remain open**
