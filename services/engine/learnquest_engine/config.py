from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    LLM_MODEL: str = Field(min_length=1)
    LLM_API_BASE: str | None = None
    LLM_API_KEY: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("TOKENROUTER_API_KEY", "LLM_API_KEY"),
    )
    LLM_JSON_MODE: Literal["schema", "object", "off"] | None = None
    LLM_PRICE_OVERRIDE_MODEL: str | None = None
    LLM_INPUT_USD_PER_MTOK: float | None = Field(default=None, ge=0, lt=1e12)
    LLM_OUTPUT_USD_PER_MTOK: float | None = Field(default=None, ge=0, lt=1e12)
    LLM_TIMEOUT_S: int = 120
    LLM_DEADLINE_S: int = 300
    LLM_MAX_TOKENS: int = 8000
    ENGINE_TOKEN: SecretStr = Field(min_length=32)

    @field_validator("LLM_INPUT_USD_PER_MTOK", "LLM_OUTPUT_USD_PER_MTOK", mode="before")
    @classmethod
    def blank_price_is_unset(cls, value: object) -> object:
        return None if value == "" else value


@lru_cache
def get_settings() -> Settings:
    return Settings()
