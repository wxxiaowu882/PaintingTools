# -*- coding: utf-8 -*-
"""Q2: rigid-align entire muscle group to Asian skull."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402


def muscle_all():
    return [o for o in C.mesh_objects(C.objects_in_group("muscle"))]


def bone_objs():
    skull = C.get_obj("skull", "UnifiedSkull")
    mandible = C.get_obj("skull", "Mandible")
    return [o for o in (skull, mandible) if o]


def rigid_align():
    static = C.get_obj("muscle", "Static")
    muscles = muscle_all()
    bones = bone_objs()
    s_c, s_s = C.bbox_center_size(bones)
    _m_c, m_s = C.bbox_center_size([static])
    scale = (s_s.x / max(m_s.x, 1e-8)) * 1.08
    print(f"[Q2] scale={scale:.5f}")

    root = C.parent_empty("MuscleRoot", muscles)
    root["asset_group"] = "muscle"
    root.scale = (scale, scale, scale)
    bpy.context.view_layer.update()

    m_c2, _ = C.bbox_center_size([static])
    s_min, s_max = C.world_bbox(bones)
    m_min, m_max = C.world_bbox([static])
    root.location += Vector(
        (
            s_c.x - m_c2.x,
            (s_min.y - m_min.y) * 0.65 + (s_c.y - m_c2.y) * 0.15,
            (s_max.z - m_max.z) * 0.92,
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
    C.assert_head_scale([static], 0.18, "Q2")


def main():
    C.ensure_dirs(C.STAGES / "Q2", C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(C.CHECKPOINTS / "Q1_recolor.blend"))
    C.hide_aux_skull()
    rigid_align()
    C.make_skull_transparent(0.26)
    C.render_views(C.STAGES / "Q2", C.visible_skull_muscle(), "overlay", res=900)
    C.set_group_visibility("skull", False)
    C.render_views(C.STAGES / "Q2", C.muscle_exportable(), "muscle", res=900)
    C.set_group_visibility("skull", True)
    C.save_blend(C.CHECKPOINTS / "Q2_align.blend")
    C.write_notes(C.STAGES / "Q2", "# Q2 align\n\nRigid group scale/place onto UnifiedSkull+Mandible.\n")
    print("[Q2] done")


if __name__ == "__main__":
    main()
