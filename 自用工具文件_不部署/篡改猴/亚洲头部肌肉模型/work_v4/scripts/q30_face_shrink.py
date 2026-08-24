# -*- coding: utf-8
"""Q30: face-only shrink on Q28-p16z to raise occiput_ratio."""
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

OUT = C.STAGES / "Q30_face_shrink"
BASE = C.CHECKPOINTS / "Q28_p16z_best.blend"


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    best_sc, best = 1e9, None
    for face in [0.10, 0.14, 0.18, 0.22]:
        tag = f"f{int(face*100)}"
        bpy.ops.wm.open_mainfile(filepath=str(BASE))
        for o in C.mesh_objects(C.objects_in_group("muscle")):
            if "Melns" in o.name or "pCylinder" in o.name:
                o.hide_render = True
        muscles = C.muscle_exportable()
        lat = Q7.make_lattice(muscles, tag, 11)
        Q19.deform_balance(lat, face, 0.0, 0.06)
        Q7.apply_lattice(muscles, lat)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_side.png"
        C.set_group_visibility("skull", False)
        Q12.render_side(muscles, png)
        ev = Q16.eval_png(png)
        sc = Q12.score(ev)
        m = ev.get("metrics", {})
        print(f"[Q30] {tag} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} occ={m.get('occiput_ratio',{}).get('test')} pr={m.get('profile_rmse')}")
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q30_face_shrink.blend")
            C.write_json(OUT / "self_eval_report.json", ev)
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q30_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        print(f"[Q30] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
