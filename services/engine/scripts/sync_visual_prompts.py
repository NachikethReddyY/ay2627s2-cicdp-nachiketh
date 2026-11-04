"""Copy the generated visual catalog and schema into the engine package.

The engine image only ships learnquest_engine/, so it cannot read packages/ui-catalog at runtime.
Re-run after `pnpm --filter @learnquest/ui-catalog gen`:
  uv run python scripts/sync_visual_prompts.py
"""

import shutil
from pathlib import Path

SRC = Path(__file__).resolve().parents[3] / "packages" / "ui-catalog"
DST = Path(__file__).resolve().parents[1] / "learnquest_engine" / "prompts"

for name in ("visual.catalog.md", "visual.schema.json"):
    shutil.copyfile(SRC / name, DST / name)
    print(f"copied {name}")
