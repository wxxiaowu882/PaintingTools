# -*- coding: utf-8
"""Q15: compress mid-face depth + boost occiput to raise occiput_ratio."""
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

OUT = C.STAGES / "Q15_face_occ"
BASE = C.CHECKPOINTS / "Q13_o_best.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def deform_face_occ(lat, face_pull: float, occ_push: float):
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
                cranial = smooth_step((lz + 0.08) / 0.88) * (1.0 - 0.5 * smooth_step((-lz - 0.2) / 0.52))

                face = smooth_step((-ly - 0.02) / 0.48) * smooth_step((lz + 0.05) / 0.58) * cranial
                occ_u = smooth_step((ly + 0.05) / 0.52) * smooth_step((lz + 0.0) / 0.62) * cranial
                occ_l = smooth_step((ly + 0.10) / 0.55) * smooth_step((-lz - 0.02) / 0.48) * cranial

                y_mul = 1.0 - face_pull * face + occ_push * (occ_u + 0.7 * occ_l)
                new = co.copy()
                new.y = co.y * max(0.68, y_mul)
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
    return json.loads(t[i:j])


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [(0.10, 0.20), (0.14, 0.24), (0.18, 0.28), (0.12, 0.32), (0.16, 0.34)]
    best_sc, best = 1e9, None
    for idx, (fp, op) in enumerate(grid):
        tag = f"q{idx+1}"
        bpy.ops.wm.open_mainfile(filepath=str(BASE))
        for o in C.mesh_objects(C.objects_in_group("muscle")):
            if "Melns" in o.name or "pCylinder" in o.name:
                o.hide_render = True
        muscles = C.muscle_exportable()
        lat = Q7.make_lattice(muscles, tag, 11)
        deform_face_occ(lat, fp, op)
        Q7.apply_lattice(muscles, lat)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_side.png"
        C.set_group_visibility("skull", False)
        Q12.render_side(muscles, png)
        ev = eval_png(png)
        sc = Q12.score(ev)
        occ = ev.get("metrics", {}).get("occiput_ratio", {}).get("test")
        hw = ev.get("metrics", {}).get("hw_ratio", {}).get("test")
        print(f"[Q15] {tag} face={fp} occ={op} hw={hw} occ_r={occ} score={sc:.3f} pass={ev.get('pass')}")
        if ev.get("pass"):
            C.save_blend(C.CHECKPOINTS / "Q15_face_occ.blend")
            C.write_json(OUT / "self_eval_report.json", ev)
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q15_{tag}_best.blend")

    if best:
        tag, ev, _ = best
        C.write_json(OUT / "self_eval_report.json", ev)
        print("[Q15] best", tag, best_sc, ev.get("notes"))


if __name__ == "__main__":
    main()
