# -*- coding: utf-8
"""Q87: Q84-a6 profile pipeline + light occ tune (target 5/5 PASS)."""
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

OUT = C.STAGES / "Q87_merge"


def deliver(tag, ev, muscles):
    Q8.force_recolor()
    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.BLEND_FINAL)
    C.save_blend(C.CHECKPOINTS / "Q87_PASS.blend")
    C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q87_PASS.blend", "pass": True, "report": ev, "tag": tag})
    C.write_json(OUT / "self_eval_report.json", ev)
    print(f"[Q87] *** ALL PASS tag={tag} ***")


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    # flat, q20, q20_st, oy, ox, fy, h0, h1, face, occ_b, passes
    grid = [
        ("m1", 1.5, True, 0.12, 0.34, 0.48, 0.12, 0.60, 0.82, 0.04, 0.02, 14),
        ("m2", 1.5, True, 0.12, 0.34, 0.48, 0.12, 0.60, 0.82, 0.05, 0.03, 14),
        ("m3", 1.5, True, 0.12, 0.34, 0.48, 0.12, 0.60, 0.82, 0.06, 0.03, 14),
        ("m4", 1.5, True, 0.10, 0.32, 0.46, 0.11, 0.62, 0.84, 0.05, 0.03, 16),
        ("m5", 1.5, True, 0.10, 0.30, 0.44, 0.11, 0.64, 0.84, 0.05, 0.03, 16),
        ("m6", 1.5, True, 0.12, 0.36, 0.50, 0.12, 0.58, 0.80, 0.04, 0.02, 16),
        ("m7", 1.5, True, 0.14, 0.38, 0.52, 0.13, 0.58, 0.80, 0.04, 0.02, 18),
        ("m8", 1.5, True, 0.12, 0.34, 0.48, 0.12, 0.60, 0.82, 0.03, 0.02, 16),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = Q84.run_preset(tag, *row[1:])
        if ev.get("pass"):
            deliver(tag, ev, muscles)
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q87_{tag}_best.blend")
    if best:
        tag, ev, muscles = best
        C.save_blend(C.CHECKPOINTS / "Q87_best.blend")
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q87_best.blend", "pass": False, "report": ev, "tag": tag})
        m = ev.get("metrics", {})
        n_pass = sum(1 for k in ("hw_ratio", "vault_ratio", "occiput_ratio", "area_ratio") if m.get(k, {}).get("pass"))
        pr_pass = float(m.get("profile_rmse", 1)) <= 0.055
        print(f"[Q87] best={tag} sc={best_sc:.3f} gates={n_pass}/4+pr={pr_pass} pr={m.get('profile_rmse')} occ={m.get('occiput_ratio',{}).get('test')}")


if __name__ == "__main__":
    main()
