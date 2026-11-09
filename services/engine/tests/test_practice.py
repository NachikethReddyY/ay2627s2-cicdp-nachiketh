import json
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from learnquest_engine import pipeline
from learnquest_engine.llm import GenerationError
from learnquest_engine.schemas import LessonContext, PracticePart, json_schema
from learnquest_engine.server import app
from tests.test_pipeline import CTX

FakeLLM = Callable[[str], list[dict[str, Any]]]
TOKEN = {"X-Engine-Token": "x" * 32}


def case(
    id_: str, visibility: str = "hidden", stretch: bool = False, **over: Any
) -> dict[str, Any]:
    base = {
        "id": id_,
        "name": "Checks one case",
        "stdin": "1\n2\n",
        "expectedStdout": "3\n",
        "visibility": visibility,
        "stretch": stretch,
    }
    base.update(over)
    return base


def part(tests: list[dict[str, Any]], language: str = "javascript") -> dict[str, Any]:
    return {
        "kind": "practice",
        "instructions": "Read two numbers and print their sum.",
        "language": language,
        "starterCode": "// read stdin\n",
        "tests": tests,
    }


def required(n: int = 3) -> list[dict[str, Any]]:
    tests = [case("basic", visibility="sample")]
    tests += [case(f"case-{i}") for i in range(1, n)]
    return tests


def stretch(n: int) -> list[dict[str, Any]]:
    return [case(f"edge-{i}", stretch=True) for i in range(n)]


def build(raw: dict[str, Any], wanted: int = 0) -> PracticePart:
    return PracticePart.model_validate(raw, context={"stretchTests": wanted})


def bad(raw: dict[str, Any], match: str, wanted: int = 0) -> None:
    with pytest.raises(ValidationError, match=match):
        build(raw, wanted)


@pytest.mark.parametrize("language", ["python", "javascript", "typescript"])
def test_each_language_is_accepted(language: str) -> None:
    assert build(part(required(), language)).language == language


def test_unknown_language_is_rejected() -> None:
    bad(part(required(), "rust"), "language")


def test_legacy_expected_output_is_rejected_with_a_clear_error() -> None:
    raw = {
        "kind": "practice",
        "instructions": "Print 3.",
        "language": "javascript",
        "starterCode": "",
        "expectedOutput": "3\n",
    }
    bad(raw, "expectedOutput is no longer supported")


def test_required_tests_need_three_to_five() -> None:
    bad(part(required(2)), "3 to 5 required")
    bad(part(required(3) + [case(f"extra-{i}") for i in range(3)]), "3 to 5 required")


def test_exactly_one_required_sample() -> None:
    no_sample = [case(f"case-{i}") for i in range(3)]
    two_samples = [case("a", visibility="sample"), case("b", visibility="sample"), case("c")]
    bad(part(no_sample), "exactly one required test must be sample, got 0")
    bad(part(two_samples), "exactly one required test must be sample, got 2")


def test_stretch_count_must_match_the_request() -> None:
    tests = required() + stretch(1)
    bad(part(tests), "exactly 0 stretch tests, got 1", wanted=0)
    bad(part(required() + stretch(1)), "exactly 0 stretch tests", wanted=0)
    bad(part(required() + stretch(1)), "exactly 2 stretch tests, got 1", wanted=2)
    assert len(build(part(required() + stretch(2)), wanted=2).tests) == 5


def test_no_stretch_tests_when_none_requested() -> None:
    assert len(build(part(required()), wanted=0).tests) == 3


def test_stretch_tests_must_be_hidden() -> None:
    tests = required() + [case("edge", visibility="sample", stretch=True)]
    bad(part(tests), "stretch tests must have visibility hidden", wanted=1)


def test_test_ids_are_unique() -> None:
    tests = required()
    tests[1]["id"] = tests[0]["id"]
    bad(part(tests), "unique")


@pytest.mark.parametrize("bad_id", ["Basic", "_x", "has space", "a" * 33, ""])
def test_test_id_pattern(bad_id: str) -> None:
    tests = required()
    tests[1]["id"] = bad_id
    with pytest.raises(ValidationError):
        build(part(tests))


def test_stdin_defaults_to_empty_and_is_capped() -> None:
    tests = required()
    del tests[0]["stdin"]
    assert build(part(tests)).tests[0].stdin == ""
    tests[0]["stdin"] = "x" * 1001
    with pytest.raises(ValidationError):
        build(part(tests))


def test_expected_stdout_is_capped_and_keeps_whitespace() -> None:
    tests = required()
    tests[0]["expectedStdout"] = "3\n\n"
    assert build(part(tests)).tests[0].expectedStdout == "3\n\n"
    tests[0]["expectedStdout"] = "x" * 1001
    with pytest.raises(ValidationError):
        build(part(tests))


