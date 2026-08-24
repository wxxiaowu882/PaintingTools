# -*- coding: utf-8 -*-
"""WRAP_v1: stop lattice roulette — fit muscles to inflated Asian skull cage.

Why: SKULL_v2..v8 lattice eye-loop oscillated (pancake ↔ teardrop ↔ skinny front).
Strategy doc Stage B: wrap to skull soft shell, then eye-check.

Steps:
  1) Q1 + uniform height align to skull
  2) Scale whole muscle so cranial AABB → skull AABB (soft margin)
  3) Inflate UnifiedSkull as cage; Shrinkwrap deform layers (keep Static looser)
  4) Mild brachy settle (widen a bit, slight AP) — tiny, eye-led
  5) Multi-view + cranial-top for agent self-check
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.WORK / "compare_review"
BASE = C.CHECKPOINTS / "Q1_recolor.blend"
TAG = "WRAP_v1"

SOFT_MARGIN = Vector((1.10, 1.04, 1.02))  # soft tissue over bone
# After wrap: slight Asian roundness (not v2 crush)
BRACHY_SX, BRACHY_SY, BRACHY_SZ = 1.08, 0.96, 0.97


def bone_objs():
    skull = C.get_obj("skull", "UnifiedSkull")
    mandible = C.get_obj("skull", "Mandible")
    return [o for o in (skull, mandible) if o]


def cranial_objs(muscles):
    out = []
    for o in muscles:
        n = o.name.lower()
        if "plastyma" in n or "platysma" in n:
            continue
        if "deform" in n or "skiedras" in n:
            out.append(o)
    return out or [C.get_obj("muscle", "Static")]


def metrics_pair(tag: str, muscles):
    soft = Q7.metrics(f"{tag}_soft")
    cr = cranial_objs(muscles)
    _, s = C.bbox_center_size(cr)
    dw = s.y / max(s.x, 1e-8)
    hw = s.z / max(s.x, 1e-8)
    print(f"[{tag}_cranial] size=({s.x:.4f},{s.y:.4f},{s.z:.4f}) depth/width={dw:.3f} height/width={hw:.3f}")
    bones = bone_objs()
    _, bs = C.bbox_center_size(bones)
    print(f"[{tag}_skull] size=({bs.x:.4f},{bs.y:.4f},{bs.z:.4f}) depth/width={bs.y/max(bs.x,1e-8):.3f}")
    return {
        "soft": soft,
        "cranial": {"size": [s.x, s.y, s.z], "depth_over_width": dw, "height_over_width": hw},
        "skull": {"size": [bs.x, bs.y, bs.z], "depth_over_width": bs.y / max(bs.x, 1e-8)},
    }


def uniform_align_to_skull(muscles):
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    b_c, b_s = C.bbox_center_size(bones)
    _, m_s = C.bbox_center_size([static])
    uni = (b_s.z / max(m_s.z, 1e-8)) * 1.02
    print(f"[wrap] uniform={uni:.4f}")

    root = C.parent_empty("MuscleRoot", muscles)
    root["asset_group"] = "muscle"
    root.scale = (uni, uni, uni)
    bpy.context.view_layer.update()

    m_c2, _ = C.bbox_center_size([static])
    _, b_max = C.world_bbox(bones)
    _, m_max = C.world_bbox([static])
    root.location += Vector(
        (
            b_c.x - m_c2.x,
            b_c.y - m_c2.y,
            (b_max.z - m_max.z) * 0.90 + (b_c.z - m_c2.z) * 0.10,
        )
    )
    bpy.context.view_layer.update()

    bpy.ops.object.select_all(action="DESELECT")
    for obj in muscles:
        obj.select_set(True)
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.data.objects.remove(root, do_unlink=True)
    C.apply_object_transforms(muscles)
    return uni


def _scale_objs_about_center(objs, center: Vector, sx: float, sy: float, sz: float):
    root = bpy.data.objects.new("FitRoot", None)
    root.empty_display_type = "PLAIN_AXES"
    bpy.context.scene.collection.objects.link(root)
    root.location = center
    bpy.context.view_layer.update()
    for obj in objs:
        obj.parent = root
        obj.matrix_parent_inverse = root.matrix_world.inverted()
    root.scale = (sx, sy, sz)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.data.objects.remove(root, do_unlink=True)
    C.apply_object_transforms(objs)


def fit_cranial_aabb_to_skull(muscles):
    """Scale cranial layers to skull*soft; Static only mild face widen (don't blow ears)."""
    cr = cranial_objs(muscles)
    bones = bone_objs()
    c_c, c_s = C.bbox_center_size(cr)
    _, b_s = C.bbox_center_size(bones)
    target = Vector((b_s.x * SOFT_MARGIN.x, b_s.y * SOFT_MARGIN.y, b_s.z * SOFT_MARGIN.z))
    sx = max(0.85, min(target.x / max(c_s.x, 1e-8), 1.55))
    sy = max(0.85, min(target.y / max(c_s.y, 1e-8), 1.55))
    sz = max(0.85, min(target.z / max(c_s.z, 1e-8), 1.35))
    print(f"[wrap] aabb_fit cranial sx={sx:.3f} sy={sy:.3f} sz={sz:.3f}")
    _scale_objs_about_center(cr, c_c, sx, sy, sz)

    # Static / platysma / acs: follow height/depth lightly, width capped so ears don't explode
    others = [o for o in muscles if o not in cr]
    if others:
        o_c, _ = C.bbox_center_size(others)
        sx_s = max(1.0, min(sx * 0.72, 1.18))
        sy_s = max(1.0, min(sy * 0.85, 1.25))
        sz_s = max(1.0, min(sz * 0.90, 1.20))
        print(f"[wrap] aabb_fit soft sx={sx_s:.3f} sy={sy_s:.3f} sz={sz_s:.3f}")
        _scale_objs_about_center(others, o_c, sx_s, sy_s, sz_s)

    static = C.get_obj("muscle", "Static")
    b_c2, _ = C.bbox_center_size(bones)
    m_c, _ = C.bbox_center_size([static])
    delta = b_c2 - m_c
    for obj in muscles:
        obj.location += delta
    C.apply_object_transforms(muscles)
    return {"sx": sx, "sy": sy, "sz": sz}


def make_inflated_cage():
    skull = C.get_obj("skull", "UnifiedSkull")
    if skull is None:
        raise RuntimeError("UnifiedSkull missing")
    cage = skull.copy()
    cage.data = skull.data.copy()
    cage.name = "SoftCage"
    bpy.context.scene.collection.objects.link(cage)
    cage["asset_group"] = "aux"
    c, _ = C.bbox_center_size([skull])
    # inflate from center
    cage.location = cage.location  # keep
    bpy.context.view_layer.update()
    # scale about bbox center via empty
    empty = bpy.data.objects.new("CagePivot", None)
    bpy.context.scene.collection.objects.link(empty)
    empty.location = c
    cage.parent = empty
    cage.matrix_parent_inverse = empty.matrix_world.inverted()
    empty.scale = (SOFT_MARGIN.x, SOFT_MARGIN.y, SOFT_MARGIN.z)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    cage.select_set(True)
    empty.select_set(True)
    bpy.context.view_layer.objects.active = empty
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.data.objects.remove(empty, do_unlink=True)
    C.apply_object_transforms([cage])
    cage.hide_render = True
    cage.hide_set(True)
    return cage


def shrinkwrap_layers(muscles, cage):
    """Tight wrap on deform layers; looser on Static (protect ears/lips)."""
    for obj in muscles:
        for mod in list(obj.modifiers):
            if mod.type == "SHRINKWRAP":
                obj.modifiers.remove(mod)
        n = obj.name.lower()
        if "plastyma" in n or "platysma" in n:
            continue
        mod = obj.modifiers.new("WrapCage", "SHRINKWRAP")
        mod.target = cage
        mod.wrap_method = "NEAREST_SURFACEPOINT"
        mod.wrap_mode = "ABOVE_SURFACE"
        if "deform" in n or "skiedras" in n:
            mod.offset = 0.004
        elif "static" in n:
            # Blender 5 Shrinkwrap has no influence — skip tight wrap on Static
            # (ears/lips); only keep modifier off. Remove and continue.
            obj.modifiers.remove(mod)
            print(f"[wrap] skip shrinkwrap: {obj.name}")
            continue
        else:
            mod.offset = 0.008
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        print(f"[wrap] shrinkwrap applied: {obj.name}")


def mild_brachy_lattice(muscles):
    lat = Q7.make_lattice(muscles, "BRACHY", 7)
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    def smooth_step(t):
        t = max(0.0, min(1.0, t))
        return t * t * (3.0 - 2.0 * t)

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                lx = max(-1.0, min(1.0, co.x * 2.0))
                lz = max(-1.0, min(1.0, co.z * 2.0))
                vault = smooth_step((lz + 0.1) / 0.8)
                ear = smooth_step((abs(lx) - 0.6) / 0.4) * smooth_step(1.0 - abs(lz - 0.0) / 0.35)
                x_mul = 1.0 + (BRACHY_SX - 1.0) * (0.5 + 0.5 * vault) * (1.0 - 0.5 * ear)
                y_mul = 1.0 + (BRACHY_SY - 1.0) * (0.5 + 0.5 * vault)
                z_mul = 1.0 + (BRACHY_SZ - 1.0) * vault
                new = co.copy()
                new.x = co.x * x_mul
                new.y = co.y * y_mul
                new.z = co.z * z_mul
                p.co_deform = new
    bpy.context.view_layer.update()
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)


