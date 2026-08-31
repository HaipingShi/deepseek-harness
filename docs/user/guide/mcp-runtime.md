# Run governed MCP servers with ToolHive

English | [中文](mcp-runtime.zh.md)

## Summary

This default-off integration connects DSH to one ToolHive-managed MCP workload through the generic Streamable HTTP client. ToolHive owns discovery, process or container isolation, network policy, secrets, tool filtering, audit, and workload lifecycle; DSH owns tool registration, model calls, session logging, and its MCP connection lifecycle. Registry metadata helps you find a server but does not establish that its package, image, permissions, or behavior is trustworthy.

## Table of Contents

- [Review and start a workload](#review-and-start-a-workload)
- [Connect DSH](#connect-dsh)
- [Verify the integration](#verify-the-integration)
- [Security and ownership](#security-and-ownership)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

-----

<a id="review-and-start-a-workload"></a>
## Review and start a workload

Use ToolHive `v0.46.0` or review the current release before adapting these commands. Inspect the resolved registry record before starting it, choose an exact tool allowlist, and retain ToolHive's default loopback proxy and isolated container network:

```sh
thv registry info <server> --format json
thv run <server> --name dsh-<server> --tools <tool-a>,<tool-b> --enable-audit
thv list --format json
```

The official MCP Registry and a ToolHive registry are discovery inputs. Review the resolved package or image identity, version, digest or provenance, requested secrets, filesystem mounts, network destinations, and tool list. Do not treat a registry entry or popularity count as an execution approval.

<a id="connect-dsh"></a>
## Connect DSH

Copy the running workload's loopback URL from `thv list`, including its `/mcp` path, then start DSH with the checked-in overlay:

```sh
export DSH_TOOLHIVE_MCP_URL=http://127.0.0.1:<port>/mcp
pnpm dsh web --patch apps/cli/config/examples/mcp-runtime/toolhive.cordis.yml
```

The overlay sets `failOnStartupError: true`; an unset URL, unreachable proxy, or failed initial tool discovery prevents that plugin from activating. It sends no authorization header because the common local ToolHive proxy is loopback-only. Add explicit headers in a private copy only when the selected deployment authenticates incoming MCP clients.

One overlay represents one stable tool namespace named `toolhive`. Copy the row and choose a unique `id` and `serverName` for another workload. Keep names stable after use because session history and permission rules record the model-facing `mcp__<serverName>__<tool>` name.

<a id="verify-the-integration"></a>
## Verify the integration

Run these checks before granting broader tools or credentials:

1. Confirm `thv list --format json` reports the selected workload as running and shows the expected loopback MCP URL.
2. Start DSH and confirm only the allowlisted `mcp__toolhive__...` tools appear.
3. Call one read-only tool with non-sensitive fixture data and confirm ToolHive's audit output records the request.
4. Stop the workload and confirm the call fails visibly; restart or reload it and confirm the discovered tool set returns.
5. Inspect the DSH session log and ToolHive audit output separately. Neither record alone proves the other component's behavior.

The repository's keyless test substitutes a local HTTP MCP fixture for ToolHive and proves that the checked-in overlay parses, rejects a missing endpoint, loads through the real Cordis Loader, and discovers a tool. It does not execute a ToolHive container, contact a registry, or approve a third-party server.

<a id="security-and-ownership"></a>
## Security and ownership

ToolHive and DSH enforce different parts of the operation. Configure both before sending sensitive data.

| Concern | Owner |
|---|---|
| Registry lookup and workload resolution | ToolHive and the configured registry |
| Package or image review and version pin | Operator |
| Container network, mounts, secrets, tool filter, incoming auth, audit | ToolHive deployment |
| MCP connection, tool-name namespace, call timeout, reconnect, model exposure | DSH MCP client |
| Prompt, tool arguments, tool results, and session retention | DSH deployment and selected MCP server |

Use dedicated integration credentials with the minimum upstream scope. Keep the proxy on loopback unless an authenticated deployment explicitly requires remote access. Treat tool arguments, results, and audit records as potentially sensitive data, and define their retention and redaction before enabling production traffic.

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP client package](../../../packages/mcp/mcp-client/README.md) — transport, naming, reconnect, and result behavior.
- [Memory MCP examples](mcp-memory.md) — direct stdio examples without a separate runtime manager.
- [ToolHive](https://github.com/stacklok/toolhive) — upstream runtime and registry documentation.
- [Official MCP Registry](https://github.com/modelcontextprotocol/registry) — registry API and publication metadata.

<a id="dev-note"></a>
## Dev Note

The automated test owns only the DSH side of the connection. A release-maintained external canary is required before this page can claim a specific third-party workload runs correctly under ToolHive.
