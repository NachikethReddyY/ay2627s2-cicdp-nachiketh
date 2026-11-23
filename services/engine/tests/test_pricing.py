import json
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock

import httpx
import litellm
import pytest
from fastapi.testclient import TestClient

from learnquest_engine import posthog_client, pricing
from learnquest_engine.config import get_settings
from learnquest_engine.pricing import Catalog, Route, TextUsage, completion_route, text_cost
from learnquest_engine.server import app


def usage(p: int = 1000, c: int = 100, **kwargs: Any) -> SimpleNamespace:
    return SimpleNamespace(prompt_tokens=p, completion_tokens=c, **kwargs)


def tokenrouter_fixture() -> dict[str, Any]:
    return {
        "success": True,
        "group_ratio": {"default": 1},
        "data": [
            {
                "model_name": model, "quota_type": 0, "tags": "Text",
                "supported_endpoint_types": ["openai", "openai-response"],
                "enable_groups": ["default"],
                "model_ratio": 0.5, "completion_ratio": 2,
            }
            for model in ["openai/gpt-6-luna", "publisher/second"]
        ],
        "tiered_pricing": {
            "openai/gpt-6-luna": {
                key: [
                    {"minTokens": 0, "maxTokens": 272000, "pricePerUnit": low},
                    {"minTokens": 272000, "maxTokens": None, "pricePerUnit": high},
                ]
                for key, low, high in [
                    ("input", 0.10, 0.20), ("output", 0.50, 0.75),
                    ("cache_read", 0.01, 0.02), ("cache_write", 0.125, 0.25),
                ]
            },
        },
    }


def models_dev_model(cost: dict[str, Any], output: str = "text") -> dict[str, Any]:
    return {"modalities": {"input": ["text"], "output": [output]}, "cost": cost}


@pytest.fixture
def catalogs(monkeypatch: pytest.MonkeyPatch) -> Mock:
    monkeypatch.setattr(pricing, "Thread", lambda target, daemon: SimpleNamespace(start=target))
    for name, url in [
        ("_tokenrouter", pricing.TOKENROUTER_CATALOG),
        ("_openrouter", pricing.OPENROUTER_CATALOG),
        ("_models_dev", pricing.MODELS_DEV_URL),
    ]:
        monkeypatch.setattr(pricing, name, Catalog(url))

    data: dict[str, Any] = {
        pricing.TOKENROUTER_CATALOG: tokenrouter_fixture(),
        pricing.OPENROUTER_CATALOG: {"data": [{
            "id": "publisher/second",
            "architecture": {"output_modalities": ["text"]},
            "pricing": {"prompt": "0.000002", "completion": "0.000005", "request": "0.01"},
        }]},
        pricing.MODELS_DEV_URL: {
            "openai": {"models": {
                "gpt-6-luna": models_dev_model({
                    "input": 0.10, "output": 0.50,
                    "tiers": [{"input": 0.20, "tier": {"type": "context", "size": 272000}}],
                }),
                "publisher/missing": models_dev_model({"input": 1, "output": 2}),
                "image": models_dev_model({"input": 0, "output": 0}, output="image"),
            }},
            "tokenrouter": {"models": {
                "publisher/free": models_dev_model({"input": 0, "output": 0}),
            }},
        },
    }
    get = Mock(side_effect=lambda url, **_: httpx.Response(
        200, json=data[url], request=httpx.Request("GET", url),
    ))
    monkeypatch.setattr(pricing.httpx, "get", get)
    return get


def test_model_switch_and_missing_price_use_same_provider_catalog(
    monkeypatch: pytest.MonkeyPatch, catalogs: Mock,
) -> None:
    monkeypatch.setenv("LLM_API_BASE", f"{pricing.TOKENROUTER}/")
    monkeypatch.setenv("LLM_INPUT_USD_PER_MTOK", "5")
    monkeypatch.setenv("LLM_OUTPUT_USD_PER_MTOK", "10")
    monkeypatch.setenv("LLM_PRICE_OVERRIDE_MODEL", "openai/publisher/previous-model")
    for model, expected in [
        ("openai/gpt-6-luna", 0.00015),
        ("publisher/second", 0.0012),
        ("publisher/missing", None),
        ("publisher/free", 0.0),
    ]:
        monkeypatch.setenv("LLM_MODEL", f"openai/{model}")
        get_settings.cache_clear()
        cfg = get_settings()
        route = completion_route(cfg)
        assert route == Route(pricing.TOKENROUTER, model)
        assert text_cost(cfg, route, usage()) == expected
    assert [call.args[0] for call in catalogs.call_args_list] == [
        pricing.TOKENROUTER_CATALOG, pricing.MODELS_DEV_URL,
    ]


