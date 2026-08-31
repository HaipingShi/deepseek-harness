# Run an isolated browser through Playwright MCP

English | [中文](mcp-browser.zh.md)

## Summary

This default-off integration starts the pinned `@playwright/mcp` executable through DSH's generic stdio MCP client. The checked-in overlay uses a headless, in-memory browser profile, enables the browser sandbox, blocks service workers, and requires an explicit origin allowlist. It does not reuse a personal browser, persist login state, install packages, or provide network isolation.

## Table of Contents

- [Install the reviewed executable](#install-the-reviewed-executable)
- [Choose allowed origins](#choose-allowed-origins)
- [Start DSH](#start-dsh)
- [Verify the integration](#verify-the-integration)
- [Security and ownership](#security-and-ownership)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

-----

<a id="install-the-reviewed-executable"></a>
## Install the reviewed executable

Install exactly the reviewed package version before starting DSH. Keep package installation separate from agent startup so a session never executes a package manager or accepts a changed transitive graph implicitly:

```sh
pnpm add --global @playwright/mcp@0.0.79
playwright-mcp --version
```

Install the required Playwright browser through your managed development or CI image. Browser acquisition is an operator-owned setup step and may download executable code; the DSH overlay does not perform it.

<a id="choose-allowed-origins"></a>
## Choose allowed origins

Set a semicolon-separated list containing only the origins needed for the task:

```sh
export DSH_PLAYWRIGHT_ALLOWED_ORIGINS='https://docs.example.com;https://app.example.com'
```

Playwright MCP documents this option as a request filter, not a security boundary, and says it does not constrain redirects. Use a container, VM, host firewall, or controlled proxy when the browser must be unable to reach other networks. Review redirects and third-party resources in an external canary before sending credentials or private data.

<a id="start-dsh"></a>
## Start DSH

Start the normal Web composition with the default-off overlay:

```sh
pnpm dsh web --patch apps/cli/config/examples/mcp-browser/playwright.cordis.yml
```

The browser runs headless with an in-memory profile and service workers blocked. The MCP process inherits the current workspace as its filesystem root. The overlay does not pass a storage-state file, user-data directory, extension connection, secrets file, or unrestricted file access. An unset allowlist or startup failure prevents the plugin from activating.

<a id="verify-the-integration"></a>
## Verify the integration

Before granting access to authenticated or internal pages:

1. Start with a public, non-sensitive origin and confirm only `mcp__playwright__...` tools appear.
2. Navigate to an allowlisted page and capture the expected accessibility snapshot.
3. Attempt a direct request to a non-allowlisted origin and confirm it fails.
4. Test an allowlisted redirect separately because the allowlist does not constrain redirect targets.
5. End the DSH process and confirm no reusable Playwright profile or storage-state file was created.

The repository's keyless test checks the exact upstream pin and hardening flags, rejects a missing allowlist, substitutes a local stdio MCP fixture, boots the real Cordis Loader, and observes one discovered tool. It does not launch a browser, test upstream redirect behavior, verify OS containment, or establish that a target site permits automation.

<a id="security-and-ownership"></a>
## Security and ownership

Playwright actions can submit forms, mutate remote state, download content, and expose page data to the model. Grant an origin only when the task authorizes those effects, and use a dedicated low-privilege account when authentication is required. Treat page text, accessibility snapshots, screenshots, downloads, console messages, and tool arguments as potentially sensitive session data.

DSH owns MCP process lifecycle, model-facing tool registration, tool calls, and session logging. Playwright MCP owns browser automation and its request filtering. The operating environment owns executable provenance, browser installation, filesystem and network containment, credentials, and cleanup beyond the in-memory browser profile.

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP client package](../../../packages/mcp/mcp-client/README.md) — stdio lifecycle, naming, timeout, and result behavior.
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) — upstream configuration and browser behavior.
- [ToolHive MCP runtime](mcp-runtime.md) — container-managed MCP workloads and registry review.

<a id="dev-note"></a>
## Dev Note

Keep the executable pin and hardening assertions synchronized. Any profile persistence, authenticated browser reuse, unrestricted file access, or broader network access is a separate security decision and requires its own integration acceptance.
