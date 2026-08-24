# -*- coding: utf-8
"""Q21: refine Q20-f1 — hw trim + occiput top-up."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q12_hw_match as Q12  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402
import q16_profile_shape as Q16  # noqa: E402
import q19_back_balance as Q19  # noqa: E402
import q20_profile_fit as Q20  # noqa: E402

OUT = C.STAGES / "Q21_refine"
BASE = C.CHECKPOINTS / "Q20_f1_best.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def hw_trim_lat(lat, zc: float):
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                lz = max(-1.0, min(1.0, co.z * 2.0))
                cranial = Q20.smooth_step((lz + 0.04) / 0.92)
                new = co.copy()
                new.z = co.z * (1.0 - zc * cranial)
                p.co_deform = new
    bpy.context.view_layer.update()


def run_combo(tag, zc, face, occ, mid, pst, pbulk):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    if zc > 0:
        lat = Q7.make_lattice(muscles, f"z{tag}", 11)
        hw_trim_lat(lat, zc)
        Q7.apply_lattice(muscles, lat)
    lat2 = Q7.make_lattice(muscles, f"o{tag}", 11)
    Q19.deform_balance(lat2, face, occ, mid)
    Q7.apply_lattice(muscles, lat2)
    if pst > 0:
        wn, on = Q20.load_targets()
        lat3 = Q7.make_lattice(muscles, f"p{tag}", 13)
        Q20.deform_to_targets(lat3, wn, on, pst, pbulk)
        Q7.apply_lattice(muscles, lat3)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = Q16.eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(f"[Q21] {tag} sc={sc:.3f} hw={m.get('hw_ratio',{}).get('test')} occ={m.get('occiput_ratio',{}).get('test')} pr={m.get('profile_rmse')} pass={ev.get('pass')}")
    return ev, muscles, sc


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("r1", 0.05, 0.08, 0.14, 0.06, 0.18, 0.04),
        ("r2", 0.06, 0.10, 0.16, 0.07, 0.20, 0.05),
        ("r3", 0.07, 0.12, 0.18, 0.08, 0.22, 0.05),
        ("r4", 0.05, 0.14, 0.20, 0.08, 0.15, 0.06),
        ("r5", 0.06, 0.10, 0.22, 0.09, 0.18, 0.06),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, muscles, sc = run_combo(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q21_refine.blend")
            C.write_json(OUT / "self_eval_report.json", ev)
            subprocess.run([PY, str(SCRIPTS / "base15_silhouette_eval.py"), str(OUT), tag], check=False)
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q21_{tag}_best.blend")

    if best:
        tag, ev, muscles = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.save_blend(C.CHECKPOINTS / "Q21_refine_FAIL.blend")
        # render pack for internal QA
        C.set_group_visibility("skull", False)
        Q12.render_side(muscles, OUT / f"{tag}_side.png")
        print(f"[Q21] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
