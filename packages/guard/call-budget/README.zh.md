---
description: "可选的循环保洁 guard：限制一个 agent 在两个人类输入之间最多调用多少次工具，供需要按次数约束失控工具循环的部署选用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-call-budget

[English](README.md) | 中文

## 概述

无法达成目标的 agent 可以永远调用工具——反复重试失败的命令，或者一个接一个地运行同一命令的不同变体——而当每次调用都不相同时，任何提醒都无济于事。`dsh-call-budget` 按次数约束这类失败：你为每个预算窗口配置工具调用上限：恰好用完额度的调用正常执行，第一次试图超出额度的调用会被拒绝，同时 guard 取消当前轮。这个上限是成本控制，不是进展判断：它无法区分有用工作与空转，所以上限只应配置在了解自身正常调用量的部署里。本插件默认不启用；以至少一条限额挂载插件即是全部的启用动作。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当单个 agent 的工具开销必须在已知上限处停止、而每次调用又各不相同时，挂载本 guard。请继续保留 `repeat-tool-reminder`：它对完全相同的重复调用给出建议且从不阻止，而本预算是结束当前轮的硬性兜底。

### When to choose it

适用于自主或定时运行、卡住的 agent 消耗真实资源快过人工察觉的场景——shell 执行、页面导航、计费工具调用。当正常工作的调用次数不可预测时避免使用：agent 在任务中途触及上限时，即便它即将完成，当前轮也会被停止；调大上限是唯一的解法。

### Minimal configuration

在 `cordis.yml` 或 `--patch` overlay 中加一条记录即可；至少需要一条限额：

```yaml
- insert:
    - id: call-budget
      name: '@deepseek-ai/dsh-call-budget'
      config:
        total: 24          # every tool call of one window, across all tools
        tools:
          bash: 8          # calls of one window per matching tool name
          'mcp_*': 12      # `*`-wildcard patterns name tool sets
```

| Field | Default | Meaning |
|---|---|---|
| `total` | — | 一个预算窗口内计数的工具调用总上限（跨全部工具）；`total`/`tools` 至少配置一项 |
| `tools` | — | 一个预算窗口内的按模式上限，键为 `*` 通配符工具名模式；一次调用命中多个模式时同时消耗每个上限 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-call-budget)是每个可接受字段的详尽来源。

### The budget window

窗口在 agent 的轮次由人类创作的消息开启时打开，跨越该 agent 直到下一条人类消息之前的全部动作，包括机器驱动自动续接的轮次。因此机器续接的工作无法重置预算再继续空转；窗口已停止时，来自插件输入的续接步骤会在消耗任何模型请求之前被拒绝。新的人类消息开启携带完整预算的新窗口。计数按 agent 保存在内存中：不同 agent 从不共享窗口，续用于新进程的会话以全新窗口开始。

### What happens at the cap

超出上限的调用被拒绝——其结果即可见错误 `Error: tool call budget exhausted: …`——同时通过标准取消路径取消该 agent 的当前轮，携带同一原因。该轮以 `aborted` 结束，原因为 `hook` 并注明耗尽的上限，因此停止原因在会话记录中可见、可从日志重建。已派发的调用正常完成并记录结果；同批次中尚未开始的调用会收到已记录的中止结果，因此日志中每个调用都有其结果。待处理的收件箱工作被保留给之后的轮次。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

本节解释 guard 如何计数与停止，并指向实现这些行为的代码；可观察行为已全部覆盖在 [Use this package](#use-this-package)。

### Design philosophy

- **确定性，非启发式。** 上限只数调用；绝不判断进展、不检查参数相似性、不读取提示词。唯一输入是工具名与配置的数字。
- **在有序阶段预留。** 计数发生在 `tools/pre-execute`，调度器在并行批次内也逐调用顺序运行该阶段——每次调用的预留完成后才开始下一次，因此一个批次无法突破剩余额度超发。
- **通过受支持的生命周期停止。** 触及上限时调用 `agent.cancel({kind: 'hook', reason}, {keepInbox: true})`，同步中止轮次信号；运行在调度器内的监听器不可能因等待工具的停止接口而自锁。调度器自身的 Abort 处理会排空已开始的调用并为跳过的调用记录合成结果。
- **加载即失败大声。** 无限额挂载、低于 1 的上限、非整数上限或空模式会在插件加载时抛出，绝不是行为的静默改变。

### What counts

每个携带 agent 到达 `tools/pre-execute` 的调用都会计数，分为这些组：模型发起的调用、PTC `run_code` 嵌套子派发（它们把 agent 转发进同一阶段）、以及被更晚监听器拒绝的调用。无 agent 的直接 `ctx.tools.execute()` 调用者不属于任何轮次，不计数。预留后又被拒绝的调用已经消耗了其预留。计数在窗口范围内精确；不存在对已完成窗口的回看。

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、大声失败的校验、预留与窗口监听器 |
| — | 不发布运行时不变量伴生；计数器是单个插件实例的私有状态，不暴露可供独立伴生观察的包级快照。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面：guard 挂钩的工具调用管线、建议型的姊妹 guard、以及详尽的配置参考。

- [工具子系统参考](../../../docs/subsystems/tools.zh.md) — guard 依赖的 `tools/pre-execute` 瀑布与取消驱动的轮次结束。
- [Repeat-tool reminder](../repeat-tool-reminder/README.zh.md) — 与预算互补的精确重复建议型 guard。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-call-budget) — 每个可接受配置字段及其来源声明。
- [guard 组地图](../README.zh.md) — 姊妹 guard 包与循环保洁家族。

-----

<a id="model-experience"></a>
## 模型体验

### Denied call at the cap

#### What the model sees

超限调用返回引用已耗尽上限的错误结果；当前轮在该步结束，不添加任何工具 schema 或提示文本，同批次中更晚的调用收到已记录的派发前中止结果。

##### Denial result text

```markdown
Error: tool call budget exhausted: the total budget of 24 tool calls for this turn is spent
```

#### Token effect

拒绝文本是保留历史中的一行错误结果；它取代该调用本会产生的工具输出。

#### KV Cache effect

只追加；拒绝内容位于可复用请求前缀之后，不使既有 KV-cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明 guard 何时不适配。它们是当前的包约束，不是任务清单。

- **是成本上限，不是进展判断** — 无论工作是否有产出，guard 都在配置的次数处停止开销；选择安全上限是部署方的责任。
- **窗口是内存态且按进程** — 续用于新进程的会话以全新窗口开始；预算不是持久配额。
- **只有 pre-execute 到达者计数** — 在 guard 监听器之前、被更早的 `tools/pre-execute` 监听器拒绝的调用不计数；顺序取决于周边组合。
- **机器驱动可再次唤醒已停止的 agent** — 每次再唤醒都会在任何模型请求之前被拒绝，但在自身重试策略放弃之前，循环唤醒的驱动会产生空的 blocked 轮。
- **无按窗口用量面** — guard 不暴露用量接口；请从会话日志的工具调用审计消耗。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

[call-budget 特性笔记](../../../.agents/notes/implemented/feature/2026-09-08-call-budget.zh.md)记录了设计备选——建议式升级、`concludesTurn` 标记、按轮键控——以及取消生命周期加人类重置窗口最终胜出的原因。

</details>
