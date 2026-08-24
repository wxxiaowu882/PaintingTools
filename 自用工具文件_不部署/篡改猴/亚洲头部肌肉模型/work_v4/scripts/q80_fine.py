# -*- coding: utf-8
"""Q80: fine-tune Q79-s3 Static mesh nudge + occ micro-tune."""
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
import q79_static as Q79  # noqa: E402

OUT = C.STAGES / "Q80_fine"
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


def pipeline(muscles, tag, flat, oy, ox, fy, ty, dw, face, occ_b):
    if flat:
        Q75.apply_f2_flat(muscles)
    Q79.nudge_targets(muscles, oy, ox, fy, ty, 1.0, dw)
    if face > 0 or occ_b > 0:
        lat = Q7.make_lattice(muscles, f"b{tag}", 11)
        Q19.deform_balance(lat, face, occ_b, 0.04)
        Q7.apply_lattice(muscles, lat)


def run(tag, flat, oy, ox, fy, ty, dw, face, occ_b):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    pipeline(muscles, tag, flat, oy, ox, fy, ty, dw, face, occ_b)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(
        f"[Q80] {tag} sc={sc:.3f} pass={ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        # flat, oy, ox, fy, ty, dw, face, occ_b
        ("a1", True, 0.28, 0.38, 0.11, 0.06, 0.0, 0.0, 0.0),
        ("a2", True, 0.30, 0.40, 0.11, 0.05, 0.0, 0.0, 0.0),
        ("a3", True, 0.32, 0.42, 0.12, 0.06, 0.0, 0.0, 0.0),
        ("b1", True, 0.28, 0.38, 0.11, 0.06, 0.0, 0.04, 0.03),
        ("b2", True, 0.30, 0.40, 0.11, 0.05, 0.0, 0.05, 0.03),
        ("b3", True, 0.30, 0.40, 0.11, 0.05, 0.35, 0.04, 0.03),
        ("c1", False, 0.30, 0.40, 0.10, 0.05, 0.0, 0.0, 0.0),
        ("c2", False, 0.28, 0.38, 0.10, 0.05, 0.0, 0.05, 0.03),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q80_fine.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q80_fine.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q80_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q80_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q80] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
