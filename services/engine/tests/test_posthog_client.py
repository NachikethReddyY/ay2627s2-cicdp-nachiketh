from unittest.mock import Mock

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
    monkeypatch.setenv("POSTHOG_HOST", "https://us.i.posthog.com")
    litellm.success_callback = []
    assert posthog_client.create_posthog_client() is None
    assert "posthog" not in litellm.success_callback


def test_test_suite_does_not_initialize_posthog() -> None:
    assert posthog_client.posthog_client is None


def test_configured_client_uses_engine_events_and_redacts_litellm_logging(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("POSTHOG_API_KEY", "phc_test")
    monkeypatch.setenv("POSTHOG_HOST", "https://us.i.posthog.com")
    client = posthog_client.create_posthog_client()
    assert client is not None
    client.shutdown()
    assert litellm.turn_off_message_logging is True
    assert "posthog" not in litellm.success_callback
    assert "posthog" not in litellm.failure_callback


def test_project_token_name_is_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("POSTHOG_API_KEY", raising=False)
    monkeypatch.setenv("POSTHOG_PROJECT_TOKEN", "phc_test")
    monkeypatch.setenv("POSTHOG_HOST", "https://us.i.posthog.com")
    client = posthog_client.create_posthog_client()
    assert client is not None
    client.shutdown()

@pytest.mark.parametrize(("cost", "status"), [(0, "priced"), (None, "unpriced")])
def test_ai_event_reports_pricing_status_and_omits_missing_cost(
    monkeypatch: pytest.MonkeyPatch, cost: float | None, status: str
) -> None:
    client = Mock()
    monkeypatch.setattr(posthog_client, "posthog_client", client)
    posthog_client.capture_ai_call(
        model="publisher/model", provider="router", modality="text", trace_id="trace",
        started=0, cost=cost, failed=cost is None,
    )
    client.capture.assert_called_once()
    args, kwargs = client.capture.call_args
    assert args == ("$ai_generation",)
    assert kwargs["distinct_id"] == "learnslop-engine"
    props = kwargs["properties"]
    assert props["pricing_status"] == status
    assert props["$ai_model"] == "publisher/model"
    assert props["$ai_is_error"] is (cost is None)
    assert ("$ai_total_cost_usd" in props) is (cost is not None)
    assert props.get("$ai_total_cost_usd") == cost
    assert "$ai_input" not in props and "$ai_output_choices" not in props


def test_telemetry_failure_does_not_fail_the_call(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Mock()
    client.capture.side_effect = RuntimeError("unavailable")
    monkeypatch.setattr(posthog_client, "posthog_client", client)
    posthog_client.capture_ai_call(
        model="model", provider="router", modality="text", trace_id="trace", started=0,
    )
