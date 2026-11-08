from pathlib import Path

from learnquest_engine import guide


def test_persona_prompt_is_reloaded_for_each_request(
    tmp_path: Path, monkeypatch
) -> None:
    prompt = tmp_path / "editor_guide.md"
    prompt.write_text("first persona", encoding="utf-8")
    monkeypatch.setattr(guide, "PROMPT", prompt)

    assert guide._system() == "first persona"
    prompt.write_text("updated persona", encoding="utf-8")
    assert guide._system() == "updated persona"
