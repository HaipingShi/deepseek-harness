# Run microVM sandboxes through Microsandbox MCP

English | [中文](microsandbox-mcp.zh.md)

## Summary

This default-off integration starts the pinned `microsandbox-mcp` executable through DSH's generic stdio MCP client. Microsandbox supplies hardware-isolated microVM execution while DSH owns model-facing tool registration and session logging. The checked-in overlay selects the local backend, requires an explicit host-path allowlist, disables the upstream dangerous-tools switch, and caps output and default execution time. It does not install the runtime, download images, enable the cloud backend, or narrow the upstream server's tool namespace.

## Table of Contents

- [Install the reviewed executable](#install-the-reviewed-executable)
- [Choose host paths](#choose-host-paths)
- [Start DSH](#start-dsh)
- [Verify the integration](#verify-the-integration)
- [Security and ownership](#security-and-ownership)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

-----

<a id="install-the-reviewed-executable"></a>
## Install the reviewed executable

Use a supported host with hardware virtualization, then install exactly the reviewed package version before starting DSH:

```sh
pnpm add --global microsandbox-mcp@0.6.16
microsandbox-mcp --version
```

Keep installation separate from agent startup. Runtime installation, native binary acquisition, OCI image pulls, and host virtualization setup execute code outside the model session and remain operator-owned actions. Follow the upstream platform prerequisites before attempting a live canary.

<a id="choose-host-paths"></a>
## Choose host paths

Set a colon-separated allowlist containing only directories that Microsandbox may mount, copy, or snapshot for this task:

```sh
export DSH_MICROSANDBOX_HOST_PATHS='/absolute/path/to/disposable-workspace'
```

The overlay deliberately refuses to start when this value is absent instead of accepting the MCP server's current-working-directory default. Use a disposable, non-secret directory. An allowlisted path grants the upstream tools access according to their operation; it is not read-only and does not protect files inside that path from mutation or disclosure.

<a id="start-dsh"></a>
## Start DSH

Start the normal Web composition with the default-off overlay:

```sh
pnpm dsh web --patch apps/cli/config/examples/mcp-sandbox/microsandbox.cordis.yml
```

The overlay fixes `MSB_BACKEND=local`, uses `MICROSANDBOX_MCP_HOST_PATH_POLICY=allowlist`, sets `MICROSANDBOX_MCP_ENABLE_DANGEROUS=0`, limits one returned payload to 256 KiB, and gives ordinary upstream operations a 60-second default timeout. A startup error prevents the MCP client from activating. Select the cloud backend, profile, API key, larger output, or dangerous-tool mode only in a separately reviewed deployment overlay.

<a id="verify-the-integration"></a>
## Verify the integration

Before assigning real work:

1. Start with one empty disposable directory and confirm only `mcp__microsandbox__...` tools appear.
2. Run the upstream runtime check without installing anything from the model session.
3. Create a sandbox, execute a harmless command, read its logs, and stop and remove it.
4. Confirm a mount or host-copy operation outside the allowlisted directory fails.
5. Confirm the host has no surviving sandbox, shell session, volume, snapshot, SSH endpoint, or unexpected image after cleanup.

The repository's keyless test checks the exact upstream pin and safety environment, rejects a missing host-path allowlist, substitutes a local stdio MCP fixture, boots the real Cordis Loader, and observes one discovered tool. It does not boot a microVM, install Microsandbox, pull an image, test the host hypervisor, or prove external cleanup.

<a id="security-and-ownership"></a>
## Security and ownership

Enabling this server registers its complete discovered MCP namespace. That namespace can include runtime installation, sandbox and shell lifecycle, command execution, host copy, mounts, volumes, images, snapshots, SSH, and SFTP. The upstream dangerous-tools switch is one guard, not a complete DSH authorization policy. Use a dedicated agent profile and `ctx.tools.restrict()` or a `tools/pre-execute` policy when the model should receive only a reviewed subset; require human approval for state-changing or host-crossing operations.

MicroVM isolation separates guest workloads from the host more strongly than the in-process DSH sandbox policy, but it does not constrain DSH itself, the MCP process, allowed host paths, image provenance, network egress, credentials, or upstream implementation defects. DSH owns MCP process lifecycle, tool naming, calls, and session logging. Microsandbox owns the microVM runtime and its MCP operations. The operator owns host prerequisites, binary and image provenance, tool authorization, paths, network policy, capacity, cleanup, and any cloud credentials.

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP client package](../../../packages/mcp/mcp-client/README.md) — stdio lifecycle, naming, timeout, and result behavior.
- [Microsandbox](https://github.com/superradcompany/microsandbox) — microVM runtime, supported hosts, and SDKs.
- [Microsandbox MCP](https://github.com/superradcompany/microsandbox-mcp) — server tools and environment configuration.
- [Tool runtime](../../../packages/core/tools/README.md) — per-agent restrictions and pre-execution policy.

<a id="dev-note"></a>
## Dev Note

Keep the executable pin, environment names, and safety assertions synchronized with upstream. A native DSH `fs`, `subprocess`, or `terminal` provider over Microsandbox would be a separate capability-seam project with lifecycle, cancellation, projection, and end-to-end snapshot requirements; this MCP example does not claim that integration.
