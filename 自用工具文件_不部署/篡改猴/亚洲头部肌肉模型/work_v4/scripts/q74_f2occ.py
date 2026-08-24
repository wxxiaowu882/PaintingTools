# -*- coding: utf-8
"""Q74: Q72-f2 profile base + minimal occ recovery."""
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

OUT = C.STAGES / "Q74_f2occ"
BASE = C.CHECKPOINTS / "Q72_f2_best.blend"
FALLBACK = C.CHECKPOINTS / "Q57_p1_best.blend"
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


def run(tag, face, occ, zc, y_exp):
    base = BASE if BASE.exists() else FALLBACK
    bpy.ops.wm.open_mainfile(filepath=str(base))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    if face > 0 or occ > 0:
        lat = Q7.make_lattice(muscles, tag, 11)
        Q19.deform_balance(lat, face, occ, 0.04)
        Q7.apply_lattice(muscles, lat)
    if y_exp > 0:
        lat2 = Q7.make_lattice(muscles, f"y{tag}", 11)
        Q12.deform_hw_lat(lat2, 1.0 + y_exp, 1.0, 0.0, 0.03 * occ)
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
        f"[Q74] {tag} sc={sc:.3f} pass={ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("a1", 0.04, 0.02, 0.0, 0.0),
        ("a2", 0.06, 0.03, 0.0, 0.0),
        ("a3", 0.06, 0.04, 0.02, 0.03),
        ("a4", 0.08, 0.04, 0.02, 0.04),
        ("a5", 0.08, 0.05, 0.03, 0.04),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q74_f2occ.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q74_f2occ.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q74_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q74_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q74] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
