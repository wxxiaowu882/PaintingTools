# -*- coding: utf-8
"""Q9b: ellipsoid cap on Static (+ light Deform) only."""
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

OUT = C.STAGES / "Q9b_static_cap"
SOURCE = C.CHECKPOINTS / "Q7e_depth_fix.blend"
PY = shutil.which("python") or shutil.which("python3")


def render_tag(tag: str, muscles):
    C.ensure_dirs(OUT / tag)
    C.set_group_visibility("skull", False)
    C.render_views(OUT / tag, muscles, "muscle", res=1000)
    static = C.get_obj("muscle", "Static")
    center, size = C.bbox_center_size([static])
    cam_data = bpy.data.cameras.new("TopCam")
    cam = bpy.data.objects.new("TopCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = center + Vector((0, 0, max(size) * 2.2))
    cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = str(OUT / tag / "muscle_top.png")
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    C.set_group_visibility("skull", True)


def eval_tag(tag: str) -> dict:
    subprocess.run(
        [PY, str(SCRIPTS / "base15_silhouette_eval.py"), str(OUT), tag],
        check=False,
    )
    rp = OUT / f"base15_eval_{tag}.json"
    return json.loads(rp.read_text(encoding="utf-8")) if rp.exists() else {}


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True

    muscles = C.muscle_exportable()
    static = C.get_obj("muscle", "Static")
    print("[Q9b] Static-only ellipsoid cap")

    render_tag("before", muscles)
    ev0 = eval_tag("before")
    print("[Q9b] before side IoU", ev0.get("side_iou"))

    Q9.fit_cranial_cap([static], blend=0.92, shell=0.018)
    for obj in muscles:
        if obj != static and "Deform" in obj.name:
            Q9.fit_cranial_cap([obj], blend=0.45, shell=0.010)

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    Q8.force_recolor()

    render_tag("after", muscles)
    report = eval_tag("after")
    subprocess.run([PY, str(SCRIPTS / "make_collages.py"), "Q9b_static_cap", "after"], check=False)
    C.save_blend(C.CHECKPOINTS / "Q9b_static_cap.blend")
    C.write_json(OUT / "self_eval_report.json", {"before": ev0, "after": report})

    side = report.get("side_iou") or 0
    side0 = ev0.get("side_iou") or 0
    print(f"[Q9b] side IoU {side0:.3f} -> {side:.3f}")

    if side >= max(0.52, side0 - 0.01):
        C.export_glb(C.GLB_FINAL, muscles)
        C.save_blend(C.BLEND_FINAL)
        print("[Q9b] exported candidate GLB")
    else:
        print("[Q9b] no export — see stages/Q9b_static_cap/after/")


if __name__ == "__main__":
    main()
