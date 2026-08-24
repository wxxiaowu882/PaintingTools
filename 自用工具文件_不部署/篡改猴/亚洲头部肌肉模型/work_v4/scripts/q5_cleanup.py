# -*- coding: utf-8 -*-
"""Q5: layer cleanup, normals, slight fiber/normal strength."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402


def offset_layer(substr: str, along=Vector((0, 0, 0)), scale=1.0):
    obj = C.get_obj("muscle", substr)
    if not obj:
        return
    obj.location += along
    if scale != 1.0:
        obj.scale *= scale
    C.apply_object_transforms([obj])


def bump_normal_strength(factor=1.25):
    for obj in C.muscle_exportable():
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            for n in mat.node_tree.nodes:
                if n.type == "NORMAL_MAP" and "Strength" in n.inputs:
                    n.inputs["Strength"].default_value = min(2.0, n.inputs["Strength"].default_value * factor)


def hide_tiny_helpers():
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
            o.hide_viewport = True


def darken_eyes():
    obj = C.get_obj("muscle", "Acs")
    if not obj:
        return
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        p = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if p and "Base Color" in p.inputs and not p.inputs["Base Color"].is_linked:
            p.inputs["Base Color"].default_value = (0.10, 0.08, 0.06, 1.0)


def main():
    C.ensure_dirs(C.STAGES / "Q5", C.CHECKPOINTS)
    packed = C.CHECKPOINTS / "Q4_packed.blend"
    src = packed if packed.exists() else (C.CHECKPOINTS / "Q4_regional.blend")
    bpy.ops.wm.open_mainfile(filepath=str(src))
    hide_tiny_helpers()
    darken_eyes()
    # tiny outward offset on deform overlay to reduce z-fight with Static
    offset_layer("Deform", along=Vector((0.0, -0.0008, 0.0)))
    offset_layer("Skiedras", along=Vector((0.0, -0.0004, 0.0)))
    muscles = C.muscle_exportable()
    C.fix_normals(muscles)
    bump_normal_strength(1.2)
    C.assert_head_scale([C.get_obj("muscle", "Static")], 0.18, "Q5")
    C.make_skull_transparent(0.24)
    C.render_views(C.STAGES / "Q5", C.visible_skull_muscle(), "overlay", res=1000)
    C.set_group_visibility("skull", False)
    C.render_views(C.STAGES / "Q5", C.muscle_exportable(), "muscle", res=1000)
    C.set_group_visibility("skull", True)
    C.save_blend(C.CHECKPOINTS / "Q5_cleanup.blend")
    C.write_notes(C.STAGES / "Q5", "# Q5 cleanup\n\nDeform/Skiedras micro-offset, normals, stronger fiber normals.\n")
    print("[Q5] done")


if __name__ == "__main__":
    main()