def test_tokenrouter_tier_and_cache_rates(catalogs: Mock) -> None:
    details = SimpleNamespace(cached_tokens=150_000, cache_write_tokens=100_000)
    result = text_cost(
        get_settings(), Route(pricing.TOKENROUTER, "openai/gpt-6-luna"),
        usage(272_000, 8_000, prompt_tokens_details=details),
    )
    assert result == 0.0384
    catalogs.assert_called_once()


@pytest.mark.parametrize(("adapter", "base", "model", "expected"), [
    ("openai", pricing.OPENROUTER, "publisher/second", 0.0125),
    ("openrouter", pricing.OPENROUTER, "publisher/second", 0.0125),
    ("openai", pricing.OPENAI, "gpt-6-luna", 0.00015),
    ("openai", pricing.OPENAI, "image", None),
    ("openai", pricing.TOKENROUTER, "gpt-6-luna", None),
    ("openai", "https://api.tokenrouter.com.example/v1", "openai/gpt-6-luna", None),
    ("openai", "https://api.tokenrouter.com/proxy/v1", "openai/gpt-6-luna", None),
])
def test_exact_endpoint_model_and_modality(
    monkeypatch: pytest.MonkeyPatch, catalogs: Mock,
    adapter: str, base: str, model: str, expected: float | None,
) -> None:
    monkeypatch.setenv("LLM_MODEL", f"{adapter}/{model}")
    monkeypatch.setenv("LLM_API_BASE", base)
    cfg = get_settings()
    route = completion_route(cfg)
    assert route == Route(base, model)
    assert text_cost(cfg, route, usage()) == expected


def test_unset_endpoint_uses_litellm_openai_endpoint_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LLM_API_BASE")
    monkeypatch.setenv("OPENAI_BASE_URL", pricing.TOKENROUTER)
    assert completion_route(get_settings()) == Route(pricing.TOKENROUTER, "test")


def test_provider_cost_even_zero_precedes_override_and_catalog(
    monkeypatch: pytest.MonkeyPatch, catalogs: Mock,
) -> None:
    monkeypatch.setenv("LLM_PRICE_OVERRIDE_MODEL", "openai/test")
    monkeypatch.setenv("LLM_INPUT_USD_PER_MTOK", "2")
    monkeypatch.setenv("LLM_OUTPUT_USD_PER_MTOK", "4")
    cfg = get_settings()
    route = Route(pricing.OPENROUTER, "publisher/second")
    for reported in (0, 0.002):
        response = litellm.ModelResponse(usage={
            "prompt_tokens": 1000, "completion_tokens": 100, "cost": reported,
        })
        assert text_cost(cfg, route, response.usage) == reported
    for invalid in (-1, "invalid", True, float("inf"), float("nan")):
        assert text_cost(cfg, route, usage(cost=invalid)) == 0.0024
    assert text_cost(cfg, Route("custom", "test"), usage(cost=9)) == 0.0024
    catalogs.assert_not_called()


def test_incomplete_or_unscoped_override_uses_catalog(
    monkeypatch: pytest.MonkeyPatch, catalogs: Mock,
) -> None:
    monkeypatch.setenv("LLM_INPUT_USD_PER_MTOK", "2")
    route = Route(pricing.OPENROUTER, "publisher/second")
    assert text_cost(get_settings(), route, usage()) == 0.0125
    monkeypatch.setenv("LLM_PRICE_OVERRIDE_MODEL", "openai/test")
    get_settings.cache_clear()
    assert text_cost(get_settings(), route, usage()) == 0.0125


def test_cache_keeps_last_good_on_bad_json_and_http_outage_until_expiry(
    monkeypatch: pytest.MonkeyPatch, catalogs: Mock,
) -> None:
    clock = [0.0]
    monkeypatch.setattr(pricing.time, "monotonic", lambda: clock[0])
    route = Route(pricing.TOKENROUTER, "openai/gpt-6-luna")
    cfg = get_settings()
    assert text_cost(cfg, route, usage()) == 0.00015
    clock[0] = pricing.REFRESH_S
    original = catalogs.side_effect

    def fail(url: str, **kwargs: Any) -> httpx.Response:
        if url == pricing.MODELS_DEV_URL:
            return original(url, **kwargs)
        if clock[0] == pricing.REFRESH_S:
            return httpx.Response(200, content=b"invalid json", request=httpx.Request("GET", url))
        raise httpx.ConnectError("unavailable")

    catalogs.side_effect = fail
    assert text_cost(cfg, route, usage()) == 0.00015
    clock[0] += pricing.RETRY_S - 1
    assert text_cost(cfg, route, usage()) == 0.00015
    assert catalogs.call_count == 2
    clock[0] = pricing.MAX_AGE_S + 1
    assert text_cost(cfg, route, usage()) is None
    assert catalogs.call_count == 4


