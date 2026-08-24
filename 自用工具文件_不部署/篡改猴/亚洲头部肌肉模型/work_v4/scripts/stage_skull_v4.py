# -*- coding: utf-8 -*-
"""SKULL_v4: correct the v2/v3 mistakes with agent eye-loop.

Root cause (measured on Q1_recolor):
  skull AABB          y/x ≈ 1.37
  Mesh_Deform cranial y/x ≈ 1.39   ← already human cranial oval
  Static (w/ ears)    y/x ≈ 0.675  ← ears inflate width; NOT cranial truth

v2: sx=1.20 sy=0.88 → crushed real cranial AP → pancake (obvious on top/back)
v3: chased Static y/x→0.88 with sy=1.43 → overstretched vault + ear/shoulder wings

v4 rule: do NOT drive Soft AABB with ears. Keep cranial depth ≈ skull;
mild face widen only; multi-view + cranial-only top for agent self-check.
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
import q8_base_profile as Q8  # noqa: E402

OUT = C.WORK / "compare_review"
BASE = C.CHECKPOINTS / "Q1_recolor.blend"
TAG = "SKULL_v4"

# Mild Asian face widen; preserve AP (sy≈1). Slight height settle.
SX, SY, SZ = 1.10, 1.00, 0.98


def bone_objs():
    skull = C.get_obj("skull", "UnifiedSkull")
    mandible = C.get_obj("skull", "Mandible")
    return [o for o in (skull, mandible) if o]


def cranial_objs(muscles):
    """Meshes that represent cranial vault better than ear-inflated Static."""
    out = []
    for o in muscles:
        n = o.name.lower()
        if "plastyma" in n or "platysma" in n:
            continue
        if "deform" in n or "skiedras" in n:
            out.append(o)
    return out or [C.get_obj("muscle", "Static")]


def metrics_pair(tag: str, muscles):
    st = C.get_obj("muscle", "Static")
    soft = Q7.metrics(f"{tag}_soft")
    cr = cranial_objs(muscles)
    c, s = C.bbox_center_size(cr)
    dw = s.y / max(s.x, 1e-8)
    hw = s.z / max(s.x, 1e-8)
    print(f"[{tag}_cranial] size=({s.x:.4f},{s.y:.4f},{s.z:.4f}) depth/width={dw:.3f} height/width={hw:.3f}")
    bones = bone_objs()
    _, bs = C.bbox_center_size(bones)
    bdw = bs.y / max(bs.x, 1e-8)
    print(f"[{tag}_skull] depth/width={bdw:.3f}")
    return {
        "soft": soft,
        "cranial": {"size": [s.x, s.y, s.z], "depth_over_width": dw, "height_over_width": hw},
        "skull_yx": bdw,
    }


def uniform_align_to_skull(muscles):
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    b_c, b_s = C.bbox_center_size(bones)
    _, m_s = C.bbox_center_size([static])
    uni = (b_s.z / max(m_s.z, 1e-8)) * 1.02
    print(f"[v4] uniform={uni:.4f}")

    root = C.parent_empty("MuscleRoot", muscles)
    root["asset_group"] = "muscle"
    root.scale = (uni, uni, uni)
    bpy.context.view_layer.update()

    m_c2, _ = C.bbox_center_size([static])
    _, b_max = C.world_bbox(bones)
    _, m_max = C.world_bbox([static])
    root.location += Vector(
        (
            b_c.x - m_c2.x,
            b_c.y - m_c2.y,
            (b_max.z - m_max.z) * 0.90 + (b_c.z - m_c2.z) * 0.10,
        )
    )
    bpy.context.view_layer.update()

    bpy.ops.object.select_all(action="DESELECT")
    for obj in muscles:
        obj.select_set(True)
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.data.objects.remove(root, do_unlink=True)
    C.apply_object_transforms(muscles)
    return uni


def face_widen_lattice(muscles, sx, sy, sz):
    """Widen mid-face more than ear tips; keep AP nearly 1:1."""
    lat = Q7.make_lattice(muscles, "V4_FACE", 9)
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    def smooth_step(t: float) -> float:
        t = max(0.0, min(1.0, t))
        return t * t * (3.0 - 2.0 * t)

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                lx = max(-1.0, min(1.0, co.x * 2.0))
                ly = max(-1.0, min(1.0, co.y * 2.0))
                lz = max(-1.0, min(1.0, co.z * 2.0))

                # Ear tips sit at extreme |x|; soften widen there so top view isn't hammerhead
                ear = smooth_step((abs(lx) - 0.55) / 0.45)
                face = 1.0 - 0.65 * ear
                # Slight cheek bias (mid z, forward-mid y)
                cheek = smooth_step(1.0 - abs(lz - 0.05) / 0.7) * smooth_step(1.0 - abs(ly + 0.15) / 0.85)

                x_mul = 1.0 + (sx - 1.0) * (0.55 + 0.45 * face) * (0.7 + 0.3 * cheek)
                y_mul = sy
                z_mul = sz

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
    b_c, _ = C.bbox_center_size(bones)
    m_c, _ = C.bbox_center_size([static])
    delta = b_c - m_c
    for obj in muscles:
        obj.location += delta
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
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    C.hide_aux_skull()
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    try:
        Q8.force_recolor()
    except Exception as e:
        print(f"[warn] recolor: {e}")

    metrics_pair("before", muscles)
    uni = uniform_align_to_skull(muscles)
    metrics_pair("after_uni", muscles)

    print(f"[v4] face_widen sx={SX} sy={SY} sz={SZ}")
    face_widen_lattice(muscles, SX, SY, SZ)
    recenter_to_skull(muscles)
    after = metrics_pair("SKULL_v4", muscles)

    C.save_blend(C.CHECKPOINTS / f"{TAG}.blend")

    C.set_group_visibility("skull", False)
    dest = OUT / "ours" / TAG
    C.render_views(dest, muscles, "muscle", res=1000)
    render_top(muscles, dest / "muscle_top.png", 1000, "soft_top")

    # Cranial-only top: hide Static + Platysma so ears/neck don't fake pancake/wings
    hide_for_cranial = []
    for o in muscles:
        n = o.name.lower()
        if "static" in n or "plastyma" in n or "platysma" in n:
            hide_for_cranial.append(o)
    set_hide_render(hide_for_cranial, True)
    cr = cranial_objs(muscles)
    render_top(cr, dest / "muscle_top_cranial.png", 1000, "cranial_top")
    set_hide_render(hide_for_cranial, False)

    render_side_extra(muscles, dest, 900)

    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True
    C.export_glb(OUT / "glb" / f"{TAG}.glb", muscles)

    cyx = float(after["cranial"]["depth_over_width"])
    chw = float(after["cranial"]["height_over_width"])
    syx = float(after["skull_yx"])
    judgment = {
        "method": "agent_eye_loop_v4",
        "lesson": "Never chase Static(ear) y/x; compare cranial meshes to skull",
        "cranial_yx": cyx,
        "cranial_hw": chw,
        "skull_yx": syx,
        "cranial_near_skull": abs(cyx - syx) < 0.25,
        "not_v2_pancake": cyx > 1.05,
        "not_v3_overstretch": cyx < 1.70,
        "views": ["front", "side", "back", "top_soft", "top_cranial", "side_extra", "3q"],
    }
    report = {
        "tag": TAG,
        "note": "纠正v2扁盘/v3硬拉：保颅深≈头骨，只轻加面宽；颅顶自检不含耳",
        "uni": uni,
        "eye_fix": {"sx": SX, "sy": SY, "sz": SZ, "mode": "face_widen_protect_ears"},
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
        {"id": "SKULL_v3", "blend": "SKULL_v3.blend", "note": "坏例·追耳包络硬拉前后深", "glb": True},
        {"id": "SKULL_v2", "blend": "SKULL_v2.blend", "note": "坏例·前后过扁", "glb": True},
        {"id": "SKULL_v1", "blend": "SKULL_v1.blend", "note": "坏例·头骨AABB正视过窄", "glb": True},
    ]
    C.write_json(OUT / "manifest.json", {"candidates": cands, "stage": "SKULL_v4_cranial_truth"})
    print(json.dumps(judgment, ensure_ascii=False))
    print("[SKULL_v4] done — agent must eye-check before claiming pass")


if __name__ == "__main__":
    main()
