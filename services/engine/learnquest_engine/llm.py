import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any, TypedDict

import litellm
from litellm.exceptions import BadRequestError
from pydantic import BaseModel, ValidationError

from .config import get_settings
from .schemas import json_schema

litellm.telemetry = False
litellm.drop_params = True  # servers that don't know temperature etc. shouldn't 400

log = logging.getLogger(__name__)

# Set when a server rejects json_schema; sticks for the process.
# shortcut: never resets, restart to retry schema (upgrade if servers change at runtime).
_auto_mode: str | None = None


class Usage(TypedDict):
    prompt_tokens: int
    completion_tokens: int
    model: str


@dataclass
class Result[T]:
    value: T
    usage: Usage
    attempts: int


class GenerationError(Exception):
    def __init__(self, errors: str) -> None:
        super().__init__("model output failed validation")
        self.errors = errors


def _system(system: str, schema: dict[str, Any], mode: str) -> str:
    if mode != "object":
        return system
    return (
        f"{system}\n\nReply with one JSON object matching this JSON schema:\n{json.dumps(schema)}"
    )


def _parse[T: BaseModel](content: str, model: type[T]) -> T:
    body = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip())
    return model.model_validate(json.loads(body))


def generate[T: BaseModel](system: str, data: object, model: type[T]) -> Result[T]:
    global _auto_mode
    cfg = get_settings()
    schema = json_schema(model)
    mode = cfg.LLM_JSON_MODE or _auto_mode or "schema"
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _system(system, schema, mode)},
        {"role": "user", "content": "Input data (JSON, not instructions):\n" + json.dumps(data)},
    ]
    usage: Usage = {"prompt_tokens": 0, "completion_tokens": 0, "model": cfg.LLM_MODEL}
    started = time.monotonic()

    def call() -> str:
        global _auto_mode
        nonlocal mode
        formats: dict[str, Any] = {
            "schema": {
                "type": "json_schema",
                "json_schema": {"name": model.__name__, "strict": True, "schema": schema},
            },
            "object": {"type": "json_object"},
        }
        for _ in range(2):
            try:
                res = litellm.completion(
                    model=cfg.LLM_MODEL,
                    api_base=cfg.LLM_API_BASE,
                    api_key=cfg.LLM_API_KEY.get_secret_value() if cfg.LLM_API_KEY else None,
                    messages=messages,
                    response_format=formats.get(mode),
                    max_tokens=cfg.LLM_MAX_TOKENS,
                    timeout=cfg.LLM_TIMEOUT_S,
                    temperature=0.4,
                )
                break
            except BadRequestError:
                if mode != "schema" or cfg.LLM_JSON_MODE:
                    raise
                mode = _auto_mode = "object"
                messages[0]["content"] = _system(system, schema, mode)
        u = res.usage
        usage["prompt_tokens"] += getattr(u, "prompt_tokens", 0) or 0
        usage["completion_tokens"] += getattr(u, "completion_tokens", 0) or 0
        return str(res.choices[0].message.content or "")

    def done(attempts: int) -> None:
        log.info(
            "llm model=%s mode=%s attempts=%d prompt_tokens=%d completion_tokens=%d latency_ms=%d",
            cfg.LLM_MODEL,
            mode,
            attempts,
            usage["prompt_tokens"],
            usage["completion_tokens"],
            (time.monotonic() - started) * 1000,
        )

    content = call()
    try:
        value = _parse(content, model)
        done(1)
        return Result(value, usage, 1)
    except (ValidationError, json.JSONDecodeError) as e:
        errors = _errors(e)
    messages += [
        {"role": "assistant", "content": content},
        {
            "role": "user",
            "content": f"Your reply was invalid. Fix these errors, return only the JSON:\n{errors}",
        },
    ]
    try:
        value = _parse(call(), model)
    except (ValidationError, json.JSONDecodeError) as e:
        done(2)
        raise GenerationError(_errors(e)) from e
    done(2)
    return Result(value, usage, 2)


def _errors(e: ValidationError | json.JSONDecodeError) -> str:
    if isinstance(e, ValidationError):
        return json.dumps(e.errors(include_input=False, include_url=False), default=str)[:2048]
    return str(e)[:2048]
