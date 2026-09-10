# -*- coding: utf-8 -*-
"""Render only side/front compare views from current SHELL_v8.blend (fast check)."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402

TAG = "SHELL_v8"
OUT = C.WORK / "compare_review" / "ours" / TAG


def main():
    bpy.ops.wm.open_mainfile(filepath=str(C.CHECKPOINTS / f"{TAG}.blend"))
    C.hide_aux_skull()
    C.set_group_visibility("skull", False)
    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    try:
        import q8_base_profile as Q8

        Q8.force_recolor()
    except Exception as e:
        print(f"[warn] recolor: {e}")
    muscles = C.muscle_exportable()
    C.ensure_dirs(OUT)
    C.configure_eevee(1600)
    C.prepare_compare_render()
    views = [("front", 0.0, 0.0), ("side", -90.0, 0.0)]
    for name, yaw, pitch in views:
        for obj in list(bpy.data.objects):
            if obj.type in {"CAMERA", "LIGHT"}:
                bpy.data.objects.remove(obj, do_unlink=True)
        C.setup_lighting(muscles, yaw_deg=yaw, back_boost=False)
        C.setup_camera_for_objs(muscles, yaw, pitch)
        path = OUT / f"muscle_{name}.png"
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        C.finalize_compare_png(path, flip_h=(name == "side"))
        print(f"[render] {path}")
    glb = C.WORK / "compare_review" / "glb" / f"{TAG}.glb"
    C.ensure_dirs(glb.parent)
    C.export_glb(glb, muscles)
    print(f"[export] {glb}")


if __name__ == "__main__":
    main()
