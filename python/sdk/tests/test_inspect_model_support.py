from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from pathlib import Path


SUPPORT = Path(__file__).parents[1] / "examples" / "inspect_model_support.py"
SPEC = importlib.util.spec_from_file_location("inspect_model_support", SUPPORT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


@dataclass
class Message:
    role: str
    text: str


def test_serialize_messages_preserves_order_roles_and_text() -> None:
    prompt = MODULE.serialize_messages([
        Message("system", "Keep receipts."),
        Message("user", "Run the case."),
    ])

    assert prompt == "SYSTEM:\nKeep receipts.\n\nUSER:\nRun the case."


def test_serialize_messages_rejects_empty_input() -> None:
    try:
        MODULE.serialize_messages([])
    except ValueError as error:
        assert str(error) == "Inspect supplied no messages"
    else:
        raise AssertionError("empty history must fail")


def test_inspect_stop_reason_is_explicit() -> None:
    assert MODULE.inspect_stop_reason("completed") == "stop"
    assert MODULE.inspect_stop_reason("max-tokens") == "max_tokens"
    assert MODULE.inspect_stop_reason("error") == "unknown"
    assert MODULE.inspect_stop_reason(None) == "unknown"
