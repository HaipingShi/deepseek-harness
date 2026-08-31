# 使用 Temporal 编排 DSH 任务

[English](temporal-orchestration.md) | 中文

## 摘要

仓库提供默认关闭的 Temporal `1.23.0` Activity adapter 和 Workflow 示例，用于长生命周期的外部编排。Temporal Worker 在一个自有 DSH SDK runtime 中执行每个 `runDshTask` Activity，返回最终回答与会话 receipt，在 turn 活跃时发送 heartbeat，在取消时关闭 runtime，并且总是在结算前完成回收。确定性的 Workflow 不包含 DSH 或模型调用，并设置 `maximumAttempts: 1`，因为可安全 replay 的编排不会让 Agent turn 或其工具效果自动具备幂等性。

该集成是 DSH 内置 workflow 能力的补充，而不是替代品。模型在一个存活 Harness 内编写的 fan-out 适合使用进程内 worker-thread engine。当应用已经需要跨进程重启的持久外部调度、历史、取消和运维管理的 Worker 时，使用 Temporal。

## 目录

- [准备集成项目](#prepare-an-integration-project)
- [运行 Worker](#run-the-worker)
- [启动 Workflow](#start-a-workflow)
- [取消与重试](#cancellation-and-retries)
- [验证集成](#verify-the-integration)
- [安全与职责](#security-and-ownership)
- [进一步探索](#further-exploration)
- [开发说明](#dev-note)

-----

<a id="prepare-an-integration-project"></a>
## 准备集成项目

这些示例是源码参考，不属于已发布 SDK 文件。将它们复制到运维方拥有的 TypeScript 或 ESM Worker 项目，并在那里安装已审阅版本：

```sh
pnpm add @deepseek-ai/dsh-sdk-client \
  @temporalio/activity@1.23.0 \
  @temporalio/client@1.23.0 \
  @temporalio/worker@1.23.0 \
  @temporalio/workflow@1.23.0
```

为 Worker 部署使用一个专用 Harness home，并在接受任务前初始化选中的 SDK profile：

```sh
export DSH_TEMPORAL_HOME='/absolute/path/to/dedicated-dsh-home'
export DSH_TEMPORAL_TASK_QUEUE='dsh-agent-tasks'
export TEMPORAL_ADDRESS='localhost:7233'
export TEMPORAL_NAMESPACE='default'
```

将模型凭据保存在 Worker 环境或其密钥管理器中。Temporal 会接收 Workflow 和 Activity 的输入与结果；DSH 会在专用 Harness home 下单独记录模型可见提示词、工具调用、工具结果和最终回答。

<a id="run-the-worker"></a>
## 运行 Worker

使用 DSH 要求的 Node 版本启动复制后的 Worker 入口：

```sh
node temporal-worker.mjs
```

Worker 注册 `dshTaskWorkflow` 和 `runDshTask`。Activity adapter 要求 `DSH_TEMPORAL_HOME`，为每次 attempt 创建新的 DSH 会话与 runtime，立即发送一次 Temporal heartbeat，此后每十秒发送一次，并返回 `{ finalResponse, receipt: { sessionId, eventCount, turnEndReason } }`。每个 Activity 一个 runtime 会增加启动耗时，但让每次 attempt 都有显式职责与清理。

<a id="start-a-workflow"></a>
## 启动 Workflow

在使用 Temporal client 的应用中，在同一 task queue 上启动导出的 Workflow，并传递可序列化输入：

```js
const handle = await client.workflow.start(dshTaskWorkflow, {
  taskQueue: 'dsh-agent-tasks',
  workflowId: 'review-change-123',
  args: [{ prompt: 'Review the checked-out change and return a concise report.' }],
})
const result = await handle.result()
```

同时保存 Temporal Workflow id/run id 和返回的 DSH session id。Temporal history 证明编排和 Activity 结果；DSH 日志证明进入模型的内容和已执行工具。任何一份 receipt 都不能单独证明外部副作用已被目标系统接受。

<a id="cancellation-and-retries"></a>
## 取消与重试

示例设置 30 秒 heartbeat timeout，因此长时间 DSH turn 运行时 Worker 可以收到取消。Adapter 通过关闭 SDK runtime 响应取消；当前 DSH SDK 没有 turn 中途取消方法，所以进程 teardown 是取消机制。Temporal 默认的等待取消完成行为随后会等待 Activity 清理，再让 Workflow 观察到取消。

Workflow 将 `retry.maximumAttempts` 固定为 `1`。不要仅仅因为 Temporal 能重试 Activity 就提高该值：第二次 attempt 会创建新的 DSH 会话，可能重复模型成本、消息、文件编辑、浏览器操作、购买或其他工具效果。只有当整个任务有应用级 idempotency key，且每个可达效果都会对该 key 去重或已证明只读时，才启用重试。超时和 Worker 崩溃仍可能使失败前刚完成的效果处于不确定状态。

<a id="verify-the-integration"></a>
## 验证集成

生产使用前：

1. 运行一个无害提示词，保留 Temporal history 和返回的 DSH session 日志。
2. 取消一个正在运行的 Workflow，确认 Activity 发送 heartbeat、关闭 runtime，且不遗留子进程。
3. 在 Workflow task 之间停止 Worker，重启后确认 Temporal 会分发待处理工作，而不会重复已完成 Activity。
4. 在一次工具效果后强制 Activity 失败，确认 `maximumAttempts: 1` 阻止重复 Agent 运行。
5. 对 Temporal history 和 DSH home 同时验证保留、脱敏与访问控制。

仓库的无密钥测试导入真实 Activity adapter，验证输入与隔离 home 要求，检查 receipt 投影与清理，覆盖启动前和运行中的取消，并断言固定版本 Workflow 的 heartbeat 与禁止重试设置。它不会运行 Temporal Server 或 Worker、调用模型 provider、执行工具、replay Workflow history 或证明崩溃恢复。

<a id="security-and-ownership"></a>
## 安全与职责

Temporal 输入和结果可能包含提示词、模型输出、DSH session id、路径和业务数据。为这些数据配置 Temporal payload 加密、namespace 访问、保留和 visibility 策略。专用 DSH home 会把 Harness 记录与个人会话隔离，但不会让并发 Activity 与共享工作区、凭据、外部账户或网络相互隔离；效果可能冲突时，按任务分配这些资源。

DSH 负责 Agent runtime、模型路由、工具、会话日志和子进程清理。Adapter 负责一个 Activity 对一个 runtime 的映射与 receipt 投影。Temporal 负责 Workflow history、任务分发、heartbeat 传递、取消和 Worker 恢复。应用负责 Workflow id、幂等性、授权、task queue、密钥、数据保留和外部效果验收。

-----

<a id="further-exploration"></a>
## 进一步探索

- [Temporal Activity adapter](../../../packages/sdk/client/examples/temporal-activity.mjs) — DSH runtime 职责、heartbeat context、取消和 receipt 映射。
- [Temporal Workflow](../../../packages/sdk/client/examples/temporal-workflow.mjs) — 禁用重试的确定性代理调用。
- [Temporal Worker](../../../packages/sdk/client/examples/temporal-worker.mjs) — task queue 与 Worker 组装。
- [TypeScript SDK](../../../packages/sdk/client/README.zh.md) — 运行、结果、超时和清理语义。
- [内置 workflow engine](../../../packages/workflow/workflow-worker-thread/README.zh.md) — Harness 内实时编排及其限制。
- [Temporal TypeScript SDK](https://docs.temporal.io/develop/typescript) — 上游部署与持久性指南。

<a id="dev-note"></a>
## 开发说明

在运维方项目中保持五个 Temporal 软件包版本一致。一等 DSH Temporal backend 需要持久关联、幂等性词汇、恢复语义、SDK 取消和外部服务集成测试；这些源码示例刻意不增加该产品接口，也不增加仓库依赖。
