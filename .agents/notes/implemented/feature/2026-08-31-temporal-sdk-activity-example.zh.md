# Agent Note：Temporal SDK Activity 示例

状态：已实现

[English](2026-08-31-temporal-sdk-activity-example.md) | 中文

## 问题

DSH workflow engine 在一个 Harness 进程中编排存活 subagent，但刻意没有 journal 或重启恢复。Temporal 可以提供持久外部编排，但从确定性的 Workflow 代码调用 DSH 会违反 replay 规则，而普通 Temporal Activity 重试可能重复模型成本和工具副作用。

## 决策

在 TypeScript SDK 旁提供仅含源码的 Temporal `1.23.0` 示例。确定性的 Workflow 代理一个 `runDshTask` Activity，设置 start-to-close timeout、heartbeat timeout 和 `maximumAttempts: 1`。Activity 为每次 attempt 独占一个新的 `DeepSeekHarness` runtime 与会话，要求专用 DSH home，发送 heartbeat 以接收取消，在取消时关闭 runtime，在所有结算路径上回收它，并返回最终文本、session id、事件数和 turn-end reason。

示例不增加仓库依赖，也不包含在已发布 SDK 软件包中。运维方将其复制到自行拥有的集成项目，由该项目管理版本一致的 Temporal 软件包、Worker 部署、task queue、连接策略和凭据。

## 验证

无密钥测试通过注入 Activity context 和 Harness factory，在不安装 Temporal 的情况下导入 Activity adapter。它证明 receipt 映射、立即 heartbeat、清理、输入与 home 校验、启动前取消、运行中取消，以及仓库内 Workflow 的禁止重试与 heartbeat 设置。它不会运行 Temporal Server 或 Worker、replay history、调用模型、执行工具或证明重启恢复。

## 考虑过的替代方案

**实现 Temporal workflow-engine provider。** 已拒绝，因为当前 seam 接受一个由存活调用者拥有的 run，没有持久关联或恢复词汇；假装 Temporal 适配它会隐藏不兼容的生命周期承诺。

**从 Workflow 代码直接调用 DSH。** 已拒绝，因为进程启动、模型调用、当前时间和工具效果都不确定，必须留在 Activity 中。

**保留 Temporal 默认 Activity 重试。** 已拒绝，因为新的 DSH 会话无法对之前 attempt 的模型调用或外部工具效果去重。应用只有在具备端到端幂等性时才能选择启用重试。

**在不同 Activity attempt 之间复用一个 DSH runtime。** 已拒绝，因为职责、取消、并发访问和崩溃恢复会变成 Worker 全局问题，receipt 也可能跨越 attempt 边界。

## 后果

现有 Temporal 应用获得具体且经过测试的 adapter，而 DSH 内置 workflow 行为保持不变。每个 Activity 都会承担 runtime 启动成本，并需要两份证据存储。由于 wire 没有 turn 中途取消方法，取消通过 SDK 进程 teardown 实现。一等持久恢复仍属于未来工作，不是本示例暗示的属性。
