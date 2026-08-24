# -*- coding: utf-8 -*-
"""SHELL_v3: continue FROM SHELL_v1 (user ~60). NEVER from SHELL_v2 sphere.

User: SHELL_v1 usable; SHELL_v2 spherical disaster — do not promote.
Goal vs Base15 side: restore some occiput depth/volume without ballooning
into a ball. Multi-view eye vs Base15; agent owns proportion judgment.
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
BASE = C.CHECKPOINTS / "SHELL_v1.blend"  # locked baseline
TAG = "SHELL_v3"

# Mild occiput restore only (Base15 side has more rear volume than v1)
OCCIP_Y = 1.10  # rear AP expand
CROWN_Z = 1.04  # slight rear vault
FACE_LOCK = 0.15  # how much front half may move (keep low)


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


def occiput_restore_lattice(muscles):
    """Expand rear vault only — never global sphere widen like SHELL_v2."""
    lat = Q7.make_lattice(muscles, "OCCIP_V3", 9)
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
                front = smooth_step((-ly + 0.1) / 0.8)
                vault = smooth_step((lz + 0.15) / 0.75)
                # Keep lateral width almost unchanged (sphere disaster was +X)
                side = smooth_step((abs(lx) - 0.2) / 0.8)

                y_mul = 1.0 + (OCCIP_Y - 1.0) * rear * (0.45 + 0.55 * vault) * (1.0 - FACE_LOCK * front)
                z_mul = 1.0 + (CROWN_Z - 1.0) * rear * vault * (1.0 - 0.35 * side)
                # tiny cheek calm only — no brachy balloon
                x_mul = 1.0 - 0.02 * rear * side

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


def render_side_extra(muscles, dest: Path, res: int = 900):
    C.ensure_dirs(dest)
    C.configure_eevee(res)
    C.setup_world_white()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting()
    center, size = C.bbox_center_size(muscles)
    extent = max(size.x, size.y, size.z, 1e-6)
    dist = extent * 2.6
    shots = [
        ("muscle_side_opp.png", (center.x - dist, center.y, center.z), (1.5708, 0, -1.5708)),
        ("muscle_side_low.png", (center.x + dist * 0.95, center.y - dist * 0.25, center.z - extent * 0.15), (1.75, 0, 1.45)),
        ("muscle_side_high.png", (center.x + dist * 0.95, center.y + dist * 0.15, center.z + extent * 0.2), (1.35, 0, 1.65)),
    ]
    for name, loc, rot in shots:
        for obj in list(bpy.data.objects):
            if obj.type == "CAMERA":
                bpy.data.objects.remove(obj, do_unlink=True)
        cam_data = bpy.data.cameras.new("SideExtra")
        cam_data.lens = 50
        cam = bpy.data.objects.new("SideExtra", cam_data)
        bpy.context.scene.collection.objects.link(cam)
        cam.location = loc
        cam.rotation_euler = rot
        bpy.context.scene.camera = cam
        path = dest / name
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        print(f"[render] {path}")


def set_hide_render(objs, hide: bool):
    for o in objs:
        o.hide_render = hide
        o.hide_set(hide)


def main():
    C.ensure_dirs(OUT / "ours" / TAG, OUT / "glb", OUT / "base15", C.CHECKPOINTS)
    if not BASE.exists():
        raise FileNotFoundError(f"baseline missing: {BASE}")
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    C.hide_aux_skull()
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()

    before = metrics_pair("from_v1", muscles)
    print(f"[v3] occiput Y*{OCCIP_Y} crown Z*{CROWN_Z} (from SHELL_v1 only)")
    occiput_restore_lattice(muscles)
    recenter_to_skull(muscles)
    after = metrics_pair("SHELL_v3", muscles)

    # Soft gate: must not explode lateral width (v2 failure mode)
    bx = before["cranial"]["size"][0]
    ax = after["cranial"]["size"][0]
    by = before["cranial"]["size"][1]
    ay = after["cranial"]["size"][1]
    width_ratio = ax / max(bx, 1e-8)
    depth_ratio = ay / max(by, 1e-8)
    print(f"[v3] delta width={width_ratio:.3f} depth={depth_ratio:.3f} (want width~1.0, depth>1.0)")
    if width_ratio > 1.08:
        print("[v3] WARN width grew too much — review carefully vs sphere fail")

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
    render_side_extra(muscles, dest, 900)
    C.export_glb(OUT / "glb" / f"{TAG}.glb", muscles)

    judgment = {
        "baseline": "SHELL_v1",
        "rejected": "SHELL_v2_spherical_disaster",
        "change": "occiput AP + slight rear crown only",
        "width_ratio": width_ratio,
        "depth_ratio": depth_ratio,
        "not_sphere_gate": width_ratio <= 1.08 and depth_ratio >= 1.02,
        "agent_pass": False,
        "eye_vs_base15": [
            "side: occiput volume closer to Base15, not ball",
            "front: keep v1 ~60 width feel",
            "top_cranial: oval not circle/sphere",
            "back: not bobblehead from lateral balloon",
        ],
    }
    report = {
        "tag": TAG,
        "note": "自 SHELL_v1：只补后枕体积靠 Base15 侧视；禁止 v2 球形加宽",
        "from": "SHELL_v1.blend",
        "params": {"occip_y": OCCIP_Y, "crown_z": CROWN_Z},
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
        ("后侧2", "rear_three_quarter_2"),
        ("背面", "back"),
    ]:
        src = C.ROOT / f"Base15_{cn}.png"
        if src.exists():
            shutil.copy2(src, OUT / "base15" / f"{en}.png")

    cands = [
        {"id": TAG, "blend": f"{TAG}.blend", "note": report["note"], "glb": True},
        {"id": "SHELL_v1", "blend": "SHELL_v1.blend", "note": "基线·约60分（用户认可可继续）", "glb": True},
        {"id": "SHELL_v2", "blend": "SHELL_v2.blend", "note": "坏例·球形头颅（禁止再用）", "glb": True},
    ]
    C.write_json(
        OUT / "manifest.json",
        {
            "candidates": cands,
            "stage": "SHELL_v3_from_v1",
            "agent_note": "Default review SHELL_v3 then SHELL_v1. Never promote SHELL_v2.",
        },
    )
    print(json.dumps(judgment, ensure_ascii=False))
    print("[SHELL_v3] done — agent must eye-check vs Base15; v2 remains rejected")


if __name__ == "__main__":
    main()
