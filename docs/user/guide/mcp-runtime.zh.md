# 使用 ToolHive 运行受治理的 MCP 服务器

[English](mcp-runtime.md) | 中文

## Summary

此默认关闭的集成通过通用 Streamable HTTP 客户端将 DSH 连接到一个由 ToolHive 管理的 MCP 工作负载。ToolHive 负责发现、进程或容器隔离、网络策略、secret、工具过滤、审计和工作负载生命周期；DSH 负责工具注册、模型调用、会话日志及其 MCP 连接生命周期。注册表元数据可帮助你发现服务器，但不能证明其包、镜像、权限或行为值得信任。

## Table of Contents

- [审查并启动工作负载](#review-and-start-a-workload)
- [连接 DSH](#connect-dsh)
- [验证集成](#verify-the-integration)
- [安全与职责归属](#security-and-ownership)
- [延伸阅读](#further-exploration)
- [Dev Note](#dev-note)

-----

<a id="review-and-start-a-workload"></a>
## 审查并启动工作负载

请使用 ToolHive `v0.46.0`，或在调整这些命令前审查当前版本。启动前检查解析后的注册表记录，选择准确的工具 allowlist，并保留 ToolHive 默认的 loopback 代理和隔离容器网络：

```sh
thv registry info <server> --format json
thv run <server> --name dsh-<server> --tools <tool-a>,<tool-b> --enable-audit
thv list --format json
```

官方 MCP Registry 和 ToolHive 注册表都是发现输入。请审查解析后的包或镜像身份、版本、摘要或来源、所请求的 secret、文件系统挂载、网络目标和工具列表。不得把注册表条目或流行度计数视为执行批准。

<a id="connect-dsh"></a>
## 连接 DSH

从 `thv list` 复制运行中工作负载的 loopback URL，并包含其 `/mcp` 路径，然后使用仓库内置的 overlay 启动 DSH：

```sh
export DSH_TOOLHIVE_MCP_URL=http://127.0.0.1:<port>/mcp
pnpm dsh web --patch apps/cli/config/examples/mcp-runtime/toolhive.cordis.yml
```

该 overlay 设置 `failOnStartupError: true`；未设置 URL、代理不可达或初始工具发现失败都会阻止该插件激活。它不发送授权 header，因为常见的本地 ToolHive 代理仅绑定 loopback。仅当所选部署对入站 MCP 客户端执行认证时，才在私有副本中添加显式 header。

一个 overlay 对应一个名为 `toolhive` 的稳定工具命名空间。要连接另一个工作负载，请复制该配置项，并选择唯一的 `id` 和 `serverName`。使用后应保持名称稳定，因为会话历史和权限规则会记录模型可见的 `mcp__<serverName>__<tool>` 名称。

<a id="verify-the-integration"></a>
## 验证集成

在授予更多工具或凭据之前，请执行以下检查：

1. 确认 `thv list --format json` 将所选工作负载报告为运行中，并显示预期的 loopback MCP URL。
2. 启动 DSH，并确认只出现 allowlist 中的 `mcp__toolhive__...` 工具。
3. 使用非敏感 fixture 数据调用一个只读工具，并确认 ToolHive 的审计输出记录了该请求。
4. 停止工作负载并确认调用显式失败；重启或重新加载它，并确认已发现的工具集合恢复。
5. 分别检查 DSH 会话日志和 ToolHive 审计输出。任一记录都不能单独证明另一个组件的行为。

仓库的 keyless 测试使用本地 HTTP MCP fixture 替代 ToolHive，并证明仓库内置的 overlay 可以解析、拒绝缺失的 endpoint、通过真实 Cordis Loader 加载并发现工具。该测试不执行 ToolHive 容器、不联系注册表，也不批准第三方服务器。

<a id="security-and-ownership"></a>
## 安全与职责归属

ToolHive 和 DSH 分别执行操作的不同部分。发送敏感数据前必须同时配置两者。

| 事项 | 负责人 |
|---|---|
| 注册表查询与工作负载解析 | ToolHive 和已配置的注册表 |
| 包或镜像审查与版本固定 | 操作员 |
| 容器网络、挂载、secret、工具过滤、入站认证、审计 | ToolHive 部署 |
| MCP 连接、工具名称命名空间、调用超时、重连、模型暴露 | DSH MCP 客户端 |
| 提示词、工具参数、工具结果和会话保留 | DSH 部署和所选 MCP 服务器 |

请使用具备最小上游 scope 的专用集成凭据。除非经过认证的部署明确需要远程访问，否则代理应保持 loopback 绑定。应将工具参数、结果和审计记录视为潜在敏感数据，并在启用生产流量前定义其保留和脱敏策略。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [MCP 客户端包](../../../packages/mcp/mcp-client/README.zh.md) — transport、命名、重连和结果行为。
- [记忆 MCP 示例](mcp-memory.zh.md) — 不使用独立运行时管理器的直接 stdio 示例。
- [ToolHive](https://github.com/stacklok/toolhive) — 上游运行时与注册表文档。
- [官方 MCP Registry](https://github.com/modelcontextprotocol/registry) — 注册表 API 和发布元数据。

<a id="dev-note"></a>
## Dev Note

自动化测试仅负责连接的 DSH 侧。在此页面可以声称特定第三方工作负载能在 ToolHive 下正确运行之前，需要由发布维护方负责外部 canary 测试。
