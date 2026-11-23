import atexit
import logging
import os

import litellm
from posthog import Posthog
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger(__name__)


class PostHogSettings(BaseSettings):
    """PostHog keys, kept apart so importing this module never needs the LLM settings."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    POSTHOG_API_KEY: str | None = None
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

    os.environ.setdefault("POSTHOG_API_KEY", settings.POSTHOG_API_KEY)
    os.environ.setdefault("POSTHOG_API_URL", settings.POSTHOG_HOST)
    litellm.turn_off_message_logging = True
    litellm.success_callback = ["posthog"]
    litellm.failure_callback = ["posthog"]

    client = Posthog(
        settings.POSTHOG_API_KEY,
        host=settings.POSTHOG_HOST,
        enable_exception_autocapture=True,
    )
    atexit.register(client.shutdown)
    return client


posthog_client = create_posthog_client()
