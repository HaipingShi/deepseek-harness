# Agent Note: Markdown wrap symlink glob

Status: implemented

English | [中文](2026-08-31-markdown-wrap-symlink-glob.zh.md)

## Problem

The Markdown wrap gate scans recorded `system-prompt.expected.md` files. Some snapshot scenarios share those files through symlinks. Node 24.8 follows a matching symlink while expanding a globstar followed by the same basename, appends the basename again, and raises `ENOTDIR` before the gate can inspect any document.

## Decision

The gate uses repository-layout patterns with explicit directory levels for system-prompt expectations. Snapshot expectations live at `snapshots/<adapter>/<scenario>/system-prompt.expected.md`; package fixtures live at `packages/<group>/<package>/tests/fixtures/<suite>/<case>/system-prompt.expected.md`. `uniqueRepoFiles` still resolves and deduplicates symlinks after matching, so shared expectations remain checked once.

## Alternatives considered

**Catch `ENOTDIR` in the shared repository glob helper.** Rejected because the helper cannot recover the matches that Node abandoned, and silently retrying with a broader corpus would change every caller's selection rules.

**Scan every Markdown file under snapshots and packages.** Rejected because the wrap gate intentionally covers system-prompt expected output plus authored documentation, not every Markdown fixture or generated artifact.

**Replace Node glob with another dependency.** Rejected because two fixed repository layouts express the intended corpus without adding a dependency or a second glob implementation.

## Consequences

The gate runs under every supported Node engine without traversing a file symlink as a directory. A new system-prompt expectation layout must update the explicit pattern and the gate's documented corpus together.
