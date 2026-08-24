# -*- coding: utf-8 -*-
"""SHELL_v7: from v6 — incremental occiput + lower jaw/chin (no sphere).

Chain: v1 → v3 → v4 → v5 → v6 → v7. Primary review: front / side / back only.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q7_form_fix as Q7  # noqa: E402

OUT = C.WORK / "compare_review"
BASE = C.CHECKPOINTS / "SHELL_v6.blend"
TAG = "SHELL_v7"

# Incremental on v6 geometry (not absolute re-run of v6 params)
OCCIP_Y = 1.08
CROWN_Z = 1.02
CHEEK_X = 0.99
CHIN_Y = 1.05
JAW_Z = 1.04
VAULT_X = 1.00
WIDTH_GATE = 1.08


def bone_objs():
    skull = C.get_obj("skull", "UnifiedSkull")
    mandible = C.get_obj("skull", "Mandible")
    return [o for o in (skull, mandible) if o]


def cranial_objs(muscles):
    out = []
    for o in muscles:
        n = o.name.lower()
        if "plastyma" in n or "platysma" in n:
            continue
        if "deform" in n or "skiedras" in n:
            out.append(o)
    return out or [C.get_obj("muscle", "Static")]


def metrics_pair(tag: str, muscles):
    soft = Q7.metrics(f"{tag}_soft")
    cr = cranial_objs(muscles)
    _, s = C.bbox_center_size(cr)
    dw = s.y / max(s.x, 1e-8)
    hw = s.z / max(s.x, 1e-8)
    print(f"[{tag}_cranial] size=({s.x:.4f},{s.y:.4f},{s.z:.4f}) depth/width={dw:.3f} height/width={hw:.3f}")
    return {
        "soft": soft,
        "cranial": {"size": [s.x, s.y, s.z], "depth_over_width": dw, "height_over_width": hw},
    }


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def reshape_lattice(muscles):
    lat = Q7.make_lattice(muscles, "V7_OCCIP_JAW", 9)
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

                rear = smooth_step((ly + 0.05) / 0.85)
                front = smooth_step((-ly + 0.15) / 0.85)
                vault = smooth_step((lz + 0.15) / 0.75)
                occip = rear * smooth_step((lz + 0.05) / 0.7)
                cheek = (
                    front
                    * smooth_step(1.0 - abs(lz + 0.05) / 0.5)
                    * smooth_step(1.0 - abs(abs(lx) - 0.45) / 0.55)
                )
                jaw = (
                    front
                    * smooth_step((-lz - 0.05) / 0.45)
                    * smooth_step(1.0 - abs(lx) / 0.52)
                )
                ear = smooth_step((abs(lx) - 0.62) / 0.38) * smooth_step(1.0 - abs(lz - 0.0) / 0.35)

                y_mul = 1.0 + (OCCIP_Y - 1.0) * occip * (0.45 + 0.55 * vault)
                y_mul *= 1.0 + (CHIN_Y - 1.0) * jaw * 0.75
                z_mul = 1.0 + (CROWN_Z - 1.0) * occip
                z_mul *= 1.0 + (JAW_Z - 1.0) * jaw
                x_mul = 1.0 + (CHEEK_X - 1.0) * cheek * (1.0 - 0.7 * ear)
                x_mul *= 1.0 + (VAULT_X - 1.0) * vault * rear

                new = co.copy()
                new.x = co.x * x_mul
                new.y = co.y * y_mul
                new.z = co.z * z_mul
                p.co_deform = new
    bpy.context.view_layer.update()
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)


def recenter_to_skull(muscles):
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    if not bones or static is None:
        return
    b_c, _ = C.bbox_center_size(bones)
    m_c, _ = C.bbox_center_size([static])
    for obj in muscles:
        obj.location += b_c - m_c
    C.apply_object_transforms(muscles)


def render_top(objs, path: Path, res: int = 1000, label: str = "top"):
    C.ensure_dirs(path.parent)
    C.configure_eevee(res)
    C.setup_world_white()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting()
    center, size = C.bbox_center_size(objs)
    extent = max(size.x, size.y, size.z, 1e-6)
    cam_data = bpy.data.cameras.new("TopCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = extent * 1.45
    cam = bpy.data.objects.new("TopCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = center + Vector((0, 0, extent * 2.4))
    cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print(f"[render:{label}] {path}")


def set_hide_render(objs, hide: bool):
    for o in objs:
        o.hide_render = hide
        o.hide_set(hide)


def main():
    C.ensure_dirs(OUT / "ours" / TAG, OUT / "glb", OUT / "base15", C.CHECKPOINTS)
    if not BASE.exists():
        raise FileNotFoundError(BASE)
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    C.hide_aux_skull()
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()

    before = metrics_pair("from_v6", muscles)
    print(f"[v7] occip={OCCIP_Y} chin={CHIN_Y} jaw_z={JAW_Z} cheek={CHEEK_X}")
    reshape_lattice(muscles)
    recenter_to_skull(muscles)
    after = metrics_pair(TAG, muscles)

    bx, by = before["cranial"]["size"][0], before["cranial"]["size"][1]
    ax, ay = after["cranial"]["size"][0], after["cranial"]["size"][1]
    width_ratio = ax / max(bx, 1e-8)
    depth_ratio = ay / max(by, 1e-8)
    print(f"[v7] delta width={width_ratio:.3f} depth={depth_ratio:.3f}")

    C.save_blend(C.CHECKPOINTS / f"{TAG}.blend")
    C.set_group_visibility("skull", False)
    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True

    dest = OUT / "ours" / TAG
    C.render_views(dest, muscles, "muscle", res=1000)
    render_top(muscles, dest / "muscle_top.png", 1000, "soft_top")
    hide_for_cranial = [
        o
        for o in muscles
        if ("static" in o.name.lower() or "plastyma" in o.name.lower() or "platysma" in o.name.lower())
    ]
    set_hide_render(hide_for_cranial, True)
    render_top(cranial_objs(muscles), dest / "muscle_top_cranial.png", 1000, "cranial_top")
    set_hide_render(hide_for_cranial, False)
    C.export_glb(OUT / "glb" / f"{TAG}.glb", muscles)

    not_sphere = width_ratio <= WIDTH_GATE
    judgment = {
        "chain": "v1→v3→v4→v5→v6→v7",
        "width_ratio": width_ratio,
        "depth_ratio": depth_ratio,
        "not_sphere_gate": not_sphere,
        "width_gate": WIDTH_GATE,
        "review_ortho": True,
        "agent_pass": False,
    }
    report = {
        "tag": TAG,
        "note": "自v6：再补后枕+下颌；颧宽微收，锁宽防球头",
        "from": "SHELL_v6.blend",
        "params": {
            "occip_y": OCCIP_Y,
            "crown_z": CROWN_Z,
            "cheek_x": CHEEK_X,
            "chin_y": CHIN_Y,
            "jaw_z": JAW_Z,
        },
        "before": before,
        "after": after,
        "judgment": judgment,
    }
    C.write_json(dest / "skull_report.json", report)
    for cn, en in [
        ("正", "front"),
        ("侧", "side"),
        ("前侧", "front_three_quarter"),
        ("后侧", "rear_three_quarter"),
        ("背面", "back"),
    ]:
        src = C.ROOT / f"Base15_{cn}.png"
        if src.exists():
            shutil.copy2(src, OUT / "base15" / f"{en}.png")

    cands = [
        {"id": TAG, "blend": f"{TAG}.blend", "note": report["note"], "glb": True},
        {"id": "SHELL_v6", "blend": "SHELL_v6.blend", "note": "上版·后枕加强", "glb": True},
        {"id": "SHELL_v5", "blend": "SHELL_v5.blend", "note": "轻颧宽", "glb": True},
        {"id": "SHELL_v1", "blend": "SHELL_v1.blend", "note": "基线·约60分", "glb": True},
        {"id": "SHELL_v2", "blend": "SHELL_v2.blend", "note": "坏例·球形头颅", "glb": True},
    ]
    C.write_json(
        OUT / "manifest.json",
        {
            "candidates": cands,
            "stage": TAG,
            "default_review": TAG,
            "never_promote": ["SHELL_v2"],
            "review_ortho": True,
            "primary_views": ["front", "side", "back"],
        },
    )
    print(json.dumps(judgment, ensure_ascii=False))
    if not not_sphere:
        print(f"[WARN] width_ratio {width_ratio:.3f} > gate {WIDTH_GATE}")
    print(f"[{TAG}] done — ortho primary review")


if __name__ == "__main__":
    main()
