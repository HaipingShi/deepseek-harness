# Agent Note: ToolHive MCP runtime example

Status: implemented

English | [中文](2026-08-31-toolhive-mcp-runtime-example.zh.md)

## Problem

DSH can connect directly to stdio and Streamable HTTP MCP servers, but it does not own third-party package discovery, container isolation, network policy, secret delivery, tool filtering, or audit. Adding those responsibilities to the generic MCP client would duplicate a separate runtime manager and make registry metadata look like execution approval.

## Decision

Ship one default-off ToolHive overlay under `apps/cli/config/examples/mcp-runtime`. It inserts the existing `@deepseek-ai/dsh-mcp-client`, reads one pre-existing ToolHive proxy URL from `DSH_TOOLHIVE_MCP_URL`, uses a stable `toolhive` namespace, sends no authorization header, and fails plugin activation when the endpoint or initial discovery fails. The [ToolHive guide](../../../../docs/user/guide/mcp-runtime.md) owns operator setup and the responsibility split.

ToolHive owns registry resolution, workload execution, network and filesystem grants, secrets, tool filters, incoming authentication, and audit. DSH owns its MCP client connection, model-facing names, call lifecycle, and session records. Registry metadata is discovery input only; the operator approves the resolved package or image, version, provenance, permissions, credentials, destinations, and tools before launch.

## Validation

The keyless app test parses the checked-in overlay, checks the reviewed ToolHive version marker and absence of embedded credentials, proves an unset endpoint fails schema validation, replaces ToolHive with the package-owned Streamable HTTP fixture, boots the real Cordis Loader, and observes the discovered tool. It never contacts a registry or runs a third-party workload.

## Alternatives considered

**Add a ToolHive-specific runtime package.** Rejected because DSH already speaks ToolHive's Streamable HTTP output, and a wrapper would duplicate workload lifecycle and policy that ToolHive owns.

**Query the official MCP Registry and install entries from DSH.** Rejected because discovery metadata is not trust evidence, automatic installation would add a package execution and supply-chain boundary, and ToolHive already owns registry resolution.

**Put an access token in the checked-in overlay.** Rejected because local ToolHive proxies bind to loopback by default and authenticated deployments require deployment-specific credential handling rather than a shared placeholder header.

## Consequences

The example adds no runtime dependency and changes no shipped profile. An operator must install ToolHive, select and start a workload, review its grants, and pass the resulting loopback `/mcp` URL explicitly. The automated test proves DSH interoperability only; each selected server still needs independent runtime and behavior acceptance.
