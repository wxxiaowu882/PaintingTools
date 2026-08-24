# -*- coding: utf-8
"""Q44: tail/vault micro on Q42-m3."""
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
import q37_profile_correct as Q37  # noqa: E402

OUT = C.STAGES / "Q44_tail"
BASE = C.CHECKPOINTS / "Q42_m3_best.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def eval_png(png):
    import subprocess
    proc = subprocess.run([PY, str(SCRIPTS / "base15_proportion_eval.py"), str(png)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    t = proc.stdout
    return json.loads(t[t.find("{"): t.rfind("}") + 1])


def run(tag, vf, tp, mo, bulk):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    lat = Q7.make_lattice(muscles, tag, 11)
    Q37.deform_profile_correct(lat, vf, tp, mo, bulk)
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = __import__("q12_hw_match", fromlist=["Q12"]).score(ev)
    print(f"[Q44] {tag} sc={sc:.3f} hw={ev['metrics']['hw_ratio']['test']} occ={ev['metrics']['occiput_ratio']['test']} pr={ev['metrics']['profile_rmse']}")
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    best_sc, best = 1e9, None
    for tag, p in [("a1", (0.04, 0.12, 0.02, 0.06)), ("a2", (0.06, 0.08, 0.02, 0.06)), ("a3", (0.03, 0.14, 0.04, 0.07)), ("a4", (0.05, 0.10, 0.04, 0.08))]:
        ev, sc, muscles = run(tag, *p)
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q44_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        if best_sc < 1.135:
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q44_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q44] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