def test_name_is_one_to_eighty_characters() -> None:
    tests = required()
    tests[0]["name"] = "x" * 81
    with pytest.raises(ValidationError):
        build(part(tests))
    tests[0]["name"] = "   "
    with pytest.raises(ValidationError):
        build(part(tests))


def test_total_tests_capped_at_25() -> None:
    raw = part(required() + [case(f"x-{i}") for i in range(23)])
    with pytest.raises(ValidationError):
        build(raw)


def test_practice_schema_is_strict() -> None:
    schema = json_schema(PracticePart)
    test_item = schema["$defs"]["PracticeTest"]
    assert test_item["additionalProperties"] is False
    assert "expectedOutput" not in json.dumps(schema)
    assert "tests" in schema["properties"]


def test_lesson_context_bounds_stretch_tests() -> None:
    assert LessonContext.model_validate(CTX.model_dump()).stretchTests == 0
    assert LessonContext.model_validate({**CTX.model_dump(), "stretchTests": 10}).stretchTests == 10
    with pytest.raises(ValidationError):
        LessonContext.model_validate({**CTX.model_dump(), "stretchTests": 11})
    with pytest.raises(ValidationError):
        LessonContext.model_validate({**CTX.model_dump(), "stretchTests": -1})


def practice_ctx(stretch_tests: int = 0) -> LessonContext:
    lesson = CTX.lesson.model_copy(update={"kind": "practice"})
    return CTX.model_copy(update={"lesson": lesson, "stretchTests": stretch_tests})


def test_typescript_part_from_the_model_is_kept(fake_llm: FakeLLM) -> None:
    fake_llm("part_practice_ts")
    res = pipeline.lesson(practice_ctx())
    assert isinstance(res.value, PracticePart)
    assert res.value.language == "typescript"


def test_stretch_count_is_in_the_system_prompt_and_the_input(fake_llm: FakeLLM) -> None:
    calls = fake_llm("part_practice_stretch")
    res = pipeline.lesson(practice_ctx(2))
    assert isinstance(res.value, PracticePart)
    assert sum(t.stretch for t in res.value.tests) == 2
    system = calls[0]["messages"][0]["content"]
    assert "write exactly 2 stretch tests" in system
    assert json.loads(calls[0]["messages"][1]["content"].split("\n", 1)[1])["stretchTests"] == 2


def test_zero_stretch_request_says_no_stretch_tests(fake_llm: FakeLLM) -> None:
    calls = fake_llm("part_practice_1")
    pipeline.lesson(practice_ctx(0))
    system = calls[0]["messages"][0]["content"]
    assert "write no stretch tests" in system
    assert "exactly" not in system.split("This request:")[1]


def test_wrong_stretch_count_is_repaired_once(fake_llm: FakeLLM) -> None:
    calls = fake_llm("part_practice_stretch_repair")
    res = pipeline.lesson(practice_ctx(2))
    assert res.attempts == 2
    assert len(calls) == 2
    assert "needs exactly 2 stretch tests, got 1" in calls[1]["messages"][-1]["content"]
    assert isinstance(res.value, PracticePart)
    assert sum(t.stretch for t in res.value.tests) == 2


def test_legacy_output_only_fails_with_the_clear_error(fake_llm: FakeLLM) -> None:
    fake_llm("part_practice_legacy")
    with pytest.raises(GenerationError) as exc:
        pipeline.lesson(practice_ctx())
    assert "expectedOutput is no longer supported" in exc.value.errors


def test_route_passes_stretch_tests_and_rejects_legacy(
    fake_llm: FakeLLM,
) -> None:
    client = TestClient(app)
    body = {**CTX.model_dump(), "lesson": {**CTX.lesson.model_dump(), "kind": "practice"}}
    fake_llm("part_practice_stretch")
    ok = client.post("/v1/pipeline/lesson", json={**body, "stretchTests": 2}, headers=TOKEN)
    assert ok.status_code == 200
    assert len(ok.json()["lesson"]["tests"]) == 5

    fake_llm("part_practice_legacy")
    legacy = client.post("/v1/pipeline/lesson", json={**body, "stretchTests": 0}, headers=TOKEN)
    assert legacy.status_code == 422
    assert "expectedOutput is no longer supported" in json.dumps(legacy.json())


def test_route_rejects_out_of_range_stretch() -> None:
    client = TestClient(app)
    body = {**CTX.model_dump(), "stretchTests": 11}
    r = client.post("/v1/pipeline/lesson", json=body, headers=TOKEN)
    assert r.status_code == 422
