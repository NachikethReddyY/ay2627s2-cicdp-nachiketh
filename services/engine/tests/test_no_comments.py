from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "check_comments.py"
SPEC = importlib.util.spec_from_file_location("check_comments", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
checker = importlib.util.module_from_spec(SPEC)
sys.modules["check_comments"] = checker
SPEC.loader.exec_module(checker)


def test_the_engine_has_no_banned_comments() -> None:
    assert checker.check_repo(ROOT) == []


def test_line_and_trailing_comments_are_banned() -> None:
    assert len(checker.find_violations("a.py", "# why\nx = 1  # note\n")) == 2


def test_hash_inside_strings_is_not_a_comment() -> None:
    assert checker.find_violations("a.py", 'x = "# not a comment"\ny = """\n# inside\n"""\n') == []


@pytest.mark.parametrize(
    "line",
    [
        "x = 1  # noqa: S101",
        "x = 1  # noqa: S101, S603",
        "x = f()  # type: ignore[no-any-return]",
        "def f() -> None:  # pragma: no cover\n    pass",
    ],
)
def test_coded_directives_are_allowed(line: str) -> None:
    assert checker.find_violations("a.py", line + "\n") == []


BANNED_LINES = ["x = 1  # noqa", "x = f()  # type: ignore", "x = 1  # TODO: later"]


@pytest.mark.parametrize("line", BANNED_LINES)
def test_bare_directives_and_todos_are_banned(line: str) -> None:
    assert len(checker.find_violations("a.py", line + "\n")) == 1


def test_stripping_removes_comments_and_keeps_code_and_directives() -> None:
    source = "# head\nx = 1  # tail\ny = 2  # noqa: E501\n\n\n\n\n\nz = 3\n"
    out = checker.strip_comments(source)
    assert out == "x = 1\ny = 2  # noqa: E501\n\n\nz = 3\n"
    assert checker.find_violations("a.py", out) == []
