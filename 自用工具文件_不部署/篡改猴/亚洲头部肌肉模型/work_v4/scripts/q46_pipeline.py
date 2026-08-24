# -*- coding: utf-8
"""Q46: full pipeline Q29-t3 + strong Q37 + light occ balance."""
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
import q19_back_balance as Q19  # noqa: E402
import q37_profile_correct as Q37  # noqa: E402
import q21_refine as Q21  # noqa: E402

OUT = C.STAGES / "Q46_pipeline"
BASE = C.CHECKPOINTS / "Q29_t3_best.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def eval_png(png):
    import subprocess
    proc = subprocess.run([PY, str(SCRIPTS / "base15_proportion_eval.py"), str(png)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    t = proc.stdout
    return json.loads(t[t.find("{"): t.rfind("}") + 1])


def pipeline(muscles, tag, vf, tp, mo, bulk, face, occ, zc):
    lat = Q7.make_lattice(muscles, f"pr{tag}", 11)
    Q37.deform_profile_correct(lat, vf, tp, mo, bulk)
    Q7.apply_lattice(muscles, lat)
    if face or occ:
        lat2 = Q7.make_lattice(muscles, f"ba{tag}", 11)
        Q19.deform_balance(lat2, face, occ, 0.06)
        Q7.apply_lattice(muscles, lat2)
    if zc > 0:
        lat3 = Q7.make_lattice(muscles, f"z{tag}", 11)
        Q21.hw_trim_lat(lat3, zc)
        Q7.apply_lattice(muscles, lat3)


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("x1", 0.14, 0.32, 0.14, 0.09, 0.08, 0.10, 0.03),
        ("x2", 0.16, 0.36, 0.16, 0.10, 0.10, 0.12, 0.04),
        ("x3", 0.14, 0.34, 0.16, 0.10, 0.06, 0.14, 0.03),
        ("x4", 0.12, 0.30, 0.12, 0.09, 0.10, 0.10, 0.02),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        bpy.ops.wm.open_mainfile(filepath=str(BASE))
        for o in C.mesh_objects(C.objects_in_group("muscle")):
            if "Melns" in o.name or "pCylinder" in o.name:
                o.hide_render = True
        muscles = C.muscle_exportable()
        pipeline(muscles, tag, *row[1:])
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_side.png"
        C.set_group_visibility("skull", False)
        Q12.render_side(muscles, png)
        ev = eval_png(png)
        sc = Q12.score(ev)
        m = ev.get("metrics", {})
        print(f"[Q46] {tag} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}")
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q46_pipeline.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q46_pipeline.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q46_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q46_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q46] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
