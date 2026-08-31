# Agent Note: Playwright MCP browser example

Status: implemented

English | [中文](2026-08-31-playwright-mcp-browser-example.zh.md)

## Problem

DSH's generic MCP client can start a browser automation server, but an unchecked example could silently download a package during agent startup, reuse a personal browser profile, persist authentication state, disable the browser sandbox, or imply that an origin filter provides network containment.

## Decision

Ship one default-off Playwright MCP overlay under `apps/cli/config/examples/mcp-browser`. It invokes a separately installed `playwright-mcp` executable pinned in operator instructions to `@playwright/mcp` `0.0.79`. The overlay uses stdio, a stable `playwright` namespace, headless mode, an in-memory profile, the browser sandbox, blocked service workers, an explicit `DSH_PLAYWRIGHT_ALLOWED_ORIGINS` value, the current workspace as the filesystem root, and loud startup failure.

The overlay does not pass `--extension`, `--no-sandbox`, `--storage-state`, `--user-data-dir`, `--secrets`, or `--allow-unrestricted-file-access`. The origin allowlist remains a Playwright MCP request filter: redirects and host networking require separate external controls.

## Validation

The keyless app test parses the checked-in overlay, checks the exact version marker and hardening arguments, rejects a missing origin allowlist, replaces the executable with the package-owned stdio MCP fixture, boots the real Cordis Loader, and observes the discovered tool. It never launches a browser, downloads a browser binary, visits an origin, or proves external network containment.

## Alternatives considered

**Run the package through `npx` or `pnpm dlx` in the overlay.** Rejected because a model session would then trigger package resolution, downloads, lifecycle scripts, and a changing dependency graph before the MCP process starts.

**Connect to the user's browser extension or persistent profile.** Rejected because it exposes unrelated cookies, tabs, history, extensions, and authenticated sessions to the tool surface.

**Treat `--allowed-origins` as egress isolation.** Rejected because upstream documents that it is not a security boundary and does not constrain redirects.

## Consequences

The example adds no runtime dependency and changes no shipped profile. Operators must install the reviewed executable and browser separately, define the minimum origin set, and add container, VM, firewall, or proxy controls when network containment is required. Authenticated and mutating browser workflows still need target-specific acceptance.
