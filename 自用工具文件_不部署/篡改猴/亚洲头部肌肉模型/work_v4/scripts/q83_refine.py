# -*- coding: utf-8
"""Q83: intensive adaptive profile passes from Q82 best params."""
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

OUT = C.STAGES / "Q83_refine"
BASE = C.CHECKPOINTS / "Q57_p1_best.blend"
REF = C.ROOT / "Base15_侧.png"
PY = __import__("shutil").which("python") or sys.executable

# Q82 g09/g10 style starting params
PRESETS = [
    ("r1", 1.5, 0.34, 0.48, 0.12, 0.03, 0.0, 0.62, 0.82, 0.16, 0.0, 0.0),
    ("r2", 1.5, 0.30, 0.44, 0.11, 0.04, 0.35, 0.64, 0.84, 0.18, 0.05, 0.03),
    ("r3", 1.5, 0.28, 0.42, 0.10, 0.04, 0.35, 0.65, 0.83, 0.19, 0.06, 0.04),
    ("r4", 0.0, 0.32, 0.46, 0.11, 0.04, 0.40, 0.63, 0.83, 0.17, 0.06, 0.05),
]


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


def apply_flat(muscles, amt):
    lat = Q7.make_lattice(muscles, "flat", 13)
    Q4.deform_region(lat, "occiput_neck", widen=-0.06 * amt, flatten=0.12 * amt, dz=0.0)
    Q7.apply_lattice(muscles, lat)


def run_preset(tag, flat, oy, ox, fy, ty, dw, h0, h1, sx, face, occ_b):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    if flat > 0:
        apply_flat(muscles, flat)
    MO.nudge_outer(muscles, oy, ox, fy, ty, 1.0, dw, h0, h1, sx)
    if face > 0 or occ_b > 0:
        lat = Q7.make_lattice(muscles, f"b{tag}", 11)
        Q19.deform_balance(lat, face, occ_b, 0.04)
        Q7.apply_lattice(muscles, lat)

    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    best_ev, best_sc = ev, Q12.score(ev)

    for pass_i, st in enumerate([0.12, 0.14, 0.16, 0.14, 0.12, 0.10, 0.08, 0.06]):
        if best_ev.get("pass"):
            break
        pr = float(best_ev.get("metrics", {}).get("profile_rmse", 1.0))
        if pr <= 0.055:
            break
        deltas = MO.measure_row_delta(REF, png)
        MO.nudge_adaptive(muscles, deltas, st, 1.0, dw, sx)
        if pass_i == 4 and pr > 0.07:
            MO.nudge_outer(muscles, 0.08, 0.14, 0.04, 0.02, 1.0, dw, 0.66, 0.82, sx)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_p{pass_i+1}_side.png"
        Q12.render_side(muscles, png)
        ev = eval_png(png)
        sc = Q12.score(ev)
        if sc < best_sc:
            best_sc, best_ev = sc, ev

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    m = best_ev.get("metrics", {})
    print(
        f"[Q83] {tag} sc={best_sc:.3f} pass={best_ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return best_ev, best_sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    best_sc, best = 1e9, None
    for row in PRESETS:
        tag = row[0]
        ev, sc, muscles = run_preset(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q83_PASS.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q83_PASS.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q83_{tag}_best.blend")
    if best:
        tag, ev, muscles = best
        C.save_blend(C.CHECKPOINTS / "Q83_best.blend")
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q83_best.blend", "pass": False, "report": ev, "tag": tag})
        print(f"[Q83] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
