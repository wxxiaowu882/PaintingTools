# -*- coding: utf-8 -*-
"""SKULL_v3: restore A-P depth after v2 pancake; agent owns eye-loop.

Facts (Q1_recolor):
  skull soft-bone AABB y/x ≈ 1.37 (depth > width)
  muscle Soft AABB y/x ≈ 0.675 (ears inflate width)
  SKULL_v2 used sx=1.20 sy=0.88 → y/x ≈ 0.495  (obvious flat top/back)

v3: keep modest widen, restore depth so top reads as oval/round human head,
not a flattened disc. Judge by front/side/top/back/3q — not profile RMSE.
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
TAG = "SKULL_v3"

# Soft-tissue target: slightly longer-or-equal AP than width after ears.
# Anthropometry brachycephalic ~ CI 80–85 → length/width ≈ 1.18–1.25 on bare skull;
# with ears, bbox y/x ~0.80–0.95 still reads as human oval, not pancake (<0.55) or bullet (>1.1).
TARGET_YX = 0.88


def bone_objs():
    skull = C.get_obj("skull", "UnifiedSkull")
    mandible = C.get_obj("skull", "Mandible")
    return [o for o in (skull, mandible) if o]


def uniform_align_to_skull(muscles):
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    b_c, b_s = C.bbox_center_size(bones)
    _, m_s = C.bbox_center_size([static])
    uni = (b_s.z / max(m_s.z, 1e-8)) * 1.02
    print(f"[v3] uniform={uni:.4f}")

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


def eye_fix_lattice(muscles, sx, sy, sz):
    lat = Q7.make_lattice(muscles, "EYE_FIX_V3", 7)
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                new = co.copy()
                new.x = co.x * sx
                new.y = co.y * sy
                new.z = co.z * sz
                p.co_deform = new
    bpy.context.view_layer.update()
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)


def render_top(muscles, path: Path, res: int = 1000):
    C.ensure_dirs(path.parent)
    C.configure_eevee(res)
    C.setup_world_white()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting()
    center, size = C.bbox_center_size(muscles)
    extent = max(size.x, size.y, size.z, 1e-6)
    cam_data = bpy.data.cameras.new("TopCam")
    cam_data.lens = 50
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = extent * 1.55
    cam = bpy.data.objects.new("TopCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = center + Vector((0, 0, extent * 2.4))
    cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print(f"[render] {path}")


def render_side_extra(muscles, dest: Path, res: int = 900):
    """Extra side angles for agent self-check (not only one canonical side)."""
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


def recenter_to_skull(muscles):
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    b_c, _ = C.bbox_center_size(bones)
    m_c, _ = C.bbox_center_size([static])
    delta = b_c - m_c
    for obj in muscles:
        obj.location += delta
    C.apply_object_transforms(muscles)


def pick_scales(base_yx: float):
    """Modest widen + restore depth toward TARGET_YX; avoid v1 skinny/tall."""
    # base_yx after uniform ≈ 0.675
    sx = 1.10
    # new_yx = base_yx * (sy / sx) → sy = TARGET_YX / base_yx * sx
    sy = (TARGET_YX / max(base_yx, 1e-6)) * sx
    sz = 0.97
    # Clamp so we don't recreate PROP giraffe / v1 bullet extremes
    sy = max(1.05, min(sy, 1.55))
    return sx, sy, sz


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

    before = Q7.metrics("before")
    uni = uniform_align_to_skull(muscles)
    after_uni = Q7.metrics("after_uni")
    base_yx = float(after_uni["depth_over_width"])

    sx, sy, sz = pick_scales(base_yx)
    print(f"[v3] eye_fix sx={sx:.3f} sy={sy:.3f} sz={sz:.3f} target_yx={TARGET_YX}")
    eye_fix_lattice(muscles, sx, sy, sz)
    recenter_to_skull(muscles)
    after = Q7.metrics("SKULL_v3")

    C.save_blend(C.CHECKPOINTS / f"{TAG}.blend")

    C.set_group_visibility("skull", False)
    dest = OUT / "ours" / TAG
    C.render_views(dest, muscles, "muscle", res=1000)
    render_top(muscles, dest / "muscle_top.png", 1000)
    render_side_extra(muscles, dest, 900)

    C.set_group_visibility("skull", False)
    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True
    C.export_glb(OUT / "glb" / f"{TAG}.glb", muscles)

    yx = float(after["depth_over_width"])
    hw = float(after["height_over_width"])
    judgment = {
        "method": "agent_eye_loop",
        "v2_fail": "y/x≈0.495 pancake — obvious on top/back/front",
        "target_yx": TARGET_YX,
        "got_yx": yx,
        "got_hw": hw,
        "gate_soft": {
            "yx_not_pancake": yx >= 0.75,
            "yx_not_bullet": yx <= 1.05,
            "hw_not_giraffe": hw <= 1.05,
        },
        "views_required": ["front", "side", "top", "back", "side_extra"],
    }

    report = {
        "tag": TAG,
        "note": "人眼自迭代：加回前后深，纠正 v2 顶视扁盘；多侧面自检",
        "uni": uni,
        "eye_fix": {"sx": sx, "sy": sy, "sz": sz},
        "before": before,
        "after_uni": after_uni,
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
        {"id": "SKULL_v2", "blend": "SKULL_v2.blend", "note": "上版·前后过扁（坏例）", "glb": True},
        {"id": "SKULL_v1", "blend": "SKULL_v1.blend", "note": "头骨AABB（正/顶别扭）", "glb": True},
    ]
    C.write_json(OUT / "manifest.json", {"candidates": cands, "stage": "SKULL_v3_restore_depth"})
    print(json.dumps(judgment, ensure_ascii=False))
    print("[SKULL_v3] done — agent must eye-check multi-view before claiming pass")


if __name__ == "__main__":
    main()
