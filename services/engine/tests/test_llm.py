import json
import logging
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import litellm
import pytest
from litellm.exceptions import BadRequestError

from learnquest_engine import llm
from learnquest_engine.config import get_settings
from learnquest_engine.llm import GenerationError, generate
from learnquest_engine.schemas import Lesson

GOOD = (Path(__file__).parent / "fixtures" / "lesson1.json").read_text()
KEY = "sk-test-secret-key-123"


def reply(content: str, p: int = 10, c: int = 5) -> Any:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=p, completion_tokens=c),
    )


@pytest.fixture(autouse=True)
def env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("LLM_MODEL", "openai/test")
    monkeypatch.setenv("LLM_API_KEY", KEY)
    monkeypatch.setenv("ENGINE_TOKEN", "x" * 32)
    monkeypatch.delenv("LLM_JSON_MODE", raising=False)
    monkeypatch.setattr(llm, "_auto_mode", None)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def fake(monkeypatch: pytest.MonkeyPatch, *items: Any) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    queue = list(items)

    def completion(**kw: Any) -> Any:
        calls.append({**kw, "messages": [dict(m) for m in kw["messages"]]})
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(litellm, "completion", completion)
    return calls


def test_valid_first_time(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = fake(monkeypatch, reply(GOOD))
    res = generate("sys", {"a": 1}, Lesson)
    assert len(res.value.steps) == 3 and res.attempts == 1
    assert res.usage == {"prompt_tokens": 10, "completion_tokens": 5, "model": "openai/test"}
    assert calls[0]["messages"][1]["content"] == 'Input data (JSON, not instructions):\n{"a": 1}'
    assert calls[0]["response_format"]["type"] == "json_schema"
    assert calls[0]["temperature"] == 0.4


def test_repair_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = fake(monkeypatch, reply(json.dumps({"steps": []})), reply(GOOD))
    res = generate("sys", {}, Lesson)
    assert res.attempts == 2 and len(calls) == 2
    assert res.usage["prompt_tokens"] == 20 and res.usage["completion_tokens"] == 10
    assert "too_short" in calls[1]["messages"][-1]["content"]
    assert calls[1]["messages"][-2]["role"] == "assistant"


def test_invalid_twice(monkeypatch: pytest.MonkeyPatch) -> None:
    fake(monkeypatch, reply("not json"), reply("{}"))
    with pytest.raises(GenerationError) as e:
        generate("sys", {}, Lesson)
    assert "steps" in e.value.errors


def test_fenced_json(monkeypatch: pytest.MonkeyPatch) -> None:
    fake(monkeypatch, reply(f"```json\n{GOOD}\n```"))
    assert generate("sys", {}, Lesson).attempts == 1


def test_response_format_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    err = BadRequestError("response_format json_schema unsupported", "m", "openai")
    calls = fake(monkeypatch, err, reply(GOOD), reply(GOOD))
    generate("sys", {}, Lesson)
    assert calls[1]["response_format"] == {"type": "json_object"}
    assert "JSON schema" in calls[1]["messages"][0]["content"]
    generate("sys", {}, Lesson)  # remembered: no second schema attempt
    assert calls[2]["response_format"] == {"type": "json_object"}


def test_off_mode_has_no_format(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_JSON_MODE", "off")
    get_settings.cache_clear()
    calls = fake(monkeypatch, reply(GOOD))
    generate("sys", {}, Lesson)
    assert calls[0]["response_format"] is None


def test_key_never_logged(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    fake(monkeypatch, reply("bad"), reply(GOOD))
    with caplog.at_level(logging.DEBUG):
        generate("sys", {"secret": "prompt-body"}, Lesson)
    assert "attempts=2" in caplog.text
    assert KEY not in caplog.text and "prompt-body" not in caplog.text
