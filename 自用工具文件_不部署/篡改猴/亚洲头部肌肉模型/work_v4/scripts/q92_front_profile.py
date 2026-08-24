# -*- coding: utf-8
"""Q92: from Q85_t5 (4/5) — front-contour only profile fix; protect occ."""
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
import q75_mesh as Q75  # noqa: E402
import q84_aggressive as Q84  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.STAGES / "Q92_front"
BASE = C.CHECKPOINTS / "Q85_t5_best.blend"
REF = C.ROOT / "Base15_侧.png"
OCC_MIN = 0.917  # gate floor


def front_nudge(muscles, deltas, strength: float, static_w=1.0, deform_w=0.25):
    """Move mostly FRONT verts. Positive delta => front too recessed => push -Y (forward).
    Negative delta => front too proud => pull toward center (+Y direction from front).
    """
    _, center, rx, ry, rz = MO._ref_bbox(muscles)
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
            if abs(d) < 0.006:
                continue
            # front-heavy; tiny back only to avoid depth-scale drift
            front = Q75.smooth_step((-ly - 0.0) / 0.38) if ly < 0.05 else 0.0
            back = Q75.smooth_step((ly - 0.15) / 0.45) if ly > 0.15 else 0.0
            outer = Q75.smooth_step((abs(lx) - 0.08) / 0.42)
            cranial = Q75.smooth_step((lz + 0.05) / 0.95)
            wgt = strength * outer * cranial * mw * (0.95 * front + 0.08 * back)
            if wgt < 0.004:
                continue
            w2 = w.copy()
            if d > 0:
                # too recessed: expand front outward (-Y from center if front is -Y)
                # front verts have ly<0; expand = multiply |y-center| by (1+k)
                y_mul = 1.0 + wgt * d * 0.85
                w2.y = center.y + (w.y - center.y) * y_mul
            else:
                # too proud: shrink toward center
                y_mul = 1.0 - wgt * abs(d) * 0.75
                w2.y = center.y + (w.y - center.y) * max(0.60, y_mul)
            v.co = inv @ w2
        me.update()


def band_front(muscles, h0, h1, amount: float):
    """Uniform front expand/shrink in a height band (amount>0 = expand forward)."""
    _, center, rx, ry, rz = MO._ref_bbox(muscles)
    for obj in muscles:
        mw = MO.mesh_weight(obj.name, 1.0, 0.2)
        if mw <= 0:
            continue
        me = obj.data
        inv = obj.matrix_world.inverted()
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            ly = max(-1.0, min(1.0, (w.y - center.y) / ry))
            lz = max(-1.0, min(1.0, (w.z - center.z) / rz))
            h = (lz + 1.0) * 0.5
            if ly > 0.02:
                continue
            band = Q75.smooth_step((h - h0) / 0.04) * Q75.smooth_step((h1 - h) / 0.04)
            front = Q75.smooth_step((-ly) / 0.35)
            k = amount * band * front * mw
            if abs(k) < 0.002:
                continue
            w2 = w.copy()
            w2.y = center.y + (w.y - center.y) * (1.0 + k)
            v.co = inv @ w2
        me.update()


def run_variant(tag, strength0, band_face, band_neck, passes):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()

    # initial band hints from a2/Q85 deltas: face recessed, neck proud
    if abs(band_face) > 0:
        band_front(muscles, 0.04, 0.32, band_face)
    if abs(band_neck) > 0:
        band_front(muscles, 0.86, 0.98, band_neck)  # negative = shrink neck front

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
        st = strength0 * (1.0 - 0.04 * min(pi, 10))
        deltas = MO.measure_row_delta(REF, png)
        front_nudge(muscles, deltas, st)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_p{pi+1}_side.png"
        Q12.render_side(muscles, png)
        ev = Q84.eval_png(png)
        sc = Q12.score(ev)
        m = ev.get("metrics", {})
        occ = float(m.get("occiput_ratio", {}).get("test", 0.0))
        pr_now = float(m.get("profile_rmse", 1.0))
        # reject if occ collapses below gate (keep 4/5 path)
        if occ < OCC_MIN - 0.01:
            print(f"[Q92] {tag} p{pi+1} reject occ={occ:.3f}")
            continue
        if sc <= best_sc or (pr_now + 0.003 < best_pr and sc < best_sc + 0.06):
            best_sc, best_ev, best_pr = sc, ev, pr_now

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    m = best_ev.get("metrics", {})
    print(
        f"[Q92] {tag} sc={best_sc:.3f} pass={best_ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return best_ev, best_sc, muscles


def deliver(tag, ev, muscles):
    Q8.force_recolor()
    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.BLEND_FINAL)
    C.save_blend(C.CHECKPOINTS / "Q92_PASS.blend")
    C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q92_PASS.blend", "pass": True, "report": ev, "tag": tag})
    C.write_json(OUT / "self_eval_report.json", ev)


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        # tag, strength0, band_face(+expand), band_neck(shrink), passes
        ("f1", 0.22, 0.08, -0.10, 14),
        ("f2", 0.28, 0.10, -0.12, 14),
        ("f3", 0.32, 0.12, -0.14, 16),
        ("f4", 0.26, 0.06, -0.08, 14),
        ("f5", 0.30, 0.14, -0.16, 16),
        ("f6", 0.24, 0.10, -0.18, 14),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run_variant(tag, *row[1:])
        C.write_json(OUT / f"{tag}_report.json", ev)
        if ev.get("pass"):
            deliver(tag, ev, muscles)
            print(f"[Q92] *** PASS {tag} ***")
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q92_{tag}_best.blend")
    if best:
        tag, ev, muscles = best
        C.save_blend(C.CHECKPOINTS / "Q92_best.blend")
        m = ev.get("metrics", {})
        gates = sum(1 for k in ("hw_ratio", "vault_ratio", "occiput_ratio", "area_ratio") if m.get(k, {}).get("pass"))
        C.write_json(
            C.STAGES / "BEST_INTERNAL.json",
            {"checkpoint": "Q92_best.blend", "pass": False, "report": ev, "tag": tag, "gates": f"{gates}/4"},
        )
        print(
            f"[Q92] best={tag} sc={best_sc:.3f} pr={m.get('profile_rmse')} "
            f"occ={m.get('occiput_ratio', {}).get('test')} gates={gates}/4"
        )


if __name__ == "__main__":
    main()