@pytest.mark.parametrize("raw", [None, usage(-1), usage(True), usage(10, 1,
    prompt_tokens_details=SimpleNamespace(cached_tokens=20)), usage(10, 1,
    completion_tokens_details=SimpleNamespace(reasoning_tokens=2))])
def test_invalid_counters_cannot_be_priced(raw: Any) -> None:
    assert TextUsage.from_response(raw) is None


def test_unsupported_cache_charge_is_unpriced() -> None:
    measured = TextUsage(10, 20, 1, 0, 0)
    assert measured.estimate(0, 0) is None

def test_model_only_switch_prices_successful_generations_and_keeps_unlisted_models_usable(
    monkeypatch: pytest.MonkeyPatch, catalogs: Mock,
    fake_llm: Callable[[str], list[dict[str, Any]]],
) -> None:
    monkeypatch.setenv("LLM_API_BASE", pricing.TOKENROUTER)
    monkeypatch.setenv("LLM_INPUT_USD_PER_MTOK", "5")
    monkeypatch.setenv("LLM_OUTPUT_USD_PER_MTOK", "10")
    telemetry = Mock()
    monkeypatch.setattr(posthog_client, "posthog_client", telemetry)
    client = TestClient(app)
    expected = [(3.5e-6, "priced"), (2e-5, "priced"), (None, "unpriced")]
    for model, (cost, status) in zip(
        ("openai/gpt-6-luna", "publisher/second", "publisher/unlisted"), expected, strict=True,
    ):
        monkeypatch.setenv("LLM_MODEL", f"openai/{model}")
        get_settings.cache_clear()
        calls = fake_llm("outline_rust")
        r = client.post("/v1/pipeline/outline", json={"topic": "rust"}, headers={
            "X-Engine-Token": "x" * 32,
        })
        assert r.status_code == 200
        assert calls[0]["model"] == f"openai/{model}"
        assert json.loads(r.headers["x-engine-usage"])[0]["estimated_usd"] == cost
        props = telemetry.capture.call_args.kwargs["properties"]
        assert props["pricing_status"] == status
        assert props.get("$ai_total_cost_usd") == cost
        assert ("$ai_total_cost_usd" in props) is (cost is not None)
    assert telemetry.capture.call_count == 3
    assert catalogs.call_count == 2


def test_cold_catalog_outage_still_returns_generation(
    monkeypatch: pytest.MonkeyPatch, catalogs: Mock,
    fake_llm: Callable[[str], list[dict[str, Any]]],
) -> None:
    monkeypatch.setenv("LLM_API_BASE", pricing.TOKENROUTER)
    monkeypatch.setenv("LLM_MODEL", "openai/openai/gpt-6-luna")
    catalogs.side_effect = httpx.ConnectError("unavailable")
    fake_llm("outline_rust")
    r = TestClient(app).post("/v1/pipeline/outline", json={"topic": "rust"}, headers={
        "X-Engine-Token": "x" * 32,
    })
    assert r.status_code == 200
    assert json.loads(r.headers["x-engine-usage"])[0]["estimated_usd"] is None
    assert catalogs.call_count == 2


def test_refresh_does_not_block_and_single_flights_requests(
    monkeypatch: pytest.MonkeyPatch, catalogs: Mock,
) -> None:
    refreshes: list[Callable[[], None]] = []
    monkeypatch.setattr(
        pricing, "Thread", lambda target, daemon: SimpleNamespace(
            start=lambda: refreshes.append(target),
        ),
    )
    cfg = get_settings()
    route = Route(pricing.TOKENROUTER, "openai/gpt-6-luna")
    for _ in range(3):
        assert text_cost(cfg, route, usage()) is None
    assert len(refreshes) == 2
    catalogs.assert_not_called()
    refreshes[0]()
    assert text_cost(cfg, route, usage()) == 0.00015
