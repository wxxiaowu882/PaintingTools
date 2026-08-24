# -*- coding: utf-8
"""Q33: Q29-t3 + profile 0.10 + hw micro-trim."""
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
import q20_profile_fit as Q20  # noqa: E402
import q21_refine as Q21  # noqa: E402

OUT = C.STAGES / "Q33_final_tune"
BASE = C.CHECKPOINTS / "Q29_t3_best.blend"


def build(muscles, pst, zc):
    wn, on = Q20.load_targets()
    lat = Q7.make_lattice(muscles, "p", 13)
    Q20.deform_to_targets(lat, wn, on, pst, 0.04)
    Q7.apply_lattice(muscles, lat)
    if zc > 0:
        lat2 = Q7.make_lattice(muscles, "z", 11)
        Q21.hw_trim_lat(lat2, zc)
        Q7.apply_lattice(muscles, lat2)


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [(0.10, 0.0), (0.10, 0.04), (0.10, 0.05), (0.10, 0.06), (0.08, 0.04)]
    best_sc, best = 1e9, None
    for i, (pst, zc) in enumerate(grid):
        tag = f"v{i+1}"
        bpy.ops.wm.open_mainfile(filepath=str(BASE))
        for o in C.mesh_objects(C.objects_in_group("muscle")):
            if "Melns" in o.name or "pCylinder" in o.name:
                o.hide_render = True
        muscles = C.muscle_exportable()
        build(muscles, pst, zc)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_side.png"
        C.set_group_visibility("skull", False)
        Q12.render_side(muscles, png)
        ev = Q16.eval_png(png)
        sc = Q12.score(ev)
        m = ev.get("metrics", {})
        print(f"[Q33] {tag} pst={pst} z={zc} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}")
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q33_final_tune.blend")
            C.write_json(OUT / "self_eval_report.json", ev)
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q33_{tag}_best.blend")
    if best:
        tag, ev, muscles = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.save_blend(C.CHECKPOINTS / "Q33_best_internal.blend")
        print(f"[Q33] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
