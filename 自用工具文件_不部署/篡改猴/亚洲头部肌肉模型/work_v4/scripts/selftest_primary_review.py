# -*- coding: utf-8 -*-
"""Gate before delivery: direction + exposure + align + compare page smoke."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
REVIEW = SCRIPTS.parent / "compare_review"
BA = SCRIPTS.parents[4] / ".cursor" / "browser-automation"
PY = sys.executable
CAND = sys.argv[1] if len(sys.argv) > 1 else "SHELL_v8"


def run(cmd: list[str], label: str, cwd: Path | None = None) -> int:
    print(f"\n=== {label} ===")
    p = subprocess.run(cmd, cwd=str(cwd or SCRIPTS))
    return p.returncode


def main() -> int:
    side_png = REVIEW / "ours" / CAND / "muscle_side.png"
    mandatory = [
        ([PY, str(SCRIPTS / "verify_view_direction.py"), CAND], "view direction"),
        ([PY, str(SCRIPTS / "verify_fg_integrity.py"), CAND], "fg integrity (no holes)"),
        ([PY, str(SCRIPTS / "verify_render_visual.py"), CAND], "visual vs Base15 (color/shading/white bg)"),
        ([PY, str(SCRIPTS / "verify_render_exposure.py"), CAND, "front"], "exposure front (legacy stats)"),
        ([PY, str(SCRIPTS / "selftest_compare_align.py"), CAND], "pixel align"),
    ]
    if BA.exists():
        mandatory.append(
            (["node", "scripts/compare-review-web-selftest.js", CAND], "compare page web screenshot", BA)
        )
        mandatory.append(
            (["node", "scripts/compare-review-align-smoke.js"], "compare page smoke", BA)
        )

    optional = []
    if side_png.exists():
        optional.append(
            ([PY, str(SCRIPTS / "base15_proportion_eval.py"), str(side_png)], "side proportion (strict)")
        )

    fails = []
    warns = []
    for item in mandatory:
        cmd, label = item[0], item[1]
        cwd = item[2] if len(item) > 2 else SCRIPTS
        if run(cmd, label, cwd) != 0:
            fails.append(label)

    for cmd, label in optional:
        if run(cmd, label) != 0:
            warns.append(label)

    if fails:
        print("\n[SELFTEST FAIL mandatory]", ", ".join(fails))
        return 1
    if warns:
        print("\n[SELFTEST WARN optional]", ", ".join(warns))
    print("\n[SELFTEST PASS] mandatory gates (incl. compare page smoke)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
