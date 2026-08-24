# -*- coding: utf-8
"""Q51: occiput push via mo/occ + profile row fix from Q29-t3."""
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

OUT = C.STAGES / "Q51_occ_push"
BASE = C.CHECKPOINTS / "Q29_t3_best.blend"
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


def run(tag, vf, tp, mo, bulk, face, occ, mid, zc):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    lat = Q7.make_lattice(muscles, f"pr{tag}", 11)
    Q37.deform_profile_correct(lat, vf, tp, mo, bulk)
    Q7.apply_lattice(muscles, lat)
    if face or occ or mid:
        lat2 = Q7.make_lattice(muscles, f"ba{tag}", 11)
        Q19.deform_balance(lat2, face, occ, mid)
        Q7.apply_lattice(muscles, lat2)
    if zc > 0:
        lat3 = Q7.make_lattice(muscles, f"zc{tag}", 11)
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
        f"[Q51] {tag} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} "
        f"occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        # higher mid_occ in Q37
        ("m1", 0.12, 0.28, 0.18, 0.08, 0.0, 0.0, 0.0, 0.0),
        ("m2", 0.12, 0.28, 0.22, 0.08, 0.0, 0.0, 0.0, 0.0),
        ("m3", 0.10, 0.32, 0.20, 0.08, 0.0, 0.0, 0.0, 0.0),
        ("m4", 0.08, 0.34, 0.22, 0.08, 0.0, 0.0, 0.0, 0.0),
        # p3 + occ boost (no face shrink)
        ("o1", 0.12, 0.28, 0.12, 0.08, 0.0, 0.12, 0.08, 0.0),
        ("o2", 0.12, 0.28, 0.12, 0.08, 0.0, 0.16, 0.10, 0.0),
        ("o3", 0.12, 0.28, 0.12, 0.08, 0.0, 0.20, 0.10, 0.04),
        # combo: less vault + more tail + occ
        ("c1", 0.08, 0.32, 0.18, 0.08, 0.10, 0.10, 0.08, 0.04),
        ("c2", 0.06, 0.34, 0.20, 0.08, 0.12, 0.08, 0.08, 0.05),
        ("c3", 0.10, 0.30, 0.20, 0.09, 0.08, 0.14, 0.08, 0.03),
        ("c4", 0.08, 0.32, 0.22, 0.08, 0.06, 0.16, 0.10, 0.04),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q51_occ_push.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q51_occ_push.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q51_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q51_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q51] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
