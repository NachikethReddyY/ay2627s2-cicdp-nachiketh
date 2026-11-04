"""The committed visual.schema.json (generated in packages/ui-catalog) works in Python jsonschema.

The schema covers shape only. check(), budgets, duplicate ids, the byte cap and sanitising run in
parseSpec, so only the expectations a schema can express are asserted here.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

CATALOG = Path(__file__).resolve().parents[3] / "packages" / "ui-catalog"
SCHEMA: dict[str, Any] = json.loads((CATALOG / "visual.schema.json").read_text())
VALIDATOR = Draft202012Validator(SCHEMA)
FIXTURES = sorted((CATALOG / "fixtures").rglob("*.json"))
# Fixtures whose envelope is wrong: rejected whatever blocks are registered.
ENVELOPE_BAD = {"v2.json", "empty-blocks.json", "too-many-blocks.json", "extra-envelope-key.json"}


def registered_types() -> set[str]:
    items = SCHEMA["properties"]["blocks"]["items"]
    return {o["properties"]["type"]["const"] for o in items.get("oneOf", [])}


def block_types(spec: Any) -> set[Any]:
    blocks = spec.get("blocks") if isinstance(spec, dict) else None
    return {b.get("type") if isinstance(b, dict) else None for b in blocks or []}


def test_schema_is_valid_draft_2020_12() -> None:
    Draft202012Validator.check_schema(SCHEMA)
    assert SCHEMA["additionalProperties"] is False


def test_fixtures_exist() -> None:
    assert FIXTURES
    assert ENVELOPE_BAD <= {f.name for f in FIXTURES}


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: str(p.relative_to(CATALOG / "fixtures")))
def test_fixture(path: Path) -> None:
    spec = json.loads(path.read_text())
    ok = VALIDATOR.is_valid(spec)
    unknown = block_types(spec) - registered_types()
    if path.name in ENVELOPE_BAD or unknown:
        assert not ok, f"{path.name} should be rejected (unknown: {sorted(map(str, unknown))})"
    elif path.name.startswith("valid"):
        assert ok, [e.message for e in VALIDATOR.iter_errors(spec)]
