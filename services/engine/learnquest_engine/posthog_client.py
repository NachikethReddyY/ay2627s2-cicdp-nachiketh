import atexit
import logging
import os
import time
import uuid

import litellm
from posthog import Posthog
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger(__name__)
_session_id = str(uuid.uuid4())


class PostHogSettings(BaseSettings):
    """PostHog keys, kept apart so importing this module never needs the LLM settings."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    POSTHOG_API_KEY: str | None = Field(
        default=None,
        validation_alias=AliasChoices("POSTHOG_API_KEY", "POSTHOG_PROJECT_TOKEN"),
    )
    POSTHOG_HOST: str | None = None


def create_posthog_client() -> Posthog | None:
    """Create the PostHog client when configured.

    LLM call events go to PostHog with prompts and completions redacted.
    """
    settings = PostHogSettings()
    missing_variable = "POSTHOG_API_KEY" if not settings.POSTHOG_API_KEY else "POSTHOG_HOST"
    if not settings.POSTHOG_API_KEY or not settings.POSTHOG_HOST:
        if os.environ.get("ENVIRONMENT") != "production":
            log.warning(
                "%s variable required by PostHog is missing or un-configured, this causes "
                "events to be silently missed. This error stops appearing once %s is configured",
                missing_variable,
                missing_variable,
            )
        return None

    litellm.turn_off_message_logging = True

    client = Posthog(
        settings.POSTHOG_API_KEY,
        host=settings.POSTHOG_HOST,
        enable_exception_autocapture=True,
    )
    atexit.register(client.shutdown)
    return client


posthog_client = create_posthog_client()


def capture_ai_call(
    *,
    model: str,
    provider: str,
    modality: str,
    trace_id: str,
    started: float,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    cost: float | None = None,
    failed: bool = False,
) -> None:
    if posthog_client is None:
        return
    try:
        posthog_client.capture(
            "$ai_generation",
            distinct_id="learnslop-engine",
            properties={
                "$ai_model": model,
                "$ai_provider": provider,
                "$ai_session_id": _session_id,
                "$ai_trace_id": trace_id,
                "$ai_span_id": str(uuid.uuid4()),
                "$ai_input_tokens": prompt_tokens,
                "$ai_output_tokens": completion_tokens,
                **({"$ai_total_cost_usd": cost} if cost is not None else {}),
                "pricing_status": "priced" if cost is not None else "unpriced",
                "$ai_latency": time.monotonic() - started,
                "$ai_is_error": failed,
                "modality": modality,
            },
        )
    except Exception:
        log.warning("Could not capture AI call telemetry")
