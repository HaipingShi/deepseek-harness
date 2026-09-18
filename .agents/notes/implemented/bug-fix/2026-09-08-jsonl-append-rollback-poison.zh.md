# Agent Note: JSONL append rollback failure poisons the handle

Status: implemented

[English](2026-09-08-jsonl-append-rollback-poison.md) | 中文

## 问题

对现场报告的 `seq gap in committed region` 损坏签名做合成复现时，发现 JSONL 后端的多条活路径：当持久化写入的 `writeFile` 成功而 `fsync` 失败时，存储原语会尝试按大小回滚；若该回滚也失败，原语抛出普通 `AggregateError`，而文件仍保留着越过写入前大小的滞留批次字节。句柄把它当作普通失败处理——活写入路径保留该批次并重试，直接调用者可以简单重新 append，而恢复撕裂尾部的重写（崩溃恢复后的第一次变更）完全位于守卫路径之外——于是同一批事件可能在文件中落地两次。扫描器读到重复区段后抛出 `corrupt session log: seq gap in committed region (expected N, got …)`，与任务现场证据引用的签名完全一致。Codex 审核（R1）在该守卫覆盖恢复尾部之前，用句柄级故障注入复现脚本复现了该变体。

## Decision

当回滚失败时，`appendLines` 现在抛出 `AppendRollbackError`（`AggregateError` 的子类，既有的报告断言保持成立），`JsonlSessionHandle.persistContiguous` 在该类型可能出现的所有位置毒化句柄：普通批次追加与恢复撕裂尾部的重写。此后每一次 append——直接调用、活 drain 重试、close 排空——都以 `the log is in an unknown physical state after a failed append rollback; further appends are refused — close this handle and reopen the session to recover` 拒绝。回滚失败的重写还会保留其 `recoveredTail` 状态（未持久落盘的字节绝不清除），而干净回滚的失败仍然可以安全重试。close 仍会释放写所有权，新的写打开会从文件的真实字节重新推导日志：滞留的完整记录成为普通的已提交事件，部分写入成为撕裂尾部并走既有的恢复路径，完全重复的区段以损坏拒绝、交由运营者处置。

## Alternatives considered

- **回滚失败时把文件向前滚动。** 否决：不验证滞留字节就信任它们，会把新事件追加到未经验证的尾部之后；而部分写入仍需要撕裂尾部机制——该机制已在重新打开时运行，校验就住在那里。
- **每次 append 前 stat 加扫描。** 否决：它缩小但不关闭竞争窗口（scan 与 append 之间的并发写或崩溃会让竞争重现），且每批次付出整日志解析的代价；在单写者契约内，句柄游标加毒化闩是精确的。
- **只在存储层拒绝。** 否决：原语没有所有权状态；变更链与重试路径都归句柄所有，闩必须住在重试所在的那一层。

## Consequences

回滚失败不再可能制造重复的已提交区段：第二次写入被拒绝，日志保持磁盘上的真实状态，恢复变成一次普通的重新打开而非人工手术。代价是触碰到回滚失败的句柄就此作废——在所有者关闭并重新打开之前，后续每次 append 都失败，包括自动的活写入：它们记录后台失败并停住，直到 `session/flush`、close 或拆除把毒化大声暴露出来。已知的进程内单写者契约不变；第二个进程写同一文件仍在本后端的一切保证之外。

## Testing

`packages/session/session-persistence-jsonl/tests/jsonl.spec.ts` 钉住：报告断言测试校验 `AppendRollbackError` 名称与错误对；回滚失败毒化句柄——后续 append 被拒、文件保持未知字节不变、close 释放所有权、新的写打开把滞留的完整记录恢复为日志真相、新的写者从恢复后的末尾连续续写；被毒化的句柄在 drain 时拒绝其保留的活批次，close 暴露失败的同时仍释放所有权。`packages/session/session-persistence-jsonl/tests/zstd.spec.ts` 针对真实临时压缩日志新增恢复尾部回归：末帧校验字节撕裂预置恢复状态，重写期间注入 fsync 加回滚失败使句柄毒化，下一次 append 与路由的活 drain 在任何底层写入之前被拒，close 暴露失败的同时释放所有权，新的写打开把滞留的完整记录恢复为日志真相。对修复前源码，毒化断言以"盲目重试成功"失败（重复区段复现写入 `[0,1,2,3,2,3]`，恢复尾部变体把已恢复事件二次重写，扫描器抛出现场签名）。
