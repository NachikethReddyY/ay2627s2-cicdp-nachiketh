import logging
import math
import time
from dataclasses import dataclass
from threading import Lock, Thread
from typing import Any

import httpx
import litellm
from litellm.secret_managers.main import get_secret_str

from .config import Settings

OPENAI = "https://api.openai.com/v1"
OPENROUTER = "https://openrouter.ai/api/v1"
TOKENROUTER = "https://api.tokenrouter.com/v1"
MODELS_DEV_URL = "https://models.dev/api.json"
TOKENROUTER_CATALOG = "https://api.tokenrouter.com/api/pricing"
OPENROUTER_CATALOG = f"{OPENROUTER}/models"
MODELS_DEV_PROVIDERS = {
    OPENAI: "openai",
    TOKENROUTER: "tokenrouter",
    "https://integrate.api.nvidia.com/v1": "nvidia",
}
REFRESH_S = 6 * 3600
RETRY_S = 5 * 60
MAX_AGE_S = 48 * 3600
log = logging.getLogger(__name__)


def whole_tokens(value: object) -> int | None:
    return value if type(value) is int and 0 <= value <= 2_147_483_647 else None


def amount(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float | str):
        return None
    try:
        result = float(value)
    except (ValueError, OverflowError):
        return None
    return result if math.isfinite(result) and 0 <= result < 1e12 else None


def usd(value: object) -> float | None:
    result = amount(value)
    return round(result, 12) if result is not None else None


@dataclass(frozen=True)
class Route:
    base: str
    model: str

    @property
    def provider(self) -> str:
        return {
            **MODELS_DEV_PROVIDERS,
            OPENROUTER: "openrouter",
        }.get(self.base, "custom")


def completion_route(cfg: Settings) -> Route:
    model, adapter, _, base = litellm.get_llm_provider(cfg.LLM_MODEL, api_base=cfg.LLM_API_BASE)
    if adapter == "openai":
        base = (
            base or litellm.api_base or get_secret_str("OPENAI_BASE_URL")
            or get_secret_str("OPENAI_API_BASE") or OPENAI
        )
    elif adapter == "openrouter":
        base = base or litellm.api_base or get_secret_str("OPENROUTER_API_BASE") or OPENROUTER
    elif adapter != "nvidia_nim":
        base = None
    return Route(base.rstrip("/") if base else "", model)


