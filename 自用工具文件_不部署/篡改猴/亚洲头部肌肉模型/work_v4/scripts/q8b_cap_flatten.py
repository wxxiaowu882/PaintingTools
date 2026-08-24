# -*- coding: utf-8
"""Q8b: direct top-cap flatten + Base15 silhouette gate."""
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

OUT = C.STAGES / "Q8b_cap_flatten"
SOURCE = C.CHECKPOINTS / "Q8_base_FAIL.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def flatten_top_cap(muscles, strength: float = 0.55):
    """Crush cone/spike on highest verts; round dome like Base15."""
    static = C.get_obj("muscle", "Static")
    center, size = C.bbox_center_size([static])
    z_top = center.z + size.z * 0.42
    z_start = center.z + size.z * 0.12
    span = max(z_top - z_start, 1e-6)

    for obj in muscles:
        me = obj.data
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            if w.z <= z_start:
                continue
            t = smooth_step((w.z - z_start) / span)
            # cap height — strongest on tip
            w.z = w.z - strength * t * t * (w.z - z_start)
            # dome spread
            w.x = center.x + (w.x - center.x) * (1.0 + 0.14 * t)
            w.y = center.y + (w.y - center.y) * (1.0 + 0.10 * t)
            v.co = obj.matrix_world.inverted() @ w
        me.update()


def deform_occiput_smooth(lat):
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                lx = max(-1.0, min(1.0, co.x * 2.0))
                ly = max(-1.0, min(1.0, co.y * 2.0))
                lz = max(-1.0, min(1.0, co.z * 2.0))
                cranial = smooth_step((lz + 0.1) / 0.85)
                top = smooth_step((lz - 0.05) / 0.55) * cranial
                new = co.copy()
                new.z = co.z * (1.0 - 0.20 * top)
                occ = smooth_step((ly + 0.08) / 0.5) * smooth_step((lz + 0.0) / 0.45) * cranial
                new.y = co.y * (1.0 + 0.08 * occ)
                neck = smooth_step((-lz - 0.2) / 0.55) * smooth_step((ly + 0.2) / 0.7)
                new.y = new.y * (1.0 - 0.18 * neck)
                p.co_deform = new
    bpy.context.view_layer.update()


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    src = SOURCE if SOURCE.exists() else C.CHECKPOINTS / "Q7e_depth_fix.blend"
    bpy.ops.wm.open_mainfile(filepath=str(src))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True

    muscles = C.muscle_exportable()
    print("[Q8b] flatten top cap from", src)

    flatten_top_cap(muscles, 0.62)
    lat = Q7.make_lattice(muscles, "CapSmooth", 11)
    deform_occiput_smooth(lat)
    Q7.apply_lattice(muscles, lat)

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    Q8.force_recolor()

    # render into Q8b OUT
    C.ensure_dirs(OUT / "after")
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

    report_path = OUT / "base15_eval_after.json"
    eval_report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {"pass": False}
    C.write_json(OUT / "self_eval_report.json", eval_report)

    side = eval_report.get("side_iou")
    print(f"[Q8b] side IoU={side}")

    if not eval_report.get("pass"):
        C.save_blend(C.CHECKPOINTS / "Q8b_cap_FAIL.blend")
        print("[Q8b] FAIL — saved checkpoint, no GLB overwrite")
        return

    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.CHECKPOINTS / "Q8b_cap_flatten.blend")
    C.save_blend(C.BLEND_FINAL)
    subprocess.run([PY, str(SCRIPTS / "make_collages.py"), "Q8b_cap_flatten", "after"], check=False)
    print("[Q8b] PASS")


if __name__ == "__main__":
    main()
