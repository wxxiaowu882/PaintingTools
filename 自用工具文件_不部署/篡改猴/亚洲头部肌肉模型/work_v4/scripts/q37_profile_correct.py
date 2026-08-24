# -*- coding: utf-8
"""
Q37: targeted profile fix — vault forward (15–60% rows), lower tail pull (75–90%).
From Q33-v1 best internal checkpoint.
"""
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
import q16_profile_shape as Q16  # noqa: E402
import q21_refine as Q21  # noqa: E402

OUT = C.STAGES / "Q37_profile_correct"
BASE = C.CHECKPOINTS / "Q33_v1_best.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def deform_profile_correct(lat, vault_fwd: float, tail_pull: float, mid_occ: float, bulk: float):
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
                cranial = smooth_step((lz + 0.05) / 0.90) * (1.0 - 0.38 * smooth_step((-lz - 0.26) / 0.48))

                # vault/forehead forward — fix shallow 15–60% rows
                vault = smooth_step((lz - 0.05) / 0.55) * smooth_step((-ly - 0.02) / 0.50) * cranial
                mid_face = smooth_step((-ly - 0.02) / 0.45) * smooth_step(1.0 - abs(lz - 0.15) / 0.35) * cranial

                # mid occiput bulge — back half balance
                occ = smooth_step((ly + 0.02) / 0.48) * smooth_step((lz - 0.0) / 0.42) * smooth_step((0.35 - lz) / 0.35) * cranial

                # lower tail pull forward — fix 75–90% too deep
                tail = smooth_step((ly + 0.05) / 0.50) * smooth_step((-lz - 0.05) / 0.38) * cranial
                neck = smooth_step((-lz - 0.28) / 0.45)

                y_mul = 1.0 + vault_fwd * (vault + 0.65 * mid_face) + mid_occ * occ - tail_pull * tail - 0.15 * tail_pull * neck
                new = co.copy()
                new.y = co.y * max(0.64, y_mul)
                roundness = smooth_step(1.0 - abs(lz - 0.12) / 0.40) * cranial
                new.x = co.x * (1.0 + bulk * roundness)
                new.z = co.z * (1.0 + bulk * 0.35 * roundness)
                p.co_deform = new
    bpy.context.view_layer.update()


def eval_png(png: Path) -> dict:
    proc = __import__("subprocess").run(
        [PY, str(SCRIPTS / "base15_proportion_eval.py"), str(png)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    t = proc.stdout
    i, j = t.find("{"), t.rfind("}") + 1
    return json.loads(t[i:j]) if i >= 0 else {"pass": False}


def run(tag, vf, tp, mo, bulk, zc=0.0):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    lat = Q7.make_lattice(muscles, tag, 11)
    deform_profile_correct(lat, vf, tp, mo, bulk)
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
    print(f"[Q37] {tag} sc={sc:.3f} pass={ev.get('pass')} hw={m.get('hw_ratio',{}).get('test')} occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}")
    return ev, muscles, sc


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("g1", 0.14, 0.30, 0.14, 0.08, 0.04),
        ("g2", 0.16, 0.34, 0.16, 0.09, 0.04),
        ("g3", 0.18, 0.36, 0.16, 0.10, 0.05),
        ("g4", 0.16, 0.38, 0.18, 0.08, 0.05),
        ("g5", 0.20, 0.32, 0.18, 0.10, 0.04),
        ("g6", 0.18, 0.40, 0.20, 0.09, 0.05),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, muscles, sc = run(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q37_profile_correct.blend")
            C.write_json(OUT / "self_eval_report.json", ev)
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q37_profile_correct.blend", "report": ev, "pass": True})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q37_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {
            "checkpoint": f"Q37_{tag}_best.blend",
            "report": ev,
            "pass": False,
        })
        print(f"[Q37] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
