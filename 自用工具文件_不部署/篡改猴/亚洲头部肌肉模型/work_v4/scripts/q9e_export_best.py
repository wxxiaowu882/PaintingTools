# -*- coding: utf-8
"""Export Q9_skull_dome checkpoint — best Base15 cranial overlay so far."""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

SOURCE = C.CHECKPOINTS / "Q9_skull_dome.blend"
PY = shutil.which("python") or shutil.which("python3")


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    Q8.force_recolor()

    out_stage = C.STAGES / "Q9_export"
    C.ensure_dirs(out_stage / "final")
    C.set_group_visibility("skull", False)
    C.render_views(out_stage / "final", muscles, "muscle", res=1000)
    C.set_group_visibility("skull", True)

    subprocess.run([PY, str(SCRIPTS / "base15_silhouette_eval.py"), str(out_stage), "final"], check=False)
    subprocess.run([PY, str(SCRIPTS / "make_collages.py"), "Q9_export", "final"], check=False)

    preview = C.WORK / "asian_head_muscles_base15_preview.glb"
    C.export_glb(preview, muscles)
    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.BLEND_FINAL)
    C.save_blend(C.CHECKPOINTS / "Q9_export_final.blend")
    print(f"[export] preview + final GLB updated from Q9_skull_dome")
    print(f"[export] review {out_stage / 'final' / 'compare_Base15_side.png'}")


if __name__ == "__main__":
    main()
