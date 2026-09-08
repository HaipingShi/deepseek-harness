# Agent Note: Tool-call budget guard

Status: implemented

[English](2026-09-08-call-budget.md) | 中文

## 问题

2026-09-08 的一次会话诊断发现：某个 agent 在进程重启间丢失了全部 MCP 工具，随后在三轮里持续发出每次命令都不相同的 `bash` 调用（`echo step1`、`echo focus1`……）。已发布的 `repeat-tool-reminder` 从未触发：它按设计只检测完全相同的重复，而每次调用都不同。组合中没有任何东西能按次数约束这次运行，而且对于一个调用从不重复的循环，建议式提醒也永远追不上。部署需要一种确定性、显式的方式停止无界的工具开销，而不必再问另一个模型"是否在取得进展"。

## Decision

`@deepseek-ai/dsh-call-budget`（packages/guard/call-budget）是一个可选的 guard 插件。以至少一条限额挂载后，它按人类创作的消息之间的边界统计每个 agent 的工具调用，并在某次调用试图超出配置上限时停止当前轮——恰好用尽额度的那次调用仍然执行。

- **计数**发生在 `tools/pre-execute` 瀑布。即使在并行批次内，该阶段也按调用逐个顺序运行，因此预留严格先于下一次调用的检查——并行批次无法超发。携带 agent 到达该阶段的调用都会计数：模型调用、PTC 嵌套子派发（它们转发 agent）、以及被更晚监听器拒绝的调用。无 agent 的直接执行不计数。
- **停止**使用受支持的取消生命周期：`agent.cancel({kind: 'hook', reason}, {keepInbox: true})` 加上原因文本一致的 deny。`cancel` 同步中止轮次信号，因此运行在调度器内的监听器不可能因等待工具的停止接口而自锁；调度器会排空已开始的调用并为跳过的调用记录合成结果，保持调用/结果配对完整。持久的 `turn/end` 携带 `{kind: 'aborted', reason: {kind: 'hook', reason}}`，使停止原因对用户可见且可从日志重建。
- **窗口**在 `agent/pre-step` 认领的消息包含 `user` 来源时重置。窗口已停止时，不含用户消息的认领被拒绝，轮次在任何模型请求之前以 `blocked` 结束——继续已停止 agent 的机器驱动无法再买到请求，而人类的下一条消息总是开启全新窗口。计数保存在按 agent 的 `WeakMap`；不同 agent 相互隔离，续用的进程以全新状态开始。
- **配置**是 `total`（每窗口跨全部工具的调用上限）加 `tools`（`*` 通配符模式 → 上限）。取值必须是 ≥ 1 的整数，至少需要一条限额，违规在加载时抛出。

## Alternatives considered

- **把 `repeat-tool-reminder` 升级为可阻止。** 否决：reminder 的契约是只提建议，其检测按设计是精确匹配；可阻止的升级仍然追不上每一个变参循环，还会把一个插件里两种不相关行为搅在一起。
- **用伪造成功标记 `concludesTurn`。** 否决：`concludesTurn` 只存在于成功的工具结果上，而用策略拒绝伪造成功结果是对模型和日志的撒谎。取消路径产生诚实的 denied/aborted 结果。
- **按轮次号计数。** 否决：机器续接机制（goal 驱动、followup）会开启新的轮次号，按轮计数会随每次自动续接重置、循环继续；以人类输入为键的窗口是能约束机器驱动空转的最小单元。
- **用另一个 LLM 做语义进展判断。** 否决：非确定性强、消耗 guard 本要节省的 token，且无法像计数器那样从日志审计。

## Consequences

部署获得了一个对任何相似性启发式都追不上的循环的硬性、可审计的工具开销上限；代价是这个停止规则无法区分有产出的调用量与空转——上限配置过低时任务中途被停是可能的，而调大上限是唯一解法。窗口是进程内的内存态，预算不是持久配额，resume 会重置它。计数从 guard 的监听器开始，因此在更早的 `tools/pre-execute` 监听器处被拒的调用逃过计数；不断再唤醒已停止 agent 的机器驱动会产生零开销的 blocked 轮，直到其自身的重试策略放弃。`repeat-tool-reminder` 保持挂载且不变：对精确重复的建议仍是建议，预算是兜底。

## Testing

`packages/guard/call-budget/tests/call-budget.spec.ts` 用脚本化 mock adapter 驱动真实 agent loop：变参序列在 `total` 处停止，带有精确的拒绝文本、持久的 `turn/end` 原因、完整的调用/结果配对，且不再有模型请求；大于剩余额度的并行批次只执行被预留的前缀；额度内的合法重复调用不受影响；模式上限只停自己的工具集合；人类 followup 重开窗口而插件 followup 在零模型开销下被拒；预算按 agent 隔离；停止后的 interrupt 加 dispose 正常完成；配置大声失败；PTC `run_code` 场景证明嵌套子派发计入同一预算；keyless 记录会话场景 `snapshots/session/call-budget-stop/` 经快照通道启动真实 `dsh --profile headless` 并钉住持久化的预算停止；模块经 Loader 的 `unwrapExports` 保持命名空间形态。
