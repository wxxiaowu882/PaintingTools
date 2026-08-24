# -*- coding: utf-8
"""Q20: fit side silhouette rows to Base15 width/outer targets."""
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

OUT = C.STAGES / "Q20_profile_fit"
BASE = C.CHECKPOINTS / "Q19_a3_best.blend"
TARGETS = C.STAGES / "base15_side_targets.json"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def load_targets():
    data = json.loads(TARGETS.read_text(encoding="utf-8"))
    return data["width_n"], data["outer_n"]


def deform_to_targets(lat, width_n, outer_n, strength: float, bulk: float):
    n = len(width_n)
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    def sample(arr, h: float) -> float:
        h = max(0.0, min(1.0, h))
        x = h * (n - 1)
        i0 = int(x)
        i1 = min(n - 1, i0 + 1)
        t = x - i0
        return arr[i0] * (1 - t) + arr[i1] * t

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                ly = max(-1.0, min(1.0, co.y * 2.0))
                lz = max(-1.0, min(1.0, co.z * 2.0))
                h = (lz + 1.0) * 0.5
                cranial = smooth_step((lz + 0.04) / 0.92) * (1.0 - 0.40 * smooth_step((-lz - 0.24) / 0.50))
                if cranial < 0.05:
                    p.co_deform = co
                    continue

                tgt_w = sample(width_n, h)
                tgt_o = sample(outer_n, h)
                # map ly [-1,1] -> param along depth; target outer at back, inner at front
                # widen row toward tgt_w; shift back edge toward tgt_o profile
                half = max(0.35, tgt_w * 0.52)
                center = -1.0 + 2.0 * tgt_o
                desired_ly = center + ly * half
                blend = strength * cranial
                new_ly = ly * (1.0 - blend) + desired_ly * blend
                new = co.copy()
                new.y = co.y * (new_ly / ly) if abs(ly) > 0.05 else co.y * (1.0 + bulk * (tgt_w - 0.85) * cranial)
                new.x = co.x * (1.0 + bulk * 0.08 * (tgt_w - 0.80) * cranial)
                p.co_deform = new
    bpy.context.view_layer.update()


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    if not TARGETS.exists():
        raise RuntimeError(f"missing {TARGETS}")
    width_n, outer_n = load_targets()
    grid = [(0.35, 0.06), (0.45, 0.08), (0.55, 0.10), (0.65, 0.10), (0.50, 0.12)]
    best_sc, best = 1e9, None
    for idx, (st, bulk) in enumerate(grid):
        tag = f"f{idx+1}"
        bpy.ops.wm.open_mainfile(filepath=str(BASE))
        for o in C.mesh_objects(C.objects_in_group("muscle")):
            if "Melns" in o.name or "pCylinder" in o.name:
                o.hide_render = True
        muscles = C.muscle_exportable()
        lat = Q7.make_lattice(muscles, tag, 13)
        deform_to_targets(lat, width_n, outer_n, st, bulk)
        Q7.apply_lattice(muscles, lat)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_side.png"
        C.set_group_visibility("skull", False)
        Q12.render_side(muscles, png)
        ev = Q16.eval_png(png)
        sc = Q12.score(ev)
        m = ev.get("metrics", {})
        print(
            f"[Q20] {tag} st={st} sc={sc:.3f} hw={m.get('hw_ratio',{}).get('test')} "
            f"occ={m.get('occiput_ratio',{}).get('test')} pr={m.get('profile_rmse')} pass={ev.get('pass')}"
        )
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q20_profile_fit.blend")
            C.write_json(OUT / "self_eval_report.json", ev)
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q20_{tag}_best.blend")

    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        print(f"[Q20] best={tag} sc={best_sc:.3f} {ev.get('notes')}")


if __name__ == "__main__":
    main()
