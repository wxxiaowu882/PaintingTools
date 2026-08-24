# -*- coding: utf-8
"""Q27: occiput push + light profile from Q26-z12."""
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
import q20_profile_fit as Q20  # noqa: E402

OUT = C.STAGES / "Q27_occ_push"
BASE = C.CHECKPOINTS / "Q26_z12_best.blend"


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    wn, on = Q20.load_targets()
    grid = [
        ("y1", 0.20, 0.32, 0.10, 0.12),
        ("y2", 0.22, 0.34, 0.11, 0.14),
        ("y3", 0.24, 0.36, 0.12, 0.15),
        ("y4", 0.18, 0.38, 0.10, 0.16),
    ]
    best_sc, best = 1e9, None
    for tag, f, o, m, pst in grid:
        bpy.ops.wm.open_mainfile(filepath=str(BASE))
        for obj in C.mesh_objects(C.objects_in_group("muscle")):
            if "Melns" in obj.name or "pCylinder" in obj.name:
                obj.hide_render = True
        muscles = C.muscle_exportable()
        lat = Q7.make_lattice(muscles, f"b{tag}", 11)
        Q19.deform_balance(lat, f, o, m)
        Q7.apply_lattice(muscles, lat)
        if pst > 0:
            lat2 = Q7.make_lattice(muscles, f"p{tag}", 13)
            Q20.deform_to_targets(lat2, wn, on, pst, 0.04)
            Q7.apply_lattice(muscles, lat2)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_side.png"
        C.set_group_visibility("skull", False)
        Q12.render_side(muscles, png)
        ev = Q16.eval_png(png)
        sc = Q12.score(ev)
        met = ev.get("metrics", {})
        print(f"[Q27] {tag} sc={sc:.3f} pass={ev.get('pass')} hw={met.get('hw_ratio',{}).get('test')} occ={met.get('occiput_ratio',{}).get('test')} pr={met.get('profile_rmse')}")
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q27_occ_push.blend")
            C.write_json(OUT / "self_eval_report.json", ev)
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q27_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        print(f"[Q27] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
