# 向 A2A agent 委派任务

[English](a2a-delegation.md) | 中文

## 概述

这个默认关闭的 A2A 集成允许 Harness `subagent` 工具向已经审查的远程 agent 发送一项文本任务。它使用官方 A2A JavaScript SDK 发现 Agent Card 并执行协议传输，而 Harness 负责本地 subagent 生命周期和最终结果。首个集成仅提供出站一次性调用：它不会把 Harness 暴露为 A2A server，也不会继续被中断的远端 task。

## 目录

- [审查目标](#review-the-destination)
- [启用提供方](#enable-the-provider)
- [验证部署](#verify-a-deployment)
- [运行限制](#operational-limits)
- [延伸阅读](#further-exploration)

-----

<a id="review-the-destination"></a>
## 审查目标

启用 overlay 前先获取并检查 `/.well-known/agent-card.json`。确认控制该 origin 的组织、每个支持的接口 URL、协议版本、安全要求、输入输出媒体、技能、数据保留方式和下游提供方。Agent Card 是自声明的发现元数据；成功解析不等于通过安全或能力验收。

决定哪些任务数据可以离开 Harness，并使用专用远端凭据。远程 agent 可以保留 prompt，也可以按自身策略调用自己的工具。它不会自动收到本地工具或父级历史，但委派 prompt 本身仍可能包含敏感会话材料。

<a id="enable-the-provider"></a>
## 启用提供方

设置已经审查的基础 URL，并把 overlay 加入已经挂载 `@deepseek-ai/dsh-subagent` 和模型侧 subagent 工具的组合：

```sh
export DSH_A2A_AGENT_URL='https://reviewed-agent.example'
pnpm dsh --profile headless \
  --patch apps/cli/config/examples/subagent-a2a/cordis.yml \
  'Delegate a bounded, non-sensitive task to the a2a provider.'
```

仓库内置 overlay 不发送认证 header。对于需要认证的部署，把它复制到部署自有配置，并从环境读取确切 header：

```yaml
headers:
  authorization: !!js process.env.DSH_A2A_AUTHORIZATION
```

非 loopback endpoint 必须使用 HTTPS。提供方在获取 Agent Card 和发送任务时都会转发配置 header，因为这两类资源通常共享同一认证策略。除非部署配置添加确切的 `allowedOrigins` 条目，否则请求只能留在 `agentUrl` origin。HTTP 重定向会被拒绝。

<a id="verify-a-deployment"></a>
## 验证部署

使用具有确定预期短语的非敏感 canary 任务。保留远端服务日志与 Harness 会话日志，然后分别确认：

1. 获取的 Agent Card、选择的接口与已审查 origin 和协议一致。
2. Harness 为远程提供方记录一对 subagent start/end。
3. 远端服务在预期身份下恰好记录一次已接受请求。
4. 父级只收到预期最终文本和映射后的终止原因。
5. 取消 canary 会停止本地等待；在声称服务端已取消之前，需独立检查远端证据。

仓库 keyless 测试会针对官方 SDK loopback fixture 完成这次往返。它不会联系你的部署、验证其身份或认证 A2A 一致性。

<a id="operational-limits"></a>
## 运行限制

只接受 `text/plain` 输入和输出。提供方不会投影图片、文件、结构化数据、流式更新、远端 token 用量、后续轮次、card 签名信任或远端 `input-required` 与 `auth-required` 交互。已取消的本地请求可能留下继续运行的服务端工作。应为远端设置超时、配额、保留、审计和幂等策略。

<a id="further-exploration"></a>
## 延伸阅读

- [A2A provider 包](../../../packages/subagent/subagent-a2a/README.zh.md)——完整配置、状态映射和限制。
- [Subagent 子系统](../../subsystems/subagent.zh.md)——共享 provider 生命周期和结果语义。
- [A2A Protocol](https://a2a-protocol.org/latest/) 与[官方 JavaScript SDK](https://github.com/a2aproject/a2a-js)——上游协议与实现参考。