def _catalog_rows(url: str, body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValueError("catalog must be an object")
    if url == MODELS_DEV_URL:
        result = {
            key: row["models"] for key, row in body.items()
            if isinstance(row, dict) and isinstance(row.get("models"), dict) and row["models"]
        }
    else:
        key = "model_name" if url == TOKENROUTER_CATALOG else "id"
        rows = body.get("data")
        if not isinstance(rows, list):
            raise ValueError("missing catalog models")
        result = {
            row[key]: row for row in rows
            if isinstance(row, dict) and isinstance(row.get(key), str)
        }
        if url == TOKENROUTER_CATALOG:
            tiers = body.get("tiered_pricing")
            groups = body.get("group_ratio")
            if (
                body.get("success") is not True
                or not isinstance(tiers, dict)
                or not isinstance(groups, dict)
                or amount(groups.get("default")) != 1
            ):
                raise ValueError("invalid TokenRouter catalog")
            result = {key: (row, tiers.get(key)) for key, row in result.items()}
    if not result:
        raise ValueError("empty catalog")
    return result


class Catalog:
    def __init__(self, url: str) -> None:
        self.url = url
        self.snapshot: tuple[float, dict[str, Any]] = (-math.inf, {})
        self.retry_at = -math.inf
        self.lock = Lock()

    def get(self, key: str) -> Any:
        self.refresh_if_due()
        fetched, rows = self.snapshot
        if time.monotonic() - fetched <= MAX_AGE_S:
            return rows.get(key)
        return None

    def refresh_if_due(self) -> None:
        if time.monotonic() < self.retry_at or not self.lock.acquire(blocking=False):
            return
        try:
            if time.monotonic() >= self.retry_at:
                self.retry_at = math.inf
                Thread(target=self.refresh, daemon=True).start()
        except RuntimeError:
            self.retry_at = time.monotonic() + RETRY_S
        finally:
            self.lock.release()

    def refresh(self) -> None:
        try:
            response = httpx.get(self.url, timeout=2.0, trust_env=False)
            response.raise_for_status()
            rows = _catalog_rows(self.url, response.json())
        except (httpx.HTTPError, ValueError):
            self.retry_at = time.monotonic() + RETRY_S
            log.warning("AI pricing catalog refresh failed: %s", self.url)
        else:
            fetched = time.monotonic()
            self.snapshot = (fetched, rows)
            self.retry_at = fetched + REFRESH_S


_models_dev = Catalog(MODELS_DEV_URL)
_tokenrouter = Catalog(TOKENROUTER_CATALOG)
_openrouter = Catalog(OPENROUTER_CATALOG)


@dataclass(frozen=True)
class TextUsage:
    prompt: int
    completion: int
    cached: int
    written: int
    reasoning: int

    @classmethod
    def from_response(cls, usage: Any) -> "TextUsage | None":
        prompt = whole_tokens(getattr(usage, "prompt_tokens", None))
        completion = whole_tokens(getattr(usage, "completion_tokens", None))
        if prompt is None or completion is None:
            return None
        details = getattr(usage, "prompt_tokens_details", None)
        cached = whole_tokens(getattr(details, "cached_tokens", 0) or 0)
        written = whole_tokens(getattr(details, "cache_write_tokens", 0) or 0)
        output = getattr(usage, "completion_tokens_details", None)
        reasoning = whole_tokens(getattr(output, "reasoning_tokens", 0) or 0)
        if cached is None or written is None or reasoning is None:
            return None
        if cached + written > prompt or reasoning > completion:
            return None
        return cls(prompt, completion, cached, written, reasoning)

    def estimate(
        self,
        input_rate: object,
        output_rate: object,
        cached_rate: object = None,
        write_rate: object = None,
        reasoning_rate: object = None,
        request_rate: object = 0,
    ) -> float | None:
        if amount(input_rate) is None or amount(output_rate) is None:
            return None
        separate_reasoning = self.reasoning if reasoning_rate is not None else 0
        total = 0.0
        for count, rate in (
            (self.prompt - self.cached - self.written, input_rate),
            (self.completion - separate_reasoning, output_rate),
            (self.cached, cached_rate),
            (self.written, write_rate),
            (separate_reasoning, reasoning_rate),
            (1, request_rate),
        ):
            if count:
                price = amount(rate)
                if price is None:
                    return None
                total += count * price
        return usd(total)


def _per_token(value: object) -> float | None:
    rate = amount(value)
    return rate / 1_000_000 if rate is not None else None


def _tier_rate(tiers: Any, prompt: int) -> object:
    if not isinstance(tiers, list):
        return None
    matches = [
        row.get("pricePerUnit") for row in tiers
        if isinstance(row, dict)
        and (lower := whole_tokens(row.get("minTokens"))) is not None
        and lower <= prompt
        and "maxTokens" in row
        and (row["maxTokens"] is None or (
            (upper := whole_tokens(row["maxTokens"])) is not None and prompt < upper
        ))
    ]
    return matches[0] if len(matches) == 1 else None


def _tokenrouter_text(entry: Any, usage: TextUsage) -> float | None:
    if entry is None:
        return None
    row, tiers = entry
    if (
        row.get("quota_type") != 0
        or row.get("tags") != "Text"
        or not isinstance(endpoints := row.get("supported_endpoint_types"), list)
        or "openai" not in endpoints
        or not isinstance(groups := row.get("enable_groups"), list)
        or "default" not in groups
    ):
        return None
    if tiers is not None:
        if not isinstance(tiers, dict):
            return None
        return usage.estimate(*[
            _per_token(_tier_rate(tiers.get(key), usage.prompt))
            for key in ("input", "output", "cache_read", "cache_write")
        ])
    model_ratio = amount(row.get("model_ratio"))
    if model_ratio is None:
        return None
    input_rate = 2 * model_ratio / 1_000_000
    ratios = [amount(row.get(key)) for key in (
        "completion_ratio", "cache_ratio", "create_cache_ratio",
    )]
    return usage.estimate(input_rate, *[
        input_rate * ratio if ratio is not None else None for ratio in ratios
    ])


def _openrouter_text(row: Any, usage: TextUsage) -> float | None:
    if not isinstance(row, dict):
        return None
    architecture = row.get("architecture")
    rates = row.get("pricing")
    if (
        not isinstance(architecture, dict)
        or architecture.get("output_modalities") != ["text"]
        or not isinstance(rates, dict)
        or rates.get("overrides")
        or rates.get("discount") not in (None, 0)
    ):
        return None
    return usage.estimate(
        rates.get("prompt"), rates.get("completion"),
        rates.get("input_cache_read"), rates.get("input_cache_write"),
        rates.get("internal_reasoning"), rates.get("request", 0),
    )


def _models_dev_text(route: Route, usage: TextUsage) -> float | None:
    provider = MODELS_DEV_PROVIDERS.get(route.base)
    if provider is None:
        return None
    model = (_models_dev.get(provider) or {}).get(route.model)
    if not isinstance(model, dict):
        return None
    modalities = model.get("modalities")
    rates = model.get("cost")
    if (
        not isinstance(modalities, dict)
        or modalities.get("output") != ["text"]
        or not isinstance(rates, dict)
    ):
        return None
    if "tiers" in rates:
        tiers = rates["tiers"]
        if not isinstance(tiers, list):
            return None
        active: dict[int, dict[str, Any]] = {}
        for tier in tiers:
            condition = tier.get("tier") if isinstance(tier, dict) else None
            if not isinstance(condition, dict) or condition.get("type") != "context":
                return None
            size = whole_tokens(condition.get("size"))
            if size is None or size in active:
                return None
            active[size] = tier
        for size, tier in sorted(active.items()):
            if usage.prompt >= size:
                rates = {**rates, **tier}
    elif "context_over_200k" in rates:
        return None
    return usage.estimate(*[_per_token(rates.get(key)) for key in (
        "input", "output", "cache_read", "cache_write", "reasoning",
    )])


def warm_text_prices(cfg: Settings, route: Route) -> None:
    if cfg.LLM_MODEL == cfg.LLM_PRICE_OVERRIDE_MODEL:
        return
    if route.base == TOKENROUTER:
        _tokenrouter.refresh_if_due()
    elif route.base in MODELS_DEV_PROVIDERS:
        _models_dev.refresh_if_due()


def text_cost(cfg: Settings, route: Route, response_usage: Any) -> float | None:
    if route.base == OPENROUTER:
        reported = usd(getattr(response_usage, "cost", None))
        if reported is not None:
            return reported
    usage = TextUsage.from_response(response_usage)
    if usage is None:
        return None
    if (
        cfg.LLM_MODEL == cfg.LLM_PRICE_OVERRIDE_MODEL
        and cfg.LLM_INPUT_USD_PER_MTOK is not None
        and cfg.LLM_OUTPUT_USD_PER_MTOK is not None
    ):
        return _override_cost(cfg, usage)
    if route.base == OPENROUTER:
        return _openrouter_text(_openrouter.get(route.model), usage)
    if route.base == TOKENROUTER:
        official = _tokenrouter_text(_tokenrouter.get(route.model), usage)
        if official is not None:
            return official
    return _models_dev_text(route, usage)


def _override_cost(cfg: Settings, usage: TextUsage) -> float | None:
    input_rate = _per_token(cfg.LLM_INPUT_USD_PER_MTOK)
    return usage.estimate(
        input_rate, _per_token(cfg.LLM_OUTPUT_USD_PER_MTOK), input_rate, input_rate,
    )


def moderation_cost(route: Route) -> float | None:
    if route.base == OPENAI and route.model in {
        "omni-moderation-latest", "omni-moderation-2024-09-26",
    }:
        return 0.0
    return None
