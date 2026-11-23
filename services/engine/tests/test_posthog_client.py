import litellm
import pytest

from learnquest_engine import posthog_client


@pytest.fixture(autouse=True)
def restore_litellm() -> object:
    success, failure = litellm.success_callback, litellm.failure_callback
    redact = litellm.turn_off_message_logging
    yield None
    litellm.success_callback, litellm.failure_callback = success, failure
    litellm.turn_off_message_logging = redact


def test_missing_key_creates_no_client_and_no_callbacks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("POSTHOG_API_KEY", raising=False)
    litellm.success_callback = []
    assert posthog_client.create_posthog_client() is None
    assert "posthog" not in litellm.success_callback


def test_configured_client_redacts_prompts_and_registers_callbacks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("POSTHOG_API_KEY", "phc_test")
    monkeypatch.setenv("POSTHOG_HOST", "https://us.i.posthog.com")
    client = posthog_client.create_posthog_client()
    assert client is not None
    client.shutdown()
    assert litellm.turn_off_message_logging is True
    assert litellm.success_callback == ["posthog"]
    assert litellm.failure_callback == ["posthog"]
