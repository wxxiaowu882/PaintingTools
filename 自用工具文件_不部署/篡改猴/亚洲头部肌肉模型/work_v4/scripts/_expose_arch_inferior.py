# -*- coding: utf-8 -*-
"""Expose zygomatic-arch inferior border: drop masseter only. Never touch temporalis.

Always start from SHELL_v8_pre_arch.blend. Usage:
  blender --background --python _expose_arch_inferior.py -- 0.016
"""
from __future__ import annotations

import json
import math
import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402

OUT = C.WORK / "compare_review" / "_probe_masseter"
SRC = C.CHECKPOINTS / "SHELL_v8_pre_arch.blend"
DST = C.CHECKPOINTS / "SHELL_v8.blend"


def smooth(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def world_pts(obj):
    mw = obj.matrix_world
    return [mw @ v.co.copy() for v in obj.data.vertices]


def arch_anchor(static):
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
    cut = sorted(abs(p.x) for p in cand)[int(0.90 * (len(cand) - 1))]
    beam = [p for p in cand if abs(p.x) >= cut]
    zs = sorted(p.z for p in beam)
    ys = sorted(p.y for p in beam)
    return zs[len(zs) // 2], ys[len(ys) // 2]


def static_hw_bins(static, arch_z, size, dy=0.004):
    """Local bony halfwidth along the arch (y bins). Ear-end is wider than cheek."""
    bins = {}
    z_lim = size.z * 0.08
    for p in world_pts(static):
        if abs(p.z - arch_z) > z_lim:
            continue
        key = int(round(p.y / dy))
        ax = abs(p.x)
        if ax > bins.get(key, 0.0):
            bins[key] = ax
    return bins, dy


def local_cap(bins, dy, y, margin=0.007):
    key = int(round(y / dy))
    hw = 0.0
    for k in (key - 2, key - 1, key, key + 1, key + 2):
        hw = max(hw, bins.get(k, 0.0))
    return hw - margin if hw > 0 else None


def beam_points(static):
    center, size = C.bbox_center_size([static])
    half = size * 0.5
    cand = []
    for p in world_pts(static):
        ly = (p.y - center.y) / max(half.y, 1e-8)
        lz = (p.z - center.z) / max(half.z, 1e-8)
        if ly > 0.32 or ly < -0.58:
            continue
        if lz < -0.22 or lz > 0.26:
            continue
        cand.append(p)
    if not cand:
        raise RuntimeError("no arch candidates")
    cut = sorted(abs(p.x) for p in cand)[int(0.70 * (len(cand) - 1))]
    return [p for p in cand if abs(p.x) >= cut], center, size


def inferior_z_bins(beam, dy=0.004):
    """User's red line: lower envelope of the bony arch along front-back (y)."""
    groups = {}
    for p in beam:
        key = int(round(p.y / dy))
        groups.setdefault(key, []).append(p.z)
    bins = {}
    for key, zs in groups.items():
        zs = sorted(zs)
        bins[key] = zs[int(0.12 * (len(zs) - 1))]
    return bins, dy


def lookup_z(bins, dy, y):
    key = int(round(y / dy))
    vals = []
    for k in range(key - 3, key + 4):
        if k in bins:
            vals.append(bins[k])
    if not vals:
        return None
    return sum(vals) / len(vals)


def attach_masseter_to_inferior(muscles, static):
    """Masseter top sits on the bony inferior border (red line). Temporalis untouched."""
    beam, center, size = beam_points(static)
    z_bins, dy = inferior_z_bins(beam)
    hw_bins, hw_dy = static_hw_bins(static, sorted(p.z for p in beam)[len(beam) // 2], size)
    y_mid = sorted(p.y for p in beam)[len(beam) // 2]
    beam_h = max(p.z for p in beam) - min(p.z for p in beam)
    y_post = size.y * 0.28
    y_ant = size.y * 0.62
    moved = 0
    skipped = 0
    attached = 0
    print(f"[redline] beam_h={beam_h:.4f} y-bins={len(z_bins)}")

    for obj in muscles:
        mw = obj.matrix_world
        imw = mw.inverted()
        for v in obj.data.vertices:
            p = mw @ v.co
            z_line = lookup_z(z_bins, dy, p.y)
            if z_line is None:
                continue
            if p.y >= y_mid:
                yw = smooth(1.0 - (p.y - y_mid) / max(y_post, 1e-8))
            else:
                yw = smooth(1.0 - (y_mid - p.y) / max(y_ant, 1e-8))
            if yw < 0.02:
                continue
            # Temporalis lives clearly above the arch roof.
            if p.z > z_line + max(beam_h * 0.95, size.z * 0.045):
                skipped += 1
                continue
            cap = local_cap(hw_bins, hw_dy, p.y, margin=0.006)
            # Temporalis on the fossa: above mid-beam and more medial than the arch.
            if cap is not None and p.z > z_line + beam_h * 0.32 and abs(p.x) < cap - 0.003:
                skipped += 1
                continue
            lat = smooth((abs(p.x - center.x) / max(size.x * 0.5, 1e-8) - 0.04) / 0.42)
            w = lat * yw
            if w < 0.03:
                continue
            # Anything on the bone face (above the red line) snaps down onto it.
            if p.z > z_line:
                blend = max(0.82, w)
                p.z = p.z * (1.0 - blend) + z_line * blend
                attached += 1
            if cap is not None and abs(p.x) > cap:
                p.x = math.copysign(abs(p.x) * (1.0 - 0.7 * w) + cap * 0.7 * w, p.x)
            v.co = imw @ p
            moved += 1
        obj.data.update()
    print(f"[redline] attached={attached} moved={moved} skipped_temp={skipped}")
    return moved, skipped, attached, y_mid, lookup_z(z_bins, dy, y_mid)


def proud_static_arch(static, arch_z, arch_y, proud=0.007):
    """Push the bony beam slightly more lateral so it reads outside the muscle."""
    center, size = C.bbox_center_size([static])
    half = size * 0.5
    mw = static.matrix_world
    imw = mw.inverted()
    n = 0
    for v in static.data.vertices:
        p = mw @ v.co
        n_x = abs(p.x - center.x) / max(half.x, 1e-8)
        lat = smooth((n_x - 0.22) / 0.40)
        if p.y >= arch_y:
            y = smooth(1.0 - (p.y - arch_y) / max(size.y * 0.22, 1e-8))
        else:
            y = smooth(1.0 - (arch_y - p.y) / max(size.y * 0.40, 1e-8))
        z = smooth(1.0 - abs(p.z - arch_z) / max(size.z * 0.09, 1e-8))
        w = lat * y * z
        if w < 1e-4:
            continue
        p.x += math.copysign(proud * w, p.x - center.x)
        v.co = imw @ p
        n += 1
    static.data.update()
    return n


def render_iso_side(static, deform, arch_z, arch_y, name: str):
    keep = [o for o in (static, deform) if o]
    for o in C.mesh_objects():
        hide = o not in keep
        o.hide_render = hide
        o.hide_set(hide)
    C.flatten_solid_principled(static, (0.92, 0.90, 0.80, 1.0), unlink_normal=True)
    C.flatten_solid_principled(deform, (0.78, 0.16, 0.32, 1.0), unlink_normal=True)
    C.configure_eevee(1100)
    C.configure_color_management()
    C.setup_world_white(1.0)
    C.setup_compositor_white_bg()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting(keep, yaw_deg=-90.0)
    cam = C.setup_camera_for_objs(keep, -90.0, 0.0, padding=1.08)
    center, size = C.bbox_center_size(keep)
    cheek = Vector((center.x, arch_y - size.y * 0.06, arch_z))
    extent = max(size.x, size.y, size.z)
    dist = extent * 2.4
    cam.data.ortho_scale = extent * 0.40
    cam.location = cheek + Vector((-dist, 0.0, 0.0))
    cam.rotation_euler = (cheek - cam.location).to_track_quat("-Z", "Y").to_euler()
    path = OUT / name
    C.ensure_dirs(path.parent)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    C.finalize_compare_png(path)
    print(f"[iso] {path}")
    return path


def parse_drop():
    drop = 0.020
    if "--" in sys.argv:
        for a in sys.argv[sys.argv.index("--") + 1 :]:
            try:
                drop = float(a)
            except ValueError:
                pass
    return drop


def main():
    drop = parse_drop()
    if not SRC.exists():
        raise FileNotFoundError(SRC)
    shutil.copy2(SRC, DST)
    bpy.ops.wm.open_mainfile(filepath=str(DST))
    C.hide_aux_skull()
    C.set_group_visibility("skull", False)
    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True

    static = C.get_obj("muscle", "Static")
    deform = C.get_obj("muscle", "Deform")
    skied = C.get_obj("muscle", "Skiedras")
    muscles = [o for o in (deform, skied) if o]
    beam, _c, _s = beam_points(static)
    arch_z = sorted(p.z for p in beam)[len(beam) // 2]
    arch_y = sorted(p.y for p in beam)[len(beam) // 2]
    proud_n = proud_static_arch(static, arch_z, arch_y, proud=0.008)
    moved, skipped, attached, y_mid, z_line = attach_masseter_to_inferior(muscles, static)
    report = {
        "redline_z": None if z_line is None else round(z_line, 5),
        "arch_y": round(y_mid, 5),
        "static_proud_verts": proud_n,
        "attached_to_inferior": attached,
        "moved_masseter_verts": moved,
        "skipped_temporalis": skipped,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    C.save_blend(DST)
    render_iso_side(static, deform, z_line or arch_z, y_mid, "iter_redline_side.png")


if __name__ == "__main__":
    main()
