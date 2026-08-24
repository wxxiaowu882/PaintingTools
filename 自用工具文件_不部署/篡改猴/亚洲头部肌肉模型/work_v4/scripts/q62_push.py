# -*- coding: utf-8
"""Q62: push occ over 8% gate from Q55-f4 + bulk for area."""
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
import q21_refine as Q21  # noqa: E402
import q37_profile_correct as Q37  # noqa: E402

OUT = C.STAGES / "Q62_push"
BASE = C.CHECKPOINTS / "Q55_f4_best.blend"
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


def run(tag, face, zc, bulk):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    if face > 0:
        lat = Q7.make_lattice(muscles, f"f{tag}", 11)
        Q19.deform_balance(lat, face, 0.0, 0.05)
        Q7.apply_lattice(muscles, lat)
    if bulk > 0:
        lat2 = Q7.make_lattice(muscles, f"b{tag}", 11)
        Q37.deform_profile_correct(lat2, 0.0, 0.0, 0.0, bulk)
        Q7.apply_lattice(muscles, lat2)
    if zc > 0:
        lat3 = Q7.make_lattice(muscles, f"z{tag}", 11)
        Q21.hw_trim_lat(lat3, zc)
        Q7.apply_lattice(muscles, lat3)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(
        f"[Q62] {tag} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} "
        f"occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}"
    )
    for n in ev.get("notes", []):
        if "occiput" in n or "area" in n or "profile" in n or "PASS" in n or "FAIL" in str(ev.get("pass")):
            print(f"       {n}")
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("a13", 0.13, 0.02, 0.0),
        ("a14", 0.14, 0.02, 0.0),
        ("a15", 0.15, 0.02, 0.0),
        ("b12", 0.12, 0.02, 0.08),
        ("b13", 0.13, 0.02, 0.08),
        ("b14", 0.14, 0.02, 0.10),
        ("c13", 0.13, 0.03, 0.06),
        ("c14", 0.14, 0.03, 0.08),
    ]
    best_sc, best = 1e9, None
    for tag, face, zc, bulk in grid:
        ev, sc, muscles = run(tag, face, zc, bulk)
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q62_push.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q62_push.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q62_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q62_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q62] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
