# -*- coding: utf-8
"""Q91: profile-first zone correction from a2-like base, then light occ."""
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

OUT = C.STAGES / "Q91_profile_zone"
BASE = C.CHECKPOINTS / "Q57_p1_best.blend"
REF = C.ROOT / "Base15_侧.png"


def denser_deltas(test_png: Path):
    """15-point table is enough for adaptive; reuse measure_row_delta."""
    return MO.measure_row_delta(REF, test_png)


def zone_correct(muscles, mid_pull: float, neck_push: float, face_pull: float):
    """Explicit fixes for known RMSE hotspots.
    mid_pull: h~0.65-0.78 back too deep -> shrink Y on back
    neck_push: h~0.86-0.97 too forward -> expand Y on back
    face_pull: h~0.05-0.25 face too deep -> expand Y on front
    """
    _, center, rx, ry, rz = MO._ref_bbox(muscles)
    static = C.get_obj("muscle", "Static")
    targets = [static] if static else []
    # also light Deform outer
    for o in muscles:
        if o is static:
            continue
        if "deform" in o.name.lower():
            targets.append(o)
    for obj in targets:
        if not obj:
            continue
        mw = 1.0 if "static" in obj.name.lower() else 0.35
        me = obj.data
        inv = obj.matrix_world.inverted()
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            lx = max(-1.0, min(1.0, (w.x - center.x) / rx))
            ly = max(-1.0, min(1.0, (w.y - center.y) / ry))
            lz = max(-1.0, min(1.0, (w.z - center.z) / rz))
            h = (lz + 1.0) * 0.5
            outer = Q75.smooth_step((abs(lx) - 0.05) / 0.45)
            back = Q75.smooth_step((ly - 0.02) / 0.40) if ly > 0 else 0.0
            front = Q75.smooth_step((-ly - 0.02) / 0.40) if ly < 0 else 0.0
            mid = (
                outer
                * back
                * Q75.smooth_step((h - 0.62) / 0.05)
                * Q75.smooth_step((0.80 - h) / 0.06)
            )
            neck = (
                outer
                * back
                * Q75.smooth_step((h - 0.86) / 0.04)
                * Q75.smooth_step((0.98 - h) / 0.04)
            )
            face = (
                outer
                * front
                * Q75.smooth_step((h - 0.04) / 0.06)
                * Q75.smooth_step((0.30 - h) / 0.10)
            )
            if mid < 0.02 and neck < 0.02 and face < 0.02:
                continue
            w2 = w.copy()
            if mid > 0.02 and mid_pull > 0:
                w2.y = center.y + (w.y - center.y) * (1.0 - mid_pull * mid * mw)
            if neck > 0.02 and neck_push > 0:
                w2.y = center.y + (w.y - center.y) * (1.0 + neck_push * neck * mw)
            if face > 0.02 and face_pull > 0 and ly < 0:
                w2.y = center.y + (w.y - center.y) * (1.0 + face_pull * face * mw)
            v.co = inv @ w2
        me.update()


def full_adaptive(muscles, deltas, strength: float):
    """Adaptive with almost no shell gate — full Static silhouette."""
    MO.nudge_adaptive(muscles, deltas, strength, static_w=1.0, deform_w=0.45, shell_x=-0.15)


