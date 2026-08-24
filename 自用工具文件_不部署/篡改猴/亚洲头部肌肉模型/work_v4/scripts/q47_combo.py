# -*- coding: utf-8
"""Q47: combo — strong profile fit + occ balance + area bulk from best checkpoints."""
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
import q20_profile_fit as Q20  # noqa: E402
import q21_refine as Q21  # noqa: E402
import q37_profile_correct as Q37  # noqa: E402

OUT = C.STAGES / "Q47_combo"
PY = shutil.which("python") or shutil.which("python3") or sys.executable

BASES = [
    ("z10", C.CHECKPOINTS / "Q26_z10_best.blend"),
    ("m3", C.CHECKPOINTS / "Q42_m3_best.blend"),
    ("t3", C.CHECKPOINTS / "Q29_t3_best.blend"),
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


def deform_area_bulk(lat, xy: float, z: float):
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                ly = max(-1.0, min(1.0, co.y * 2.0))
                lz = max(-1.0, min(1.0, co.z * 2.0))
                cranial = Q20.smooth_step((lz + 0.04) / 0.92) * (
                    1.0 - 0.42 * Q20.smooth_step((-lz - 0.22) / 0.50)
                )
                mid = Q20.smooth_step(1.0 - abs(lz - 0.05) / 0.45) * Q20.smooth_step(0.35 + 0.65 * abs(ly))
                wgt = cranial * (0.55 + 0.45 * mid)
                new = co.copy()
                new.x = co.x * (1.0 + xy * wgt)
                new.y = co.y * (1.0 + xy * 0.92 * wgt)
                new.z = co.z * (1.0 + z * wgt)
                p.co_deform = new
    bpy.context.view_layer.update()


def pipeline(muscles, tag, pst, pbulk, face, occ, mid, ab_xy, ab_z, vf, tp, mo, bulk, zc, pf_passes):
    wn, on = Q20.load_targets()
    for i, st in enumerate(pf_passes):
        lat = Q7.make_lattice(muscles, f"pf{tag}{i}", 13)
        Q20.deform_to_targets(lat, wn, on, st, pbulk)
        Q7.apply_lattice(muscles, lat)
    if vf > 0 or tp > 0 or mo > 0 or bulk > 0:
        lat = Q7.make_lattice(muscles, f"pr{tag}", 11)
        Q37.deform_profile_correct(lat, vf, tp, mo, bulk)
        Q7.apply_lattice(muscles, lat)
    if face > 0 or occ > 0 or mid > 0:
        lat = Q7.make_lattice(muscles, f"ba{tag}", 11)
        Q19.deform_balance(lat, face, occ, mid)
        Q7.apply_lattice(muscles, lat)
    if ab_xy > 0 or ab_z > 0:
        lat = Q7.make_lattice(muscles, f"ab{tag}", 11)
        deform_area_bulk(lat, ab_xy, ab_z)
        Q7.apply_lattice(muscles, lat)
    if zc > 0:
        lat = Q7.make_lattice(muscles, f"zc{tag}", 11)
        Q21.hw_trim_lat(lat, zc)
        Q7.apply_lattice(muscles, lat)


def run_base(bname, bpath, row):
    tag, pst, pbulk, face, occ, mid, ab_xy, ab_z, vf, tp, mo, bulk, zc, pf_passes = row
    full = f"{bname}_{tag}"
    if not bpath.exists():
        return None
    bpy.ops.wm.open_mainfile(filepath=str(bpath))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    pipeline(muscles, full, pst, pbulk, face, occ, mid, ab_xy, ab_z, vf, tp, mo, bulk, zc, pf_passes)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{full}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(
        f"[Q47] {full} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} "
        f"occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}"
    )
    return full, ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        # tag, pst, pbulk, face, occ, mid, ab_xy, ab_z, vf, tp, mo, bulk, zc, pf_passes
        ("a1", 0.0, 0.08, 0.14, 0.22, 0.10, 0.16, 0.06, 0.0, 0.0, 0.0, 0.0, 0.04, [0.55, 0.45, 0.35]),
        ("a2", 0.0, 0.10, 0.12, 0.24, 0.12, 0.18, 0.08, 0.0, 0.0, 0.0, 0.0, 0.05, [0.60, 0.50, 0.40]),
        ("a3", 0.0, 0.08, 0.10, 0.20, 0.08, 0.14, 0.05, 0.08, 0.12, 0.10, 0.06, 0.03, [0.50, 0.40, 0.30]),
        ("b1", 0.0, 0.10, 0.16, 0.18, 0.08, 0.20, 0.10, 0.06, 0.10, 0.08, 0.08, 0.04, [0.65, 0.55]),
        ("b2", 0.0, 0.12, 0.14, 0.20, 0.10, 0.22, 0.10, 0.08, 0.14, 0.10, 0.08, 0.05, [0.70, 0.50]),
        ("c1", 0.0, 0.08, 0.12, 0.26, 0.10, 0.15, 0.07, 0.10, 0.16, 0.12, 0.06, 0.04, [0.55, 0.45, 0.35]),
    ]
    best_sc, best = 1e9, None
    for bname, bpath in BASES:
        for row in grid:
            res = run_base(bname, bpath, row)
            if res is None:
                continue
            full, ev, sc, muscles = res
            if ev.get("pass"):
                Q8.force_recolor()
                C.export_glb(C.GLB_FINAL, muscles)
                C.save_blend(C.BLEND_FINAL)
                C.save_blend(C.CHECKPOINTS / "Q47_combo.blend")
                C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q47_combo.blend", "pass": True, "report": ev})
                return
            if sc < best_sc:
                best_sc, best = sc, (full, ev, muscles)
                C.save_blend(C.CHECKPOINTS / f"Q47_{full}_best.blend")
    if best:
        full, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q47_{full}_best.blend", "pass": False, "report": ev})
        print(f"[Q47] best={full} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
