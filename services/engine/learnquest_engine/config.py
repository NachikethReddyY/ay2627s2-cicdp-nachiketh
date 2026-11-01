from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # LiteLLM model string, e.g. "openai/<name>" for any OpenAI-compatible endpoint.
    LLM_MODEL: str = Field(min_length=1)
    LLM_API_BASE: str | None = None
    LLM_API_KEY: SecretStr | None = None
    LLM_JSON_MODE: Literal["schema", "object", "off"] | None = None
    LLM_TIMEOUT_S: int = 120
    LLM_MAX_TOKENS: int = 8000
    ENGINE_TOKEN: SecretStr = Field(min_length=32)
    PORT: int = 8000


@lru_cache
def get_settings() -> Settings:
    # Fails at startup on a missing LLM_MODEL or a short ENGINE_TOKEN, not on the first request.
    return Settings()
