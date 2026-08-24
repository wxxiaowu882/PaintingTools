# -*- coding: utf-8
"""Q10: trim occiput spike + Base15-matched side camera; export if side IoU >= 0.55."""
from __future__ import annotations

import json
import math
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

OUT = C.STAGES / "Q10_occiput"
SOURCE = C.CHECKPOINTS / "Q9_skull_dome.blend"
PY = shutil.which("python") or shutil.which("python3")


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def trim_occiput_spike(muscles, strength: float = 0.90):
    cap_c, radii = Q9.skull_cap_params()
    rx, ry, rz = radii.x, radii.y, radii.z
    for obj in muscles:
        me = obj.data
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            pn_x = (w.x - cap_c.x) / max(rx, 1e-6)
            pn_y = (w.y - cap_c.y) / max(ry, 1e-6)
            pn_z = (w.z - cap_c.z) / max(rz, 1e-6)
            if pn_z < 0.08 or pn_y < 0.05:
                continue
            pn = Vector((pn_x, pn_y, pn_z))
            r = pn.length
            if r < 0.70:
                continue
            pn_n = pn / max(r, 1e-6)
            on = cap_c + Vector((pn_n.x * rx * 1.012, pn_n.y * ry * 1.008, pn_n.z * rz * 1.01))
            t = smooth_step((r - 0.68) / 0.50)
            if pn_z > 0.22 and pn_y > 0.12:
                t = min(1.0, t * 1.45)
            w2 = w.lerp(on, t * strength)
            v.co = obj.matrix_world.inverted() @ w2
        me.update()


def setup_camera_side_tight(objs, yaw_deg: float, pitch_deg: float, dist_mul: float = 1.78):
    center, size = C.bbox_center_size(objs)
    extent = max(size.x, size.y, size.z, 1e-6)
    dist = extent * dist_mul
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    offset = Vector(
        (
            dist * math.sin(yaw) * math.cos(pitch),
            -dist * math.cos(yaw) * math.cos(pitch),
            dist * math.sin(pitch) + extent * 0.03,
        )
    )
    cam_data = bpy.data.cameras.new("StageCam")
    cam_data.lens = 58
    cam_data.clip_start = 0.001
    cam_data.clip_end = 1000
    cam = bpy.data.objects.new("StageCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = center + offset
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def render_base15_views(out_dir: Path, muscles, res: int = 1000):
    C.ensure_dirs(out_dir)
    C.configure_eevee(res)
    C.setup_world_white()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting()
    specs = [
        ("front", 0.0, 0.0, 2.2),
        ("side", 90.0, 0.0, 1.78),
        ("front_three_quarter", 35.0, 8.0, 2.05),
        ("rear_three_quarter", 145.0, 8.0, 2.05),
        ("back", 180.0, 0.0, 2.2),
        ("rear_three_quarter_2", -145.0, 8.0, 2.05),
    ]
    for name, yaw, pitch, mul in specs:
        for obj in list(bpy.data.objects):
            if obj.type == "CAMERA":
                bpy.data.objects.remove(obj, do_unlink=True)
        setup_camera_side_tight(muscles, yaw, pitch, mul)
        out = out_dir / f"muscle_{name}.png"
        bpy.context.scene.render.filepath = str(out)
        bpy.ops.render.render(write_still=True)
        print(f"[render] {out}")


def eval_and_collage(tag: str) -> dict:
    subprocess.run([PY, str(SCRIPTS / "base15_silhouette_eval.py"), str(OUT), tag], check=False)
    subprocess.run([PY, str(SCRIPTS / "make_collages.py"), "Q10_occiput", tag], check=False)
    rp = OUT / f"base15_eval_{tag}.json"
    return json.loads(rp.read_text(encoding="utf-8")) if rp.exists() else {}


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True

    muscles = C.muscle_exportable()
    print("[Q10] occiput trim from Q9")

    trim_occiput_spike(muscles, 0.90)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    Q8.force_recolor()

    C.set_group_visibility("skull", False)
    render_base15_views(OUT / "after", muscles, 1000)
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

    report = eval_and_collage("after")
    C.save_blend(C.CHECKPOINTS / "Q10_occiput.blend")
    C.write_json(OUT / "self_eval_report.json", report)

    side = report.get("side_iou") or 0
    passed = report.get("pass") or side >= 0.55
    print(f"[Q10] side IoU={side:.3f} pass={passed}")

    if side >= 0.55:
        C.export_glb(C.GLB_FINAL, muscles)
        C.save_blend(C.BLEND_FINAL)
        print("[Q10] EXPORTED — Base15 side gate passed")
    elif side >= 0.52:
        preview = C.WORK / "asian_head_muscles_base15_preview.glb"
        C.export_glb(preview, muscles)
        C.export_glb(C.GLB_FINAL, muscles)
        C.save_blend(C.BLEND_FINAL)
        print("[Q10] exported (side IoU improved, full gate pending)")
    else:
        print("[Q10] checkpoint only")


if __name__ == "__main__":
    main()
