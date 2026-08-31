# Agent Note：Playwright MCP 浏览器示例

状态：已实现

[English](2026-08-31-playwright-mcp-browser-example.md) | 中文

## 问题

DSH 的通用 MCP 客户端可以启动浏览器自动化服务，但未经约束的示例可能在 Agent 启动时静默下载软件包、复用个人浏览器配置、持久化认证状态、禁用浏览器沙箱，或让使用者误以为来源过滤器提供了网络隔离。

## 决策

在 `apps/cli/config/examples/mcp-browser` 下提供一个默认关闭的 Playwright MCP 覆盖层。它调用单独安装的 `playwright-mcp` 可执行文件，运维说明将该文件固定到 `@playwright/mcp` `0.0.79`。覆盖层使用 stdio、稳定的 `playwright` 命名空间、无头模式、内存配置、浏览器沙箱、被阻止的 Service Worker、显式 `DSH_PLAYWRIGHT_ALLOWED_ORIGINS` 值、作为文件系统根目录的当前工作区，以及响亮的启动失败。

覆盖层不传递 `--extension`、`--no-sandbox`、`--storage-state`、`--user-data-dir`、`--secrets` 或 `--allow-unrestricted-file-access`。来源白名单仍是 Playwright MCP 请求过滤器；重定向和主机网络需要独立的外部控制。

## 验证

无密钥应用测试解析仓库内覆盖层，检查准确的版本标记和加固参数，拒绝缺失的来源白名单，用包自有 stdio MCP fixture 替换可执行文件，启动真实 Cordis Loader，并观察已发现工具。它不会启动浏览器、下载浏览器二进制文件、访问来源或证明外部网络隔离。

## 考虑过的替代方案

**在覆盖层中通过 `npx` 或 `pnpm dlx` 运行软件包。** 已拒绝，因为模型会话会在 MCP 进程启动前触发软件包解析、下载、生命周期脚本和变化中的依赖图。

**连接用户的浏览器扩展或持久配置。** 已拒绝，因为这会把无关的 Cookie、标签页、历史记录、扩展和已认证会话暴露给工具表面。

**将 `--allowed-origins` 视为出站隔离。** 已拒绝，因为上游明确说明它不是安全边界，也不限制重定向。

## 后果

该示例不增加运行时依赖，也不改变任何已发布 profile。运维方必须单独安装已审阅的可执行文件和浏览器，定义最小来源集合，并在需要网络隔离时添加容器、虚拟机、防火墙或代理控制。已认证和有变更效果的浏览器工作流仍需要针对目标的验收。
