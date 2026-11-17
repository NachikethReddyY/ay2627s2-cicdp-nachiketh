from __future__ import annotations

import io
import re
import sys
import tokenize
from dataclasses import dataclass
from pathlib import Path

MESSAGE = (
    "Comments are banned. Name the thing so it needs no explanation, extract a function, "
    "or add a test that states the rule. Directives are allowed only in their coded form."
)

ALLOWED = re.compile(
    r"^#\s*("
    r"noqa:\s*[A-Z]+[0-9]+(\s*,\s*[A-Z]+[0-9]+)*"
    r"|type:\s*ignore\[[^\]]+\]"
    r"|pragma:\s*no (cover|branch)"
    r"|fmt:\s*(on|off|skip)"
    r"|ruff:\s*(noqa|disable|enable)\b.*"
    r"|mypy:\s*\S.*"
    r"|-\*-.*-\*-"
    r")(\s|$)"
)

SKIP_DIRS = {".venv", "node_modules", "__pycache__", ".mypy_cache", ".pytest_cache", "dist"}
ROOTS = ("learnquest_engine", "tests", "scripts")


@dataclass(frozen=True)
class Violation:
    file: str
    line: int
    text: str


def is_allowed(comment: str, line_number: int) -> bool:
    if line_number == 1 and comment.startswith("#!"):
        return True
    return ALLOWED.match(comment) is not None


def banned_comments(source: str) -> list[tokenize.TokenInfo]:
    tokens = tokenize.generate_tokens(io.StringIO(source).readline)
    comments = (t for t in tokens if t.type == tokenize.COMMENT)
    return [t for t in comments if not is_allowed(t.string, t.start[0])]


def find_violations(file: str, source: str) -> list[Violation]:
    return [Violation(file, t.start[0], t.string[:60]) for t in banned_comments(source)]


def strip_comments(source: str) -> str:
    lines = source.splitlines(keepends=True)
    drop: set[int] = set()
    for token in reversed(banned_comments(source)):
        row, col = token.start
        line = lines[row - 1]
        if line[:col].strip() == "":
            drop.add(row - 1)
        else:
            ending = "\n" if line.endswith("\n") else ""
            lines[row - 1] = line[:col].rstrip() + ending
    kept = [line for index, line in enumerate(lines) if index not in drop]
    return re.sub(r"\n{4,}", "\n\n\n", "".join(kept))


def python_files(root: Path) -> list[Path]:
    found: list[Path] = []
    for top in ROOTS:
        base = root / top
        if base.is_dir():
            found.extend(p for p in sorted(base.rglob("*.py")) if not SKIP_DIRS & set(p.parts))
    return found


def check_repo(root: Path) -> list[Violation]:
    out: list[Violation] = []
    for path in python_files(root):
        out.extend(find_violations(str(path.relative_to(root)), path.read_text()))
    return out


def main(argv: list[str]) -> int:
    root = Path(__file__).resolve().parent.parent
    if "--fix" in argv:
        changed = 0
        for path in python_files(root):
            before = path.read_text()
            after = strip_comments(before)
            if after != before:
                path.write_text(after)
                changed += 1
        print(f"stripped comments in {changed} files")
        return 0
    violations = check_repo(root)
    for v in violations:
        print(f"{v.file}:{v.line}  {MESSAGE}  ({v.text})", file=sys.stderr)
    if violations:
        return 1
    print("no banned comments")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
