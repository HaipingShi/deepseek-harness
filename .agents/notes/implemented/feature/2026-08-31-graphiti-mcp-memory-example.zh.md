# Agent Note：Graphiti MCP 记忆示例

状态：已实现

[English](2026-08-31-graphiti-mcp-memory-example.md) | 中文

## 问题

现有记忆 MCP 示例覆盖本地存储，但没有覆盖通过已配置模型 provider 提取实体与关系的时序知识图谱。Graphiti 通过 MCP 提供该接口，但已审阅的 HTTP 服务没有端点认证，而且数据库、模型调用、异步写入、遥测和破坏性维护工具会带来实质不同的运维责任。

## 决策

将 Graphiti MCP `mcp-v1.0.2` 作为第四个默认关闭的记忆覆盖层。覆盖层通过通用 Streamable HTTP 客户端连接，要求显式 `DSH_GRAPHITI_MCP_URL`，只接受回环主机名上的普通 HTTP，不发送 header 或 provider 凭据，并在启动无法发现服务时响亮失败。Graphiti 及其数据库由运维方单独监管。

已审阅 tag 的组合 Dockerfile 使用可变的 FalkorDB 基础镜像，独立 Dockerfile 则会在解析无上限的 MCP 主版本前丢弃锁文件，并随开发依赖组排除实际导入的 `httpx` 依赖。在覆盖层旁交付一份兼容 Dockerfile，从该 tag 的精确 `mcp_server` 目录构建，并固定 Python 与 uv 镜像 digest、Graphiti Core 0.28.2、`httpx` 0.28.1 和 MCP 1.26.0。该配方仍由运维方构建并单独监管，不会把 Graphiti 生命周期移入 DSH。

指南记录 tag commit、兼容版本、上游遥测关闭方式、异步写入、group 作用域和完整的读/写/删除/维护工具接口。网络部署需要单独的认证入口决策，本回环参考配置刻意不表达该部署。

## 验证

无密钥记忆套件解析全部四个示例，检查每个版本和通用 MCP 字段，通过静态检查拒绝兼容镜像已审阅输入的漂移，通过真实 Loader 激活路径拒绝缺失或非回环的 Graphiti 端点，将仓库内 HTTP 传输连接到包自有 fixture，并观察已发现工具。现有传输替换矩阵还证明 Graphiti 配置项可以通过通用客户端加载，且不接触第三方。

默认测试不会运行 Graphiti、图数据库、LLM 或 embedding provider、异步提取、持久化、删除、认证或遥测。单独的本地 canary 会构建精确源码 commit，在内部网络启动固定版本的数据库与兼容镜像，等待健康检查，并通过回环端点发现 MCP 工具。完整的真实验收仍需要在一个已审阅 group id 下提供写入、新会话召回和使用证据。

## 考虑过的替代方案

**添加 Graphiti 专属 DSH 插件。** 已拒绝，因为 MCP 已经承载提供方的工具 schema 与调用；专属插件会让 Graphiti 配置和生命周期成为 DSH 维护的接口，却不会改善连接边界。

**提供 header 为空的远程 HTTP 示例。** 已拒绝，因为已审阅服务没有端点认证。可复制的网络示例会使未做身份决策就暴露读取、写入、删除和维护操作显得正常。

**从 DSH 覆盖层启动 Graphiti 及其数据库。** 已拒绝，因为一个 MCP 子进程配置项无法负责任地管理多服务部署的数据库、模型凭据、迁移、持久化、健康状态和清理。

## 后果

DSH 获得可检查的集成路径，但不接管 Graphiti schema 或生命周期。运维方负责服务与数据库版本、模型和 embedding 凭据、端点保护、租户隔离、配额、保留、备份、provider 成本和图清理。更新参考版本时必须同时重复无密钥检查和真实记忆验收。