def run_variant(tag, flat, q20_st, oy, ox, fy, h0, h1, face, occ_b, mid, neck, face_z, passes):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()

    if flat > 0:
        lat = Q7.make_lattice(muscles, f"f{tag}", 13)
        Q4.deform_region(lat, "occiput_neck", widen=-0.06 * flat, flatten=0.12 * flat, dz=0.0)
        Q7.apply_lattice(muscles, lat)
    if q20_st > 0:
        Q84.static_q20(muscles, q20_st, 0.04)
    Q84.nudge_static_full(muscles, oy, ox, fy, h0, h1)
    MO.nudge_outer(muscles, oy * 0.55, ox * 0.55, fy * 0.55, 0.05, 1.0, 0.40, h0, h1, 0.10)
    zone_correct(muscles, mid, neck, face_z)
    if face > 0 or occ_b > 0:
        lat2 = Q7.make_lattice(muscles, f"b{tag}", 11)
        Q19.deform_balance(lat2, face, occ_b, 0.03)
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
        st = 0.16 + 0.025 * min(pi, 8)
        deltas = denser_deltas(png)
        full_adaptive(muscles, deltas, st)
        # re-apply light zone each 2 passes
        if pi % 2 == 1:
            zone_correct(muscles, mid * 0.35, neck * 0.35, face_z * 0.25)
        # light occ guard without face crush
        if pi >= 4 and pi % 3 == 0:
            Q84.nudge_static_full(muscles, 0.04, 0.07, 0.02, 0.68, 0.84)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_p{pi+1}_side.png"
        Q12.render_side(muscles, png)
        ev = Q84.eval_png(png)
        sc = Q12.score(ev)
        pr_now = float(ev.get("metrics", {}).get("profile_rmse", 1.0))
        # prefer profile improvement when gates nearly held
        if sc <= best_sc or (pr_now + 0.004 < best_pr and sc < best_sc + 0.08):
            best_sc, best_ev, best_pr = sc, ev, pr_now

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    m = best_ev.get("metrics", {})
    print(
        f"[Q91] {tag} sc={best_sc:.3f} pass={best_ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return best_ev, best_sc, muscles


def deliver(tag, ev, muscles):
    Q8.force_recolor()
    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.BLEND_FINAL)
    C.save_blend(C.CHECKPOINTS / "Q91_PASS.blend")
    C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q91_PASS.blend", "pass": True, "report": ev, "tag": tag})
    C.write_json(OUT / "self_eval_report.json", ev)


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    # a2-like profile base + zone params; face/occ light for gate
    grid = [
        # tag, flat, q20, oy, ox, fy, h0, h1, face, occ_b, mid, neck, face_z, passes
        ("z1", 1.5, 0.08, 0.28, 0.42, 0.11, 0.62, 0.84, 0.04, 0.02, 0.18, 0.16, 0.10, 16),
        ("z2", 1.5, 0.08, 0.26, 0.40, 0.10, 0.62, 0.84, 0.05, 0.03, 0.22, 0.18, 0.12, 16),
        ("z3", 1.5, 0.10, 0.30, 0.44, 0.11, 0.60, 0.82, 0.05, 0.03, 0.20, 0.20, 0.10, 18),
        ("z4", 1.2, 0.08, 0.28, 0.42, 0.10, 0.64, 0.84, 0.06, 0.03, 0.24, 0.14, 0.12, 16),
        ("z5", 1.5, 0.06, 0.24, 0.38, 0.12, 0.60, 0.82, 0.04, 0.02, 0.26, 0.22, 0.14, 18),
        ("z6", 1.5, 0.10, 0.32, 0.46, 0.11, 0.62, 0.84, 0.07, 0.04, 0.16, 0.18, 0.08, 16),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run_variant(tag, *row[1:])
        C.write_json(OUT / f"{tag}_report.json", ev)
        if ev.get("pass"):
            deliver(tag, ev, muscles)
            print(f"[Q91] *** PASS {tag} ***")
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q91_{tag}_best.blend")
    if best:
        tag, ev, muscles = best
        C.save_blend(C.CHECKPOINTS / "Q91_best.blend")
        m = ev.get("metrics", {})
        gates = sum(1 for k in ("hw_ratio", "vault_ratio", "occiput_ratio", "area_ratio") if m.get(k, {}).get("pass"))
        C.write_json(
            C.STAGES / "BEST_INTERNAL.json",
            {"checkpoint": "Q91_best.blend", "pass": False, "report": ev, "tag": tag, "gates": f"{gates}/4"},
        )
        print(
            f"[Q91] best={tag} sc={best_sc:.3f} pr={m.get('profile_rmse')} "
            f"occ={m.get('occiput_ratio', {}).get('test')} gates={gates}/4"
        )


if __name__ == "__main__":
    main()
