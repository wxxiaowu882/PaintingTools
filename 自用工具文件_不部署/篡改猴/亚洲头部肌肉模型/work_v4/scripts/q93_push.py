# -*- coding: utf-8
"""Q93: profile push via face_shr + upper-depth trim, then light occ."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import mesh_outer as MO  # noqa: E402
import q4_regional as Q4  # noqa: E402
import q12_hw_match as Q12  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402
import q19_back_balance as Q19  # noqa: E402
import q75_mesh as Q75  # noqa: E402
import q84_aggressive as Q84  # noqa: E402

OUT = C.STAGES / "Q93_push"
BASE = C.CHECKPOINTS / "Q57_p1_best.blend"
REF = C.ROOT / "Base15_侧.png"


def shrink_face(muscles, amount: float, h0=0.04, h1=0.34):
    _, center, rx, ry, rz = MO._ref_bbox(muscles)
    for obj in muscles:
        mw = MO.mesh_weight(obj.name, 1.0, 0.35)
        if mw <= 0:
            continue
        me = obj.data
        inv = obj.matrix_world.inverted()
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            ly = max(-1.0, min(1.0, (w.y - center.y) / ry))
            lz = max(-1.0, min(1.0, (w.z - center.z) / rz))
            h = (lz + 1.0) * 0.5
            if ly > 0.08:
                continue
            band = Q75.smooth_step((h - h0) / 0.05) * Q75.smooth_step((h1 - h) / 0.06)
            front = Q75.smooth_step((-ly + 0.02) / 0.40)
            k = -abs(amount) * band * front * mw
            if abs(k) < 0.002:
                continue
            w2 = w.copy()
            w2.y = center.y + (w.y - center.y) * (1.0 + k)
            v.co = inv @ w2
        me.update()


def trim_upper_depth(muscles, amount: float):
    """Shrink both front+back in upper cranial half — reduces depth scale."""
    _, center, rx, ry, rz = MO._ref_bbox(muscles)
    for obj in muscles:
        mw = MO.mesh_weight(obj.name, 1.0, 0.40)
        if mw <= 0:
            continue
        me = obj.data
        inv = obj.matrix_world.inverted()
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            ly = max(-1.0, min(1.0, (w.y - center.y) / ry))
            lz = max(-1.0, min(1.0, (w.z - center.z) / rz))
            h = (lz + 1.0) * 0.5
            # upper 55%
            up = Q75.smooth_step((0.58 - h) / 0.10) * Q75.smooth_step((h - 0.02) / 0.06)
            if up < 0.02:
                continue
            k = -abs(amount) * up * mw
            w2 = w.copy()
            w2.y = center.y + (w.y - center.y) * (1.0 + k)
            v.co = inv @ w2
        me.update()


def run_variant(tag, flat, q20, oy, ox, fy, h0, h1, face_shr, upper_trim, occ_b, face_bal, passes):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()

    # a2-like base stack
    if flat > 0:
        lat = Q7.make_lattice(muscles, f"f{tag}", 13)
        Q4.deform_region(lat, "occiput_neck", widen=-0.06 * flat, flatten=0.12 * flat, dz=0.0)
        Q7.apply_lattice(muscles, lat)
    if q20 > 0:
        Q84.static_q20(muscles, q20, 0.04)
    Q84.nudge_static_full(muscles, oy, ox, fy, h0, h1)
    MO.nudge_outer(muscles, oy * 0.55, ox * 0.55, fy * 0.55, 0.04, 1.0, 0.40, h0, h1, 0.10)

    if face_shr > 0:
        shrink_face(muscles, face_shr)
    if upper_trim > 0:
        trim_upper_depth(muscles, upper_trim)
    if face_bal > 0 or occ_b > 0:
        lat2 = Q7.make_lattice(muscles, f"b{tag}", 11)
        Q19.deform_balance(lat2, face_bal, occ_b, 0.03)
        Q7.apply_lattice(muscles, lat2)

    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = Q84.eval_png(png)
    best_ev, best_sc = ev, Q12.score(ev)
    best_pr = float(best_ev.get("metrics", {}).get("profile_rmse", 1.0))

    for pi in range(passes):
        if best_ev.get("pass"):
            break
        pr = float(best_ev.get("metrics", {}).get("profile_rmse", 1.0))
        if pr <= 0.055:
            break
        st = 0.14 + 0.02 * min(pi, 8)
        deltas = MO.measure_row_delta(REF, png)
        # ORIGINAL polarity adaptive (positive d => shrink) — probe confirmed
        MO.nudge_adaptive(muscles, deltas, st, 1.0, 0.40, 0.08)
        if pi % 3 == 2 and face_shr > 0:
            shrink_face(muscles, face_shr * 0.25)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_p{pi+1}_side.png"
        Q12.render_side(muscles, png)
        ev = Q84.eval_png(png)
        sc = Q12.score(ev)
        pr_now = float(ev.get("metrics", {}).get("profile_rmse", 1.0))
        if sc <= best_sc or (pr_now + 0.003 < best_pr and sc < best_sc + 0.10):
            best_sc, best_ev, best_pr = sc, ev, pr_now

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    m = best_ev.get("metrics", {})
    print(
        f"[Q93] {tag} sc={best_sc:.3f} pass={best_ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return best_ev, best_sc, muscles


def deliver(tag, ev, muscles):
    Q8.force_recolor()
    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.BLEND_FINAL)
    C.save_blend(C.CHECKPOINTS / "Q93_PASS.blend")
    C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q93_PASS.blend", "pass": True, "report": ev, "tag": tag})


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    # a2-like + face_shr / upper_trim / light occ
    grid = [
        # tag, flat, q20, oy, ox, fy, h0, h1, face_shr, upper_trim, occ_b, face_bal, passes
        ("p1", 1.5, 0.08, 0.28, 0.42, 0.11, 0.62, 0.84, 0.12, 0.00, 0.02, 0.03, 14),
        ("p2", 1.5, 0.08, 0.28, 0.42, 0.11, 0.62, 0.84, 0.18, 0.00, 0.02, 0.03, 14),
        ("p3", 1.5, 0.08, 0.26, 0.40, 0.10, 0.62, 0.84, 0.22, 0.06, 0.03, 0.04, 16),
        ("p4", 1.5, 0.08, 0.28, 0.42, 0.11, 0.62, 0.84, 0.16, 0.10, 0.04, 0.05, 16),
        ("p5", 1.5, 0.10, 0.30, 0.44, 0.11, 0.60, 0.82, 0.20, 0.08, 0.05, 0.06, 16),
        ("p6", 1.5, 0.08, 0.28, 0.42, 0.11, 0.62, 0.84, 0.28, 0.12, 0.03, 0.04, 18),
        ("p7", 1.2, 0.08, 0.26, 0.40, 0.10, 0.64, 0.84, 0.24, 0.10, 0.06, 0.07, 16),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run_variant(tag, *row[1:])
        C.write_json(OUT / f"{tag}_report.json", ev)
        if ev.get("pass"):
            deliver(tag, ev, muscles)
            print(f"[Q93] *** PASS {tag} ***")
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q93_{tag}_best.blend")
    if best:
        tag, ev, muscles = best
        C.save_blend(C.CHECKPOINTS / "Q93_best.blend")
        m = ev.get("metrics", {})
        gates = sum(1 for k in ("hw_ratio", "vault_ratio", "occiput_ratio", "area_ratio") if m.get(k, {}).get("pass"))
        C.write_json(
            C.STAGES / "BEST_INTERNAL.json",
            {"checkpoint": "Q93_best.blend", "pass": False, "report": ev, "tag": tag, "gates": f"{gates}/4"},
        )
        print(
            f"[Q93] best={tag} sc={best_sc:.3f} pr={m.get('profile_rmse')} "
            f"occ={m.get('occiput_ratio', {}).get('test')} gates={gates}/4"
        )


if __name__ == "__main__":
    main()
