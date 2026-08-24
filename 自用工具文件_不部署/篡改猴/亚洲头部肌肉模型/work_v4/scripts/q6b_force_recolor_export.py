# -*- coding: utf-8 -*-
"""Q6b: force Base15 albedo remap on current geometry, dark eyes, re-export."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy
import numpy as np

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q1_recolor as R  # noqa: E402


def albedo_images():
    imgs = []
    seen = set()
    for obj in C.mesh_objects(C.objects_in_group("muscle")):
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            for n in mat.node_tree.nodes:
                if n.type != "TEX_IMAGE" or not n.image:
                    continue
                for out in n.outputs:
                    for link in out.links:
                        sock = (link.to_socket.name or "").lower()
                        if "base color" in sock or sock == "alpha":
                            if n.image.name not in seen:
                                seen.add(n.image.name)
                                imgs.append((obj.name, n.image, sock))
    return imgs


def force_dark_eye_pixels(img: bpy.types.Image):
    arr = R.image_to_np(img)
    rgb = arr[..., :3]
    hsv = R.rgb_to_hsv_np(rgb)
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    # any saturated chromatic pixels in eye map -> dark brown
    color = S > 0.18
    rgb = R.apply_hue(rgb, color, 0.06, 0.4)
    rgb[color] = rgb[color] * 0.22
    # bright centers -> pupil black
    bright = V > 0.55
    rgb[bright] = np.array([0.03, 0.025, 0.02], dtype=np.float32)
    # leftover mid tones
    mid = (~color) & (V > 0.25) & (V < 0.85)
    rgb[mid] = rgb[mid] * 0.45 + np.array([0.15, 0.12, 0.10], dtype=np.float32)
    out = np.concatenate([np.clip(rgb, 0, 1), arr[..., 3:4]], axis=-1).astype(np.float32)
    R.np_to_image(img, out)


def main():
    C.ensure_dirs(C.STAGES / "Q6_final", C.TEXTURES)
    bpy.ops.wm.open_mainfile(filepath=str(C.CHECKPOINTS / "Q5_cleanup.blend"))

    for obj_name, img, sock in albedo_images():
        mode = "face"
        if "plastyma" in obj_name.lower() or "Image_1" in img.name:
            mode = "neck"
        if "Acs" in obj_name or "eye" in img.name.lower() or "Image_0" in img.name:
            mode = "eye"
        arr = R.image_to_np(img)
        # If already remapped once, remapping again can wash hues — still force eye; for face
        # remap from current pixels toward Base15 buckets again.
        rem = R.remap_array(arr, mode)
        R.np_to_image(img, rem)
        if mode == "eye":
            force_dark_eye_pixels(img)
        out = C.TEXTURES / f"q6b_{img.name}_{mode}.png"
        try:
            R.save_png(img, out)
        except Exception as e:
            print("save skip", e)
        img.pack()
        print(f"[Q6b] {obj_name} {img.name} mode={mode}")

    # also remap SEPARATE_COLOR inputs (Image_7 / Image_4) — often secondary color masks
    for obj in C.mesh_objects(C.objects_in_group("muscle")):
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            for n in mat.node_tree.nodes:
                if n.type != "TEX_IMAGE" or not n.image:
                    continue
                for out in n.outputs:
                    for link in out.links:
                        if link.to_node.type == "SEPARATE_COLOR":
                            arr = R.image_to_np(n.image)
                            rem = R.remap_array(arr, "face")
                            R.np_to_image(n.image, rem)
                            n.image.pack()
                            print(f"[Q6b] secondary {n.image.name}")

    R.darken_eye_principled()
    R.gray_plastyma_principled()
    bpy.ops.file.pack_all()

    muscles = C.muscle_exportable()
    C.assert_head_scale([C.get_obj("muscle", "Static")], 0.18, "Q6b")
    C.set_group_visibility("skull", False)
    C.render_views(C.STAGES / "Q6_final", muscles, "muscle", res=1100)
    C.set_group_visibility("skull", True)
    C.make_skull_transparent(0.22)
    C.render_views(C.STAGES / "Q6_final", C.visible_skull_muscle(), "overlay", res=1000)

    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.CHECKPOINTS / "Q6_final.blend")
    C.save_blend(C.BLEND_FINAL)
    print("[Q6b] done")


if __name__ == "__main__":
    main()
