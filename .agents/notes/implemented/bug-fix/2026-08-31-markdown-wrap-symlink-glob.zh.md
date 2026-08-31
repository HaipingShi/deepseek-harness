# Agent Note: Markdown wrap symlink glob

Status: implemented

[English](2026-08-31-markdown-wrap-symlink-glob.md) | 中文

## Problem

Markdown wrap 门禁扫描记录的 `system-prompt.expected.md` 文件。部分 snapshot 场景通过 symlink 共享这些文件。Node 24.8 在展开 globstar 后跟同名 basename 的 pattern 时会继续遍历匹配的 symlink，再次追加该 basename，并在门禁检查任何文档之前抛出 `ENOTDIR`。

## Decision

该门禁使用带显式目录层级的仓库布局 pattern 来匹配 system-prompt 预期输出。snapshot 预期输出位于 `snapshots/<adapter>/<scenario>/system-prompt.expected.md`；包内 fixture 位于 `packages/<group>/<package>/tests/fixtures/<suite>/<case>/system-prompt.expected.md`。`uniqueRepoFiles` 仍会在匹配后解析并去重 symlink，因此共享预期输出仍只检查一次。

## Alternatives considered

**在共享仓库 glob helper 中捕获 `ENOTDIR`。** 拒绝此方案，因为该 helper 无法恢复 Node 已放弃的匹配项，而使用更宽泛的语料静默重试会改变每个调用方的选择规则。

**扫描 snapshots 和 packages 下的所有 Markdown 文件。** 拒绝此方案，因为 wrap 门禁有意覆盖 system-prompt 预期输出和创作文档，而不是每个 Markdown fixture 或生成产物。

**使用另一个依赖替换 Node glob。** 拒绝此方案，因为两个固定仓库布局已经能表达预期语料，无需新增依赖或第二套 glob 实现。

## Consequences

该门禁能在所有受支持的 Node 引擎下运行，而不会把文件 symlink 当作目录遍历。新的 system-prompt 预期输出布局必须同时更新显式 pattern 和门禁记录的语料范围。
