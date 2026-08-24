# -*- coding: utf-8
"""Q34: aggressive face shrink from Q33-v1 (occ~0.891)."""
from __future__ import annotations

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
import q16_profile_shape as Q16  # noqa: E402
import q19_back_balance as Q19  # noqa: E402
import q21_refine as Q21  # noqa: E402

OUT = C.STAGES / "Q34_aggressive"
BASE = C.CHECKPOINTS / "Q33_v1_best.blend"


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [(0.24, 0.06), (0.28, 0.07), (0.32, 0.08), (0.26, 0.05)]
    best_sc, best = 1e9, None
    for i, (face, zc) in enumerate(grid):
        tag = f"a{i+1}"
        bpy.ops.wm.open_mainfile(filepath=str(BASE))
        for o in C.mesh_objects(C.objects_in_group("muscle")):
            if "Melns" in o.name or "pCylinder" in o.name:
                o.hide_render = True
        muscles = C.muscle_exportable()
        lat = Q7.make_lattice(muscles, f"f{tag}", 11)
        Q19.deform_balance(lat, face, 0.0, 0.08)
        Q7.apply_lattice(muscles, lat)
        if zc:
            lat2 = Q7.make_lattice(muscles, f"z{tag}", 11)
            Q21.hw_trim_lat(lat2, zc)
            Q7.apply_lattice(muscles, lat2)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_side.png"
        C.set_group_visibility("skull", False)
        Q12.render_side(muscles, png)
        ev = Q16.eval_png(png)
        sc = Q12.score(ev)
        m = ev.get("metrics", {})
        print(f"[Q34] {tag} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} occ={m.get('occiput_ratio',{}).get('test')} pr={m.get('profile_rmse')}")
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q34_aggressive.blend")
            C.write_json(OUT / "self_eval_report.json", ev)
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q34_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        print(f"[Q34] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
