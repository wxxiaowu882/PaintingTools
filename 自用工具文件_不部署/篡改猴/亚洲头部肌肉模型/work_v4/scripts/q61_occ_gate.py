# -*- coding: utf-8
"""Q61: minimal face shrink on Q55-f4 / Q57-p1 to pass occ gate."""
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

OUT = C.STAGES / "Q61_occ_gate"
PY = shutil.which("python") or shutil.which("python3") or sys.executable

BASES = [
    ("f4", C.CHECKPOINTS / "Q55_f4_best.blend"),
    ("p1", C.CHECKPOINTS / "Q57_p1_best.blend"),
    ("f8", C.CHECKPOINTS / "Q60_a_f8z2_best.blend"),
]


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


def run(bp, base, tag, face, zc):
    if not base.exists():
        return None
    bpy.ops.wm.open_mainfile(filepath=str(base))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    if face > 0:
        lat = Q7.make_lattice(muscles, f"ba{tag}", 11)
        Q19.deform_balance(lat, face, 0.0, 0.05)
        Q7.apply_lattice(muscles, lat)
    if zc > 0:
        lat2 = Q7.make_lattice(muscles, f"zc{tag}", 11)
        Q21.hw_trim_lat(lat2, zc)
        Q7.apply_lattice(muscles, lat2)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{bp}_{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    ok = ev.get("pass")
    print(
        f"[Q61] {bp}_{tag} sc={sc:.3f} pass={ok} hw={m.get('hw_ratio',{}).get('test')} "
        f"occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}"
    )
    for n in ev.get("notes", []):
        print(f"       {n}")
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("m2", 0.02, 0.0),
        ("m3", 0.03, 0.0),
        ("m4", 0.04, 0.0),
        ("f10z2", 0.10, 0.02),
        ("f12z2", 0.12, 0.02),
        ("f14z3", 0.14, 0.03),
        ("f16z3", 0.16, 0.03),
        ("f12z4", 0.12, 0.04),
    ]
    best_sc, best = 1e9, None
    for bp, base in BASES:
        for tag, face, zc in grid:
            res = run(bp, base, tag, face, zc)
            if res is None:
                continue
            ev, sc, muscles = res
            if ev.get("pass"):
                Q8.force_recolor()
                C.export_glb(C.GLB_FINAL, muscles)
                C.save_blend(C.BLEND_FINAL)
                C.save_blend(C.CHECKPOINTS / "Q61_occ_gate.blend")
                C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q61_occ_gate.blend", "pass": True, "report": ev})
                return
            if sc < best_sc:
                best_sc, best = sc, (f"{bp}_{tag}", ev, muscles)
                C.save_blend(C.CHECKPOINTS / f"Q61_{bp}_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q61_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q61] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
