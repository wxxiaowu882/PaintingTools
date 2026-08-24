# -*- coding: utf-8
"""Q67: rebuild Q29-t3 -> Q56-t2 -> Q57-p1 pipeline + occ micro-tune."""
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
import q19_back_balance as Q19  # noqa: E402
import q20_profile_fit as Q20  # noqa: E402
import q21_refine as Q21  # noqa: E402
import q37_profile_correct as Q37  # noqa: E402

OUT = C.STAGES / "Q67_pipeline"
BASE = C.CHECKPOINTS / "Q29_t3_best.blend"
PY = __import__("shutil").which("python") or sys.executable


def eval_png(png):
    import subprocess
    proc = subprocess.run([PY, str(SCRIPTS / "base15_proportion_eval.py"), str(png)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    t = proc.stdout
    i, j = t.find("{"), t.rfind("}") + 1
    return json.loads(t[i:j])


def build_base(muscles):
    wn, on = Q20.load_targets()
    for i, st in enumerate([0.05, 0.05, 0.05]):
        lat = Q7.make_lattice(muscles, f"q56_{i}", 13)
        Q20.deform_to_targets(lat, wn, on, st, 0.04)
        Q7.apply_lattice(muscles, lat)
    lat = Q7.make_lattice(muscles, "q56z", 11)
    Q21.hw_trim_lat(lat, 0.05)
    Q7.apply_lattice(muscles, lat)
    lat2 = Q7.make_lattice(muscles, "q57p1", 11)
    Q37.deform_profile_correct(lat2, 0.0, 0.20, 0.14, 0.06)
    Q7.apply_lattice(muscles, lat2)


def run(tag, face, zc):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    build_base(muscles)
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
    print(f"[Q67] {tag} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}")
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    best_sc, best = 1e9, None
    for face, zc in [(0.0, 0.0), (0.06, 0.02), (0.08, 0.02), (0.08, 0.03), (0.10, 0.03), (0.10, 0.04), (0.12, 0.03)]:
        tag = f"f{int(face*100)}z{int(zc*100)}"
        ev, sc, muscles = run(tag, face, zc)
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q67_pipeline.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q67_pipeline.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q67_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q67_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q67] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
