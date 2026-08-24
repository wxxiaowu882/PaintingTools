# -*- coding: utf-8
"""Q18: tail pull-forward + vault push + symmetric cranial bulk."""
from __future__ import annotations

import shutil
import subprocess
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

OUT = C.STAGES / "Q18_tail_vault"
BASE = C.CHECKPOINTS / "Q15_q3_best.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def deform_tail_vault(lat, tail_pull: float, vault_push: float, sym_bulk: float, z_comp: float):
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
                cranial = smooth_step((lz + 0.05) / 0.92) * (1.0 - 0.38 * smooth_step((-lz - 0.24) / 0.48))

                tail = smooth_step((ly + 0.02) / 0.48) * smooth_step((-lz - 0.08) / 0.38) * cranial
                vault = smooth_step((lz - 0.10) / 0.52) * smooth_step((-ly - 0.08) / 0.52) * cranial
                occ_bulge = smooth_step((ly + 0.05) / 0.45) * smooth_step((lz - 0.02) / 0.42) * cranial
                face = smooth_step((-ly - 0.02) / 0.42) * smooth_step((lz - 0.02) / 0.50) * cranial
                sym = cranial * (1.0 - 0.35 * tail)

                y_mul = 1.0 + sym_bulk * sym + vault_push * vault + 0.55 * sym_bulk * occ_bulge
                y_mul += 0.35 * sym_bulk * face
                y_mul -= tail_pull * tail

                new = co.copy()
                new.y = co.y * max(0.62, y_mul)
                new.z = co.z * (1.0 - z_comp * smooth_step((lz - 0.05) / 0.55) * cranial)
                p.co_deform = new
    bpy.context.view_layer.update()


def try_variant(tag, tail, vault, bulk, zc):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    lat = Q7.make_lattice(muscles, tag, 11)
    deform_tail_vault(lat, tail, vault, bulk, zc)
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = Q16.eval_png(png)
    sc = Q12.score(ev)
    pr = ev.get("metrics", {}).get("profile_rmse", 1)
    print(f"[Q18] {tag} sc={sc:.3f} pr={pr:.4f} pass={ev.get('pass')}")
    return ev, muscles, sc


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("u1", 0.32, 0.14, 0.10, 0.06),
        ("u2", 0.38, 0.16, 0.11, 0.07),
        ("u3", 0.44, 0.18, 0.12, 0.08),
        ("u4", 0.36, 0.20, 0.13, 0.07),
        ("u5", 0.40, 0.14, 0.14, 0.08),
        ("u6", 0.48, 0.16, 0.12, 0.09),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, muscles, sc = try_variant(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q18_tail_vault.blend")
            C.write_json(OUT / "self_eval_report.json", ev)
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q18_{tag}_best.blend")

    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        print(f"[Q18] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
