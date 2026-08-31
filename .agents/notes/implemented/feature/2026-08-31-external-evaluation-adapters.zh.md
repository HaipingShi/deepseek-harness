# Agent Note：外部评测适配器

状态：已实现

[English](2026-08-31-external-evaluation-adapters.md) | 中文

## 问题

Promptfoo 和 Inspect 可以对 Agent 输出评分，但直接调用底层模型 API 会绕过已组合的 DSH 提示、工具、会话日志、provider 路由和生命周期。松散的 shell 包装器只能返回文本，没有稳定的会话 receipt、错误分类或经过证明的子进程清理。

## 决策

基于现有 TypeScript 和 Python SDK 提供两个默认关闭的仓库示例。Promptfoo 自定义 provider 将一条渲染后的提示映射到新的 DSH 运行时和会话，返回已提交的助手文本，并在响应元数据中放入 session id、事件数和轮次结束原因。Inspect `ModelAPI` 将带显式角色的有序文本消息序列化为一条 DSH 提示，拒绝 Inspect 定义的工具，运行新的运行时和会话，只映射已知停止原因，并记录相同的 receipt 元数据。

两个示例都要求专用 `DSH_EVAL_HOME`，将第三方安装保持在仓库依赖之外，并在已审阅说明中固定 Promptfoo `0.122.2` 和 Inspect AI `0.3.260`。它们省略 token 使用量和成本，因为 SDK 结果没有这些字段的权威聚合。

## 验证

Promptfoo 测试动态加载 Promptfoo 消费的同一 ESM 文件，让它通过真实 TypeScript SDK JSON-RPC transport 连接其包自有脚本化运行时，然后检查输出、receipt 元数据、启动前取消和显式 home 要求。Python 测试在不依赖 Inspect 的情况下执行消息序列化和停止原因映射。另一个兼容性 smoke 使用官方 `inspect-ai 0.3.260` wheel 导入并构造适配器。没有测试调用模型 provider 或第三方 scorer。

## 考虑过的替代方案

**让评测器直接调用模型 provider。** 已拒绝，因为结果会测量另一个没有 DSH 组合上下文、工具、日志或生命周期的应用。

**暴露 OpenAI 兼容 HTTP façade。** 已拒绝，因为当前没有 DSH 服务负责该协议、认证、流式响应、取消、多租户或部署生命周期。

**为所有并行样本复用一个运行时。** 首次集成中已拒绝，因为评测器并发、取消、会话职责和清理会成为共享可变状态。后续吞吐优化必须保留独立会话和有界 teardown。

**将 Inspect 定义的工具投影进 DSH。** 已拒绝，因为 DSH 工具是由组合拥有、模型可见且被记录的能力；在没有 provider 和 executor 的情况下接受评测器 schema 会改变身份与执行语义。

## 后果

适配器不增加运行时依赖，也不改变已发布 profile。每个样本都承担进程启动成本，评测器日志与 DSH 日志需要独立保留策略，使用者必须同时保存两类产物以便关联。图片输入、评测器定义的工具、轮次中取消、权威 token/成本投影和发布 canary 仍不受支持。
