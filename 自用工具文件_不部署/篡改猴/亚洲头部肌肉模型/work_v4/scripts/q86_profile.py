# -*- coding: utf-8
"""Q86: profile-first push from Q84-a2 lineage."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import q84_aggressive as Q84  # noqa: E402
import common as C  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.STAGES / "Q86_profile"


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("p1", 1.5, True, 0.08, 0.28, 0.42, 0.11, 0.62, 0.84, 0.0, 0.0, 14),
        ("p2", 1.5, True, 0.10, 0.30, 0.44, 0.11, 0.62, 0.84, 0.0, 0.0, 16),
        ("p3", 1.5, True, 0.12, 0.32, 0.46, 0.12, 0.60, 0.82, 0.0, 0.0, 16),
        ("p4", 1.5, True, 0.10, 0.32, 0.46, 0.12, 0.60, 0.82, 0.04, 0.02, 14),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = Q84.run_preset(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q86_PASS.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q86_PASS.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q86_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.save_blend(C.CHECKPOINTS / "Q86_best.blend")
        m = ev.get("metrics", {})
        print(f"[Q86] best={tag} sc={best_sc:.3f} pr={m.get('profile_rmse')} occ={m.get('occiput_ratio',{}).get('test')}")


if __name__ == "__main__":
    main()
