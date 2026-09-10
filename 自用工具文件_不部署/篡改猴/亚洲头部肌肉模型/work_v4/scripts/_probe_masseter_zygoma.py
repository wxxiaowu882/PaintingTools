# -*- coding: utf-8 -*-
"""Compare masseter vs zygomatic-arch layering: Euro GLB vs SHELL_v8."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402

OUT = C.WORK / "compare_review" / "_probe_masseter"
INSIDE_EPS = 0.0008  # ~0.8mm if unit is meter; meshes are ~0.2m wide so ~relative


def world_co(obj):
    mw = obj.matrix_world
    return [mw @ v.co.copy() for v in obj.data.vertices]


def bbox_norm(pt, center, half):
    return Vector(
        (
            (pt.x - center.x) / max(half.x, 1e-8),
            (pt.y - center.y) / max(half.y, 1e-8),
            (pt.z - center.z) / max(half.z, 1e-8),
        )
    )


def in_masseter_zygoma_roi(lx, ly, lz):
    """Right+left lateral midface: zygomatic arch + masseter belly."""
    if abs(lx) < 0.28:
        return False
    if lz < -0.55 or lz > 0.38:
        return False
    if ly < -0.55:  # far occiput
        return False
    return True


def in_arch_band(lx, ly, lz):
    """Zygomatic arch height: beam sitting above masseter origin."""
    if abs(lx) < 0.38:
        return False
    if lz < -0.08 or lz > 0.28:
        return False
    if ly < -0.25:
        return False
    return True


def in_belly_band(lx, ly, lz):
    """Masseter belly below the arch, still lateral."""
    if abs(lx) < 0.32:
        return False
    if lz < -0.50 or lz > -0.02:
        return False
    if ly < -0.35:
        return False
    return True


def bvh_of(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    return BVHTree.FromObject(ev, deps)


def signed_nearest(bvh, pt):
    loc, nrm, _idx, dist = bvh.find_nearest(pt)
    if loc is None or nrm is None:
        return None
    side = (pt - loc).dot(nrm)
    signed = math.copysign(dist, side)
    return signed, dist, loc, nrm


def odd_hit_inside(bvh, pt):
    direction = Vector((1.0, 0.07, 0.04)).normalized()
    loc = pt.copy()
    hits = 0
    for _ in range(24):
        hit = bvh.ray_cast(loc, direction)
        if not hit or hit[0] is None:
            break
        hits += 1
        loc = hit[0] + direction * 2e-5
    return (hits % 2) == 1


def summarize(tag, static, deform):
    bpy.context.view_layer.update()
    center, size = C.bbox_center_size([static, deform])
    half = size * 0.5
    bvh = bvh_of(static)
    dverts = world_co(deform)
    sverts = world_co(static)

    roi_signed = []
    arch_inside = 0
    arch_n = 0
    belly_outside = 0
    belly_n = 0
    deep = 0
    stride = 2

    for i, pt in enumerate(dverts):
        if i % stride:
            continue
        nrm = bbox_norm(pt, center, half)
        if not in_masseter_zygoma_roi(*nrm):
            continue
        sn = signed_nearest(bvh, pt)
        if sn is None:
            continue
        signed, dist, _loc, _n = sn
        roi_signed.append(signed)
        inside = signed < -INSIDE_EPS and odd_hit_inside(bvh, pt)
        if inside and dist > 0.002:
            deep += 1
        if in_arch_band(*nrm):
            arch_n += 1
            if inside:
                arch_inside += 1
        if in_belly_band(*nrm):
            belly_n += 1
            if signed > 0:
                belly_outside += 1

    def pct(a, b):
        return None if b == 0 else round(100.0 * a / b, 2)

    # At arch height, max |x| of Static vs Deform (right side)
    def max_abs_x(verts, pred):
        xs = [abs(p.x - center.x) for p in verts if pred(bbox_norm(p, center, half))]
        return max(xs) if xs else None

    static_arch_x = max_abs_x(sverts, lambda n: in_arch_band(*n) and n.x > 0)
    deform_arch_x = max_abs_x(dverts, lambda n: in_arch_band(*n) and n.x > 0)
    deform_belly_x = max_abs_x(dverts, lambda n: in_belly_band(*n) and n.x > 0)

    roi_signed.sort()

    def q(p):
        if not roi_signed:
            return None
        k = int(round((len(roi_signed) - 1) * p))
        return round(roi_signed[k], 5)

    return {
        "tag": tag,
        "static": static.name,
        "deform": deform.name,
        "n_static": len(sverts),
        "n_deform": len(dverts),
        "bbox_size": [round(size.x, 4), round(size.y, 4), round(size.z, 4)],
        "roi_samples": len(roi_signed),
        "signed_p10": q(0.10),
        "signed_p50": q(0.50),
        "signed_p90": q(0.90),
        "deep_inside_deform_verts": deep,
        "arch_samples": arch_n,
        "arch_inside_pct": pct(arch_inside, arch_n),
        "belly_samples": belly_n,
        "belly_outside_pct": pct(belly_outside, belly_n),
        "static_arch_halfwidth": None if static_arch_x is None else round(static_arch_x, 5),
        "deform_arch_halfwidth": None if deform_arch_x is None else round(deform_arch_x, 5),
        "deform_belly_halfwidth": None if deform_belly_x is None else round(deform_belly_x, 5),
        "arch_muscle_minus_bone": (
            None
            if static_arch_x is None or deform_arch_x is None
            else round(deform_arch_x - static_arch_x, 5)
        ),
    }


def tint(obj, rgba):
    C.flatten_solid_principled(obj, rgba, unlink_normal=True)


def hide_others(keep):
    keep_set = set(keep)
    for o in C.mesh_objects():
        hide = o not in keep_set
        o.hide_render = hide
        o.hide_set(hide)


def render_iso(tag, static, deform, yaw, pitch, name):
    keep = [static, deform]
    hide_others(keep)
    tint(static, (0.90, 0.88, 0.78, 1.0))
    tint(deform, (0.78, 0.16, 0.32, 1.0))
    C.configure_eevee(1000)
    C.configure_color_management()
    C.setup_world_white(1.0)
    C.setup_compositor_white_bg()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting(keep, yaw_deg=yaw)
    center, size = C.bbox_center_size(keep)
    # Aim at right cheek (positive X in this asset).
    cheek = Vector((center.x + size.x * 0.28, center.y - size.y * 0.02, center.z + size.z * 0.02))
    dummy = bpy.data.objects.new("CheekAim", None)
    dummy.location = cheek
    bpy.context.scene.collection.objects.link(dummy)
    # Fake bbox via empty scale for camera: use a tiny mesh cluster
    cam = C.setup_camera_for_objs(keep, yaw, pitch, padding=1.12)
    # Zoom to cheek: shrink ortho and recentre on cheek
    cam.data.ortho_scale = max(size.x, size.y, size.z) * 0.42
    dist = max(size.x, size.y, size.z) * 2.2
    yaw_r = math.radians(yaw)
    pitch_r = math.radians(pitch)
    offset = Vector(
        (
            dist * math.sin(yaw_r) * math.cos(pitch_r),
            -dist * math.cos(yaw_r) * math.cos(pitch_r),
            dist * math.sin(pitch_r) + size.z * 0.02,
        )
    )
    cam.location = cheek + offset
    cam.rotation_euler = (cheek - cam.location).to_track_quat("-Z", "Y").to_euler()
    path = OUT / f"{tag}_{name}.png"
    C.ensure_dirs(path.parent)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    C.finalize_compare_png(path)
    bpy.data.objects.remove(dummy, do_unlink=True)
    print(f"[iso] {path}")


def analyze_and_render(tag):
    static = C.get_obj("muscle", "Static")
    deform = C.get_obj("muscle", "Deform")
    if static is None or deform is None:
        names = [o.name for o in C.mesh_objects()]
        raise RuntimeError(f"{tag}: missing Static/Deform, meshes={names}")
    stats = summarize(tag, static, deform)
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    for yaw, pitch, name in [
        (18.0, 6.0, "front_r"),
        (55.0, 8.0, "oblique_r"),
        (-90.0, 0.0, "side"),
    ]:
        render_iso(tag, static, deform, yaw, pitch, name)
    return stats


def main():
    C.ensure_dirs(OUT)
    reports = []

    C.clear_scene()
    C.import_glb(C.MUSCLE_GLB, "muscle")
    C.apply_object_transforms(C.mesh_objects(C.objects_in_group("muscle")))
    reports.append(analyze_and_render("euro"))

    bpy.ops.wm.open_mainfile(filepath=str(C.CHECKPOINTS / "SHELL_v8.blend"))
    C.hide_aux_skull()
    C.set_group_visibility("skull", False)
    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True
    reports.append(analyze_and_render("shell_v8"))

    path = OUT / "report.json"
    path.write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[write] {path}")


if __name__ == "__main__":
    main()