def render_top(objs, path: Path, res: int = 1000, label: str = "top"):
    C.ensure_dirs(path.parent)
    C.configure_eevee(res)
    C.setup_world_white()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting()
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
    print(f"[render:{label}] {path}")


def render_side_extra(muscles, dest: Path, res: int = 900):
    C.ensure_dirs(dest)
    C.configure_eevee(res)
    C.setup_world_white()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting()
    center, size = C.bbox_center_size(muscles)
    extent = max(size.x, size.y, size.z, 1e-6)
    dist = extent * 2.6
    shots = [
        ("muscle_side_opp.png", (center.x - dist, center.y, center.z), (1.5708, 0, -1.5708)),
        ("muscle_side_low.png", (center.x + dist * 0.95, center.y - dist * 0.25, center.z - extent * 0.15), (1.75, 0, 1.45)),
        ("muscle_side_high.png", (center.x + dist * 0.95, center.y + dist * 0.15, center.z + extent * 0.2), (1.35, 0, 1.65)),
    ]
    for name, loc, rot in shots:
        for obj in list(bpy.data.objects):
            if obj.type == "CAMERA":
                bpy.data.objects.remove(obj, do_unlink=True)
        cam_data = bpy.data.cameras.new("SideExtra")
        cam_data.lens = 50
        cam = bpy.data.objects.new("SideExtra", cam_data)
        bpy.context.scene.collection.objects.link(cam)
        cam.location = loc
        cam.rotation_euler = rot
        bpy.context.scene.camera = cam
        path = dest / name
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        print(f"[render] {path}")


