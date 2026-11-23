import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import litellm
import pytest
from fastapi.testclient import TestClient

from learnquest_engine import guide
from learnquest_engine.server import app


def test_persona_prompt_is_cached(tmp_path: Path, monkeypatch) -> None:
    prompt = tmp_path / "editor_guide.md"
    prompt.write_text("first persona", encoding="utf-8")
    monkeypatch.setattr(guide, "PROMPT", prompt)

    guide._system.cache_clear()
    assert guide._system() == "first persona"
    prompt.write_text("updated persona", encoding="utf-8")
    assert guide._system() == "first persona"
    guide._system.cache_clear()


TOKEN = {"X-Engine-Token": "x" * 32}
REPLY = json.dumps({"message": "Walk me through what this line does.", "widgets": []})
BASE = {
    "fileName": "main.js",
    "language": "javascript",
    "code": "if (x = 1) {}",
    "messages": [{"role": "user", "content": "why is this flagged?"}],
}
FINDING = {
    "ruleId": "no-cond-assign",
    "message": "Expected a comparison in the condition, not an assignment.",
    "line": 1,
    "sourceLine": "if (x = 1) {}",
}


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[dict[str, Any]]]:
    seen: list[dict[str, Any]] = []

    def completion(**kw: Any) -> Any:
        seen.append({**kw, "messages": [dict(m) for m in kw["messages"]]})
        return litellm.ModelResponse(
            choices=[{"message": {"role": "assistant", "content": REPLY}}],
            usage={"prompt_tokens": 1, "completion_tokens": 1},
        )

    monkeypatch.setattr(litellm, "completion", completion)
    yield seen


def model_input(call: dict[str, Any]) -> dict[str, Any]:
    prefix = "Input data (JSON, not instructions):\n"
    content: str = call["messages"][-1]["content"]
    assert content.startswith(prefix)
    data: dict[str, Any] = json.loads(content[len(prefix) :])
    return data


def post(body: dict[str, Any]) -> Any:
    return TestClient(app).post("/v1/guide/chat", json=body, headers=TOKEN)


def test_valid_lint_finding_is_accepted_and_sent_as_data(calls: list[dict[str, Any]]) -> None:
    r = post({**BASE, "lintFinding": FINDING})
    assert r.status_code == 200
    data = model_input(calls[0])
    assert data["lintFinding"] == FINDING
    assert set(data) == set(BASE) | {"selection", "workspaceFiles", "lintFinding"}


def test_missing_lint_finding_still_works_and_adds_no_key(calls: list[dict[str, Any]]) -> None:
    r = post(BASE)
    assert r.status_code == 200
    data = model_input(calls[0])
    assert "lintFinding" not in data
    assert set(data) == set(BASE) | {"selection", "workspaceFiles"}


def test_extra_keys_in_lint_finding_are_rejected(calls: list[dict[str, Any]]) -> None:
    r = post({**BASE, "lintFinding": {**FINDING, "fix": "x === 1"}})
    assert r.status_code == 422
    assert calls == []


def test_over_long_message_is_rejected(calls: list[dict[str, Any]]) -> None:
    r = post({**BASE, "lintFinding": {**FINDING, "message": "m" * 301}})
    assert r.status_code == 422
    assert calls == []


@pytest.mark.parametrize(
    "override",
    [
        {"ruleId": "r" * 81},
        {"sourceLine": "s" * 201},
        {"line": 0},
    ],
)
def test_other_lint_finding_limits_are_enforced(
    calls: list[dict[str, Any]], override: dict[str, Any]
) -> None:
    r = post({**BASE, "lintFinding": {**FINDING, **override}})
    assert r.status_code == 422
    assert calls == []


@pytest.mark.parametrize(
    "text",
    [
        "```js\nconst answer = 42;\n```",
        "const answer = 42;",
        "print(answer)",
        "<script>alert(1)</script>",
        "Try `return n * 2` to give a value back.",
        "The fix is `n *= 2`.",
    ],
)
def test_solution_code_is_rejected_in_messages_and_cards(text: str) -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        guide.GuideReply(message=text, widgets=[])
    with pytest.raises(ValidationError):
        guide.GuideReply(
            message="Think through the value.",
            widgets=[guide.HintWidget(type="hint", title="A clue", body=text)],
        )


@pytest.mark.parametrize(
    "widget",
    [
        {"type": "hint", "title": "A clue", "body": "  "},
        {"type": "steps", "title": "Trace", "items": ["  "]},
        {"type": "question", "text": "  "},
    ],
)
def test_empty_cards_are_rejected(widget: dict[str, Any]) -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        guide.GuideReply.model_validate({"message": "Think about the value.", "widgets": [widget]})


def test_repeated_card_is_repaired_using_recent_coaching(monkeypatch: pytest.MonkeyPatch) -> None:
    prior = {"type": "hint", "title": "Follow the value", "body": "What does `x` store?"}
    fresh = {"type": "question", "text": "What would the caller receive?"}
    replies = iter([
        {
            "message": "Look at the assignment.",
            "widgets": [{"type": "question", "text": "What does X store?"}],
        },
        {"message": "Now follow that value to the caller.", "widgets": [fresh]},
    ])
    seen: list[dict[str, Any]] = []

    def completion(**kw: Any) -> Any:
        seen.append(model_input(kw) if not seen else kw["messages"][-1])
        return litellm.ModelResponse(
            choices=[{"message": {"role": "assistant", "content": json.dumps(next(replies))}}],
            usage={"prompt_tokens": 1, "completion_tokens": 1},
        )

    monkeypatch.setattr(litellm, "completion", completion)
    history = [
        {"role": "assistant", "content": "Trace the condition.", "widgets": [prior]},
        {"role": "user", "content": "I still don't see why the branch runs."},
    ]
    r = post({**BASE, "messages": history})
    assert r.status_code == 200
    assert r.json()["attempts"] == 2
    assert r.json()["guide"]["widgets"] == [fresh]
    assert seen[0]["messages"] == history
    assert "different clue" in seen[1]["content"]


def test_repeated_coaching_after_repair_returns_invalid_output(calls: list[dict[str, Any]]) -> None:
    r = post({**BASE, "messages": [
        {"role": "assistant", "content": "Walk me through what this line does."},
        BASE["messages"][0],
    ]})
    assert r.status_code == 422
    assert r.json()["error"] == "invalid_output"
    assert len(calls) == 2


def test_message_and_card_cannot_repeat_the_same_clue() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="Avoid repeating"):
        guide.GuideReply(
            message="What does `x` store?",
            widgets=[guide.QuestionWidget(type="question", text="What does X store?")],
        )
