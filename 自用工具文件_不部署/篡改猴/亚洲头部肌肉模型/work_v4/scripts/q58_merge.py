# -*- coding: utf-8
"""Q58: merge Q57-p1 profile + face shrink; or p1 on f16z4 base."""
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

OUT = C.STAGES / "Q58_merge"
PY = shutil.which("python") or shutil.which("python3") or sys.executable

P1 = (0.0, 0.20, 0.14, 0.06)


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


def apply_p1(muscles, tag):
    lat = Q7.make_lattice(muscles, f"p1{tag}", 11)
    Q37.deform_profile_correct(lat, *P1)
    Q7.apply_lattice(muscles, lat)


def run_from(base: Path, tag: str, face: float, zc: float, second_p1: bool):
    bpy.ops.wm.open_mainfile(filepath=str(base))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    if second_p1:
        apply_p1(muscles, tag)
    if face > 0:
        lat = Q7.make_lattice(muscles, f"f{tag}", 11)
        Q19.deform_balance(lat, face, 0.0, 0.05)
        Q7.apply_lattice(muscles, lat)
    if zc > 0:
        lat2 = Q7.make_lattice(muscles, f"z{tag}", 11)
        Q21.hw_trim_lat(lat2, zc)
        Q7.apply_lattice(muscles, lat2)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(
        f"[Q58] {tag} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} "
        f"occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    bases = [
        ("a", C.CHECKPOINTS / "Q57_p1_best.blend"),
        ("b", C.CHECKPOINTS / "Q57_f16z4_best.blend"),
        ("c", C.CHECKPOINTS / "Q57_f10z3_best.blend"),
    ]
    grid = [
        (0.06, 0.02, False),
        (0.08, 0.02, False),
        (0.10, 0.03, False),
        (0.12, 0.03, False),
        (0.08, 0.02, True),
        (0.10, 0.03, True),
    ]
    best_sc, best = 1e9, None
    for bp, base in bases:
        if not base.exists():
            continue
        for face, zc, sp1 in grid:
            tag = f"{bp}f{int(face*100)}z{int(zc*100)}{'p' if sp1 else ''}"
            ev, sc, muscles = run_from(base, tag, face, zc, sp1)
            if ev.get("pass"):
                Q8.force_recolor()
                C.export_glb(C.GLB_FINAL, muscles)
                C.save_blend(C.BLEND_FINAL)
                C.save_blend(C.CHECKPOINTS / "Q58_merge.blend")
                C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q58_merge.blend", "pass": True, "report": ev})
                return
            if sc < best_sc:
                best_sc, best = sc, (tag, ev, muscles)
                C.save_blend(C.CHECKPOINTS / f"Q58_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q58_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q58] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
