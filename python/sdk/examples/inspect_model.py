"""Inspect AI 0.3.260 ModelAPI backed by the DeepSeek Harness Python SDK."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any

from deepseek_harness import DeepSeekHarness
from inspect_ai.model import ChatMessage, GenerateConfig, ModelAPI, ModelOutput, modelapi
from inspect_ai.tool import ToolChoice, ToolInfo

from inspect_model_support import inspect_stop_reason, serialize_messages


@modelapi("dsh")
class DshModelAPI(ModelAPI):
    """Run each Inspect generation as one fresh DSH runtime and session."""

    def __init__(
        self,
        model_name: str,
        base_url: str | None = None,
        api_key: str | None = None,
        api_key_vars: list[str] = [],
        config: GenerateConfig = GenerateConfig(),
        **model_args: Any,
    ) -> None:
        super().__init__(model_name, base_url, api_key, api_key_vars, config)
        self._provider = str(model_args.pop("provider", "deepseek-official"))
        self._profile = str(model_args.pop("profile", "sdk-minimal"))
        self._reasoning_effort = model_args.pop("reasoning_effort", None)
        self._cwd = str(Path(model_args.pop("cwd", Path.cwd())).resolve())
        configured_home = model_args.pop("dsh_home", os.environ.get("DSH_EVAL_HOME"))
        if configured_home is None or not str(configured_home).strip():
            raise ValueError("dsh_home or DSH_EVAL_HOME is required for an isolated evaluation home")
        self._dsh_home = str(Path(configured_home).resolve())
        patches = model_args.pop("patches", ())
        if not isinstance(patches, (list, tuple)) or not all(isinstance(path, str) for path in patches):
            raise TypeError("patches must be a list or tuple of paths")
        self._patches = tuple(patches)
        if model_args:
            raise TypeError(f"unsupported DSH model arguments: {', '.join(sorted(model_args))}")

    async def generate(
        self,
        input: list[ChatMessage],
        tools: list[ToolInfo],
        tool_choice: ToolChoice,
        config: GenerateConfig,
    ) -> ModelOutput:
        """Run one text-only Inspect generation through DSH."""
        del tool_choice
        if tools:
            raise NotImplementedError("Inspect-defined tools cannot be projected into a composed DSH agent")
        prompt = serialize_messages(input)
        result = await asyncio.to_thread(self._run, prompt, config.max_tokens)
        output = ModelOutput.from_content(
            model=self.model_name,
            content=result.final_response,
            stop_reason=inspect_stop_reason(result.finish_reason),
        )
        output.metadata = {
            "dsh_session_id": result.session_id,
            "dsh_event_count": len(result.events),
            "dsh_turn_end_reason": result.finish_reason,
        }
        return output

    def _run(self, prompt: str, max_tokens: int | None):
        with DeepSeekHarness(
            provider=self._provider,
            model=self.model_name,
            reasoning_effort=self._reasoning_effort,
            max_tokens=max_tokens,
            cwd=self._cwd,
            dsh_home=self._dsh_home,
            profile=self._profile,
            patches=self._patches,
            base_url=self.base_url,
            api_key=self.api_key,
        ) as harness:
            return harness.run(prompt)
