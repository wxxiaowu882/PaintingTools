# -*- coding: utf-8 -*-
"""Side isolation of Static+Deform at the zygomatic arch (no geometry change)."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import common as C  # noqa: E402

import _fix_zygoma_arch_beam as F  # noqa: E402


def main():
    bpy.ops.wm.open_mainfile(filepath=str(C.CHECKPOINTS / "SHELL_v8.blend"))
    C.hide_aux_skull()
    C.set_group_visibility("skull", False)
    static = C.get_obj("muscle", "Static")
    deform = C.get_obj("muscle", "Deform")
    arch_z, arch_y = F.arch_anchor(static)
    keep = [static, deform]
    for o in C.mesh_objects():
        hide = o not in keep
        o.hide_render = hide
        o.hide_set(hide)
    C.flatten_solid_principled(static, (0.90, 0.88, 0.78, 1.0), unlink_normal=True)
    C.flatten_solid_principled(deform, (0.78, 0.16, 0.32, 1.0), unlink_normal=True)
    C.configure_eevee(1000)
    C.configure_color_management()
    C.setup_world_white(1.0)
    C.setup_compositor_white_bg()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting(keep, yaw_deg=-90.0)
    cam = C.setup_camera_for_objs(keep, -90.0, 0.0, padding=1.12)
    center, size = C.bbox_center_size(keep)
    cheek = Vector((center.x, arch_y, arch_z))
    extent = max(size.x, size.y, size.z)
    dist = extent * 2.2
    cam.data.ortho_scale = extent * 0.38
    cam.location = cheek + Vector((-dist, 0.0, 0.0))
    cam.rotation_euler = (cheek - cam.location).to_track_quat("-Z", "Y").to_euler()
    out = C.WORK / "compare_review" / "_probe_masseter" / "shell_v8_side_after.png"
    bpy.context.scene.render.filepath = str(out)
    bpy.ops.render.render(write_still=True)
    C.finalize_compare_png(out)
    print(f"[iso-side] {out} arch_z={arch_z:.4f} arch_y={arch_y:.4f}")


if __name__ == "__main__":
    main()
