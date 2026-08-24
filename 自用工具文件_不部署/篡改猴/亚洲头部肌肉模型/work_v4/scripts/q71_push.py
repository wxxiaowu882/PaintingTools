# -*- coding: utf-8
"""Q71: aggressive occiput pull + forehead push on Q56-t2, recover hw."""
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
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402
import q19_back_balance as Q19  # noqa: E402
import q21_refine as Q21  # noqa: E402
import q37_profile_correct as Q37  # noqa: E402

OUT = C.STAGES / "Q71_push"
BASE = C.CHECKPOINTS / "Q56_t2_best.blend"
PY = __import__("shutil").which("python") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def deform_silhouette_push(lat, fore_push: float, occ_pull: float, tail_push: float):
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
                h = (lz + 1.0) * 0.5
                cranial = smooth_step((lz + 0.04) / 0.92) * (
                    1.0 - 0.42 * smooth_step((-lz - 0.22) / 0.50)
                )
                if cranial < 0.03:
                    p.co_deform = co
                    continue

                front = smooth_step((-ly - 0.05) / 0.42)
                back = smooth_step((ly - 0.05) / 0.42)

                fore = smooth_step((h - 0.03) / 0.08) * smooth_step((0.36 - h) / 0.14) * front
                occ = smooth_step((h - 0.62) / 0.08) * smooth_step((0.90 - h) / 0.12) * back
                tail = smooth_step((h - 0.86) / 0.05) * smooth_step((0.98 - h) / 0.04) * back

                y_mul = 1.0
                if ly < -0.02:
                    y_mul += fore_push * fore
                if ly > 0.02:
                    y_mul -= occ_pull * occ
                    y_mul += tail_push * tail

                new = co.copy()
                new.y = co.y * max(0.58, y_mul)
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
    return json.loads(t[i:j])


def run(tag, fore, occ, tail, tp, face, occ_b, zc, y_exp=0.0):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()

    lat = Q7.make_lattice(muscles, f"s{tag}", 13)
    deform_silhouette_push(lat, fore, occ, tail)
    Q7.apply_lattice(muscles, lat)

    if tp > 0:
        lat2 = Q7.make_lattice(muscles, f"t{tag}", 11)
        Q37.deform_profile_correct(lat2, 0.0, tp, 0.0, 0.05)
        Q7.apply_lattice(muscles, lat2)

    if y_exp > 0:
        lat3 = Q7.make_lattice(muscles, f"y{tag}", 11)
        Q12.deform_hw_lat(lat3, 1.0 + y_exp, 1.0, 0.0, 0.0)
        Q7.apply_lattice(muscles, lat3)

    if face > 0 or occ_b > 0:
        lat4 = Q7.make_lattice(muscles, f"b{tag}", 11)
        Q19.deform_balance(lat4, face, occ_b, 0.04)
        Q7.apply_lattice(muscles, lat4)

    if zc > 0:
        lat5 = Q7.make_lattice(muscles, f"z{tag}", 11)
        Q21.hw_trim_lat(lat5, zc)
        Q7.apply_lattice(muscles, lat5)

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(
        f"[Q71] {tag} sc={sc:.3f} pass={ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        # fore, occ, tail, tp, face, occ_b, zc, y_exp
        ("p1", 0.10, 0.18, 0.08, 0.24, 0.0, 0.0, 0.0, 0.0),
        ("p2", 0.12, 0.20, 0.10, 0.26, 0.0, 0.0, 0.0, 0.0),
        ("p3", 0.12, 0.22, 0.10, 0.28, 0.0, 0.0, 0.0, 0.0),
        ("p4", 0.14, 0.22, 0.12, 0.28, 0.0, 0.0, 0.0, 0.0),
        ("p5", 0.12, 0.20, 0.10, 0.26, 0.06, 0.04, 0.02, 0.04),
        ("p6", 0.12, 0.22, 0.10, 0.28, 0.07, 0.05, 0.03, 0.05),
        ("p7", 0.14, 0.24, 0.12, 0.30, 0.07, 0.05, 0.03, 0.06),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q71_push.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q71_push.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q71_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q71_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q71] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
