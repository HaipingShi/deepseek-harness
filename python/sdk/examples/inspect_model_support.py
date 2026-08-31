"""Dependency-free conversion helpers for the Inspect model example."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol


class TextMessage(Protocol):
    """The Inspect message fields consumed by the example adapter."""

    role: str
    text: str


def serialize_messages(messages: Iterable[TextMessage]) -> str:
    """Serialize Inspect text history into one model-visible DSH prompt."""
    sections: list[str] = []
    for message in messages:
        role = message.role.strip().upper()
        if not role:
            raise ValueError("Inspect message role must be non-empty")
        sections.append(f"{role}:\n{message.text}")
    if not sections:
        raise ValueError("Inspect supplied no messages")
    return "\n\n".join(sections)


def inspect_stop_reason(finish_reason: str | None) -> str:
    """Map a DSH turn end reason to Inspect's stable stop vocabulary."""
    if finish_reason == "completed":
        return "stop"
    if finish_reason == "max-tokens":
        return "max_tokens"
    return "unknown"
