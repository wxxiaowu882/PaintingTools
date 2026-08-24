# -*- coding: utf-8
"""Q88: continue adaptive from Q84_a6 checkpoint + occ lattice."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import mesh_outer as MO  # noqa: E402
import q12_hw_match as Q12  # noqa: E402
import q19_back_balance as Q19  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q84_aggressive as Q84  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.STAGES / "Q88_continue"
BASE = C.CHECKPOINTS / "Q84_a6_best.blend"
FALLBACK = C.CHECKPOINTS / "Q57_p1_best.blend"
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
    import json

    return json.loads(t[i:j])


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    base = BASE if BASE.exists() else FALLBACK
    bpy.ops.wm.open_mainfile(filepath=str(base))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    png = OUT / "c0_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    best_ev, best_sc = ev, Q12.score(ev)

    for pi in range(20):
        if best_ev.get("pass"):
            break
        pr = float(best_ev.get("metrics", {}).get("profile_rmse", 1.0))
        if pr <= 0.055:
            break
        st = 0.10 + 0.015 * min(pi, 10)
        deltas = MO.measure_row_delta(REF, png)
        MO.nudge_adaptive(muscles, deltas, st, 1.0, 0.45, 0.08)
        Q84.nudge_static_full(muscles, 0.05, 0.08, 0.03, 0.64, 0.82)
        if pi == 10:
            lat = Q7.make_lattice(muscles, "occ", 11)
            Q19.deform_balance(lat, 0.05, 0.03, 0.04)
            Q7.apply_lattice(muscles, lat)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"c{pi+1}_side.png"
        Q12.render_side(muscles, png)
        ev = eval_png(png)
        sc = Q12.score(ev)
        if sc < best_sc:
            best_sc, best_ev = sc, ev
        if ev.get("pass"):
            best_ev = ev
            break

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    m = best_ev.get("metrics", {})
    print(
        f"[Q88] sc={best_sc:.3f} pass={best_ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    if best_ev.get("pass"):
        Q8.force_recolor()
        C.export_glb(C.GLB_FINAL, muscles)
        C.save_blend(C.BLEND_FINAL)
        C.save_blend(C.CHECKPOINTS / "Q88_PASS.blend")
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q88_PASS.blend", "pass": True, "report": best_ev})
    else:
        C.save_blend(C.CHECKPOINTS / "Q88_best.blend")
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q88_best.blend", "pass": False, "report": best_ev})


if __name__ == "__main__":
    main()
