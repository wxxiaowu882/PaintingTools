# -*- coding: utf-8 -*-
"""Re-render compare_review PNGs from an existing checkpoint (geometry unchanged)."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402

OUT = C.WORK / "compare_review"
TAG = "SHELL_v5"
for arg in reversed(sys.argv):
    if arg.startswith("SHELL_"):
        TAG = arg
        break
BLEND = C.CHECKPOINTS / f"{TAG}.blend"


def cranial_objs(muscles):
    out = []
    for o in muscles:
        n = o.name.lower()
        if "plastyma" in n or "platysma" in n:
            continue
        if "deform" in n or "skiedras" in n:
            out.append(o)
    return out or [C.get_obj("muscle", "Static")]


def render_top(objs, path: Path, res: int, label: str):
    C.ensure_dirs(path.parent)
    C.configure_eevee(res)
    C.prepare_compare_render()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting(objs, yaw_deg=0.0)
    center, size = C.bbox_center_size(objs)
    extent = max(size.x, size.y, size.z, 1e-6)
    cam_data = bpy.data.cameras.new("TopCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = extent * 1.45
    cam = bpy.data.objects.new("TopCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = center + Vector((0, 0, extent * 2.4))
    cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    C.finalize_compare_png(path)
    print(f"[render:{label}] {path}")


def set_hide_render(objs, hide: bool):
    for o in objs:
        o.hide_render = hide
        o.hide_set(hide)


def main():
    if not BLEND.exists():
        raise FileNotFoundError(BLEND)
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    C.hide_aux_skull()
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    dest = OUT / "ours" / TAG
    C.ensure_dirs(dest, OUT / "base15")

    try:
        import q8_base_profile as Q8

        Q8.force_recolor()
        C.darken_static_albedo()
        C.flatten_static_shader()
        print("[rerender] force_recolor once (before all views)")
    except Exception as e:
        print(f"[warn] force_recolor skipped: {e}")

    C.set_group_visibility("skull", False)
    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True

    C.render_views(dest, muscles, "muscle", res=1600)
    render_top(muscles, dest / "muscle_top.png", 1000, "soft_top")
    hide_for_cranial = [
        o
        for o in muscles
        if ("static" in o.name.lower() or "plastyma" in o.name.lower() or "platysma" in o.name.lower())
    ]
    set_hide_render(hide_for_cranial, True)
    render_top(cranial_objs(muscles), dest / "muscle_top_cranial.png", 1000, "cranial_top")
    set_hide_render(hide_for_cranial, False)

    for cn, en in [
        ("正", "front"),
        ("侧", "side"),
        ("前侧", "front_three_quarter"),
        ("后侧", "rear_three_quarter"),
        ("背面", "back"),
    ]:
        src = C.ROOT / f"Base15_{cn}.png"
        if src.exists():
            shutil.copy2(src, OUT / "base15" / f"{en}.png")
    import subprocess

    py = shutil.which("python") or shutil.which("python3")
    if py:
        try:
            subprocess.run([py, str(SCRIPTS / "gen_base15_align.py")], check=True)
        except subprocess.CalledProcessError as e:
            print(f"[warn] gen_base15_align skipped: {e}")
    else:
        print("[warn] system python not found; skip gen_base15_align")
    glb_dest = OUT / "glb" / f"{TAG}.glb"
    C.ensure_dirs(glb_dest.parent)
    C.export_glb(glb_dest, muscles)
    print(f"[rerender] done {TAG}")


if __name__ == "__main__":
    main()
