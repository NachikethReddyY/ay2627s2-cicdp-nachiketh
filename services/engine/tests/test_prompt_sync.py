from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "packages" / "ui-catalog"
DST = Path(__file__).resolve().parents[1] / "learnquest_engine" / "prompts"


@pytest.mark.parametrize("name", ["visual.schema.json", "visual.catalog.md"])
def test_engine_copy_matches_ui_catalog(name: str) -> None:
    assert (DST / name).read_bytes() == (SRC / name).read_bytes(), (
        f"{name} drifted from packages/ui-catalog. Run: cd services/engine && "
        "uv run python scripts/sync_visual_prompts.py"
    )
