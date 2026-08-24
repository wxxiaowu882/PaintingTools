# -*- coding: utf-8
"""
Q12: match Base15 side hw_ratio — expand A-P depth, optional cranial Z tweak.
Q4 render hw~1.69 vs Base15 1.27 → need depth ~+32% with minimal height change.
Strict proportion gate; no export until PASS.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q10_occiput as Q10  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q7e_depth_fix as Q7E  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.STAGES / "Q12_hw_match"
SOURCE = C.CHECKPOINTS / "Q4_packed.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def deform_hw_lat(lat, y_mul: float, z_mul: float, vault_c: float, occ_boost: float):
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
                cranial = smooth_step((lz + 0.14) / 0.86) * (1.0 - 0.52 * smooth_step((-lz - 0.16) / 0.52))

                y_scale = 1.0 + (y_mul - 1.0) * smooth_step(0.42 + 0.58 * abs(ly)) * cranial
                occ = smooth_step((ly + 0.02) / 0.58) * smooth_step((lz + 0.02) / 0.62) * cranial
                y_scale += occ_boost * occ
                neck = smooth_step((-lz - 0.22) / 0.52) * smooth_step((ly + 0.12) / 0.72)
                y_scale -= 0.14 * neck

                z_scale = 1.0 + (z_mul - 1.0) * cranial
                top = smooth_step((lz - 0.04) / 0.60) * cranial

                new = co.copy()
                new.y = co.y * max(0.70, y_scale)
                new.z = co.z * z_scale * (1.0 - vault_c * top)
                mid = smooth_step(1.0 - abs(lz - 0.02) / 0.48) * smooth_step(abs(lx))
                new.x = co.x * (1.0 + 0.03 * mid * cranial)
                p.co_deform = new
    bpy.context.view_layer.update()


def load_muscles():
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    return C.muscle_exportable()


_SILHOUETTE_MAT_NAME = "_PropEvalSilhouette"


def _silhouette_material():
    mat = bpy.data.materials.get(_SILHOUETTE_MAT_NAME)
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(_SILHOUETTE_MAT_NAME)
    mat.use_nodes = True
    nt = mat.node_tree
    for node in list(nt.nodes):
        nt.nodes.remove(node)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (0.10, 0.05, 0.05, 1.0)
    emit.inputs["Strength"].default_value = 1.0
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def _apply_silhouette_materials(muscles):
    saved = []
    mat = _silhouette_material()
    for obj in muscles:
        for i, slot in enumerate(obj.material_slots):
            saved.append((obj, i, slot.material))
            slot.material = mat
    return saved


def _restore_materials(saved):
    for obj, i, mat in saved:
        obj.material_slots[i].material = mat


def render_side(muscles, path: Path, res: int = 900):
    """High-contrast side render for proportion-eval mask extraction."""
    C.configure_eevee(res)
    C.setup_world_white()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    saved_mats = _apply_silhouette_materials(muscles)
    try:
        Q10.setup_camera_side_tight(muscles, 90.0, 0.0, 1.78)
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
    finally:
        _restore_materials(saved_mats)


def proportion_eval(side_png: Path) -> dict:
    proc = subprocess.run(
        [PY, str(SCRIPTS / "base15_proportion_eval.py"), str(side_png)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(proc.stdout)
    rp = side_png.parent / "base15_proportion_report.json"
    return json.loads(rp.read_text(encoding="utf-8")) if rp.exists() else {"pass": False}


def score(ev: dict) -> float:
    m = ev.get("metrics", {})
    s = 0.0
    for key, w in [("hw_ratio", 3.0), ("occiput_ratio", 2.0), ("vault_ratio", 1.0), ("area_ratio", 2.0)]:
        if key in m:
            s += w * float(m[key].get("err", 1.0))
    s += 4.0 * float(m.get("profile_rmse", 1.0))
    return s


def run_variant(tag: str, y_mul: float, z_mul: float, vault_c: float, occ: float):
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    muscles = load_muscles()
    lat = Q7.make_lattice(muscles, f"HW_{tag}", 11)
    deform_hw_lat(lat, y_mul, z_mul, vault_c, occ)
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    m = Q7E.cranial_metrics()
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    render_side(muscles, png)
    ev = proportion_eval(png)
    print(f"[Q12] {tag} y={y_mul} z={z_mul} vault={vault_c} occ={occ} cranial={m} score={score(ev):.3f}")
    return ev, png, muscles


def export_pass(muscles, ev: dict):
    Q8.force_recolor()
    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.BLEND_FINAL)
    C.save_blend(C.CHECKPOINTS / "Q12_hw_match.blend")
    C.write_json(OUT / "self_eval_report.json", ev)
    subprocess.run([PY, str(SCRIPTS / "make_collages.py"), "Q12_hw_match", "final"], check=False)
    print("[Q12] EXPORTED — proportion gate PASS")


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)

    # Q4 baseline under tight camera
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    muscles = load_muscles()
    base_png = OUT / "Q4_base_side.png"
    C.set_group_visibility("skull", False)
    render_side(muscles, base_png)
    base_ev = proportion_eval(base_png)
    best_ev, best_muscles, best_score = base_ev, muscles, score(base_ev)

    # y_mul ~1.32 targets hw 1.685→1.27; sweep around that
    grid = [
        ("a", 1.28, 1.00, 0.10, 0.12),
        ("b", 1.30, 1.00, 0.10, 0.14),
        ("c", 1.32, 1.00, 0.12, 0.16),
        ("d", 1.34, 0.99, 0.12, 0.18),
        ("e", 1.36, 0.98, 0.12, 0.18),
        ("f", 1.32, 0.97, 0.14, 0.16),
        ("g", 1.30, 0.96, 0.14, 0.14),
        ("h", 1.38, 0.98, 0.10, 0.20),
    ]

    for tag, y, z, v, o in grid:
        ev, _, muscles = run_variant(tag, y, z, v, o)
        sc = score(ev)
        if ev.get("pass"):
            export_pass(muscles, ev)
            return
        if sc < best_score:
            best_score, best_ev, best_muscles = sc, ev, muscles
            C.save_blend(C.CHECKPOINTS / f"Q12_{tag}_best.blend")

    C.write_json(OUT / "self_eval_report.json", best_ev)
    C.save_blend(C.CHECKPOINTS / "Q12_hw_match_FAIL.blend")
    print("[Q12] NOT exported. Best:", best_ev.get("notes"), "score=", best_score)


if __name__ == "__main__":
    main()
