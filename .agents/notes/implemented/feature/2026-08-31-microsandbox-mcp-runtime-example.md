# Agent Note: Microsandbox MCP runtime example

Status: implemented

English | [中文](2026-08-31-microsandbox-mcp-runtime-example.zh.md)

## Problem

DSH needs a bounded path to hardware-isolated local execution without confusing its same-process sandbox policy with a microVM security boundary or taking ownership of an upstream runtime's complete lifecycle. A loose MCP example could also expose the launch directory by default, let a model install runtime components, or imply that disabling one dangerous-tools switch authorizes the remaining tool namespace.

## Decision

Ship one default-off stdio overlay under `apps/cli/config/examples/mcp-sandbox`. It invokes a separately installed `microsandbox-mcp` executable pinned in operator instructions to `0.6.16`, selects the local backend, requires `DSH_MICROSANDBOX_HOST_PATHS`, fixes the upstream host-path policy to `allowlist`, disables the dangerous-tools switch, caps output, sets explicit operation and MCP call timeouts, and fails loud at startup.

The integration stays on the generic MCP seam. It does not implement partial `fs`, `subprocess`, or `terminal` providers because those roles must share lifecycle, cancellation, projection, and cleanup behavior. It does not select the cloud backend or pass credentials. It also does not claim that the upstream switch or path allowlist narrows the discovered tool namespace; deployments use agent-scoped restrictions or pre-execution policy for that decision.

## Validation

The keyless app test parses the checked-in overlay, checks the exact version marker and safety environment, rejects a missing host-path allowlist, replaces the executable with the package-owned stdio MCP fixture, boots the real Cordis Loader, and observes the discovered tool. It never installs Microsandbox, boots a microVM, pulls an image, exercises a hypervisor, or proves host cleanup.

## Alternatives considered

**Implement a new core sandbox backend.** Rejected because the existing sandbox service expresses same-world confinement. A microVM surrounds filesystem, process, and terminal capabilities rather than supplying only one policy mode.

**Implement one native provider first.** Rejected because a lone filesystem or subprocess adapter would leave ownership and lifecycle split across worlds and would not form a complete capability seam.

**Run the package through `npx` or `pnpm dlx`.** Rejected because agent startup would perform package resolution, downloads, lifecycle scripts, and a changing dependency graph.

**Accept the upstream default host path.** Rejected because it would silently expose the DSH launch directory when the operator omitted a security-relevant choice.

## Consequences

The example adds no dependency and changes no shipped profile. Operators install the reviewed executable and runtime, choose disposable host paths, constrain the model-visible tool set, review images and network access, and perform a real create-execute-cleanup canary on a supported host. A future native provider family remains separate work.
