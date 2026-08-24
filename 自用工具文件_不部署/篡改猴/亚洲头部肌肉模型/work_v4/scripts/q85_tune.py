# -*- coding: utf-8
"""Q85: tune Q84-a6 for occ>=0.917 while holding profile/hw."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import q84_aggressive as Q84  # noqa: E402
import common as C  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.STAGES / "Q85_tune"
PY = __import__("shutil").which("python") or sys.executable


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("t1", 1.5, True, 0.12, 0.34, 0.48, 0.12, 0.60, 0.82, 0.07, 0.05, 12),
        ("t2", 1.5, True, 0.12, 0.34, 0.48, 0.12, 0.60, 0.82, 0.08, 0.06, 12),
        ("t3", 1.5, True, 0.12, 0.34, 0.48, 0.12, 0.60, 0.82, 0.09, 0.06, 12),
        ("t4", 1.5, True, 0.12, 0.34, 0.48, 0.12, 0.60, 0.82, 0.10, 0.07, 12),
        ("t5", 1.5, True, 0.10, 0.32, 0.46, 0.11, 0.62, 0.84, 0.08, 0.06, 14),
        ("t6", 1.5, True, 0.10, 0.30, 0.44, 0.10, 0.64, 0.84, 0.09, 0.06, 14),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = Q84.run_preset(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q85_PASS.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q85_PASS.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q85_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.save_blend(C.CHECKPOINTS / "Q85_best.blend")
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q85_best.blend", "pass": False, "report": ev, "tag": tag})
        m = ev.get("metrics", {})
        print(f"[Q85] best={tag} sc={best_sc:.3f} occ={m.get('occiput_ratio',{}).get('test')} pr={m.get('profile_rmse')}")


if __name__ == "__main__":
    main()
