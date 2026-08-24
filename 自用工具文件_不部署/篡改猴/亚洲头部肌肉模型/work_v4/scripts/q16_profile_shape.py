# -*- coding: utf-8
"""Q16: profile-shaped lattice — fix lower-back tail, vault forehead, mid-face."""
from __future__ import annotations

import json
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

OUT = C.STAGES / "Q16_profile_shape"
BASE = C.CHECKPOINTS / "Q15_q3_best.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def deform_profile(lat, vault_fwd: float, face_in: float, mid_occ: float, tail_in: float, bulk: float):
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                lx = max(-1.0, min(1.0, co.x * 2.0))
                ly = max(-1.0, min(1.0, co.y * 2.0))
                lz = max(-1.0, min(1.0, co.z * 2.0))
                cranial = smooth_step((lz + 0.06) / 0.90) * (1.0 - 0.42 * smooth_step((-lz - 0.22) / 0.50))

                vault = smooth_step((lz - 0.12) / 0.55) * smooth_step((-ly - 0.05) / 0.55) * cranial
                face = smooth_step((-ly - 0.02) / 0.45) * smooth_step((lz - 0.02) / 0.55) * cranial
                mid_face = smooth_step((-ly - 0.05) / 0.40) * smooth_step(1.0 - abs(lz - 0.05) / 0.35) * cranial
                occ_mid = smooth_step((ly + 0.02) / 0.50) * smooth_step((lz - 0.05) / 0.45) * cranial
                tail = smooth_step((ly + 0.08) / 0.55) * smooth_step((-lz - 0.12) / 0.45) * cranial
                neck = smooth_step((-lz - 0.30) / 0.45)

                y_mul = (
                    1.0
                    + vault_fwd * vault
                    - face_in * face
                    - 0.55 * face_in * mid_face
                    + mid_occ * occ_mid
                    - tail_in * tail
                    - 0.20 * tail_in * neck
                )
                new = co.copy()
                new.y = co.y * max(0.66, y_mul)
                new.z = co.z * (1.0 + bulk * (vault + 0.35 * occ_mid) * cranial)
                new.x = co.x * (1.0 + bulk * 0.55 * smooth_step(abs(lx)) * cranial)
                p.co_deform = new
    bpy.context.view_layer.update()


def eval_png(png: Path) -> dict:
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


def run(tag, params):
    vault_fwd, face_in, mid_occ, tail_in, bulk = params
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    lat = Q7.make_lattice(muscles, tag, 11)
    deform_profile(lat, vault_fwd, face_in, mid_occ, tail_in, bulk)
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    return ev, muscles, Q12.score(ev)


def export_ok(muscles, ev):
    Q8.force_recolor()
    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.BLEND_FINAL)
    C.save_blend(C.CHECKPOINTS / "Q16_profile_shape.blend")
    C.write_json(OUT / "self_eval_report.json", ev)
    subprocess.run([PY, str(SCRIPTS / "make_collages.py"), "Q16_profile_shape", "final"], check=False)


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("s1", (0.10, 0.16, 0.22, 0.28, 0.06)),
        ("s2", (0.12, 0.18, 0.26, 0.32, 0.07)),
        ("s3", (0.14, 0.20, 0.28, 0.36, 0.08)),
        ("s4", (0.12, 0.22, 0.30, 0.40, 0.08)),
        ("s5", (0.16, 0.18, 0.32, 0.34, 0.09)),
        ("s6", (0.14, 0.24, 0.28, 0.44, 0.07)),
    ]
    best_sc, best = 1e9, None
    for tag, p in grid:
        ev, muscles, sc = run(tag, p)
        print(f"[Q16] {tag} sc={sc:.3f} pass={ev.get('pass')} {ev.get('notes', [])[:2]}")
        if ev.get("pass"):
            export_ok(muscles, ev)
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q16_{tag}_best.blend")

    if best:
        tag, ev, muscles = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.save_blend(C.CHECKPOINTS / "Q16_profile_FAIL.blend")
        print(f"[Q16] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
