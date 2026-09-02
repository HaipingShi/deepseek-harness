# Agent Note: DevBoard-managed Web runtime control

Status: implemented

[English](2026-09-02-devboard-runtime-control.md) | 中文

## Problem

独立 Web profile 原先同时拥有启动的两部分行为：打印携带进程 token 的根 URL，并选择性地把该 URL 交给操作系统浏览器开启器。产品管理器在不暴露终端的情况下启动 DSH 时，可以观察 HTTP 监听端口，却无法得知已认证应用何时完成挂载，也无法在不抓取含秘密输出的前提下取得浏览器 capability。把监听端口或干净根 URL 当作充分条件，会分别产生过早的 404 响应或 authentication-required 页面。

DevBoard 定义了产品中立的 Runtime Protocol v1，用于已认证就绪与浏览器交接。DSH 需要参与该协议，同时不能把 DevBoard 状态移入浏览器 UI、削弱独立运行时认证、持久化 bootstrap URL，或把管理器控制凭据变成浏览器凭据。

## Decision

只有当 `DEVBOARD_CONTROL_URL`、`DEVBOARD_RUN_ID` 与 `DEVBOARD_CONTROL_GRANT` 都是进程继承的有效值时，`@deepseek-ai/dsh-web-app` 才作为 Runtime Protocol v1 客户端运行。三者全部缺失时保留独立模式的 URL 行与浏览器开启器；部分存在、畸形或来自 `.env` 的配置会让启动失败。托管模式要求 Web 服务器绑定 loopback，抑制两项独立模式公告，并在 Upgrade 请求头中用 bearer grant 与 run id 认证控制 WebSocket。

项目本地的 `.devboard/runtime.json` 声明 `dsh-web` 命令、loopback endpoint 与产品中立的结构化控制模式。DevBoard 在托管激活前于 DSH 外部关联 owner 确认的文件 digest；该声明不包含 run identity、控制 grant、owner origin 或浏览器交接。

由进程根持有的 `DevBoardRuntimeControl` 在已认证 WebSocket 打开后发送 `hello`。它只在 Loader 树结算且 Web 服务器与 Connection 认证服务仍然存在后发送 `ready`，并公告 Web 服务器实际绑定的端口。根级归属使 Connection 插件重载时不会为同一个 DevBoard run 重新连接。握手被拒、消息无效或过大、连接断开、Loader 失败或根关闭时，控制器都会关闭并撤销全部未使用的浏览器交接。

控制器只接受属于本 run、来源为协议规定的两个 DevBoard origin 之一的精确 `open.request` 对象。每个有效请求都会要求当前 Connection 服务生成新的 30 秒浏览器交接，并返回字段精确且 request id 关联一致的 `open.response`。控制器在发送前校验返回 URL。capability 生成失败会返回 `OPEN_UNAVAILABLE`；控制输入无效时关闭连接，不猜测响应。

## Capability ownership

控制 grant 只由控制适配器私有持有，仅用于 WebSocket 握手。它绝不进入 URL、协议消息、公开状态对象、参数向量、持久记录或诊断。runtime-control 代码不输出原始帧、URL、错误或凭据。

`BrowserAuth` 在既有进程启动 token 旁拥有浏览器交接。每个交接都是新的 32 字节 base64url capability，绑定目标 authority 与绝对过期时间。只有以该 query token 为唯一参数的精确 `GET /` 才能消费它。错误 authority 不会消耗另一次有效尝试；成功交换会先移除该 capability，再写入签名的 `SameSite=Lax` 浏览器 cookie，并以 303 重定向到干净根路径。当 DevBoard 使用 `localhost` 而 DSH 使用 `127.0.0.1` 时，Lax 允许该顶层跳转携带新会话。既有进程 token 在进程生命周期内仍可复用并写入 `SameSite=Strict`，因此非托管行为不变。

## Alternatives considered

**让 DevBoard 抓取独立模式 URL 行。** 这能保留一条 DSH 代码路径，但会把含秘密的日志行变成集成协议，继续保留监听过早的竞态，并要求管理器解析产品专属文案。

**把控制 grant 复用为浏览器 token。** 单一凭据会简化签发，但任一平面发生泄漏都会取得另一平面的权限，重放能力会持续整个托管 run，撤销一个未使用浏览器交接也将被迫销毁控制会话。

**把控制状态放进 Web UI。** 管理器必须先打开第一个已认证页面，浏览器代码才能运行，因此 UI 适配器无法解决 bootstrap；它还会把进程生命周期与秘密处理放进错误的程序。

**控制连接断开后重连。** 重连可以掩盖瞬时传输故障，但同一 run grant 没有协议来重新同步待处理 open 请求或替换旧管理器会话。因此客户端关闭并要求新的托管进程 run。

**为托管交接保留 `SameSite=Strict`。** Strict 最大限度减少跨站 cookie 附带，但浏览器会把 `localhost` 与 `127.0.0.1` 视为不同 site，并在跳转到干净根路径时不发送刚签发的 cookie。即使一次性交接已经消费，用户仍会到达 authentication-required 页面。

## Consequences

owner 关联项目 runtime manifest 后，DevBoard 可以启动 DSH、等待已认证应用就绪并打开页面，无需展示终端或复制 token。代价是增加一条进程本地控制连接；只要任一控制字段存在，启动就进入严格的 fail-closed 判定。托管 cookie 保持持久，并允许安全的跨站顶层导航；API 仍会在 cookie 认证前拒绝跨站 fetch 与不匹配的 origin。断开只撤销未使用的交接 capability，不撤销已经完成交换的会话。独立运行的 cookie 保留更严格的策略。

实现使用 Node 内置 WebSocket 与既有密码学能力，因此不增加依赖或磁盘格式。协议 fixture 覆盖真实 source CLI 路径与操作系统分配端口；Connection 测试覆盖单次交换、authority 绑定、过期、重放与显式撤销。
