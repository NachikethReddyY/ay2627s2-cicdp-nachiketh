import json
import socket
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import litellm
import pytest

from learnquest_engine.config import get_settings

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def engine_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    # Settings must load in every test; no real key is ever needed or read.
    monkeypatch.setenv("LLM_MODEL", "openai/test")
    monkeypatch.setenv("ENGINE_TOKEN", "x" * 32)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    # A missed mock must fail loudly, not reach a paid API from CI.
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
            calls.append(kw)
            if not queue:
                raise AssertionError(f"{name}: no recorded reply left for call {len(calls)}")
            return litellm.ModelResponse(**queue.pop(0))

        monkeypatch.setattr(litellm, "completion", completion)
        return calls

    return use
