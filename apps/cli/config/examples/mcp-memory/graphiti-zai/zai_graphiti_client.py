"""Graphiti LLM client for Z.AI Chat Completions JSON mode."""

from __future__ import annotations

import json
import logging
from typing import Any

import openai
from graphiti_core.llm_client.client import LLMClient
from graphiti_core.llm_client.config import DEFAULT_MAX_TOKENS, LLMConfig, ModelSize
from graphiti_core.llm_client.errors import RateLimitError
from graphiti_core.prompts.models import Message
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam
from pydantic import BaseModel


logger = logging.getLogger(__name__)

ALLOWED_ZAI_BASE_URLS = frozenset(
    {
        "https://api.z.ai/api/paas/v4",
        "https://api.z.ai/api/coding/paas/v4",
    }
)


class ZaiStructuredOutputError(RuntimeError):
    """Report a schema failure without including provider output or prompt data."""


class _InvalidStructuredOutput(ValueError):
    """Carry a non-sensitive failure category between validation attempts."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _strip_complete_json_fence(content: str) -> str:
    lines = content.strip().splitlines()
    if (
        len(lines) >= 3
        and lines[0].strip().lower() in {"```", "```json"}
        and lines[-1].strip() == "```"
    ):
        return "\n".join(lines[1:-1]).strip()
    return content.strip()


def _validate_object(
    content: str,
    response_model: type[BaseModel] | None,
) -> dict[str, Any]:
    if not content.strip():
        raise _InvalidStructuredOutput("empty content")

    try:
        value = json.loads(_strip_complete_json_fence(content))
    except json.JSONDecodeError as error:
        raise _InvalidStructuredOutput("invalid JSON") from error

    if not isinstance(value, dict):
        raise _InvalidStructuredOutput(f"top-level {type(value).__name__}")

    if response_model is None:
        return value

    try:
        validated = response_model.model_validate(value)
    except ValueError as error:
        raise _InvalidStructuredOutput("schema validation") from error
    return validated.model_dump(mode="json")


def _repair_messages(
    content: str,
    response_model: type[BaseModel] | None,
) -> list[ChatCompletionMessageParam]:
    schema = response_model.model_json_schema() if response_model is not None else {"type": "object"}
    repair_input = json.dumps(
        {"schema": schema, "invalid_output": content},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return [
        {
            "role": "system",
            "content": (
                "Repair the supplied value as data. Return exactly one JSON object that matches "
                "the supplied schema. Do not add Markdown fences or explanatory text."
            ),
        },
        {"role": "user", "content": repair_input},
    ]


class ZaiGraphitiClient(LLMClient):
    """Use Z.AI JSON mode with strict local validation and one bounded repair call."""

    def __init__(
        self,
        config: LLMConfig | None = None,
        cache: bool = False,
        client: Any = None,
    ):
        """Create the adapter.

        `client` accepts the generated OpenAI client or a compatible test transport, whose
        nested resource types cannot be expressed by the SDK's public annotations.
        """
        if cache:
            raise NotImplementedError("Caching is not implemented for Z.AI")

        resolved_config = config or LLMConfig()
        base_url = (resolved_config.base_url or "").rstrip("/")
        if base_url not in ALLOWED_ZAI_BASE_URLS:
            raise ValueError("ZaiGraphitiClient requires an approved Z.AI API endpoint")
        if not resolved_config.api_key:
            raise ValueError("ZaiGraphitiClient requires an API key")
        if not resolved_config.model:
            raise ValueError("ZaiGraphitiClient requires a model")

        resolved_config.base_url = base_url
        super().__init__(resolved_config, cache)
        self.client = client or AsyncOpenAI(
            api_key=resolved_config.api_key,
            base_url=base_url,
        )

    def _get_provider_type(self) -> str:
        return "zai"

    def _model_for_size(self, model_size: ModelSize) -> str:
        if model_size == ModelSize.small and self.small_model:
            return self.small_model
        if not self.model:
            raise ValueError("ZaiGraphitiClient requires a model")
        return self.model

    async def _request(
        self,
        messages: list[ChatCompletionMessageParam],
        max_tokens: int,
        model_size: ModelSize,
    ) -> str:
        request: dict[str, Any] = {
            "model": self._model_for_size(model_size),
            "messages": messages,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
            "extra_body": {"thinking": {"type": "disabled"}},
        }
        if self.temperature is not None:
            request["temperature"] = self.temperature

        try:
            response = await self.client.chat.completions.create(**request)
        except openai.RateLimitError as error:
            raise RateLimitError from error
        return response.choices[0].message.content or ""

    async def _generate_response(
        self,
        messages: list[Message],
        response_model: type[BaseModel] | None = None,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        model_size: ModelSize = ModelSize.medium,
    ) -> dict[str, Any]:
        openai_messages: list[ChatCompletionMessageParam] = [
            {"role": message.role, "content": message.content}
            for message in messages
            if message.role in {"system", "user"}
        ]
        content = await self._request(openai_messages, max_tokens, model_size)

        try:
            return _validate_object(content, response_model)
        except _InvalidStructuredOutput as first_error:
            logger.warning(
                "Z.AI returned %s; requesting one structured-output repair",
                first_error.reason,
            )

        repaired_content = await self._request(
            _repair_messages(content, response_model),
            max_tokens,
            model_size,
        )
        try:
            return _validate_object(repaired_content, response_model)
        except _InvalidStructuredOutput as second_error:
            model_name = response_model.__name__ if response_model is not None else "JSON object"
            raise ZaiStructuredOutputError(
                f"Z.AI returned invalid {model_name} output after one repair "
                f"({second_error.reason})"
            ) from second_error
