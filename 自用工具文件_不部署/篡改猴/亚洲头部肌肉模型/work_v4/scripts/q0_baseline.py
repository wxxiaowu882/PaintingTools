# -*- coding: utf-8 -*-
"""Q0: clean baseline import + six-view renders."""
from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402


def main():
    C.ensure_dirs(C.WORK, C.STAGES / "Q0", C.CHECKPOINTS, C.TEXTURES)
    C.clear_scene()
    C.import_glb(C.SKULL_GLB, "skull")
    C.import_glb(C.MUSCLE_GLB, "muscle")
    C.hide_aux_skull()

    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True

    roles = {}
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        roles[o.name] = {
            "verts": len(o.data.vertices),
            "mats": [s.material.name if s.material else None for s in o.material_slots],
            "hidden": bool(o.hide_render),
        }
    C.write_json(C.STAGES / "Q0" / "mesh_roles.json", roles)

    C.set_group_visibility("muscle", False)
    C.render_views(C.STAGES / "Q0", C.mesh_objects(C.objects_in_group("skull")), "skull", res=768)
    C.set_group_visibility("skull", False)
    C.set_group_visibility("muscle", True)
    C.render_views(C.STAGES / "Q0", C.muscle_exportable(), "euro_muscle", res=900)
    C.set_group_visibility("skull", True)

    C.save_blend(C.CHECKPOINTS / "Q0_baseline.blend")
    C.write_notes(
        C.STAGES / "Q0",
        "# Q0 baseline\n\n- Clean euro muscle + asian skull imported.\n- See mesh_roles.json and euro_muscle_*.png.\n- Palette: textures/base15_palette.json\n",
    )
    print("[Q0] done")


if __name__ == "__main__":
    main()
