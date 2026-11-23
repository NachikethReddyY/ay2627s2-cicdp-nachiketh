import json
import os
import socket
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

os.environ.setdefault("LITELLM_MODE", "PRODUCTION")

import litellm  # noqa: E402
import pytest  # noqa: E402

from learnquest_engine.config import get_settings

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def engine_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[None]:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LLM_MODEL", "openai/test")
    monkeypatch.setenv("LLM_API_BASE", "http://fake.invalid/v1")
    for name in ("LLM_PRICE_OVERRIDE_MODEL", "LLM_INPUT_USD_PER_MTOK", "LLM_OUTPUT_USD_PER_MTOK"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ENGINE_TOKEN", "x" * 32)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("TOKENROUTER_API_KEY", raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*_: Any, **__: Any) -> None:
        raise RuntimeError("network access is blocked in tests")

    monkeypatch.setattr(socket.socket, "connect", refuse)


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch) -> Callable[[str], list[dict[str, Any]]]:
    """Replay tests/fixtures/<name>.json as litellm.completion replies, in order.

    Returns the list of kwargs each call received, so tests can inspect the messages sent.
    """

    def use(name: str) -> list[dict[str, Any]]:
        queue = list(json.loads((FIXTURES / f"{name}.json").read_text())["responses"])
        calls: list[dict[str, Any]] = []

        def completion(**kw: Any) -> Any:
            calls.append({**kw, "messages": [dict(m) for m in kw["messages"]]})
            if not queue:
                raise AssertionError(f"{name}: no recorded reply left for call {len(calls)}")
            return litellm.ModelResponse(**queue.pop(0))

        monkeypatch.setattr(litellm, "completion", completion)
        return calls

    return use
