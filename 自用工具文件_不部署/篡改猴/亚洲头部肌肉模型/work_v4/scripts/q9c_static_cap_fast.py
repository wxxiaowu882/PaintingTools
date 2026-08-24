# -*- coding: utf-8
"""Q9c: fast Static-only skull cap — skip before render if exists."""
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

OUT = C.STAGES / "Q9c_static_cap"
SOURCE = C.CHECKPOINTS / "Q7e_depth_fix.blend"
PY = shutil.which("python") or shutil.which("python3")
RES = 850


def render_tag(tag: str, muscles):
    C.ensure_dirs(OUT / tag)
    C.set_group_visibility("skull", False)
    C.render_views(OUT / tag, muscles, "muscle", res=RES)
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
    subprocess.run([PY, str(SCRIPTS / "base15_silhouette_eval.py"), str(OUT), tag], check=False)
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
    print("[Q9c] Static-only cap, no lattice")

    Q9.fit_cranial_cap([static], blend=0.90, shell=0.017)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    Q8.force_recolor()

    render_tag("after", muscles)
    report = eval_tag("after")
    subprocess.run([PY, str(SCRIPTS / "make_collages.py"), "Q9c_static_cap", "after"], check=False)
    C.save_blend(C.CHECKPOINTS / "Q9c_static_cap.blend")
    C.write_json(OUT / "self_eval_report.json", report)

    side = report.get("side_iou") or 0
    outer = report.get("views", {}).get("side", {}).get("outer_profile_rmse", 99)
    print(f"[Q9c] side IoU={side:.3f} outer={outer:.4f}")

    # export if side IoU >= 0.50 (Q7e baseline ~0.48-0.53)
    if side >= 0.50:
        C.export_glb(C.GLB_FINAL, muscles)
        C.save_blend(C.BLEND_FINAL)
        print("[Q9c] EXPORTED")
    else:
        print("[Q9c] checkpoint only — review compare_Base15_side.png")


if __name__ == "__main__":
    main()
