# -*- coding: utf-8 -*-
"""Reload Base15 albedos + restore raw normals, then pack into blend."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402


def image_role(img, mat) -> str:
    """Return 'albedo' | 'normal' | 'other' based on node links."""
    if not mat or not mat.use_nodes:
        return "other"
    for n in mat.node_tree.nodes:
        if n.type != "TEX_IMAGE" or n.image != img:
            continue
        for out in n.outputs:
            for link in out.links:
                to = link.to_node
                sock = link.to_socket.name.lower() if link.to_socket else ""
                if to.type == "NORMAL_MAP" or "normal" in sock:
                    return "normal"
                if "base color" in sock or "color" == sock or to.type == "BSDF_PRINCIPLED":
                    if "base color" in sock or (to.type == "BSDF_PRINCIPLED" and "color" in sock):
                        return "albedo"
                if to.type in {"MIX", "MIX_RGB", "GAMMA", "HUE_SAT"}:
                    return "albedo"
    return "other"


def find_png(prefix_hint: str, img_name: str, suffix: str) -> Path | None:
    stem = img_name.replace(" ", "_")
    candidates = list(C.TEXTURES.glob(f"*{stem}*{suffix}.png"))
    if candidates:
        return candidates[0]
    # blender may add .001
    base = stem.replace(".001", "")
    candidates = list(C.TEXTURES.glob(f"*{base}*{suffix}.png"))
    return candidates[0] if candidates else None


def load_into(img: bpy.types.Image, path: Path):
    other = bpy.data.images.load(str(path), check_existing=True)
    # copy pixels
    if other.size[0] != img.size[0] or other.size[1] != img.size[1]:
        print(f"[pack] size mismatch {img.name} {img.size[:]} vs {path.name} {other.size[:]}")
        img.scale(other.size[0], other.size[1])
    img.pixels[:] = other.pixels[:]
    img.update()
    img.pack()
    print(f"[pack] {img.name} <- {path.name}")


def main():
    bpy.ops.wm.open_mainfile(filepath=str(C.CHECKPOINTS / "Q4_regional.blend"))
    seen = set()
    for obj in C.mesh_objects(C.objects_in_group("muscle")):
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            for n in mat.node_tree.nodes:
                if n.type != "TEX_IMAGE" or not n.image:
                    continue
                img = n.image
                key = img.name
                if key in seen:
                    continue
                seen.add(key)
                role = image_role(img, mat)
                suffix = "base15" if role in ("albedo", "other") else "raw"
                # normals must stay raw
                if role == "normal":
                    suffix = "raw"
                path = find_png(obj.name, img.name, suffix)
                if path is None and role == "albedo":
                    path = find_png(obj.name, img.name, "base15")
                if path is None:
                    print(f"[pack] no file for {img.name} role={role}")
                    continue
                load_into(img, path)
    bpy.ops.file.pack_all()
    C.save_blend(C.CHECKPOINTS / "Q4_packed.blend")
    print("[pack] done")


if __name__ == "__main__":
    main()
