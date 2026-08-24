# -*- coding: utf-8
"""Q19: balance front/back half widths — shrink face, expand occiput."""
from __future__ import annotations

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
import q15_face_occ as Q15  # noqa: E402
import q16_profile_shape as Q16  # noqa: E402

OUT = C.STAGES / "Q19_back_balance"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def deform_balance(lat, face: float, occ: float, mid_round: float):
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                ly = max(-1.0, min(1.0, co.y * 2.0))
                lz = max(-1.0, min(1.0, co.z * 2.0))
                cranial = Q15.smooth_step((lz + 0.06) / 0.90) * (1.0 - 0.45 * Q15.smooth_step((-lz - 0.22) / 0.50))

                face_m = Q15.smooth_step((-ly - 0.01) / 0.50) * Q15.smooth_step((lz + 0.0) / 0.55) * cranial
                occ_m = Q15.smooth_step((ly + 0.0) / 0.48) * Q15.smooth_step((lz - 0.05) / 0.50) * cranial
                occ_low = Q15.smooth_step((ly + 0.06) / 0.50) * Q15.smooth_step((-lz - 0.05) / 0.45) * cranial
                mid = Q15.smooth_step(1.0 - abs(lz - 0.08) / 0.38) * cranial

                y_mul = 1.0 - face * face_m + occ * (occ_m + 0.85 * occ_low) + mid_round * mid
                new = co.copy()
                new.y = co.y * max(0.64, y_mul)
                new.x = co.x * (1.0 + mid_round * 0.35 * Q15.smooth_step(abs(co.x * 2.0)) * cranial)
                p.co_deform = new
    bpy.context.view_layer.update()


def run_from(base: Path, tag: str, face: float, occ: float, mid: float):
    bpy.ops.wm.open_mainfile(filepath=str(base))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    lat = Q7.make_lattice(muscles, tag, 11)
    deform_balance(lat, face, occ, mid)
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = Q16.eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(
        f"[Q19] {tag} sc={sc:.3f} hw={m.get('hw_ratio',{}).get('test')} "
        f"occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} "
        f"pr={m.get('profile_rmse')} pass={ev.get('pass')}"
    )
    return ev, muscles, sc


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    bases = [
        ("a", C.CHECKPOINTS / "Q13_o_best.blend"),
        ("b", C.CHECKPOINTS / "Q15_q3_best.blend"),
    ]
    params = [
        (0.28, 0.40, 0.10),
        (0.32, 0.44, 0.11),
        (0.36, 0.48, 0.12),
        (0.30, 0.50, 0.13),
        (0.34, 0.46, 0.14),
    ]
    best_sc, best = 1e9, None
    for bp, base in bases:
        if not base.exists():
            continue
        for i, (f, o, m) in enumerate(params):
            tag = f"{bp}{i+1}"
            ev, muscles, sc = run_from(base, tag, f, o, m)
            if ev.get("pass"):
                Q8.force_recolor()
                C.export_glb(C.GLB_FINAL, muscles)
                C.save_blend(C.BLEND_FINAL)
                C.save_blend(C.CHECKPOINTS / "Q19_back_balance.blend")
                C.write_json(OUT / "self_eval_report.json", ev)
                return
            if sc < best_sc:
                best_sc, best = sc, (tag, ev, muscles)
                C.save_blend(C.CHECKPOINTS / f"Q19_{tag}_best.blend")

    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        print(f"[Q19] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
