# 使用 Promptfoo 或 Inspect 评测 DSH

[English](external-evaluation.md) | 中文

## 摘要

仓库为 Promptfoo `0.122.2` 和 Inspect AI `0.3.260` 提供默认关闭的适配器。两者都驱动已发布的 DSH SDK 协议，而不是绕过 Harness 直接调用模型。每个样本拥有新的运行时和会话，只向评测器返回最终提交的助手文本，并将 DSH session id、事件数和轮次结束原因记录为评测器元数据。适配器不会声称 SDK 结果未证明的 token 使用量、成本、沙箱或基准有效性。

## 目录

- [准备评测 home](#prepare-an-evaluation-home)
- [运行 Promptfoo](#run-promptfoo)
- [运行 Inspect](#run-inspect)
- [解释证据](#interpret-evidence)
- [安全与限制](#security-and-limitations)
- [进一步探索](#further-exploration)
- [开发说明](#dev-note)

-----

<a id="prepare-an-evaluation-home"></a>
## 准备评测 home

使用专用 Harness home，不要使用个人 DSH home。评测前初始化选定的 SDK profile，并安装所有私有 profile patch；适配器绝不会修改依赖 manifest 或安装插件：

```sh
export DSH_EVAL_HOME="$PWD/.dsh-eval"
export DEEPSEEK_API_KEY='<evaluation credential>'
pnpm dsh plugin --profile sdk-minimal list
```

凭据、提示、工具参数、工具结果和最终文本可能到达配置的模型 provider。使用专用凭据和只包含评测授权数据的工作区。

<a id="run-promptfoo"></a>
## 运行 Promptfoo

使用 Node 24，并在本仓库之外安装已审阅的 Promptfoo 版本。示例自定义 provider 导入 `@deepseek-ai/dsh-sdk-client`；请在该包可解析的已构建或已安装工作区运行：

```sh
pnpm add --global promptfoo@0.122.2
cd packages/sdk/client/examples
promptfoo eval --config promptfooconfig.yaml --no-cache
```

示例配置有意只提供 smoke 断言。将它作为门禁前，用已审阅的数据集和确定性 scorer 替换任务与断言。Promptfoo 缓存可能阻止新的 DSH 运行，因此当每条结果都必须带有新的 Harness receipt 时使用 `--no-cache`。启动前观察到 abort 会阻止运行时启动；当前 SDK 协议无法取消已经运行的轮次。

<a id="run-inspect"></a>
## 运行 Inspect

在独立评测环境中安装已审阅的 Inspect 版本与 `deepseek-harness-sdk`，然后从 Inspect task 导入仓库适配器，以注册其 `dsh` model API：

```python
import inspect_model  # registers dsh/<model>
```

将示例目录加入 `PYTHONPATH` 后运行 task：

```sh
python -m pip install 'inspect-ai==0.3.260' deepseek-harness-sdk
PYTHONPATH="$PWD/python/sdk/examples" \
  inspect eval path/to/task.py \
  --model dsh/deepseek-v4-flash \
  -M provider=deepseek-official \
  -M profile=sdk-minimal
```

适配器将带显式角色的有序文本历史序列化为一条被记录的 DSH 用户提示。它拒绝 Inspect 定义的工具，因为在不改变工具身份和执行职责的情况下，无法将这些 schema 投影到已组合的 DSH agent 中。DSH 自身配置的工具在 Harness 内仍然可用。

<a id="interpret-evidence"></a>
## 解释证据

Promptfoo 将 DSH receipt 保存在 provider response metadata 下；Inspect 将相同字段保存在 `ModelOutput.metadata` 下。使用 `dshSessionId` 或 `dsh_session_id` 定位对应的 Harness session log。评测器日志证明 scorer 看到了哪个输出，DSH 日志证明该会话内的模型可见输入和工具生命周期。为可复现运行保留两类产物，以及准确的数据集、评测器版本、适配器 commit、profile、patch、provider、模型和环境指纹。

通过断言只为该数据集、scorer、配置和本次运行提供证据。它不是 provider 验收、生产放行、安全批准，也不能证明缓存结果经过了新执行。适配器省略 token 和成本字段，因为 SDK 结果没有公开它们的权威聚合。

<a id="security-and-limitations"></a>
## 安全与限制

Promptfoo 和 Inspect 在各自的缓存或日志中存储提示、响应、分数与元数据；DSH 则在评测 home 下独立保留会话事件。为两类存储设置保留、访问和脱敏策略。发布评测产物前，检查其中的提示、模型输出、工具数据、路径、凭据和专有基准材料。

每个样本都会启动并关闭一个 DSH 运行时，以吞吐量换取隔离与清理。并行评测器仍可能共享配置的 home、工作区、外部账户、端口和远程配额；基准会改变状态时，应为每个 worker 分配这些资源。适配器只接受文本历史，不投影评测器定义的工具，也不会把 DSH 事件级 token 记账映射到评测器 usage 字段。

-----

<a id="further-exploration"></a>
## 进一步探索

- [Promptfoo provider 示例](../../../packages/sdk/client/examples/promptfoo-provider.mjs) — 结构化 provider 适配器和 receipt 元数据。
- [Promptfoo smoke 配置](../../../packages/sdk/client/examples/promptfooconfig.yaml) — 一条可替换的任务和断言。
- [Inspect model 示例](../../../python/sdk/examples/inspect_model.py) — 已注册的 `dsh` ModelAPI。
- [TypeScript SDK](../../../packages/sdk/client/README.zh.md) 和 [Python SDK](../../../python/sdk/README.zh.md) — 运行时、会话、错误和清理契约。

<a id="dev-note"></a>
## 开发说明

无密钥 Promptfoo 测试让适配器通过真实 SDK JSON-RPC 客户端连接包自有脚本化运行时。Python 测试在不安装 Inspect 的情况下执行 Inspect 转换规则，维护者还可以针对固定的官方 wheel 单独导入适配器。两种无密钥测试都不会调用模型 provider，也不会验证第三方 scorer。
