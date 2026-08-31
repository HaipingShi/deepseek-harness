# Evaluate DSH with Promptfoo or Inspect

English | [中文](external-evaluation.zh.md)

## Summary

The repository provides default-off adapters for Promptfoo `0.122.2` and Inspect AI `0.3.260`. Both drive the shipped DSH SDK protocol instead of bypassing the Harness with a direct model call. Each sample owns a fresh runtime and session, returns only the final committed assistant text to the evaluator, and records the DSH session id, event count, and turn-end reason as evaluator metadata. The adapters do not claim token usage, cost, sandboxing, or benchmark validity that the SDK result does not establish.

## Table of Contents

- [Prepare an evaluation home](#prepare-an-evaluation-home)
- [Run Promptfoo](#run-promptfoo)
- [Run Inspect](#run-inspect)
- [Interpret evidence](#interpret-evidence)
- [Security and limitations](#security-and-limitations)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

-----

<a id="prepare-an-evaluation-home"></a>
## Prepare an evaluation home

Use a dedicated Harness home instead of a personal DSH home. Initialize the chosen SDK profile and install any private profile patches before the evaluation; the adapters never mutate dependency manifests or install plugins:

```sh
export DSH_EVAL_HOME="$PWD/.dsh-eval"
export DEEPSEEK_API_KEY='<evaluation credential>'
pnpm dsh plugin --profile sdk-minimal list
```

The credential, prompts, tool arguments, tool results, and final text can reach the configured model provider. Use a dedicated credential and workspace with only the data authorized for the evaluation.

<a id="run-promptfoo"></a>
## Run Promptfoo

Use Node 24 and install the reviewed Promptfoo version outside this repository. The example custom provider imports `@deepseek-ai/dsh-sdk-client`; run it from a built or installed workspace where that package resolves:

```sh
pnpm add --global promptfoo@0.122.2
cd packages/sdk/client/examples
promptfoo eval --config promptfooconfig.yaml --no-cache
```

The sample config is intentionally a smoke assertion. Replace its task and assertion with a reviewed dataset and deterministic scorer before using it as a gate. Promptfoo caching can suppress a new DSH run, so use `--no-cache` when every result must have a fresh Harness receipt. An abort observed before launch prevents the runtime from starting; the current SDK protocol cannot cancel an already running turn.

<a id="run-inspect"></a>
## Run Inspect

Install the reviewed Inspect release in a separate evaluation environment alongside `deepseek-harness-sdk`, then import the repository adapter from the Inspect task so its `dsh` model API is registered:

```python
import inspect_model  # registers dsh/<model>
```

Run the task with the examples directory on `PYTHONPATH`:

```sh
python -m pip install 'inspect-ai==0.3.260' deepseek-harness-sdk
PYTHONPATH="$PWD/python/sdk/examples" \
  inspect eval path/to/task.py \
  --model dsh/deepseek-v4-flash \
  -M provider=deepseek-official \
  -M profile=sdk-minimal
```

The adapter serializes the ordered text history with explicit roles into one logged DSH user prompt. It rejects Inspect-defined tools because those schemas cannot be projected into an already composed DSH agent without changing tool identity and execution ownership. DSH's own configured tools remain available inside the Harness.

<a id="interpret-evidence"></a>
## Interpret evidence

Promptfoo stores the DSH receipt under provider response metadata; Inspect stores the same fields under `ModelOutput.metadata`. Use `dshSessionId` or `dsh_session_id` to locate the corresponding Harness session log. The evaluator log proves which output a scorer saw, while the DSH log proves the model-visible inputs and tool lifecycle inside that session. Keep both artifacts and the exact dataset, evaluator version, adapter commit, profile, patches, provider, model, and environment fingerprint for a reproducible run.

A passing assertion is evidence for that dataset, scorer, configuration, and run only. It is not provider acceptance, production clearance, security approval, or proof that a cached result was freshly executed. The adapters omit token and cost fields because the SDK result does not expose an authoritative aggregate for them.

<a id="security-and-limitations"></a>
## Security and limitations

Promptfoo and Inspect store prompts, responses, scores, and metadata in their own caches or logs; DSH separately retains session events under the evaluation home. Set retention, access, and redaction policy for both stores. Do not publish evaluator artifacts until they have been inspected for prompts, model output, tool data, paths, credentials, and proprietary benchmark material.

Each sample starts and closes a DSH runtime, favoring isolation and cleanup over throughput. Parallel evaluators can still share the configured home, workspace, external accounts, ports, and remote quotas; allocate those resources per worker when the benchmark mutates state. The adapters accept text histories only, do not project evaluator-defined tools, and do not map DSH event-level token accounting into evaluator usage fields.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Promptfoo provider example](../../../packages/sdk/client/examples/promptfoo-provider.mjs) — structural provider adapter and receipt metadata.
- [Promptfoo smoke config](../../../packages/sdk/client/examples/promptfooconfig.yaml) — one replaceable task and assertion.
- [Inspect model example](../../../python/sdk/examples/inspect_model.py) — registered `dsh` ModelAPI.
- [TypeScript SDK](../../../packages/sdk/client/README.md) and [Python SDK](../../../python/sdk/README.md) — runtime, session, error, and cleanup contracts.

<a id="dev-note"></a>
## Dev Note

The keyless Promptfoo test runs the adapter through the real SDK JSON-RPC client against the package-owned scripted runtime. The Python test executes the Inspect conversion rules without installing Inspect, and a maintainer can separately import the adapter against the pinned official wheel. Neither keyless test calls a model provider or validates a third-party scorer.
