# -*- coding: utf-8
"""Q73: stronger occiput_neck regional flatten (from Q72-f2 path) + occ/hw recovery."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy

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

OUT = C.STAGES / "Q73_flat"
BASE = C.CHECKPOINTS / "Q57_p1_best.blend"
PY = __import__("shutil").which("python") or sys.executable


def deform_occ_flat(lat, flat: float, widen: float):
    Q4.deform_region(lat, "occiput_neck", widen=-0.08 * widen, flatten=0.16 * flat, dz=0.0)
    Q4.deform_region(lat, "forehead_eyes", widen=0.0, flatten=0.10 * flat * 0.35, dz=0.0)


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


def run(tag, flat, widen, face, occ, zc, y_exp):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()

    lat = Q7.make_lattice(muscles, f"o{tag}", 13)
    deform_occ_flat(lat, flat, widen)
    Q7.apply_lattice(muscles, lat)

    if face > 0 or occ > 0:
        lat2 = Q7.make_lattice(muscles, f"b{tag}", 11)
        Q19.deform_balance(lat2, face, occ, 0.04)
        Q7.apply_lattice(muscles, lat2)

    if y_exp > 0:
        lat3 = Q7.make_lattice(muscles, f"y{tag}", 11)
        Q12.deform_hw_lat(lat3, 1.0 + y_exp, 1.0, 0.0, 0.02 * occ)
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
        f"[Q73] {tag} sc={sc:.3f} pass={ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        # flat, widen, face, occ, zc, y_exp
        ("f2b", 1.5, 1.0, 0.0, 0.0, 0.0, 0.0),
        ("f25", 2.0, 1.2, 0.0, 0.0, 0.0, 0.0),
        ("f30", 2.5, 1.5, 0.0, 0.0, 0.0, 0.0),
        ("o1", 2.0, 1.2, 0.08, 0.04, 0.02, 0.04),
        ("o2", 2.0, 1.2, 0.10, 0.05, 0.03, 0.05),
        ("o3", 2.5, 1.5, 0.08, 0.05, 0.03, 0.05),
        ("o4", 2.5, 1.5, 0.10, 0.06, 0.03, 0.06),
        ("o5", 2.0, 1.8, 0.10, 0.05, 0.04, 0.05),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q73_flat.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q73_flat.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q73_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q73_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q73] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
