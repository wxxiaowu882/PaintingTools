# -*- coding: utf-8 -*-
"""One-shot: verify Static flatten + raw/grayworld front samples."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q8_base_profile as Q8  # noqa: E402


def main():
    bpy.ops.wm.open_mainfile(filepath=str(C.CHECKPOINTS / "SHELL_v8.blend"))
    C.hide_aux_skull()
    Q8.force_recolor()
    C.darken_static_albedo()
    C.flatten_static_shader()
    C.set_group_visibility("skull", False)

    st = C.get_obj("muscle", "Static")
    mat = st.material_slots[0].material
    p = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    links = [(l.from_node.type, l.to_socket.name) for l in mat.node_tree.links if l.to_node == p]
    print("AFTER flatten principled links:", links)
    print("Base Color default:", tuple(round(x, 3) for x in p.inputs["Base Color"].default_value))

    muscles = C.muscle_exportable()
    C.configure_eevee(800)
    C.prepare_compare_render()
    links2 = [(l.from_node.type, l.to_socket.name) for l in mat.node_tree.links if l.to_node == p]
    print("AFTER prepare principled links:", links2)
    print("Base Color default2:", tuple(round(x, 3) for x in p.inputs["Base Color"].default_value))

    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting()
    C.setup_camera_for_objs(muscles, 0.0, 0.0)

    out = C.WORK / "compare_review" / "_diag_front_raw.png"
    bpy.context.scene.render.filepath = str(out)
    bpy.ops.render.render(write_still=True)
    print("saved", out)

    C.setup_world_gray(1.0)
    out2 = C.WORK / "compare_review" / "_diag_front_grayworld.png"
    bpy.context.scene.render.filepath = str(out2)
    bpy.ops.render.render(write_still=True)
    print("saved", out2)


if __name__ == "__main__":
    main()
