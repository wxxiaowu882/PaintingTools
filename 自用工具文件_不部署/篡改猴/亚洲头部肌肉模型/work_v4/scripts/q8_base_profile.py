# -*- coding: utf-8 -*-
"""
Q8: Fix profile vs Base15 — flatten pointy vault, round occiput, re-check silhouette.
Mandatory Base15 image eval before export.
"""
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
import q1_recolor as R  # noqa: E402
import q6b_force_recolor_export as Q6B  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q7e_depth_fix as Q7E  # noqa: E402

OUT = C.STAGES / "Q8_base_profile"
SOURCE = C.CHECKPOINTS / "Q7e_depth_fix.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def deform_base15_profile(lat):
    """Flatten cone-like vault; round dome; mild occiput; keep neck short."""
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

                cranial = smooth_step((lz + 0.18) / 0.82) * (
                    1.0 - 0.6 * smooth_step((-lz - 0.2) / 0.55)
                )

                new = co.copy()

                # 1) Kill pointy vault — compress upper Z, spread dome (Base15 rounded top)
                top = smooth_step((lz - 0.08) / 0.58) * cranial
                new.z = co.z * (1.0 - 0.28 * top)
                dome = top * (1.0 - 0.40 * smooth_step(abs(lx)))
                new.x = co.x * (1.0 + 0.12 * dome)
                new.y = co.y * (1.0 + 0.08 * dome)

                # 2) Occiput: gentle bulge mid-back, not horse-tail
                occ = smooth_step((ly + 0.05) / 0.55) * smooth_step((lz + 0.05) / 0.55) * cranial
                occ *= 1.0 - smooth_step((ly + 0.55) / 0.45)  # trim extreme +Y tail
                new.y = new.y * (1.0 + 0.10 * occ)

                # 3) Forehead slope — less vertical wall (Base15 gentle brow)
                brow = smooth_step((lz + 0.05) / 0.45) * smooth_step((-ly - 0.02) / 0.55) * cranial
                if ly < 0:
                    new.y = new.y * (1.0 - 0.08 * brow)

                # 4) Chin/neck — tuck lower face slightly, compress neck tail
                neck = smooth_step((-lz - 0.22) / 0.58) * smooth_step((ly + 0.15) / 0.75)
                new.y = new.y * (1.0 - 0.20 * neck)
                new.z = new.z * (1.0 - 0.06 * neck)

                # 5) Mid A-P depth nudge if still flat after vault fix
                mid_depth = smooth_step(1.0 - abs(lz - 0.08) / 0.55) * cranial
                new.y = new.y * (1.0 + 0.06 * mid_depth)

                p.co_deform = new
    bpy.context.view_layer.update()


def run_base15_eval(tag: str) -> dict:
    script = SCRIPTS / "base15_silhouette_eval.py"
    proc = subprocess.run(
        [PY, str(script), str(OUT), tag],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(proc.stdout)
    if proc.stderr:
        print(proc.stderr, file=sys.stderr)
    import json

    report_path = OUT / f"base15_eval_{tag}.json"
    if report_path.exists():
        return json.loads(report_path.read_text(encoding="utf-8"))
    return {"pass": False, "notes": ["eval script failed"]}


def force_recolor():
    for obj_name, img, _sock in Q6B.albedo_images():
        if "Static" in obj_name:
            continue
        elif "Skiedras" in obj_name:
            R.reload_raw_texture(img, obj_name)
            mode = "skiedras"
            rem = R.remap_array(R.image_to_np(img), mode)
        else:
            R.reload_raw_texture(img, obj_name)
            mode = "face"
            if "plastyma" in obj_name.lower() or "Image_1" in img.name:
                mode = "neck"
            if "Acs" in obj_name or "eye" in img.name.lower() or "Image_0" in img.name:
                mode = "eye"
            rem = R.remap_array(R.image_to_np(img), mode)
        R.np_to_image(img, rem)
        if mode == "eye":
            Q6B.force_dark_eye_pixels(img)
        img.pack()
    R.darken_eye_principled()
    R.gray_plastyma_principled()
    R.recolor_occiput_green_to_purple()
    bpy.ops.file.pack_all()


def self_eval_render(tag: str):
    C.ensure_dirs(OUT / tag)
    muscles = C.muscle_exportable()
    C.set_group_visibility("skull", False)
    C.render_views(OUT / tag, muscles, "muscle", res=900)
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


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True

    muscles = C.muscle_exportable()
    print("[Q8] from Q7e checkpoint")
    self_eval_render("before")

    lat = Q7.make_lattice(muscles, "Base15Profile", 11)
    deform_base15_profile(lat)
    Q7.apply_lattice(muscles, lat)

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)

    cranial = Q7E.cranial_metrics()
    print("[Q8] cranial after deform", cranial)

    force_recolor()
    self_eval_render("after")

    eval_report = run_base15_eval("after")
    C.write_json(OUT / "self_eval_report.json", {"cranial": cranial, "base15": eval_report})

    if not eval_report.get("pass"):
        print("[Q8] BASE15 SILHOUETTE FAIL — no GLB overwrite")
        C.save_blend(C.CHECKPOINTS / "Q8_base_FAIL.blend")
        raise RuntimeError(
            "Base15 silhouette eval failed: "
            + str(eval_report.get("views", {}).get("side", {}).get("notes"))
        )

    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.CHECKPOINTS / "Q8_base_profile.blend")
    C.save_blend(C.BLEND_FINAL)
    subprocess.run([PY, str(SCRIPTS / "make_collages.py"), "Q8_base_profile", "after"], check=False)
    C.write_notes(
        OUT / "notes.md",
        "# Q8 Base15 profile fix\n\n"
        f"- Side IoU: {eval_report.get('side_iou')}\n"
        f"- Side profile RMSE: {eval_report.get('side_profile_rmse')}\n"
        "- Base15 silhouette eval PASSED.\n",
    )
    print("[Q8] PASS", eval_report)


if __name__ == "__main__":
    main()
