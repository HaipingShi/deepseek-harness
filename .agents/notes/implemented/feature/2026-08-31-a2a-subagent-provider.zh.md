# Agent Note：A2A 子 agent 提供方

状态：已实现

[English](2026-08-31-a2a-subagent-provider.md) | 中文

## 问题

subagent seam 已支持进程内子级、本地子进程协议和独立 Harness runtime，但还不能把有边界的任务委派给网络 A2A agent。把 Agent Card 当成普通 HTTP endpoint 会重复实现协议发现和校验，也会掩盖远端身份、task 状态、取消和凭据分别由谁负责。

## 决策

新增 `@deepseek-ai/dsh-subagent-a2a` 一次性远程提供方，使用 `@a2a-js/sdk` `1.1.0`。官方 SDK 负责 Agent Card 解析、JSON-RPC 或 HTTP+JSON 传输选择、协议 header 和 wire 解码。提供方仅接受文本块，发送一条阻塞请求，把官方终态 task 状态映射到共享 subagent 结果，把取消传给 HTTP 操作，并且只产生固定安全诊断。

除 loopback HTTP 外必须使用 HTTPS。认证只能来自显式配置的 header，且同时应用于发现和消息请求。除非 `allowedOrigins` 显式授权另一个确切 origin，否则请求只能留在配置 origin；HTTP 重定向会被拒绝。不声明任何可选 Harness 启动 capability，也不继承父级上下文。不能从 card 发现推断远端 endpoint 已获授权，也不能把请求中止解释为服务端执行已取消。

## 验证

keyless 测试用 `DefaultRequestHandler` 启动官方 Express JSON-RPC adapter，提供真实 Agent Card，观察发现和消息请求的授权 header，并经官方 client factory 与 Harness subagent seam 完成文本往返。聚焦用例拒绝不安全的非 loopback HTTP、未批准的接口 origin、非文本输入、非文本输出和非终态 task 结果。测试不会联系外部 agent 或模型提供方。

## 考虑过的替代方案

**直接实现 A2A JSON-RPC。** 拒绝，因为传输协商、协议版本、wire 校验和未来兼容应归维护中的协议 SDK 负责。

**把所有 A2A content part 都暴露为 Harness 文本。** 拒绝，因为 URL、原始字节和结构化数据有不同的信任与渲染要求。首个提供方只协商并接受 `text/plain`。

**把请求中止当作远端 task 取消。** 拒绝，因为阻塞式 client 可能在断开前还没有收到 task id，而且 HTTP 取消不能证明 server 已停止执行。

**在同一个包中提供入站 server。** 拒绝，因为出站委派和公开 task 托管有不同的认证、tenant、持久化、限流和生命周期 owner。入站 adapter 需要独立设计和验收证据。

## 后果

此包把官方 A2A JavaScript SDK 加为运行时依赖；Express 只作为 SDK server fixture 的测试依赖。每次运行都会发现 Agent Card，只支持一轮文本，也不返回远端 token 或成本统计。流式响应、连续对话、签名 card 策略、入站托管、task 轮询和服务端确认取消仍是显式限制。
