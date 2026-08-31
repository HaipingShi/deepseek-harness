"""Behavior tests for the Graphiti Z.AI structured-output adapter."""

from __future__ import annotations

import unittest
from types import SimpleNamespace

from graphiti_core.llm_client.config import LLMConfig
from graphiti_core.prompts.models import Message
from pydantic import BaseModel

from zai_graphiti_client import ZaiGraphitiClient, ZaiStructuredOutputError


class ExtractedEntity(BaseModel):
    """Minimal Graphiti entity used by the adapter tests."""

    name: str
    entity_type_id: int


class ExtractedEntities(BaseModel):
    """Minimal Graphiti response object used by the adapter tests."""

    extracted_entities: list[ExtractedEntity]


class FakeCompletions:
    """Return deterministic Chat Completions responses and retain request fields."""

    def __init__(self, outputs: list[str | None]):
        self.outputs = list(outputs)
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        content = self.outputs.pop(0)
        message = SimpleNamespace(content=content)
        choice = SimpleNamespace(message=message, finish_reason="stop")
        usage = SimpleNamespace(prompt_tokens=7, completion_tokens=5)
        return SimpleNamespace(choices=[choice], usage=usage)


class FakeOpenAIClient:
    """Expose the OpenAI SDK resource path used by the adapter."""

    def __init__(self, outputs: list[str | None]):
        self.completions = FakeCompletions(outputs)
        self.chat = SimpleNamespace(completions=self.completions)


def create_client(outputs: list[str | None], *, base_url: str = "https://api.z.ai/api/paas/v4"):
    """Create an adapter with a deterministic provider transport."""

    provider = FakeOpenAIClient(outputs)
    config = LLMConfig(
        api_key="test-key",
        base_url=base_url,
        model="glm-test",
        small_model="glm-test-small",
        temperature=None,
        max_tokens=512,
    )
    return ZaiGraphitiClient(config=config, client=provider), provider


class ZaiGraphitiClientTests(unittest.IsolatedAsyncioTestCase):
    """Verify strict object validation and the single-repair limit."""

    async def test_accepts_a_complete_json_fence_without_repair(self):
        client, provider = create_client(
            ['```json\n{"extracted_entities":[{"name":"Canary","entity_type_id":0}]}\n```']
        )

        result = await client.generate_response(
            [Message(role="system", content="system"), Message(role="user", content="extract")],
            response_model=ExtractedEntities,
        )

        self.assertEqual(result["extracted_entities"][0]["name"], "Canary")
        self.assertEqual(len(provider.completions.calls), 1)
        request = provider.completions.calls[0]
        self.assertEqual(request["response_format"], {"type": "json_object"})
        self.assertEqual(request["extra_body"], {"thinking": {"type": "disabled"}})
        self.assertNotIn("temperature", request)

    async def test_repairs_a_top_level_array_once(self):
        client, provider = create_client(
            [
                '[{"name":"Canary","entity_type_id":0}]',
                '{"extracted_entities":[{"name":"Canary","entity_type_id":0}]}',
            ]
        )

        result = await client.generate_response(
            [Message(role="system", content="system"), Message(role="user", content="extract")],
            response_model=ExtractedEntities,
        )

        self.assertEqual(result["extracted_entities"][0]["entity_type_id"], 0)
        self.assertEqual(len(provider.completions.calls), 2)
        repair_messages = provider.completions.calls[1]["messages"]
        self.assertIn("Return exactly one JSON object", repair_messages[0]["content"])

    async def test_rejects_a_second_invalid_response_without_leaking_content(self):
        client, provider = create_client(["SECRET_CANARY", "[]"])

        with self.assertRaises(ZaiStructuredOutputError) as raised:
            await client.generate_response(
                [
                    Message(role="system", content="system"),
                    Message(role="user", content="extract"),
                ],
                response_model=ExtractedEntities,
            )

        self.assertEqual(len(provider.completions.calls), 2)
        self.assertNotIn("SECRET_CANARY", str(raised.exception))
        self.assertIn("after one repair", str(raised.exception))

    def test_rejects_non_zai_base_urls(self):
        with self.assertRaisesRegex(ValueError, "approved Z.AI API endpoint"):
            create_client(["{}"], base_url="https://memory.example.com/v1")

    def test_reports_zai_as_the_provider_type(self):
        client, _provider = create_client(["{}"])

        self.assertEqual(client._get_provider_type(), "zai")


if __name__ == "__main__":
    unittest.main()
