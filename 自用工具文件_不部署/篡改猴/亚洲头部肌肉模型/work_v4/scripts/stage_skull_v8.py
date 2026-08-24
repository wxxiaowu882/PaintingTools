# -*- coding: utf-8 -*-
"""SKULL_v8: fix teardrop top — widen FRONT half, calm rear flare.

v7 eye-fail:
  cranial top = teardrop (narrow forehead, wide rear)
  front = still tall-narrow vs Base15
  soft top = ear wings still dominate

v8: anterior widen > posterior; mild AP settle on occiput only;
ear Z-band tuck; lower vault a bit.
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
TAG = "SKULL_v8"

SX_FRONT, SX_REAR, SX_CHEEK = 1.34, 1.10, 1.26
SY_OCCIP, SY_FACE, SZ, EAR_IN = 0.88, 1.00, 0.93, 0.72


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
    print(f"[{tag}_skull] depth/width={bs.y/max(bs.x,1e-8):.3f} (ref only)")
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
    print(f"[v8] uniform={uni:.4f}")

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


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def reshape_lattice(muscles):
    lat = Q7.make_lattice(muscles, "V8_FRONTWIDE", 9)
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
                jaw = smooth_step(1.0 - abs(lz + 0.45) / 0.45)
                ear_z = smooth_step(1.0 - abs(lz - 0.02) / 0.30)
                ear = smooth_step((abs(lx) - 0.58) / 0.42) * ear_z

                x_mul = 1.0
                x_mul += (SX_FRONT - 1.0) * front * (0.45 + 0.55 * vault) * (1.0 - 0.2 * ear)
                x_mul += (SX_REAR - 1.0) * rear * vault * (1.0 - 0.2 * ear)
                x_mul += (SX_CHEEK - 1.0) * front * (0.55 * cheek + 0.45 * jaw) * (1.0 - 0.45 * ear)
                x_mul *= 1.0 + (EAR_IN - 1.0) * ear

                y_mul = 1.0
                y_mul += (SY_OCCIP - 1.0) * rear * (0.5 + 0.5 * vault)
                y_mul += (SY_FACE - 1.0) * front

                z_mul = 1.0 + (SZ - 1.0) * (0.5 + 0.5 * vault)

                new = co.copy()
                new.x = co.x * x_mul
                new.y = co.y * y_mul
                new.z = co.z * z_mul
                p.co_deform = new
    bpy.context.view_layer.update()
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)


def recenter_to_skull(muscles):
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    b_c, _ = C.bbox_center_size(bones)
    m_c, _ = C.bbox_center_size([static])
    delta = b_c - m_c
    for obj in muscles:
        obj.location += delta
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
    metrics_pair("after_uni", muscles)

    print(
        f"[v8] front={SX_FRONT} rear={SX_REAR} cheek={SX_CHEEK} "
        f"sy_oc={SY_OCCIP} sy_face={SY_FACE} sz={SZ} ear={EAR_IN}"
    )
    reshape_lattice(muscles)
    recenter_to_skull(muscles)
    after = metrics_pair("SKULL_v8", muscles)

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
    chw = float(after["cranial"]["height_over_width"])
    judgment = {
        "method": "agent_eye_loop_v8",
        "from_v7_fail": "teardrop top (narrow forehead) + front still skinny",
        "cranial_yx": cyx,
        "cranial_hw": chw,
        "want_yx_band": [1.05, 1.28],
        "yx_in_band": 1.05 <= cyx <= 1.28,
        "agent_will_pass_only_if_eye_ok": True,
    }
    report = {
        "tag": TAG,
        "note": "人眼自迭代：前额/颧加宽、后颅少扩、后枕略收、耳高收耳",
        "uni": uni,
        "eye_fix": {
            "sx_front": SX_FRONT,
            "sx_rear": SX_REAR,
            "sx_cheek": SX_CHEEK,
            "sy_occip": SY_OCCIP,
            "sy_face": SY_FACE,
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
        {"id": "SKULL_v5", "blend": "SKULL_v5.blend", "note": "对照", "glb": True},
        {"id": "SKULL_v2", "blend": "SKULL_v2.blend", "note": "坏例·前后过扁", "glb": True},
    ]
    C.write_json(OUT / "manifest.json", {"candidates": cands, "stage": "SKULL_v8_frontwide"})
    print(json.dumps(judgment, ensure_ascii=False))
    print("[SKULL_v8] done — agent eye-check next")


if __name__ == "__main__":
    main()
