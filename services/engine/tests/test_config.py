import pytest
from pydantic import ValidationError

from learnquest_engine.config import Settings

TOKEN = "x" * 32


def test_loads_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_MODEL", "openai/m")
    monkeypatch.setenv("ENGINE_TOKEN", TOKEN)
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.LLM_MODEL == "openai/m"
    assert s.LLM_TIMEOUT_S == 120
    assert s.LLM_API_KEY is None


def test_missing_model_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.setenv("ENGINE_TOKEN", TOKEN)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_short_token_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_MODEL", "openai/m")
    monkeypatch.setenv("ENGINE_TOKEN", "short")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_key_is_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_MODEL", "openai/m")
    monkeypatch.setenv("ENGINE_TOKEN", TOKEN)
    monkeypatch.setenv("LLM_API_KEY", "sk-supersecret")
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert "sk-supersecret" not in repr(s)
