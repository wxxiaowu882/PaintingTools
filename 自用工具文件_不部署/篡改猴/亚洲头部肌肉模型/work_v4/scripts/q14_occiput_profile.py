# -*- coding: utf-8
"""Q14: occiput + profile bulk pass on top of Q13-o hw match."""
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

OUT = C.STAGES / "Q14_occiput_profile"
BASE = C.CHECKPOINTS / "Q13_o_best.blend"
FALLBACK = C.CHECKPOINTS / "Q4_packed.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable

# Q13-o winning hw params (re-apply if fallback)
HW = (1.58, 0.94, 0.12, 0.28)


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def deform_occiput_profile(lat, occ_y: float, face_y: float, bulk_z: float):
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
                cranial = smooth_step((lz + 0.10) / 0.88) * (1.0 - 0.48 * smooth_step((-lz - 0.18) / 0.52))

                occ = smooth_step((ly + 0.08) / 0.50) * smooth_step((lz + 0.05) / 0.55) * cranial
                occ_lower = smooth_step((ly + 0.12) / 0.55) * smooth_step((-lz - 0.05) / 0.45) * cranial
                face = smooth_step((-ly - 0.05) / 0.42) * smooth_step((lz + 0.08) / 0.55) * cranial
                neck = smooth_step((-lz - 0.28) / 0.48) * smooth_step((ly + 0.05) / 0.75)

                new = co.copy()
                y_mul = 1.0 + occ_y * occ + 0.65 * occ_y * occ_lower + face_y * face - 0.12 * neck
                new.y = co.y * max(0.72, y_mul)
                # slight vertical bulk for area (lower back of cranium)
                bulk = (occ + 0.5 * occ_lower) * bulk_z * cranial
                new.z = co.z * (1.0 + bulk)
                # midface width for area_ratio
                mid = smooth_step(1.0 - abs(lz - 0.0) / 0.50) * smooth_step(abs(lx))
                new.x = co.x * (1.0 + 0.045 * mid * cranial)
                p.co_deform = new
    bpy.context.view_layer.update()


def proportion_eval(png: Path) -> dict:
    proc = subprocess.run(
        [PY, str(SCRIPTS / "base15_proportion_eval.py"), str(png)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(proc.stdout)
    t = proc.stdout
    i, j = t.find("{"), t.rfind("}") + 1
    return json.loads(t[i:j]) if i >= 0 else {"pass": False}


def load_source():
    src = BASE if BASE.exists() else FALLBACK
    bpy.ops.wm.open_mainfile(filepath=str(src))
    if src == FALLBACK:
        muscles = Q12.load_muscles()
        lat = Q7.make_lattice(muscles, "HW_base", 11)
        Q12.deform_hw_lat(lat, *HW)
        Q7.apply_lattice(muscles, lat)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    return C.muscle_exportable()


def run_pass(tag: str, occ_y: float, face_y: float, bulk_z: float):
    muscles = load_source()
    lat = Q7.make_lattice(muscles, f"Occ_{tag}", 11)
    deform_occiput_profile(lat, occ_y, face_y, bulk_z)
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = proportion_eval(png)
    sc = Q12.score(ev)
    print(f"[Q14] {tag} occ={occ_y} face={face_y} bulk={bulk_z} score={sc:.3f} pass={ev.get('pass')}")
    return ev, muscles, sc


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("p1", 0.14, 0.06, 0.04),
        ("p2", 0.18, 0.08, 0.05),
        ("p3", 0.22, 0.10, 0.06),
        ("p4", 0.26, 0.10, 0.05),
        ("p5", 0.20, 0.12, 0.07),
        ("p6", 0.24, 0.14, 0.06),
    ]
    best_sc, best = 1e9, None
    for tag, oy, fy, bz in grid:
        ev, muscles, sc = run_pass(tag, oy, fy, bz)
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q14_occiput_profile.blend")
            C.write_json(OUT / "self_eval_report.json", ev)
            subprocess.run([PY, str(SCRIPTS / "make_collages.py"), "Q14_occiput_profile", tag], check=False)
            print("[Q14] EXPORTED")
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q14_{tag}_best.blend")

    if best:
        tag, ev, muscles = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.save_blend(C.CHECKPOINTS / "Q14_occiput_FAIL.blend")
        print("[Q14] best", tag, best_sc, ev.get("notes"))


if __name__ == "__main__":
    main()
