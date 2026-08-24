# -*- coding: utf-8
"""Q76: Q75-m4 mesh profile + hw/occ recovery."""
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
import q75_mesh as Q75  # noqa: E402

OUT = C.STAGES / "Q76_recover"
BASE = C.CHECKPOINTS / "Q57_p1_best.blend"
PY = __import__("shutil").which("python") or sys.executable


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


def run(tag, occ_y, occ_x, fore_y, tail_y, y_exp, face, occ_b):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    Q75.apply_f2_flat(muscles)
    Q75.nudge_mesh(muscles, occ_y, occ_x, fore_y, tail_y)

    if y_exp > 0:
        lat = Q7.make_lattice(muscles, f"y{tag}", 11)
        Q12.deform_hw_lat(lat, 1.0 + y_exp, 1.0, 0.0, occ_b * 0.5)
        Q7.apply_lattice(muscles, lat)

    if face > 0 or occ_b > 0:
        lat2 = Q7.make_lattice(muscles, f"b{tag}", 11)
        Q19.deform_balance(lat2, face, occ_b, 0.04)
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
        f"[Q76] {tag} sc={sc:.3f} pass={ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        # occ_y, occ_x, fore_y, tail_y, y_exp, face, occ_b
        ("a1", 0.35, 0.18, 0.12, 0.12, 0.10, 0.0, 0.0),
        ("a2", 0.35, 0.18, 0.12, 0.12, 0.12, 0.0, 0.0),
        ("a3", 0.32, 0.16, 0.10, 0.10, 0.10, 0.0, 0.0),
        ("b1", 0.35, 0.18, 0.12, 0.12, 0.10, 0.06, 0.04),
        ("b2", 0.35, 0.18, 0.12, 0.12, 0.12, 0.06, 0.04),
        ("b3", 0.32, 0.16, 0.10, 0.10, 0.10, 0.07, 0.05),
        ("b4", 0.35, 0.18, 0.12, 0.10, 0.12, 0.08, 0.05),
        ("c1", 0.30, 0.15, 0.10, 0.10, 0.12, 0.08, 0.06),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q76_recover.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q76_recover.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q76_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q76_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q76] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
