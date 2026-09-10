# -*- coding: utf-8 -*-
"""Export SHELL_v8.glb from latest checkpoint (no full re-render)."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q8_base_profile as Q8  # noqa: E402


def main():
    src = C.CHECKPOINTS / "SHELL_v8.blend"
    bpy.ops.wm.open_mainfile(filepath=str(src))
    C.hide_aux_skull()
    C.set_group_visibility("skull", False)
    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True
    try:
        Q8.force_recolor()
    except Exception as e:
        print(f"[warn] recolor: {e}")
    dest = C.WORK / "compare_review" / "glb" / "SHELL_v8.glb"
    C.export_glb(dest, C.muscle_exportable())
    print(f"[done] {dest}")


if __name__ == "__main__":
    main()
