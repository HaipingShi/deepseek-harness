# 通过 Microsandbox MCP 运行微虚拟机沙箱

[English](microsandbox-mcp.md) | 中文

## 摘要

这个默认关闭的集成通过 DSH 的通用 stdio MCP 客户端启动固定版本的 `microsandbox-mcp` 可执行文件。Microsandbox 提供硬件隔离的微虚拟机执行，DSH 负责模型可见工具注册和会话日志。仓库内覆盖层选择本地后端，要求显式宿主路径白名单，关闭上游危险工具开关，并限制输出与默认执行时间。它不会安装运行时、下载镜像、启用云后端，也不会收窄上游服务的工具命名空间。

## 目录

- [安装已审阅的可执行文件](#install-the-reviewed-executable)
- [选择宿主路径](#choose-host-paths)
- [启动 DSH](#start-dsh)
- [验证集成](#verify-the-integration)
- [安全与职责](#security-and-ownership)
- [进一步探索](#further-exploration)
- [开发说明](#dev-note)

-----

<a id="install-the-reviewed-executable"></a>
## 安装已审阅的可执行文件

使用支持硬件虚拟化的宿主机，并在启动 DSH 前准确安装已审阅的软件包版本：

```sh
pnpm add --global microsandbox-mcp@0.6.16
microsandbox-mcp --version
```

将安装和 Agent 启动分开。运行时安装、原生二进制获取、OCI 镜像拉取和宿主虚拟化配置都会在模型会话之外执行代码，仍由运维方负责。尝试真实 canary 前先满足上游平台前置条件。

<a id="choose-host-paths"></a>
## 选择宿主路径

设置由冒号分隔的白名单，仅包含本任务允许 Microsandbox 挂载、复制或快照的目录：

```sh
export DSH_MICROSANDBOX_HOST_PATHS='/absolute/path/to/disposable-workspace'
```

覆盖层在该值缺失时会刻意拒绝启动，而不是接受 MCP 服务当前工作目录这一默认值。使用不含密钥的可丢弃目录。白名单路径按具体操作授予上游工具访问权；它不是只读策略，也不会保护该路径内的文件免受修改或泄露。

<a id="start-dsh"></a>
## 启动 DSH

使用默认关闭的覆盖层启动普通 Web 组合：

```sh
pnpm dsh web --patch apps/cli/config/examples/mcp-sandbox/microsandbox.cordis.yml
```

覆盖层固定 `MSB_BACKEND=local`，使用 `MICROSANDBOX_MCP_HOST_PATH_POLICY=allowlist`，设置 `MICROSANDBOX_MCP_ENABLE_DANGEROUS=0`，将单次返回负载限制为 256 KiB，并为普通上游操作设置 60 秒默认超时。启动错误会阻止 MCP 客户端激活。仅在单独审阅的部署覆盖层中选择云后端、profile、API key、更大输出或危险工具模式。

<a id="verify-the-integration"></a>
## 验证集成

分配真实工作前：

1. 从一个空的可丢弃目录开始，确认只出现 `mcp__microsandbox__...` 工具。
2. 运行上游运行时检查，不让模型会话安装任何内容。
3. 创建沙箱、执行无害命令、读取日志，然后停止并删除沙箱。
4. 确认白名单目录以外的挂载或宿主复制操作失败。
5. 清理后确认宿主没有残留沙箱、shell 会话、卷、快照、SSH 端点或意外镜像。

仓库的无密钥测试检查准确的上游版本和安全环境变量，拒绝缺失的宿主路径白名单，用本地 stdio MCP fixture 替换上游，启动真实 Cordis Loader，并观察一个已发现工具。它不会启动微虚拟机、安装 Microsandbox、拉取镜像、测试宿主 hypervisor 或证明外部清理完成。

<a id="security-and-ownership"></a>
## 安全与职责

启用该服务会注册它发现的完整 MCP 命名空间。该命名空间可能包含运行时安装、沙箱与 shell 生命周期、命令执行、宿主复制、挂载、卷、镜像、快照、SSH 和 SFTP。上游危险工具开关只是一道防护，不是完整的 DSH 授权策略。当模型只能获得经过审阅的子集时，使用专用 Agent profile 和 `ctx.tools.restrict()` 或 `tools/pre-execute` 策略；对改变状态或跨越宿主的操作要求人工批准。

微虚拟机隔离对 guest 工作负载与宿主的分离强于 DSH 同进程沙箱策略，但它不会约束 DSH 本身、MCP 进程、允许的宿主路径、镜像来源、网络出站、凭据或上游实现缺陷。DSH 负责 MCP 进程生命周期、工具命名、调用和会话日志。Microsandbox 负责微虚拟机运行时及其 MCP 操作。运维方负责宿主前置条件、二进制与镜像来源、工具授权、路径、网络策略、容量、清理和任何云凭据。

-----

<a id="further-exploration"></a>
## 进一步探索

- [MCP 客户端包](../../../packages/mcp/mcp-client/README.zh.md) — stdio 生命周期、命名、超时和结果行为。
- [Microsandbox](https://github.com/superradcompany/microsandbox) — 微虚拟机运行时、受支持宿主和 SDK。
- [Microsandbox MCP](https://github.com/superradcompany/microsandbox-mcp) — 服务工具和环境配置。
- [工具运行时](../../../packages/core/tools/README.zh.md) — 按 Agent 限制和执行前策略。

<a id="dev-note"></a>
## 开发说明

保持可执行文件版本、环境变量名称和安全断言与上游同步。基于 Microsandbox 的原生 DSH `fs`、`subprocess` 或 `terminal` provider 属于另一个 capability seam 项目，需要生命周期、取消、投影和端到端快照要求；本 MCP 示例不声称完成该集成。
