# -*- coding: utf-8
"""Q53: micro profile on Q50-f22z5 (best occ~0.899)."""
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
import q20_profile_fit as Q20  # noqa: E402
import q37_profile_correct as Q37  # noqa: E402

OUT = C.STAGES / "Q53_micro"
BASE = C.CHECKPOINTS / "Q50_f22z5_best.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


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
    return json.loads(t[i:j]) if i >= 0 else {"pass": False}


def run(tag, mode, args):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    if mode == "q37":
        vf, tp, mo, bulk = args
        lat = Q7.make_lattice(muscles, tag, 11)
        Q37.deform_profile_correct(lat, vf, tp, mo, bulk)
        Q7.apply_lattice(muscles, lat)
    elif mode == "q20":
        st, bulk = args
        wn, on = Q20.load_targets()
        lat = Q7.make_lattice(muscles, tag, 13)
        Q20.deform_to_targets(lat, wn, on, st, bulk)
        Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(
        f"[Q53] {tag} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} "
        f"occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("p1", "q37", (0.04, 0.12, 0.06, 0.04)),
        ("p2", "q37", (0.06, 0.14, 0.08, 0.05)),
        ("p3", "q37", (0.05, 0.16, 0.06, 0.04)),
        ("g1", "q20", (0.08, 0.04)),
        ("g2", "q20", (0.10, 0.05)),
        ("g3", "q20", (0.12, 0.05)),
    ]
    best_sc, best = 1e9, None
    for tag, mode, args in grid:
        ev, sc, muscles = run(tag, mode, args)
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q53_micro.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q53_micro.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q53_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q53_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q53] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
