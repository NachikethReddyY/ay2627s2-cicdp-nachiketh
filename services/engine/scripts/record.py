"""Record real LiteLLM replies as a test fixture. Run by hand with your .env; never in CI.

  uv run python scripts/record.py --kind outline --input in.json --out tests/fixtures/outline_x.json
  uv run python scripts/record.py --kind lesson  --input ctx.json --out tests/fixtures/lesson_x.json

--input is {"topic": "..."} for outline, a LessonContext object for lesson.
Every completion attempt is saved (repairs included) in the order it was made.
"""

import argparse
import json
import re
from pathlib import Path
from typing import Any

import litellm

from learnquest_engine import pipeline
from learnquest_engine.schemas import LessonContext

# Keys and bearer tokens must never reach a fixture file.
SECRET = re.compile(r"(sk-[A-Za-z0-9_-]+|Bearer\s+\S+)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=["outline", "lesson"], required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    raw: list[dict[str, Any]] = []
    real = litellm.completion

    def spy(**kw: Any) -> Any:
        res = real(**kw)
        raw.append(res.model_dump())
        return res

    litellm.completion = spy
    data = json.loads(args.input.read_text())
    if args.kind == "outline":
        pipeline.outline(data["topic"])
    else:
        pipeline.lesson(LessonContext.model_validate(data))

    text = SECRET.sub("[redacted]", json.dumps({"responses": raw}, indent=2))
    args.out.write_text(text + "\n")
    print(f"recorded {len(raw)} completion(s) to {args.out}")


if __name__ == "__main__":
    main()
