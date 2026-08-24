# -*- coding: utf-8
"""Q84: aggressive Static occ-band nudge + deep adaptive + occ tune."""
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
import q4_regional as Q4  # noqa: E402
import q12_hw_match as Q12  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402
import q19_back_balance as Q19  # noqa: E402
import q20_profile_fit as Q20  # noqa: E402
import q75_mesh as Q75  # noqa: E402

OUT = C.STAGES / "Q84_aggressive"
BASE = C.CHECKPOINTS / "Q57_p1_best.blend"
REF = C.ROOT / "Base15_侧.png"
PY = __import__("shutil").which("python") or sys.executable


def eval_png(png):
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


def nudge_static_full(muscles, occ_y, occ_x, fore_y, h0, h1):
    """All Static verts in occ/fore bands (no outer-shell gate)."""
    static = C.get_obj("muscle", "Static")
    if not static:
        return
    _, center, rx, ry, rz = MO._ref_bbox(muscles)
    me = static.data
    inv = static.matrix_world.inverted()
    for v in me.vertices:
        w = static.matrix_world @ v.co
        ly = max(-1.0, min(1.0, (w.y - center.y) / ry))
        lz = max(-1.0, min(1.0, (w.z - center.z) / rz))
        h = (lz + 1.0) * 0.5
        occ = Q75.smooth_step((ly - 0.02) / 0.45) * Q75.smooth_step((h - h0) / 0.05) * Q75.smooth_step((h1 - h) / 0.08)
        fore = Q75.smooth_step((-ly - 0.02) / 0.42) * Q75.smooth_step((h - 0.04) / 0.08) * Q75.smooth_step((0.36 - h) / 0.14)
        if occ < 0.02 and fore < 0.02:
            continue
        w2 = w.copy()
        if occ > 0.02:
            w2.y = center.y + (w.y - center.y) * (1.0 - occ_y * occ)
            w2.x = center.x + (w.x - center.x) * (1.0 - occ_x * occ)
        if fore > 0.02 and ly < 0:
            w2.y = center.y + (w.y - center.y) * (1.0 + fore_y * fore)
        v.co = inv @ w2
    me.update()


def static_q20(muscles, strength, bulk):
    static = C.get_obj("muscle", "Static")
    if not static:
        return
    wn, on = Q20.load_targets()
    lat = Q7.make_lattice([static], "s20", 13)
    Q20.deform_to_targets(lat, wn, on, strength, bulk)
    Q7.apply_lattice([static], lat)


def run_preset(tag, flat, use_q20, q20_st, oy, ox, fy, h0, h1, face, occ_b, passes):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    if flat > 0:
        lat = Q7.make_lattice(muscles, f"f{tag}", 13)
        Q4.deform_region(lat, "occiput_neck", widen=-0.06 * flat, flatten=0.12 * flat, dz=0.0)
        Q7.apply_lattice(muscles, lat)
    if use_q20:
        static_q20(muscles, q20_st, 0.04)
    nudge_static_full(muscles, oy, ox, fy, h0, h1)
    MO.nudge_outer(muscles, oy * 0.65, ox * 0.65, fy * 0.65, 0.04, 1.0, 0.45, h0, h1, 0.12)
    if face > 0 or occ_b > 0:
        lat2 = Q7.make_lattice(muscles, f"b{tag}", 11)
        Q19.deform_balance(lat2, face, occ_b, 0.04)
        Q7.apply_lattice(muscles, lat2)

    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    best_ev, best_sc = ev, Q12.score(ev)

    for pi in range(passes):
        if best_ev.get("pass"):
            break
        pr = float(best_ev.get("metrics", {}).get("profile_rmse", 1.0))
        if pr <= 0.055:
            break
        st = 0.12 + 0.02 * min(pi, 6)
        deltas = MO.measure_row_delta(REF, png)
        MO.nudge_adaptive(muscles, deltas, st, 1.0, 0.40, 0.10)
        nudge_static_full(muscles, 0.06, 0.10, 0.04, 0.66, 0.82)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_p{pi+1}_side.png"
        Q12.render_side(muscles, png)
        ev = eval_png(png)
        sc = Q12.score(ev)
        if sc <= best_sc:
            best_sc, best_ev = sc, ev

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    m = best_ev.get("metrics", {})
    print(
        f"[Q84] {tag} sc={best_sc:.3f} pass={best_ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return best_ev, best_sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("a1", 1.5, False, 0.0, 0.32, 0.46, 0.12, 0.62, 0.84, 0.05, 0.03, 10),
        ("a2", 1.5, True, 0.08, 0.28, 0.42, 0.11, 0.62, 0.84, 0.05, 0.03, 10),
        ("a3", 1.5, True, 0.10, 0.30, 0.44, 0.11, 0.64, 0.83, 0.06, 0.04, 10),
        ("a4", 1.2, True, 0.08, 0.26, 0.40, 0.10, 0.64, 0.84, 0.06, 0.04, 10),
        ("a5", 0.0, True, 0.10, 0.30, 0.44, 0.10, 0.64, 0.84, 0.07, 0.05, 10),
        ("a6", 1.5, True, 0.12, 0.34, 0.48, 0.12, 0.60, 0.82, 0.05, 0.04, 12),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run_preset(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q84_PASS.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q84_PASS.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q84_{tag}_best.blend")
    if best:
        tag, ev, muscles = best
        C.save_blend(C.CHECKPOINTS / "Q84_best.blend")
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q84_best.blend", "pass": False, "report": ev, "tag": tag})
        print(f"[Q84] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
