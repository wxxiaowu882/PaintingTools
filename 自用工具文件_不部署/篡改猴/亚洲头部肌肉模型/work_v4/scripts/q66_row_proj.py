# -*- coding: utf-8
"""Q66: ultra-light row-profile projection passes on Q57-p1 / Q65 best."""
from __future__ import annotations

import json
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
import q21_refine as Q21  # noqa: E402

OUT = C.STAGES / "Q66_row_proj"
BASES = [
    ("p1", C.CHECKPOINTS / "Q57_p1_best.blend"),
]
PY = __import__("shutil").which("python") or sys.executable


def eval_png(png):
    import subprocess
    proc = subprocess.run([PY, str(SCRIPTS / "base15_proportion_eval.py"), str(png)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    t = proc.stdout
    i, j = t.find("{"), t.rfind("}") + 1
    return json.loads(t[i:j])


def apply_passes(muscles, tag, strengths, bulk, zc):
    wn, on = Q20.load_targets()
    for i, st in enumerate(strengths):
        lat = Q7.make_lattice(muscles, f"{tag}{i}", 13)
        Q20.deform_to_targets(lat, wn, on, st, bulk)
        Q7.apply_lattice(muscles, lat)
    if zc > 0:
        lat = Q7.make_lattice(muscles, f"z{tag}", 11)
        Q21.hw_trim_lat(lat, zc)
        Q7.apply_lattice(muscles, lat)


def run(bp, base, tag, strengths, bulk, zc):
    if not base.exists():
        return None
    bpy.ops.wm.open_mainfile(filepath=str(base))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    apply_passes(muscles, tag, strengths, bulk, zc)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{bp}_{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(f"[Q66] {bp}_{tag} sc={sc:.3f} pass={ev.get('pass')} occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}")
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grids = [
        ("t1", [0.03, 0.03, 0.03], 0.03, 0.03),
        ("t2", [0.04, 0.03, 0.02], 0.03, 0.04),
        ("t3", [0.05, 0.04, 0.03], 0.04, 0.04),
        ("t4", [0.06, 0.04], 0.04, 0.05),
    ]
    best_sc, best = 1e9, None
    for bp, base in BASES:
        for tag, strengths, bulk, zc in grids:
            res = run(bp, base, tag, strengths, bulk, zc)
            if res is None:
                continue
            ev, sc, muscles = res
            if ev.get("pass"):
                Q8.force_recolor()
                C.export_glb(C.GLB_FINAL, muscles)
                C.save_blend(C.BLEND_FINAL)
                C.save_blend(C.CHECKPOINTS / "Q66_row_proj.blend")
                C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q66_row_proj.blend", "pass": True, "report": ev})
                return
            if sc < best_sc:
                best_sc, best = sc, (f"{bp}_{tag}", ev, muscles)
                C.save_blend(C.CHECKPOINTS / f"Q66_{bp}_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q66_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q66] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
