---
description: "供用户和维护者把 Harness 组合连接到 A2A v1.0 agent 的远程 A2A 子 agent 提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-subagent-a2a

[English](README.md) | 中文

## 概述

`dsh-subagent-a2a` 把一个远程 A2A agent 注册为 Harness 一次性子 agent 提供方。官方 `@a2a-js/sdk` 负责发现 Agent Card、从其声明接口选择 JSON-RPC 或 HTTP+JSON、校验 wire 值并发送一条阻塞式消息。Harness 提供方负责文本投影、取消、终态映射、安全诊断和共享子 agent 生命周期。除非任务文本主动携带，否则远端 agent 不会收到父会话 transcript、本地工具权限、文件系统路径或 Harness 配置。

## 目录

- [使用此包](#use-this-package)
- [协议与生命周期](#protocol-and-lifecycle)
- [安全与证据](#security-and-evidence)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

先挂载 subagent seam，再挂载此提供方。仓库在 [`apps/cli/config/examples/subagent-a2a/cordis.yml`](../../../apps/cli/config/examples/subagent-a2a/cordis.yml) 提供默认关闭的 overlay：

```sh
export DSH_A2A_AGENT_URL='https://reviewed-agent.example'
pnpm dsh --profile headless \
  --patch apps/cli/config/examples/subagent-a2a/cordis.yml \
  'Delegate the bounded task to the a2a provider.'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `a2a` | `ctx.subagents` 中的注册名 |
| `agentUrl` | 必填 | Agent Card 的绝对基础 URL；除 loopback 外必须使用 HTTPS |
| `agentCardPath` | `/.well-known/agent-card.json` | 不含 query 或 fragment 的绝对路径 |
| `allowedOrigins` | `[]` | 为 Agent Card 声明接口额外授权的确切 origin |
| `headers` | `{}` | 发现与消息调用时发送的显式 header |

从部署配置提供凭据，例如 `authorization: !!js process.env.DSH_A2A_AUTHORIZATION`。切勿提交 bearer token。默认情况下，请求与 header 都限制在 `agentUrl` origin。只有审查另一个 origin 上声明的接口后，才能添加对应的确切 HTTPS origin。重定向会被拒绝，因此请求不会经过未经审查的中间跳转。Header 可以认证调用方，但不能证明已发现的 card、其声明 endpoint 或远端实现可信。

<a id="protocol-and-lifecycle"></a>
## 协议与生命周期

提供方启动时校验配置和仅文本输入，再通过官方 SDK 解析 Agent Card。发现成功就是发布边界。已发布的运行发送一条 `returnImmediately: false` 消息，接受 `text/plain`，并把运行取消信号传给 SDK。资源释放会中止本地 HTTP 操作，并等待结果结算。

直接 agent 消息或已完成 task 映射为 `completed`。已取消、拒绝和失败的 task 分别映射为 `aborted`、`refusal` 和 `error`。`input-required`、`auth-required`、非终态 task、未知输出媒体以及传输失败都会成为带有固定有界诊断的 `error`。优先读取 task artifact；若无 artifact，再读取 status message 和最新 agent history message。远端异常文本、响应 payload、URL、header 和任务内容绝不会进入诊断。

<a id="security-and-evidence"></a>
## 安全与证据

Agent Card 是发现元数据，不是授权。请审查其来源、支持的接口 URL、协议版本、安全要求、声明技能、保留策略，以及所有可能收到任务的下游系统。使用专用凭据，并且只发送已经批准交给该远端运营方的数据。非 loopback endpoint 必须使用 HTTPS；loopback HTTP 仅保留给本地开发。发现阶段会响应运行取消信号，发现和消息请求都会拒绝 HTTP 重定向。

keyless 集成测试会在 loopback 启动官方 A2A JSON-RPC server，提供真实 Agent Card，验证 header 转发，经官方 client 发送文本消息，并检查 Harness 结果。测试还证明不安全 HTTP URL、非文本 prompt、非文本输出和非终态都会 fail closed。这是针对 fixture 的互操作证据，不是外部部署 canary 或 A2A 一致性认证。

不发布运行时不变式伴生入口，因为 subagent seam 负责提供方注册和运行生命周期，而官方 SDK 校验 A2A wire 值；此适配器不暴露可独立检测漂移的第二份本地观测。

<a id="model-experience"></a>
## 模型体验

### 远程子级请求

#### 模型看到什么

远程 A2A agent 会收到委派的文本块及其自身服务端组合。它不会收到父会话或本地 Harness capability。非文本块和可选 Harness 子 agent capability 会在发送前被拒绝。

#### Token 影响

远端 agent 使用独立上下文计费。其 token 统计不会投影进父会话。

#### KV Cache 影响

与父请求缓存相互独立。远端缓存行为归 A2A server 及其模型提供方负责。

### 父级工具结果（间接）

#### 模型看到什么

父级通过 `dsh-tool-subagent` 收到远端最终文本或 consumer 的错误展示。Agent Card 字段、中间 task 状态和传输 payload 不会对模型可见。

#### Token 影响

最终结果或错误会追加到父会话，并保留到压缩为止。

#### KV Cache 影响

仅追加；结果位于已有可复用请求前缀之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅支持一次性文本**——不会投影图片、文件、data part、流式响应、后续轮次、`input-required` 或 `auth-required` 流程。
- **远端确认后不能取消 task**——资源释放会中止本地请求；如果 server 在 client 断开后继续运行，它需要自己的执行和保留策略。
- **没有 Agent Card 签名策略**——SDK 会解析 card 签名，但此提供方未配置 trust root，也不强制验证。
- **没有入站 A2A server**——此包只向外委派；暴露 Harness agent 需要另一个具备认证、tenant 隔离和持久 task 所有权的 server。
- **没有可选 Harness 启动 capability**——不能跨这个协议 adapter 强制 agent option、结构化输出、深度限制、工具过滤或 persona。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
