# 通过 Playwright MCP 运行隔离浏览器

[English](mcp-browser.md) | 中文

## 摘要

这个默认关闭的集成通过 DSH 的通用 stdio MCP 客户端启动固定版本的 `@playwright/mcp` 可执行文件。仓库内覆盖层使用无头、内存浏览器配置，启用浏览器沙箱，阻止 Service Worker，并要求显式来源白名单。它不会复用个人浏览器、持久化登录状态、安装软件包，也不提供网络隔离。

## 目录

- [安装已审阅的可执行文件](#install-the-reviewed-executable)
- [选择允许的来源](#choose-allowed-origins)
- [启动 DSH](#start-dsh)
- [验证集成](#verify-the-integration)
- [安全与职责](#security-and-ownership)
- [进一步探索](#further-exploration)
- [开发说明](#dev-note)

-----

<a id="install-the-reviewed-executable"></a>
## 安装已审阅的可执行文件

启动 DSH 前准确安装已审阅的软件包版本。将软件包安装和 Agent 启动分开，避免会话执行包管理器或隐式接受变化后的传递依赖图：

```sh
pnpm add --global @playwright/mcp@0.0.79
playwright-mcp --version
```

通过受控的开发或 CI 镜像安装所需的 Playwright 浏览器。浏览器获取是运维方负责的准备步骤，并可能下载可执行代码；DSH 覆盖层不会执行该步骤。

<a id="choose-allowed-origins"></a>
## 选择允许的来源

设置由分号分隔、仅包含任务必需来源的列表：

```sh
export DSH_PLAYWRIGHT_ALLOWED_ORIGINS='https://docs.example.com;https://app.example.com'
```

Playwright MCP 将此选项描述为请求过滤器而非安全边界，并说明它不限制重定向。当浏览器必须无法访问其他网络时，使用容器、虚拟机、主机防火墙或受控代理。在发送凭据或私有数据前，通过外部 canary 审查重定向和第三方资源。

<a id="start-dsh"></a>
## 启动 DSH

使用默认关闭的覆盖层启动普通 Web 组合：

```sh
pnpm dsh web --patch apps/cli/config/examples/mcp-browser/playwright.cordis.yml
```

浏览器以无头模式运行，配置保存在内存中，并阻止 Service Worker。MCP 进程继承当前工作区作为文件系统根目录。覆盖层不会传递 storage-state 文件、用户数据目录、扩展连接、密钥文件或不受限文件访问。白名单未设置或启动失败时，插件不会激活。

<a id="verify-the-integration"></a>
## 验证集成

授予已认证页面或内网页面访问前：

1. 从公开、非敏感来源开始，并确认只出现 `mcp__playwright__...` 工具。
2. 导航至白名单页面并捕获预期的可访问性快照。
3. 直接请求不在白名单中的来源，确认请求失败。
4. 单独测试白名单来源的重定向，因为白名单不会限制重定向目标。
5. 结束 DSH 进程，确认没有创建可复用的 Playwright 配置或 storage-state 文件。

仓库的无密钥测试检查准确的上游版本和加固参数，拒绝缺失的白名单，用本地 stdio MCP fixture 替换上游，启动真实 Cordis Loader，并观察一个已发现工具。它不会启动浏览器、测试上游重定向行为、验证操作系统隔离，也不会证明目标网站允许自动化。

<a id="security-and-ownership"></a>
## 安全与职责

Playwright 操作可能提交表单、改变远端状态、下载内容，并向模型暴露页面数据。仅在任务授权这些效果时允许来源；需要认证时使用专用低权限账户。将页面文本、可访问性快照、截图、下载、控制台消息和工具参数视为潜在敏感会话数据。

DSH 负责 MCP 进程生命周期、模型可见工具注册、工具调用和会话日志。Playwright MCP 负责浏览器自动化及其请求过滤。运行环境负责可执行文件来源、浏览器安装、文件系统与网络隔离、凭据，以及内存浏览器配置以外的清理。

-----

<a id="further-exploration"></a>
## 进一步探索

- [MCP 客户端包](../../../packages/mcp/mcp-client/README.zh.md) — stdio 生命周期、命名、超时和结果行为。
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) — 上游配置和浏览器行为。
- [ToolHive MCP 运行时](mcp-runtime.zh.md) — 容器管理的 MCP 工作负载和注册表审阅。

<a id="dev-note"></a>
## 开发说明

保持可执行文件版本和加固断言同步。任何配置持久化、已认证浏览器复用、不受限文件访问或更广网络访问都是独立安全决策，需要单独的集成验收。
