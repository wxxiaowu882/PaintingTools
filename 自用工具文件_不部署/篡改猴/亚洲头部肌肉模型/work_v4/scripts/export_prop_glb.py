# -*- coding: utf-8
"""Export PROP_v1/v2 GLB into compare_review/glb for the review page viewer."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT_GLB = C.WORK / "compare_review" / "glb"
TAGS = ["PROP_v1", "PROP_v2"]


def export_one(tag: str):
    src = C.CHECKPOINTS / f"{tag}.blend"
    if not src.exists():
        print(f"[skip] missing {src}")
        return
    bpy.ops.wm.open_mainfile(filepath=str(src))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
            o.hide_set(True)
    muscles = C.muscle_exportable()
    try:
        Q8.force_recolor()
    except Exception as e:
        print(f"[warn] recolor {tag}: {e}")
    C.set_group_visibility("skull", False)
    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True
    dest = OUT_GLB / f"{tag}.glb"
    C.export_glb(dest, muscles)
    print(f"[ok] {dest}")


def main():
    C.ensure_dirs(OUT_GLB)
    for tag in TAGS:
        export_one(tag)


if __name__ == "__main__":
    main()
