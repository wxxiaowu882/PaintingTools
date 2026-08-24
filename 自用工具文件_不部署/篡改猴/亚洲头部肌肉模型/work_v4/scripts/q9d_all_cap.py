# -*- coding: utf-8
"""Q9d: full muscle skull cap, NO lattice — best spike fix from Q9 overlay tests."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q8_base_profile as Q8  # noqa: E402
import q9_skull_dome as Q9  # noqa: E402

OUT = C.STAGES / "Q9d_all_cap"
SOURCE = C.CHECKPOINTS / "Q7e_depth_fix.blend"
PY = shutil.which("python") or shutil.which("python3")


def render_and_eval(muscles):
    C.ensure_dirs(OUT / "after")
    C.set_group_visibility("skull", False)
    C.render_views(OUT / "after", muscles, "muscle", res=850)
    static = C.get_obj("muscle", "Static")
    center, size = C.bbox_center_size([static])
    cam_data = bpy.data.cameras.new("TopCam")
    cam = bpy.data.objects.new("TopCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = center + Vector((0, 0, max(size) * 2.2))
    cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = str(OUT / "after" / "muscle_top.png")
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    C.set_group_visibility("skull", True)
    subprocess.run([PY, str(SCRIPTS / "base15_silhouette_eval.py"), str(OUT), "after"], check=False)
    subprocess.run([PY, str(SCRIPTS / "make_collages.py"), "Q9d_all_cap", "after"], check=False)
    rp = OUT / "base15_eval_after.json"
    return json.loads(rp.read_text(encoding="utf-8")) if rp.exists() else {}


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True

    muscles = C.muscle_exportable()
    print("[Q9d] all-muscle cap, no lattice")
    Q9.fit_cranial_cap(muscles, blend=0.84, shell=0.015)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    Q8.force_recolor()

    report = render_and_eval(muscles)
    C.save_blend(C.CHECKPOINTS / "Q9d_all_cap.blend")
    C.write_json(OUT / "self_eval_report.json", report)

    side = report.get("side_iou") or 0
    print(f"[Q9d] side IoU={side:.3f}")

    preview = C.WORK / "asian_head_muscles_base15_preview.glb"
    if side >= 0.48:
        C.export_glb(preview, muscles)
        print(f"[Q9d] preview GLB -> {preview}")
    if side >= 0.52:
        C.export_glb(C.GLB_FINAL, muscles)
        C.save_blend(C.BLEND_FINAL)
        print("[Q9d] EXPORTED final GLB")


if __name__ == "__main__":
    main()
