# -*- coding: utf-8 -*-
"""Open the zygomatic-arch 'beam' window: tucks masseter/temporalis off the arch."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402


def smooth(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def world_pts(obj):
    mw = obj.matrix_world
    return [mw @ v.co.copy() for v in obj.data.vertices]


def arch_anchor(static):
    """Zygomatic arch: most lateral Static verts that are NOT the ear.

    Ear pinna is the global |x| max and sits posterior; the arch is
    anterior of the ear, about ear-canal height.
    """
    center, size = C.bbox_center_size([static])
    half = size * 0.5
    cand = []
    for p in world_pts(static):
        ly = (p.y - center.y) / max(half.y, 1e-8)
        lz = (p.z - center.z) / max(half.z, 1e-8)
        if ly > 0.28 or ly < -0.55:
            continue
        if lz < -0.18 or lz > 0.22:
            continue
        cand.append(p)
    if not cand:
        raise RuntimeError("no arch candidates")
    cut = sorted(abs(p.x) for p in cand)[int(0.92 * (len(cand) - 1))]
    beam = [p for p in cand if abs(p.x) >= cut]
    zs = sorted(p.z for p in beam)
    ys = sorted(p.y for p in beam)
    return zs[len(zs) // 2], ys[len(ys) // 2]


def apply_open_beam(static, muscles, arch_z, arch_y, inset=0.024, split=0.012, proud=0.009):
    """Inset muscle off the arch silhouette; open a modest vertical slit for the beam."""
    center, size = C.bbox_center_size([static])
    half = size * 0.5

    def nrm(p):
        return Vector(
            (
                (p.x - center.x) / max(half.x, 1e-8),
                (p.y - center.y) / max(half.y, 1e-8),
                (p.z - center.z) / max(half.z, 1e-8),
            )
        )

    def w_arch(p):
        n = nrm(p)
        lat = smooth((abs(n.x) - 0.16) / 0.42)
        y = smooth(1.0 - abs(p.y - arch_y) / (size.y * 0.34))
        z = smooth(1.0 - abs(p.z - arch_z) / (size.z * 0.18))
        return lat * y * z

    mw = static.matrix_world
    imw = mw.inverted()
    for v in static.data.vertices:
        p = mw @ v.co
        w = w_arch(p)
        if w < 1e-4:
            continue
        p.x += math.copysign(proud * w, p.x - center.x)
        v.co = imw @ p
    static.data.update()

    moved = 0
    for obj in muscles:
        mw = obj.matrix_world
        imw = mw.inverted()
        for v in obj.data.vertices:
            p = mw @ v.co
            w = w_arch(p)
            if w < 1e-4:
                continue
            # Extra punch in a thin Z band so the beam silhouette is bone-only.
            clear = smooth(1.0 - abs(p.z - arch_z) / (size.z * 0.055))
            p.x -= math.copysign(inset * w * (0.55 + 1.15 * clear), p.x - center.x)
            if p.z <= arch_z:
                p.z -= split * 1.25 * w
            else:
                p.z += split * 0.90 * w
            v.co = imw @ p
            moved += 1
        obj.data.update()
    return moved


def halfwidth_at_arch(obj, arch_z, arch_y, band_z, band_y):
    xs = [
        abs(p.x)
        for p in world_pts(obj)
        if abs(p.z - arch_z) < band_z and abs(p.y - arch_y) < band_y
    ]
    return max(xs) if xs else 0.0


def main():
    blend = C.CHECKPOINTS / "SHELL_v8.blend"
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    C.hide_aux_skull()
    C.set_group_visibility("skull", False)

    static = C.get_obj("muscle", "Static")
    deform = C.get_obj("muscle", "Deform")
    skied = C.get_obj("muscle", "Skiedras")
    muscles = [o for o in (deform, skied) if o]
    arch_z, arch_y = arch_anchor(static)
    size = C.bbox_center_size([static])[1]
    band_z = size.z * 0.06
    band_y = size.y * 0.12
    before = {
        "arch_z": round(arch_z, 5),
        "arch_y": round(arch_y, 5),
        "static_hw": round(halfwidth_at_arch(static, arch_z, arch_y, band_z, band_y), 5),
        "deform_hw": round(halfwidth_at_arch(deform, arch_z, arch_y, band_z, band_y), 5),
    }
    moved = apply_open_beam(static, muscles, arch_z, arch_y)
    after = {
        "static_hw": round(halfwidth_at_arch(static, arch_z, arch_y, band_z, band_y), 5),
        "deform_hw": round(halfwidth_at_arch(deform, arch_z, arch_y, band_z, band_y), 5),
        "moved_muscle_verts": moved,
    }
    after["bone_minus_muscle"] = round(after["static_hw"] - after["deform_hw"], 5)
    before["bone_minus_muscle"] = round(before["static_hw"] - before["deform_hw"], 5)
    print(json.dumps({"before": before, "after": after}, ensure_ascii=False, indent=2))

    C.save_blend(blend)

    # isolation side crop for visual check
    out = C.WORK / "compare_review" / "_probe_masseter"
    C.ensure_dirs(out)
    keep = [static, deform]
    for o in C.mesh_objects():
        hide = o not in keep
        o.hide_render = hide
        o.hide_set(hide)
    C.flatten_solid_principled(static, (0.90, 0.88, 0.78, 1.0), unlink_normal=True)
    C.flatten_solid_principled(deform, (0.78, 0.16, 0.32, 1.0), unlink_normal=True)
    C.configure_eevee(1000)
    C.configure_color_management()
    C.setup_world_white(1.0)
    C.setup_compositor_white_bg()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting(keep, yaw_deg=-90.0)
    cam = C.setup_camera_for_objs(keep, -90.0, 0.0, padding=1.12)
    center, size = C.bbox_center_size(keep)
    cheek = Vector((center.x + size.x * 0.28, center.y, arch_z))
    extent = max(size.x, size.y, size.z)
    cam.data.ortho_scale = extent * 0.42
    dist = extent * 2.2
    cam.location = cheek + Vector((0.0, -dist, 0.0))
    cam.rotation_euler = (cheek - cam.location).to_track_quat("-Z", "Y").to_euler()
    path = out / "shell_v8_side_after.png"
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    C.finalize_compare_png(path)
    print(f"[iso] {path}")


if __name__ == "__main__":
    main()
