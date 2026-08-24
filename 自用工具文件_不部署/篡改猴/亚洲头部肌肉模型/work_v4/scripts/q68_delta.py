# -*- coding: utf-8
"""Q68: Q67 base + row-profile delta correction from measured Q57-p1 errors."""
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
import q21_refine as Q21  # noqa: E402
import q67_pipeline as Q67  # noqa: E402

OUT = C.STAGES / "Q68_delta"
BASE = C.CHECKPOINTS / "Q67_f0z0_best.blend"
FALLBACK = C.CHECKPOINTS / "Q57_p1_best.blend"
PY = __import__("shutil").which("python") or sys.executable

# measured row delta test-ref on Q57-p1 (positive = too deep/back)
ROW_DELTA = [
    (0.05, +0.09),
    (0.10, +0.10),
    (0.15, +0.09),
    (0.20, +0.07),
    (0.25, +0.06),
    (0.30, +0.07),
    (0.40, -0.06),
    (0.50, -0.01),
    (0.60, -0.03),
    (0.70, +0.16),
    (0.75, +0.16),
    (0.80, +0.18),
    (0.85, +0.18),
    (0.90, -0.11),
    (0.95, -0.15),
]


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def sample_delta(h: float) -> float:
    h = max(0.0, min(1.0, h))
    xs = [r[0] for r in ROW_DELTA]
    ys = [r[1] for r in ROW_DELTA]
    if h <= xs[0]:
        return ys[0]
    if h >= xs[-1]:
        return ys[-1]
    for i in range(len(xs) - 1):
        if xs[i] <= h <= xs[i + 1]:
            t = (h - xs[i]) / max(xs[i + 1] - xs[i], 1e-6)
            return ys[i] * (1 - t) + ys[i + 1] * t
    return 0.0


def deform_delta(lat, strength: float):
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
                h = (lz + 1.0) * 0.5
                cranial = smooth_step((lz + 0.04) / 0.92) * (
                    1.0 - 0.42 * smooth_step((-lz - 0.22) / 0.50)
                )
                d = sample_delta(h)
                if abs(d) < 0.01 or cranial < 0.05:
                    p.co_deform = co
                    continue
                # positive d: silhouette too back -> pull toward front
                front_w = smooth_step((-ly - 0.01) / 0.48) if ly < 0 else 0.0
                back_w = smooth_step((ly + 0.01) / 0.48) if ly > 0 else 0.0
                wgt = cranial * strength
                y_mul = 1.0
                if d > 0:
                    y_mul -= wgt * d * (0.55 * front_w + 0.85 * back_w)
                else:
                    y_mul += wgt * abs(d) * (0.45 * front_w + 0.65 * back_w)
                new = co.copy()
                new.y = co.y * max(0.62, y_mul)
                p.co_deform = new
    bpy.context.view_layer.update()


def eval_png(png):
    import subprocess
    proc = subprocess.run([PY, str(SCRIPTS / "base15_proportion_eval.py"), str(png)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    t = proc.stdout
    i, j = t.find("{"), t.rfind("}") + 1
    return json.loads(t[i:j])


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    base_path = BASE if BASE.exists() else FALLBACK
    best_sc, best = 1e9, None
    for st in [0.08, 0.10, 0.12, 0.14, 0.16]:
        for zc in [0.0, 0.02, 0.03]:
            tag = f"d{int(st*100)}z{int(zc*100)}"
            bpy.ops.wm.open_mainfile(filepath=str(base_path))
            for o in C.mesh_objects(C.objects_in_group("muscle")):
                if "Melns" in o.name or "pCylinder" in o.name:
                    o.hide_render = True
            muscles = C.muscle_exportable()
            lat = Q7.make_lattice(muscles, tag, 13)
            deform_delta(lat, st)
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
            print(f"[Q68] {tag} sc={sc:.3f} pass={ev.get('pass')} occ={m.get('occiput_ratio',{}).get('test')} area={m.get('area_ratio',{}).get('test')} pr={m.get('profile_rmse')}")
            if ev.get("pass"):
                Q8.force_recolor()
                C.export_glb(C.GLB_FINAL, muscles)
                C.save_blend(C.BLEND_FINAL)
                C.save_blend(C.CHECKPOINTS / "Q68_delta.blend")
                C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q68_delta.blend", "pass": True, "report": ev})
                return
            if sc < best_sc:
                best_sc, best = sc, (tag, ev, muscles)
                C.save_blend(C.CHECKPOINTS / f"Q68_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q68_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q68] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
