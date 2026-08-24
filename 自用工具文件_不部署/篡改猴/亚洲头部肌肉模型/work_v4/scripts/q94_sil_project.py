# -*- coding: utf-8
"""Q94: high-gain front-silhouette projection from Q84_a6 (shape S-curve fix)."""
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
import q12_hw_match as Q12  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402
import q19_back_balance as Q19  # noqa: E402
import q75_mesh as Q75  # noqa: E402
import q84_aggressive as Q84  # noqa: E402

OUT = C.STAGES / "Q94_sil"
BASE = C.CHECKPOINTS / "Q84_a6_best.blend"
REF = C.ROOT / "Base15_侧.png"


def project_front(muscles, deltas, gain: float, static_w=1.0, deform_w=0.20):
    """High-gain row projection on front verts only.
    delta = test-ref (normalized). Positive => too recessed => expand front (gain>0 uses empirical face_shr for +d?);
    Probe: face_shr (+) improved overall pr via depth, but shape residual at 0.7 needs expand and 0.9 needs shrink.
    So follow delta sign with CORRECT local geometry:
      d>0 (recessed): expand front (y_mul>1 for ly<0)
      d<0 (proud): shrink front (y_mul<1)
    This is OPPOSITE of MO.nudge_adaptive and OPPOSITE of global face_shr heuristic —
    used here for local S-curve after depth is roughly ok.
    """
    _, center, rx, ry, rz = MO._ref_bbox(muscles)
    # scale gain by bbox depth so normalized delta maps to meaningful Y
    xs = [r[0] for r in deltas]
    ys = [r[1] for r in deltas]

    def sample(h: float) -> float:
        h = max(0.0, min(1.0, h))
        if h <= xs[0]:
            return ys[0]
        if h >= xs[-1]:
            return ys[-1]
        for i in range(len(xs) - 1):
            if xs[i] <= h <= xs[i + 1]:
                t = (h - xs[i]) / max(xs[i + 1] - xs[i], 1e-6)
                return ys[i] * (1 - t) + ys[i + 1] * t
        return 0.0

    for obj in muscles:
        mw = MO.mesh_weight(obj.name, static_w, deform_w)
        if mw <= 0:
            continue
        me = obj.data
        inv = obj.matrix_world.inverted()
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            lx = max(-1.0, min(1.0, (w.x - center.x) / rx))
            ly = max(-1.0, min(1.0, (w.y - center.y) / ry))
            lz = max(-1.0, min(1.0, (w.z - center.z) / rz))
            h = (lz + 1.0) * 0.5
            d = sample(h)
            if abs(d) < 0.01:
                continue
            if ly > 0.12:
                continue  # front only
            front = Q75.smooth_step((-ly + 0.05) / 0.45)
            outer = Q75.smooth_step((abs(lx) - 0.02) / 0.50)
            cranial = Q75.smooth_step((lz + 0.08) / 0.95)
            wgt = gain * abs(d) * front * outer * cranial * mw
            if wgt < 0.004:
                continue
            w2 = w.copy()
            if d > 0:
                # recessed -> expand forward
                y_mul = 1.0 + wgt
            else:
                # proud -> shrink
                y_mul = 1.0 - wgt
            w2.y = center.y + (w.y - center.y) * max(0.45, min(1.55, y_mul))
            v.co = inv @ w2
        me.update()


def face_shr(muscles, amount: float):
    _, center, rx, ry, rz = MO._ref_bbox(muscles)
    for obj in muscles:
        mw = MO.mesh_weight(obj.name, 1.0, 0.3)
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
            band = Q75.smooth_step((h - 0.04) / 0.05) * Q75.smooth_step((0.34 - h) / 0.06)
            front = Q75.smooth_step((-ly + 0.02) / 0.40)
            k = -abs(amount) * band * front * mw
            if abs(k) < 0.002:
                continue
            w2 = w.copy()
            w2.y = center.y + (w.y - center.y) * (1.0 + k)
            v.co = inv @ w2
        me.update()


def run_variant(tag, shr0, gain0, occ_b, face_bal, passes):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()

    if shr0 > 0:
        face_shr(muscles, shr0)
    if face_bal > 0 or occ_b > 0:
        lat = Q7.make_lattice(muscles, f"b{tag}", 11)
        Q19.deform_balance(lat, face_bal, occ_b, 0.03)
        Q7.apply_lattice(muscles, lat)

    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = Q84.eval_png(png)
    best_ev, best_sc = ev, Q12.score(ev)
    best_pr = float(best_ev.get("metrics", {}).get("profile_rmse", 1.0))
    # keep mesh state of best by re-applying from scratch is hard; save blend each improve
    best_path = C.CHECKPOINTS / f"Q94_{tag}_live.blend"

    for pi in range(passes):
        if best_ev.get("pass"):
            break
        if best_pr <= 0.055:
            break
        gain = gain0 * (0.92 ** pi)
        deltas = MO.measure_row_delta(REF, png)
        project_front(muscles, deltas, gain)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_p{pi+1}_side.png"
        Q12.render_side(muscles, png)
        ev = Q84.eval_png(png)
        sc = Q12.score(ev)
        pr_now = float(ev.get("metrics", {}).get("profile_rmse", 1.0))
        m = ev.get("metrics", {})
        print(f"[Q94] {tag} p{pi+1} pr={pr_now:.4f} occ={m.get('occiput_ratio',{}).get('test')} sc={sc:.3f}")
        if sc <= best_sc or pr_now + 0.002 < best_pr:
            best_sc, best_ev, best_pr = sc, ev, pr_now
            C.save_blend(best_path)

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    m = best_ev.get("metrics", {})
    print(
        f"[Q94] {tag} BEST sc={best_sc:.3f} pass={best_ev.get('pass')} "
        f"occ={m.get('occiput_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return best_ev, best_sc, muscles


def deliver(tag, ev, muscles):
    Q8.force_recolor()
    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.BLEND_FINAL)
    C.save_blend(C.CHECKPOINTS / "Q94_PASS.blend")
    C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q94_PASS.blend", "pass": True, "report": ev, "tag": tag})


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        # tag, face_shr, gain, occ_b, face_bal, passes
        ("s1", 0.12, 0.55, 0.00, 0.00, 12),
        ("s2", 0.12, 0.75, 0.02, 0.03, 12),
        ("s3", 0.10, 0.90, 0.03, 0.04, 14),
        ("s4", 0.08, 0.65, 0.04, 0.05, 12),
        ("s5", 0.14, 0.80, 0.05, 0.06, 14),
        ("s6", 0.00, 1.00, 0.03, 0.04, 14),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run_variant(tag, *row[1:])
        C.write_json(OUT / f"{tag}_report.json", ev)
        if ev.get("pass"):
            deliver(tag, ev, muscles)
            print(f"[Q94] *** PASS {tag} ***")
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q94_{tag}_best.blend")
    if best:
        tag, ev, muscles = best
        C.save_blend(C.CHECKPOINTS / "Q94_best.blend")
        m = ev.get("metrics", {})
        gates = sum(1 for k in ("hw_ratio", "vault_ratio", "occiput_ratio", "area_ratio") if m.get(k, {}).get("pass"))
        C.write_json(
            C.STAGES / "BEST_INTERNAL.json",
            {"checkpoint": "Q94_best.blend", "pass": False, "report": ev, "tag": tag, "gates": f"{gates}/4"},
        )
        print(
            f"[Q94] best={tag} sc={best_sc:.3f} pr={m.get('profile_rmse')} "
            f"occ={m.get('occiput_ratio', {}).get('test')} gates={gates}/4"
        )


if __name__ == "__main__":
    main()
