# -*- coding: utf-8 -*-
"""WRAP_v3: from v2 AABB, reshape teardrop → rounder oval (agent eye).

v2 kept colors (good) but eye-fail:
  cranial top = teardrop (narrow forehead, long AP)
  front = tall/narrow vs Base15
  soft top = ear wings

v3: same split AABB, then front-weighted widen + occiput AP settle + ear Z-tuck.
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

# Reuse v2 helpers by importing the module functions via exec path copy — keep self-contained.
OUT = C.WORK / "compare_review"
BASE = C.CHECKPOINTS / "Q1_recolor.blend"
TAG = "WRAP_v3"

SOFT_MARGIN = Vector((1.08, 1.02, 1.02))
SX_FRONT, SX_REAR, SX_CHEEK = 1.22, 1.08, 1.16
SY_OCCIP, SY_FACE, SZ, EAR_IN = 0.88, 1.00, 0.94, 0.72


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
    print(f"[{tag}_skull] y/x={bs.y/max(bs.x,1e-8):.3f}")
    return {
        "soft": soft,
        "cranial": {"size": [s.x, s.y, s.z], "depth_over_width": dw, "height_over_width": hw},
        "skull_yx": bs.y / max(bs.x, 1e-8),
    }


def uniform_align_to_skull(muscles):
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    b_c, b_s = C.bbox_center_size(bones)
    _, m_s = C.bbox_center_size([static])
    uni = (b_s.z / max(m_s.z, 1e-8)) * 1.02
    root = C.parent_empty("MuscleRoot", muscles)
    root["asset_group"] = "muscle"
    root.scale = (uni, uni, uni)
    bpy.context.view_layer.update()
    m_c2, _ = C.bbox_center_size([static])
    _, b_max = C.world_bbox(bones)
    _, m_max = C.world_bbox([static])
    root.location += Vector(
        (b_c.x - m_c2.x, b_c.y - m_c2.y, (b_max.z - m_max.z) * 0.90 + (b_c.z - m_c2.z) * 0.10)
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
    root = C.parent_empty("FitRoot", objs)
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


def fit_split_aabb(muscles):
    cr = cranial_objs(muscles)
    bones = bone_objs()
    c_c, c_s = C.bbox_center_size(cr)
    _, b_s = C.bbox_center_size(bones)
    target = Vector((b_s.x * SOFT_MARGIN.x, b_s.y * SOFT_MARGIN.y, b_s.z * SOFT_MARGIN.z))
    sx = max(0.9, min(target.x / max(c_s.x, 1e-8), 1.45))
    sy = max(0.9, min(target.y / max(c_s.y, 1e-8), 1.45))
    sz = max(0.9, min(target.z / max(c_s.z, 1e-8), 1.30))
    print(f"[v3] cranial_fit sx={sx:.3f} sy={sy:.3f} sz={sz:.3f}")
    _scale_objs_about_center(cr, c_c, sx, sy, sz)
    others = [o for o in muscles if o not in cr]
    if others:
        o_c, _ = C.bbox_center_size(others)
        sx_s = max(1.0, min(sx * 0.78, 1.20))
        sy_s = max(1.0, min(sy * 0.88, 1.22))
        sz_s = max(1.0, min(sz * 0.92, 1.18))
        print(f"[v3] soft_fit sx={sx_s:.3f} sy={sy_s:.3f} sz={sz_s:.3f}")
        _scale_objs_about_center(others, o_c, sx_s, sy_s, sz_s)
    static = C.get_obj("muscle", "Static")
    b_c2, _ = C.bbox_center_size(bones)
    m_c, _ = C.bbox_center_size([static])
    for obj in muscles:
        obj.location += b_c2 - m_c
    C.apply_object_transforms(muscles)
    return {"sx": sx, "sy": sy, "sz": sz}


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def reshape_round_oval(muscles):
    lat = Q7.make_lattice(muscles, "ROUND3", 9)
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
                front = smooth_step((-ly + 0.15) / 0.85)
                rear = smooth_step((ly + 0.05) / 0.85)
                vault = smooth_step((lz + 0.05) / 0.8)
                cheek = smooth_step(1.0 - abs(lz + 0.02) / 0.55)
                ear_z = smooth_step(1.0 - abs(lz - 0.02) / 0.30)
                ear = smooth_step((abs(lx) - 0.58) / 0.42) * ear_z

                x_mul = 1.0
                x_mul += (SX_FRONT - 1.0) * front * (0.5 + 0.5 * vault) * (1.0 - 0.25 * ear)
                x_mul += (SX_REAR - 1.0) * rear * vault * (1.0 - 0.25 * ear)
                x_mul += (SX_CHEEK - 1.0) * front * cheek * (1.0 - 0.4 * ear)
                x_mul *= 1.0 + (EAR_IN - 1.0) * ear

                y_mul = 1.0 + (SY_OCCIP - 1.0) * rear * (0.55 + 0.45 * vault)
                y_mul += (SY_FACE - 1.0) * front
                z_mul = 1.0 + (SZ - 1.0) * (0.55 + 0.45 * vault)

                new = co.copy()
                new.x = co.x * x_mul
                new.y = co.y * y_mul
                new.z = co.z * z_mul
                p.co_deform = new
    bpy.context.view_layer.update()
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)


def recenter(muscles):
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    b_c, _ = C.bbox_center_size(bones)
    m_c, _ = C.bbox_center_size([static])
    for obj in muscles:
        obj.location += b_c - m_c
    C.apply_object_transforms(muscles)


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
    fit = fit_split_aabb(muscles)
    metrics_pair("after_aabb", muscles)
    print(f"[v3] reshape front={SX_FRONT} rear={SX_REAR} cheek={SX_CHEEK} sy_oc={SY_OCCIP} ear={EAR_IN}")
    reshape_round_oval(muscles)
    recenter(muscles)
    after = metrics_pair("WRAP_v3", muscles)

    C.save_blend(C.CHECKPOINTS / f"{TAG}.blend")
    C.set_group_visibility("skull", False)
    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True

    dest = OUT / "ours" / TAG
    C.render_views(dest, muscles, "muscle", res=1000)
    render_top(muscles, dest / "muscle_top.png", 1000, "soft_top")
    hide_for_cranial = [
        o for o in muscles if ("static" in o.name.lower() or "plastyma" in o.name.lower() or "platysma" in o.name.lower())
    ]
    set_hide_render(hide_for_cranial, True)
    render_top(cranial_objs(muscles), dest / "muscle_top_cranial.png", 1000, "cranial_top")
    set_hide_render(hide_for_cranial, False)
    render_side_extra(muscles, dest, 900)
    C.export_glb(OUT / "glb" / f"{TAG}.glb", muscles)

    cyx = float(after["cranial"]["depth_over_width"])
    judgment = {
        "method": "aabb_then_frontwide_round",
        "cranial_yx": cyx,
        "want_yx": [1.05, 1.25],
        "yx_ok": 1.05 <= cyx <= 1.25,
        "agent_pass": False,
        "note": "set agent_pass after eye-check in chat",
    }
    report = {
        "tag": TAG,
        "note": "AABB后前额/颧加宽、后枕略收、耳高收耳；保色层",
        "uni": uni,
        "fit": fit,
        "reshape": {
            "sx_front": SX_FRONT,
            "sx_rear": SX_REAR,
            "sx_cheek": SX_CHEEK,
            "sy_occip": SY_OCCIP,
            "sz": SZ,
            "ear_in": EAR_IN,
        },
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
        {"id": "WRAP_v2", "blend": "WRAP_v2.blend", "note": "上版·色层OK但顶仍水滴", "glb": True},
        {"id": "SKULL_v2", "blend": "SKULL_v2.blend", "note": "坏例·前后过扁", "glb": True},
    ]
    C.write_json(OUT / "manifest.json", {"candidates": cands, "stage": "WRAP_v3_round"})
    print(json.dumps(judgment, ensure_ascii=False))
    print("[WRAP_v3] done — agent eye-check next")


if __name__ == "__main__":
    main()
