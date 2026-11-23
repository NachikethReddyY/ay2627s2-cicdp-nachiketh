from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    LLM_MODEL: str = Field(min_length=1)
    LLM_API_BASE: str | None = None
    LLM_API_KEY: SecretStr | None = None
    LLM_JSON_MODE: Literal["schema", "object", "off"] | None = None
    LLM_TIMEOUT_S: int = 120
    LLM_DEADLINE_S: int = 300
    LLM_MAX_TOKENS: int = 8000
    ENGINE_TOKEN: SecretStr = Field(min_length=32)
    POSTHOG_API_KEY: str | None = None
    POSTHOG_HOST: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
