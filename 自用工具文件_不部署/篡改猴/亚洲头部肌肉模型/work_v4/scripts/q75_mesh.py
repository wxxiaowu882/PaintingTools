# -*- coding: utf-8
"""Q75: mesh-level occiput vertex pull on Q72-f2 profile base."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q4_regional as Q4  # noqa: E402
import q12_hw_match as Q12  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402
import q19_back_balance as Q19  # noqa: E402
import q21_refine as Q21  # noqa: E402

OUT = C.STAGES / "Q75_mesh"
BASE_PROFILE = C.CHECKPOINTS / "Q72_f2_best.blend"
BASE_P1 = C.CHECKPOINTS / "Q57_p1_best.blend"
PY = __import__("shutil").which("python") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def apply_f2_flat(muscles):
    lat = Q7.make_lattice(muscles, "f2flat", 13)
    Q4.deform_region(lat, "occiput_neck", widen=-0.06 * 1.5, flatten=0.12 * 1.5, dz=0.0)
    Q7.apply_lattice(muscles, lat)


def nudge_mesh(muscles, occ_y: float, occ_x: float, fore_y: float, tail_y: float):
    """Direct vertex nudge in world space — occiput 58-88% rows, forehead 5-35%."""
    ref = C.get_obj("muscle", "Static") or muscles[0]
    center, size = C.bbox_center_size([ref])
    rx, ry, rz = max(size.x * 0.5, 1e-6), max(size.y * 0.5, 1e-6), max(size.z * 0.5, 1e-6)

    for obj in muscles:
        me = obj.data
        inv = obj.matrix_world.inverted()
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            lx = max(-1.0, min(1.0, (w.x - center.x) / rx))
            ly = max(-1.0, min(1.0, (w.y - center.y) / ry))
            lz = max(-1.0, min(1.0, (w.z - center.z) / rz))
            h = (lz + 1.0) * 0.5

            occ = (
                smooth_step((ly - 0.04) / 0.42)
                * smooth_step((h - 0.56) / 0.10)
                * smooth_step((0.90 - h) / 0.14)
            )
            fore = (
                smooth_step((-ly - 0.04) / 0.40)
                * smooth_step((h - 0.04) / 0.10)
                * smooth_step((0.36 - h) / 0.14)
            )
            tail = (
                smooth_step((ly - 0.02) / 0.45)
                * smooth_step((0.86 - h) / 0.06)
                * smooth_step((0.98 - h) / 0.05)
            )

            if occ < 0.01 and fore < 0.01 and tail < 0.01:
                continue

            w2 = w.copy()
            if occ > 0.01:
                # back too deep -> pull forward (+Y is back in our lattice convention)
                w2.y = center.y + (w.y - center.y) * (1.0 - occ_y * occ)
                w2.x = center.x + (w.x - center.x) * (1.0 - occ_x * occ)
            if fore > 0.01 and ly < 0:
                w2.y = center.y + (w.y - center.y) * (1.0 + fore_y * fore)
            if tail > 0.01:
                w2.y = center.y + (w.y - center.y) * (1.0 + tail_y * tail)
            v.co = inv @ w2
        me.update()


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


def run(tag, base_path, use_flat, occ_y, occ_x, fore_y, tail_y, face, zc, y_exp):
    bpy.ops.wm.open_mainfile(filepath=str(base_path))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()

    if use_flat:
        apply_f2_flat(muscles)

    if occ_y > 0 or occ_x > 0 or fore_y > 0 or tail_y > 0:
        nudge_mesh(muscles, occ_y, occ_x, fore_y, tail_y)

    if face > 0:
        lat = Q7.make_lattice(muscles, f"f{tag}", 11)
        Q19.deform_balance(lat, face, 0.0, 0.04)
        Q7.apply_lattice(muscles, lat)

    if y_exp > 0:
        lat2 = Q7.make_lattice(muscles, f"y{tag}", 11)
        Q12.deform_hw_lat(lat2, 1.0 + y_exp, 1.0, 0.0, 0.0)
        Q7.apply_lattice(muscles, lat2)

    if zc > 0:
        lat3 = Q7.make_lattice(muscles, f"z{tag}", 11)
        Q21.hw_trim_lat(lat3, zc)
        Q7.apply_lattice(muscles, lat3)

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(
        f"[Q75] {tag} sc={sc:.3f} pass={ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grids = [
        # tag, base, flat, occ_y, occ_x, fore_y, tail_y, face, zc, y_exp
        ("m1", BASE_PROFILE, False, 0.20, 0.10, 0.08, 0.10, 0.0, 0.0, 0.0),
        ("m2", BASE_PROFILE, False, 0.30, 0.15, 0.10, 0.12, 0.0, 0.0, 0.0),
        ("m3", BASE_PROFILE, False, 0.40, 0.20, 0.12, 0.14, 0.0, 0.0, 0.0),
        ("m4", BASE_PROFILE, False, 0.35, 0.18, 0.12, 0.16, 0.0, 0.0, 0.0),
        ("p1", BASE_P1, True, 0.30, 0.15, 0.10, 0.12, 0.0, 0.0, 0.0),
        ("p2", BASE_P1, True, 0.35, 0.18, 0.12, 0.14, 0.0, 0.0, 0.0),
        ("p3", BASE_P1, True, 0.35, 0.18, 0.12, 0.14, 0.05, 0.02, 0.04),
        ("p4", BASE_P1, True, 0.30, 0.15, 0.10, 0.12, 0.06, 0.02, 0.04),
    ]
    best_sc, best = 1e9, None
    for row in grids:
        tag = row[0]
        base = row[1]
        if not base.exists():
            print(f"[Q75] skip {tag}, missing {base.name}")
            continue
        ev, sc, muscles = run(tag, base, *row[2:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q75_mesh.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q75_mesh.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q75_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q75_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q75] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
