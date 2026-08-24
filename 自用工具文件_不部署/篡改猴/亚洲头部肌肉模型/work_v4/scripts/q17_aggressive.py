# -*- coding: utf-8
"""Q17: aggressive tail trim + vault forward + cranial bulk from Q15-q3."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q12_hw_match as Q12  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402
import q16_profile_shape as Q16  # noqa: E402

OUT = C.STAGES / "Q17_aggressive"
BASE = C.CHECKPOINTS / "Q15_q3_best.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def trim_lower_tail(muscles, strength: float):
    static = C.get_obj("muscle", "Static")
    c, s = C.bbox_center_size([static])
    for obj in muscles:
        me = obj.data
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            lz = (w.z - c.z) / max(s.z * 0.5, 1e-6)
            ly = (w.y - c.y) / max(s.y * 0.5, 1e-6)
            if ly < 0.05 or lz > 0.15:
                continue
            tail = smooth_step((ly + 0.05) / 0.55) * smooth_step((-lz - 0.05) / 0.42)
            if tail < 0.05:
                continue
            target_y = c.y + (w.y - c.y) * (1.0 - strength * tail)
            w2 = Vector((w.x, target_y, w.z))
            v.co = obj.matrix_world.inverted() @ w2
        me.update()


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("t1", (0.18, 0.22, 0.34, 0.50, 0.12), 0.55),
        ("t2", (0.20, 0.24, 0.36, 0.58, 0.13), 0.62),
        ("t3", (0.22, 0.26, 0.38, 0.65, 0.14), 0.68),
        ("t4", (0.16, 0.28, 0.32, 0.55, 0.11), 0.60),
        ("t5", (0.24, 0.22, 0.40, 0.52, 0.15), 0.50),
    ]
    best_sc, best = 1e9, None
    for tag, params, tail_s in grid:
        bpy.ops.wm.open_mainfile(filepath=str(BASE))
        for o in C.mesh_objects(C.objects_in_group("muscle")):
            if "Melns" in o.name or "pCylinder" in o.name:
                o.hide_render = True
        muscles = C.muscle_exportable()
        lat = Q7.make_lattice(muscles, tag, 11)
        Q16.deform_profile(lat, *params)
        Q7.apply_lattice(muscles, lat)
        trim_lower_tail(muscles, tail_s)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_side.png"
        C.set_group_visibility("skull", False)
        Q12.render_side(muscles, png)
        ev = Q16.eval_png(png)
        sc = Q12.score(ev)
        print(f"[Q17] {tag} sc={sc:.3f} pass={ev.get('pass')}")
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q17_aggressive.blend")
            C.write_json(OUT / "self_eval_report.json", ev)
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q17_{tag}_best.blend")

    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.save_blend(C.CHECKPOINTS / "Q17_aggressive_FAIL.blend")
        print(f"[Q17] best={tag} sc={best_sc:.3f} {ev.get('notes')}")


if __name__ == "__main__":
    main()
