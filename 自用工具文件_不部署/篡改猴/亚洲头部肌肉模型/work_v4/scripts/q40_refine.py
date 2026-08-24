# -*- coding: utf-8
"""Q40: micro-refine from Q37-g1 — bulk up + light second profile pass."""
from __future__ import annotations

import json
import shutil
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
import q37_profile_correct as Q37  # noqa: E402

OUT = C.STAGES / "Q40_refine"
BASE = C.CHECKPOINTS / "Q37_g1_best.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def eval_png(png):
    import subprocess
    proc = subprocess.run([PY, str(SCRIPTS / "base15_proportion_eval.py"), str(png)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    t = proc.stdout
    i, j = t.find("{"), t.rfind("}") + 1
    return json.loads(t[i:j])


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("r1", 0.06, 0.0, 0.0, 0.12, 0.0),   # bulk only
        ("r2", 0.04, 0.08, 0.04, 0.10, 0.0), # 2nd light profile
        ("r3", 0.05, 0.10, 0.06, 0.11, 0.0),
        ("r4", 0.06, 0.0, 0.0, 0.12, 0.06),  # bulk + face shrink
        ("r5", 0.04, 0.06, 0.08, 0.10, 0.05),
    ]
    best_sc, best = 1e9, None
    for tag, vf, tp, mo, bulk, face in grid:
        bpy.ops.wm.open_mainfile(filepath=str(BASE))
        for o in C.mesh_objects(C.objects_in_group("muscle")):
            if "Melns" in o.name or "pCylinder" in o.name:
                o.hide_render = True
        muscles = C.muscle_exportable()
        lat = Q7.make_lattice(muscles, f"p{tag}", 11)
        Q37.deform_profile_correct(lat, vf, tp, mo, bulk)
        Q7.apply_lattice(muscles, lat)
        if face > 0:
            lat2 = Q7.make_lattice(muscles, f"f{tag}", 11)
            Q19.deform_balance(lat2, face, 0.08, 0.05)
            Q7.apply_lattice(muscles, lat2)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_side.png"
        C.set_group_visibility("skull", False)
        Q12.render_side(muscles, png)
        ev = eval_png(png)
        sc = Q12.score(ev)
        m = ev.get("metrics", {})
        print(f"[Q40] {tag} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}")
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q40_refine.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q40_refine.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q40_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q40_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q40] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
