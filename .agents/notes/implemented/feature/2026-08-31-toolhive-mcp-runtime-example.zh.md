# Agent Note: ToolHive MCP 运行时示例

Status: implemented

[English](2026-08-31-toolhive-mcp-runtime-example.md) | 中文

## Problem

DSH 可以直接连接 stdio 和 Streamable HTTP MCP 服务器，但不负责第三方包发现、容器隔离、网络策略、secret 交付、工具过滤或审计。将这些职责加入通用 MCP 客户端会重复独立运行时管理器的功能，并让注册表元数据看起来像执行批准。

## Decision

在 `apps/cli/config/examples/mcp-runtime` 下提供一个默认关闭的 ToolHive overlay。它插入现有的 `@deepseek-ai/dsh-mcp-client`，从 `DSH_TOOLHIVE_MCP_URL` 读取一个预先存在的 ToolHive 代理 URL，使用稳定的 `toolhive` 命名空间，不发送授权 header，并在 endpoint 或初始发现失败时阻止插件激活。[ToolHive 指南](../../../../docs/user/guide/mcp-runtime.zh.md)负责操作员设置和职责划分。

ToolHive 负责注册表解析、工作负载执行、网络与文件系统授权、secret、工具过滤、入站认证和审计。DSH 负责其 MCP 客户端连接、模型可见名称、调用生命周期和会话记录。注册表元数据仅作为发现输入；操作员在启动前批准解析后的包或镜像、版本、来源、权限、凭据、目标和工具。

## Validation

keyless 应用测试解析仓库内置的 overlay，检查已审查的 ToolHive 版本标记及不存在内嵌凭据，证明未设置 endpoint 时 schema 验证失败，使用包自身的 Streamable HTTP fixture 替代 ToolHive，启动真实 Cordis Loader，并观察发现的工具。该测试不联系注册表，也不运行第三方工作负载。

## Alternatives considered

**添加 ToolHive 专用运行时包。** 拒绝此方案，因为 DSH 已经能使用 ToolHive 的 Streamable HTTP 输出，而包装层会重复 ToolHive 负责的工作负载生命周期和策略。

**从 DSH 查询官方 MCP Registry 并安装条目。** 拒绝此方案，因为发现元数据不是信任证据，自动安装会增加包执行和供应链边界，而且 ToolHive 已经负责注册表解析。

**在仓库内置的 overlay 中放置 access token。** 拒绝此方案，因为本地 ToolHive 代理默认绑定 loopback，而经过认证的部署需要部署专属的凭据处理，不能使用共享的占位 header。

## Consequences

该示例不增加运行时依赖，也不修改发布的 profile。操作员必须安装 ToolHive、选择并启动工作负载、审查其授权，并显式传入生成的 loopback `/mcp` URL。自动化测试只证明 DSH 互操作性；每个所选服务器仍需要独立的运行时和行为验收。
