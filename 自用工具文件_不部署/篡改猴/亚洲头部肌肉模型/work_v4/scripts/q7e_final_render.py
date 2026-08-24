# -*- coding: utf-8 -*-
"""Render final muscle views from saved Q7e checkpoint (post-recolor)."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402

OUT = C.STAGES / "Q7e_depth_fix" / "final"
BLEND = C.CHECKPOINTS / "Q7e_depth_fix.blend"


def main():
    C.ensure_dirs(OUT)
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    C.set_group_visibility("skull", False)
    C.render_views(OUT, muscles, "muscle", res=1000)
    static = C.get_obj("muscle", "Static")
    center, size = C.bbox_center_size([static])
    cam_data = bpy.data.cameras.new("TopCam")
    cam = bpy.data.objects.new("TopCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = center + Vector((0, 0, max(size) * 2.2))
    cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = str(OUT / "muscle_top.png")
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    C.set_group_visibility("skull", True)
    print("[final render] done", OUT)


if __name__ == "__main__":
    main()