def set_hide_render(objs, hide: bool):
    for o in objs:
        o.hide_render = hide
        o.hide_set(hide)


def main():
    C.ensure_dirs(OUT / "ours" / TAG, OUT / "glb", OUT / "base15", C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    C.hide_aux_skull()
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    try:
        Q8.force_recolor()
    except Exception as e:
        print(f"[warn] recolor: {e}")

    metrics_pair("before", muscles)
    uni = uniform_align_to_skull(muscles)
    metrics_pair("after_uni", muscles)
    fit = fit_cranial_aabb_to_skull(muscles)
    metrics_pair("after_aabb", muscles)

    cage = make_inflated_cage()
    shrinkwrap_layers(muscles, cage)
    metrics_pair("after_wrap", muscles)

    mild_brachy_lattice(muscles)
    # recenter
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    b_c, _ = C.bbox_center_size(bones)
    m_c, _ = C.bbox_center_size([static])
    for obj in muscles:
        obj.location += b_c - m_c
    C.apply_object_transforms(muscles)
    after = metrics_pair("WRAP_v1", muscles)

    # cleanup cage
    if cage.name in bpy.data.objects:
        bpy.data.objects.remove(cage, do_unlink=True)

    C.save_blend(C.CHECKPOINTS / f"{TAG}.blend")

    C.set_group_visibility("skull", False)
    dest = OUT / "ours" / TAG
    C.render_views(dest, muscles, "muscle", res=1000)
    render_top(muscles, dest / "muscle_top.png", 1000, "soft_top")
    hide_for_cranial = [
        o
        for o in muscles
        if ("static" in o.name.lower() or "plastyma" in o.name.lower() or "platysma" in o.name.lower())
    ]
    set_hide_render(hide_for_cranial, True)
    render_top(cranial_objs(muscles), dest / "muscle_top_cranial.png", 1000, "cranial_top")
    set_hide_render(hide_for_cranial, False)
    render_side_extra(muscles, dest, 900)

    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True
    C.export_glb(OUT / "glb" / f"{TAG}.glb", muscles)

    cyx = float(after["cranial"]["depth_over_width"])
    judgment = {
        "method": "wrap_skull_cage_v1",
        "stopped_lattice_roulette": True,
        "cranial_yx": cyx,
        "fit": fit,
        "soft_margin": [SOFT_MARGIN.x, SOFT_MARGIN.y, SOFT_MARGIN.z],
        "brachy": {"sx": BRACHY_SX, "sy": BRACHY_SY, "sz": BRACHY_SZ},
        "eye_gate": "agent must confirm oval top + human front/side/back before Stage C",
    }
    report = {
        "tag": TAG,
        "note": "停 lattice 扫参；颅AABB贴头骨软组织笼 + Shrinkwrap + 轻短头微调",
        "uni": uni,
        "after": after,
        "judgment": judgment,
    }
    C.write_json(dest / "skull_report.json", report)

    for cn, en in [
        ("正", "front"),
        ("侧", "side"),
        ("前侧", "front_three_quarter"),
        ("后侧", "rear_three_quarter"),
        ("后侧2", "rear_three_quarter_2"),
        ("背面", "back"),
    ]:
        src = C.ROOT / f"Base15_{cn}.png"
        if src.exists():
            shutil.copy2(src, OUT / "base15" / f"{en}.png")

    cands = [
        {"id": TAG, "blend": f"{TAG}.blend", "note": report["note"], "glb": True},
        {"id": "SKULL_v5", "blend": "SKULL_v5.blend", "note": "lattice 相对最好一档（仍未过关）", "glb": True},
        {"id": "SKULL_v2", "blend": "SKULL_v2.blend", "note": "坏例·前后过扁", "glb": True},
    ]
    C.write_json(OUT / "manifest.json", {"candidates": cands, "stage": "WRAP_v1_skull_cage"})
    print(json.dumps(judgment, ensure_ascii=False))
    print("[WRAP_v1] done — agent eye-check next")


if __name__ == "__main__":
    main()
