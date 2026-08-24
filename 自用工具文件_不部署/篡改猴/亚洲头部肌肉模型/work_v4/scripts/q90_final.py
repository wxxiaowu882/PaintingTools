# -*- coding: utf-8
"""Q90: Q84-a6 profile base + minimal occ bump (target 5/5)."""
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

OUT = C.STAGES / "Q90_final"
BASE = C.CHECKPOINTS / "Q57_p1_best.blend"
PY = __import__("shutil").which("python") or sys.executable


def deliver(tag, ev, muscles):
    Q8.force_recolor()
    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.BLEND_FINAL)
    C.save_blend(C.CHECKPOINTS / "Q90_PASS.blend")
    C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q90_PASS.blend", "pass": True, "report": ev, "tag": tag})
    C.write_json(OUT / "self_eval_report.json", ev)


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    # a6 params with lighter occ than Q85-t5
    grid = [
        ("f1", 1.5, True, 0.12, 0.34, 0.48, 0.12, 0.60, 0.82, 0.04, 0.02, 12),
        ("f2", 1.5, True, 0.12, 0.34, 0.48, 0.12, 0.60, 0.82, 0.05, 0.03, 12),
        ("f3", 1.5, True, 0.10, 0.32, 0.46, 0.11, 0.62, 0.84, 0.05, 0.03, 14),
        ("f4", 1.5, True, 0.10, 0.30, 0.44, 0.11, 0.64, 0.84, 0.06, 0.03, 14),
        ("f5", 1.5, True, 0.12, 0.36, 0.50, 0.12, 0.58, 0.80, 0.05, 0.03, 14),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = Q84.run_preset(tag, *row[1:])
        C.write_json(OUT / f"{tag}_report.json", ev)
        if ev.get("pass"):
            deliver(tag, ev, muscles)
            print(f"[Q90] *** PASS {tag} ***")
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q90_{tag}_best.blend")
    if best:
        tag, ev, muscles = best
        C.save_blend(C.CHECKPOINTS / "Q90_best.blend")
        m = ev.get("metrics", {})
        gates = sum(1 for k in ("hw_ratio", "vault_ratio", "occiput_ratio", "area_ratio") if m.get(k, {}).get("pass"))
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {
            "checkpoint": "Q90_best.blend",
            "pass": False,
            "report": ev,
            "tag": tag,
            "gates": f"{gates}/4",
        })
        print(f"[Q90] best={tag} sc={best_sc:.3f} pr={m.get('profile_rmse')} occ={m.get('occiput_ratio',{}).get('test')}")


if __name__ == "__main__":
    main()
