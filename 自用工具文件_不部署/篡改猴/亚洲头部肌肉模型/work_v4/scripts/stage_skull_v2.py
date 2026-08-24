# -*- coding: utf-8
"""SKULL_v2: human-eye fix after v1 — widen + shorten AP + slight height trim.

v1 skull-AABB used sx=0.85 sy=1.15 → front too skinny, top too long.
Side was OK-ish; protect it. No profile-RMSE. Judge by front/side/top renders.
"""
from __future__ import annotations

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
TAG = "SKULL_v2"


def bone_objs():
    skull = C.get_obj("skull", "UnifiedSkull")
    mandible = C.get_obj("skull", "Mandible")
    return [o for o in (skull, mandible) if o]


def uniform_align_to_skull(muscles):
    """Uniform height scale + center — keep euro relative shape."""
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    b_c, b_s = C.bbox_center_size(bones)
    _, m_s = C.bbox_center_size([static])
    uni = (b_s.z / max(m_s.z, 1e-8)) * 1.02
    print(f"[v2] uniform={uni:.4f}")

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
    """Gentle global reshape judged for front/top/side balance."""
    lat = Q7.make_lattice(muscles, "EYE_FIX", 7)
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
    """Top-down orthographic-ish view for roundness check."""
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


def recenter_to_skull(muscles):
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    b_c, _ = C.bbox_center_size(bones)
    m_c, _ = C.bbox_center_size([static])
    delta = b_c - m_c
    for obj in muscles:
        obj.location += delta
    C.apply_object_transforms(muscles)


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

    Q7.metrics("before")
    uni = uniform_align_to_skull(muscles)
    Q7.metrics("after_uni")

    # Human-eye correction (NOT skull AABB):
    # front: too skinny → widen; top: too long AP → shorten depth; slight height trim
    # Values chosen so side silhouette stays close to "better" side feel of v1.
    sx, sy, sz = 1.20, 0.88, 0.93
    print(f"[v2] eye_fix sx={sx} sy={sy} sz={sz}")
    eye_fix_lattice(muscles, sx, sy, sz)
    recenter_to_skull(muscles)
    after = Q7.metrics("SKULL_v2")

    C.save_blend(C.CHECKPOINTS / f"{TAG}.blend")

    C.set_group_visibility("skull", False)
    dest = OUT / "ours" / TAG
    C.render_views(dest, muscles, "muscle", res=1000)
    render_top(muscles, dest / "muscle_top.png", 1000)

    C.set_group_visibility("skull", False)
    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True
    C.export_glb(OUT / "glb" / f"{TAG}.glb", muscles)

    report = {
        "tag": TAG,
        "note": "人眼纠偏：加宽+略收前后深+略降颅高（保留侧视观感，纠正正/顶离谱）",
        "uni": uni,
        "eye_fix": {"sx": sx, "sy": sy, "sz": sz},
        "after": after,
        "judgment": {
            "front": "v1过窄过高→加宽、略降高",
            "top": "v1前后过长过窄→加宽、收深",
            "side": "v1已改善→只轻收深，避免再扁",
        },
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
        {"id": "SKULL_v1", "blend": "SKULL_v1.blend", "note": "上版·头骨AABB（正/顶别扭）", "glb": True},
        {"id": "PROP_v2", "blend": "PROP_v2.blend", "note": "已废弃坏例", "glb": True},
    ]
    C.write_json(OUT / "manifest.json", {"candidates": cands, "stage": "SKULL_v2_eye_fix"})
    print("[SKULL_v2] done — review front/side/top + 3D GLB with human eye")


if __name__ == "__main__":
    main()
