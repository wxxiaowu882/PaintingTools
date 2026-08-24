# -*- coding: utf-8
"""Q8c: gentle dome round from Q7e — fix pointy cap without chopping."""
from __future__ import annotations

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
import q6b_force_recolor_export as Q6B  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.STAGES / "Q8c_gentle_dome"
SOURCE = C.CHECKPOINTS / "Q7e_depth_fix.blend"
PY = shutil.which("python") or shutil.which("python3")


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def gentle_dome_cap(muscles, strength: float = 0.28):
    static = C.get_obj("muscle", "Static")
    center, size = C.bbox_center_size([static])
    z_start = center.z + size.z * 0.30
    z_top = center.z + size.z * 0.50
    span = max(z_top - z_start, 1e-6)

    for obj in muscles:
        me = obj.data
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            if w.z <= z_start:
                continue
            t = smooth_step((w.z - z_start) / span)
            # only upper tip — round, not chop
            w.z = w.z - strength * t * t * t * (w.z - z_start)
            w.x = center.x + (w.x - center.x) * (1.0 + 0.08 * t)
            w.y = center.y + (w.y - center.y) * (1.0 + 0.05 * t)
            v.co = obj.matrix_world.inverted() @ w
        me.update()


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True

    muscles = C.muscle_exportable()
    print("[Q8c] gentle dome from Q7e")
    gentle_dome_cap(muscles, 0.28)

    lat = Q7.make_lattice(muscles, "DomeSmooth", 11)
    Q8.deform_base15_profile(lat)
    Q7.apply_lattice(muscles, lat)

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    Q8.force_recolor()

    C.set_group_visibility("skull", False)
    C.render_views(OUT / "after", muscles, "muscle", res=1000)
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

    proc = subprocess.run(
        [PY, str(SCRIPTS / "base15_silhouette_eval.py"), str(OUT), "after"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(proc.stdout)

    import json

    rp = OUT / "base15_eval_after.json"
    ev = json.loads(rp.read_text(encoding="utf-8")) if rp.exists() else {"pass": False}
    subprocess.run([PY, str(SCRIPTS / "make_collages.py"), "Q8c_gentle_dome", "after"], check=False)

    C.save_blend(C.CHECKPOINTS / "Q8c_gentle_dome.blend")
    # Always save candidate; export GLB only if side IoU improved vs Q7e baseline (0.484)
    side_iou = ev.get("side_iou") or 0
    print(f"[Q8c] side IoU={side_iou}")
    if side_iou >= 0.484:
        C.export_glb(C.GLB_FINAL, muscles)
        C.save_blend(C.BLEND_FINAL)
        print("[Q8c] exported (IoU improved)")
    else:
        print("[Q8c] kept Q7e GLB; review renders in stages/Q8c_gentle_dome/after/")


if __name__ == "__main__":
    main()
