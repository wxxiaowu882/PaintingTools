# -*- coding: utf-8
"""Q65: regional occiput bulge + face flatten on Q57-p1 (mesh-zone lattice)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q12_hw_match as Q12  # noqa: E402
import q4_regional as Q4  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402
import q21_refine as Q21  # noqa: E402

OUT = C.STAGES / "Q65_regional"
BASE = C.CHECKPOINTS / "Q57_p1_best.blend"
PY = __import__("shutil").which("python") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def deform_occ_face(lat, occ_y: float, face_y: float, mid_pull: float, low_push: float):
    """Back +Y bulge; front -Y shrink; mid-back pull; lower-back push."""
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                lx = max(-1.0, min(1.0, co.x * 2.0))
                ly = max(-1.0, min(1.0, co.y * 2.0))
                lz = max(-1.0, min(1.0, co.z * 2.0))
                cranial = smooth_step((lz + 0.04) / 0.92) * (
                    1.0 - 0.42 * smooth_step((-lz - 0.22) / 0.50)
                )

                occ = smooth_step((ly + 0.02) / 0.55) * smooth_step((lz + 0.05) / 0.55) * cranial
                occ_mid = smooth_step((ly + 0.02) / 0.50) * smooth_step(1.0 - abs(lz - 0.05) / 0.38) * cranial
                face = smooth_step((-ly - 0.01) / 0.50) * smooth_step((lz + 0.0) / 0.55) * cranial
                face_upper = face * smooth_step((lz - 0.05) / 0.45)
                mid_back = smooth_step((ly + 0.03) / 0.48) * smooth_step((lz + 0.0) / 0.35) * smooth_step(
                    (0.25 - lz) / 0.30
                ) * cranial
                low_back = smooth_step((ly + 0.04) / 0.50) * smooth_step((-lz - 0.05) / 0.40) * cranial

                y_mul = (
                    1.0
                    + occ_y * occ
                    + occ_y * 0.65 * occ_mid
                    - face_y * (face + 0.85 * face_upper)
                    - mid_pull * mid_back
                    + low_push * low_back
                )
                outer = smooth_step((abs(lx) - 0.20) / 0.55) * occ * occ_y
                new = co.copy()
                new.y = co.y * max(0.62, y_mul)
                new.x = co.x * (1.0 + 0.35 * outer)
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


def run(tag, occ, face, mid, low, zc, use_q4=False):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    lat = Q7.make_lattice(muscles, tag, 11)
    deform_occ_face(lat, occ, face, mid, low)
    Q7.apply_lattice(muscles, lat)
    if use_q4:
        for rname, flat in [("forehead_eyes", face * 0.9), ("zygomatic", face * 0.7), ("masseter_jaw", face * 0.5)]:
            lat2 = Q7.make_lattice(muscles, f"{tag}_{rname[:3]}", 11)
            Q4.deform_region(lat2, rname, widen=0.0, flatten=flat, dz=0.0)
            Q7.apply_lattice(muscles, lat2)
        lat3 = Q7.make_lattice(muscles, f"{tag}_occ", 11)
        Q4.deform_region(lat3, "occiput_neck", widen=occ * 1.2, flatten=0.0, dz=0.0)
        Q7.apply_lattice(muscles, lat3)
    if zc > 0:
        lat4 = Q7.make_lattice(muscles, f"z{tag}", 11)
        Q21.hw_trim_lat(lat4, zc)
        Q7.apply_lattice(muscles, lat4)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(
        f"[Q65] {tag} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} "
        f"occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("r1", 0.10, 0.10, 0.12, 0.06, 0.0, False),
        ("r2", 0.12, 0.12, 0.14, 0.08, 0.0, False),
        ("r3", 0.14, 0.10, 0.16, 0.08, 0.02, False),
        ("r4", 0.12, 0.14, 0.14, 0.06, 0.02, False),
        ("r5", 0.10, 0.12, 0.12, 0.08, 0.03, True),
        ("r6", 0.12, 0.10, 0.16, 0.10, 0.03, True),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q65_regional.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q65_regional.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q65_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q65_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q65] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
