# -*- coding: utf-8
"""Q59: row-targeted profile fix from Q57-p1."""
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
import q20_profile_fit as Q20  # noqa: E402
import q21_refine as Q21  # noqa: E402

OUT = C.STAGES / "Q59_row_fix"
BASE = C.CHECKPOINTS / "Q57_p1_best.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def deform_row_fix(lat, upper_pull: float, mid_back_pull: float, lower_fwd: float, occ_mid: float):
    """Fix Q56-t2 row errors: upper face back, mid-back pull, lower neck fwd."""
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
                cranial = smooth_step((lz + 0.04) / 0.92) * (
                    1.0 - 0.42 * smooth_step((-lz - 0.22) / 0.50)
                )

                # 5–30% rows: face too forward
                upper = smooth_step((lz + 0.02) / 0.55) * smooth_step((-ly - 0.01) / 0.48) * cranial
                # 70–85%: occiput too back
                mid_back = smooth_step((ly + 0.02) / 0.50) * smooth_step((lz + 0.02) / 0.38) * smooth_step(
                    (0.30 - lz) / 0.30
                ) * cranial
                # 90–95%: lower tail too forward vs ref
                lower = smooth_step((ly + 0.04) / 0.48) * smooth_step((-lz - 0.08) / 0.35) * cranial
                # occ bulge for ratio
                occ = smooth_step((ly + 0.02) / 0.45) * smooth_step(1.0 - abs(lz - 0.08) / 0.35) * cranial

                y_mul = (
                    1.0
                    - upper_pull * upper
                    - mid_back_pull * mid_back
                    + lower_fwd * lower
                    + occ_mid * occ
                )
                new = co.copy()
                new.y = co.y * max(0.64, y_mul)
                p.co_deform = new
    bpy.context.view_layer.update()


def eval_png(png: Path) -> dict:
    import subprocess

    proc = subprocess.run(
        [PY, str(SCRIPTS / "base15_proportion_eval.py"), str(png)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    t = proc.stdout
    i, j = t.find("{"), t.rfind("}") + 1
    return json.loads(t[i:j]) if i >= 0 else {"pass": False}


def run(tag, up, mb, lf, occ, zc):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    lat = Q7.make_lattice(muscles, tag, 11)
    deform_row_fix(lat, up, mb, lf, occ)
    Q7.apply_lattice(muscles, lat)
    if zc > 0:
        lat2 = Q7.make_lattice(muscles, f"z{tag}", 11)
        Q21.hw_trim_lat(lat2, zc)
        Q7.apply_lattice(muscles, lat2)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(
        f"[Q59] {tag} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} "
        f"occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("r1", 0.10, 0.14, 0.06, 0.10, 0.0),
        ("r2", 0.12, 0.16, 0.08, 0.12, 0.0),
        ("r3", 0.14, 0.18, 0.08, 0.14, 0.03),
        ("r4", 0.10, 0.18, 0.10, 0.12, 0.03),
        ("r5", 0.12, 0.20, 0.10, 0.14, 0.04),
        ("r6", 0.08, 0.16, 0.08, 0.16, 0.03),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q59_row_fix.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q59_row_fix.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q59_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q59_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q59] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
