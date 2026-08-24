# -*- coding: utf-8
"""Q93 probe: 4 one-shot polarity tests from Q84_a6_best."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import mesh_outer as MO  # noqa: E402
import q12_hw_match as Q12  # noqa: E402
import q75_mesh as Q75  # noqa: E402
import q84_aggressive as Q84  # noqa: E402

OUT = C.STAGES / "Q93_probe"
BASE = C.CHECKPOINTS / "Q84_a6_best.blend"
REF = C.ROOT / "Base15_侧.png"


def nudge_band(muscles, h0, h1, y_amount, front=True, back=False):
    """y_amount>0: expand from center; <0: shrink."""
    _, center, rx, ry, rz = MO._ref_bbox(muscles)
    for obj in muscles:
        mw = MO.mesh_weight(obj.name, 1.0, 0.3)
        if mw <= 0:
            continue
        me = obj.data
        inv = obj.matrix_world.inverted()
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            ly = max(-1.0, min(1.0, (w.y - center.y) / ry))
            lz = max(-1.0, min(1.0, (w.z - center.z) / rz))
            h = (lz + 1.0) * 0.5
            band = Q75.smooth_step((h - h0) / 0.04) * Q75.smooth_step((h1 - h) / 0.04)
            if band < 0.02:
                continue
            f = Q75.smooth_step((-ly) / 0.35) if ly < 0.05 else 0.0
            b = Q75.smooth_step((ly) / 0.35) if ly > -0.05 else 0.0
            wgt = 0.0
            if front:
                wgt += f
            if back:
                wgt += b
            k = y_amount * band * wgt * mw
            if abs(k) < 0.002:
                continue
            w2 = w.copy()
            w2.y = center.y + (w.y - center.y) * (1.0 + k)
            v.co = inv @ w2
        me.update()


def one(tag, fn):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    fn(muscles)
    C.apply_object_transforms(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = Q84.eval_png(png)
    deltas = MO.measure_row_delta(REF, png)
    m = ev.get("metrics", {})
    summary = {
        "tag": tag,
        "pr": m.get("profile_rmse"),
        "occ": m.get("occiput_ratio", {}).get("test"),
        "hw": m.get("hw_ratio", {}).get("test"),
        "deltas": deltas,
        "pass": ev.get("pass"),
    }
    C.write_json(OUT / f"{tag}_report.json", summary)
    print(json.dumps({k: summary[k] for k in ("tag", "pr", "occ", "hw")}, ensure_ascii=False))
    return summary


def main():
    C.ensure_dirs(OUT)
    # baseline
    one("b0", lambda m: None)
    # face expand / shrink
    one("face_exp", lambda m: nudge_band(m, 0.05, 0.30, +0.12, front=True, back=False))
    one("face_shr", lambda m: nudge_band(m, 0.05, 0.30, -0.12, front=True, back=False))
    # mid-back (h~0.70) expand / shrink
    one("midb_exp", lambda m: nudge_band(m, 0.65, 0.80, +0.14, front=False, back=True))
    one("midb_shr", lambda m: nudge_band(m, 0.65, 0.80, -0.14, front=False, back=True))
    # neck front expand / shrink
    one("neckf_exp", lambda m: nudge_band(m, 0.86, 0.98, +0.14, front=True, back=False))
    one("neckf_shr", lambda m: nudge_band(m, 0.86, 0.98, -0.14, front=True, back=False))
    # neck/back occiput expand (for occ)
    one("neckb_exp", lambda m: nudge_band(m, 0.70, 0.92, +0.12, front=False, back=True))
    print("[Q93probe] done")


if __name__ == "__main__":
    main()
