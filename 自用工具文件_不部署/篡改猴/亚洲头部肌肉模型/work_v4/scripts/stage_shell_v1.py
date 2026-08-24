# -*- coding: utf-8 -*-
"""SHELL_v1: independent brachycephalic ellipsoid shell (stop AABB/lattice roulette).

Builds an Asian-leaning oval shell sized from skull height, then projects
muscle vertices radially onto that ellipsoid (with ear protection).
Judge by multi-view eye — not Soft AABB with ears.
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
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.WORK / "compare_review"
BASE = C.CHECKPOINTS / "Q1_recolor.blend"
TAG = "SHELL_v2"

# Ellipsoid half-axes relative to skull height H:
# brachy-ish: width >= depth
A_OVER_H = 0.58  # X half-width — wider brachy
B_OVER_H = 0.48  # Y half-depth (AP) — shorter than width
C_OVER_H = 0.48  # Z half-height
BLEND = 0.88  # how hard to pull toward shell (1=full)
EAR_PROTECT = 0.40  # reduce pull at extreme |x| near ear z


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
    return {
        "soft": soft,
        "cranial": {"size": [s.x, s.y, s.z], "depth_over_width": dw, "height_over_width": hw},
    }


def uniform_align_to_skull(muscles):
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    b_c, b_s = C.bbox_center_size(bones)
    _, m_s = C.bbox_center_size([static])
    uni = (b_s.z / max(m_s.z, 1e-8)) * 1.02
    print(f"[shell] uniform={uni:.4f}")
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
    return uni, b_c, b_s


def project_to_ellipsoid(p: Vector, center: Vector, a: float, b: float, c: float) -> Vector:
    """Radial project from center onto ellipsoid surface. Keep inside points milder."""
    d = p - center
    if d.length < 1e-8:
        return p.copy()
    # scale space to unit sphere
    q = Vector((d.x / a, d.y / b, d.z / c))
    ql = q.length
    if ql < 1e-8:
        return p.copy()
    # on surface in scaled space
    q_s = q / ql
    return center + Vector((q_s.x * a, q_s.y * b, q_s.z * c))


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def apply_shell(muscles, center: Vector, a: float, b: float, c: float):
    """Project vertices toward ellipsoid; protect ears & lower neck."""
    for obj in muscles:
        n = obj.name.lower()
        # Platysma / shoulder: light pull only
        strength = BLEND
        if "plastyma" in n or "platysma" in n:
            strength = BLEND * 0.25
        elif "static" in n:
            strength = BLEND * 0.55
        elif "deform" in n or "skiedras" in n:
            strength = BLEND * 0.85
        else:
            strength = BLEND * 0.65

        mw = obj.matrix_world
        imw = mw.inverted()
        mesh = obj.data
        for vert in mesh.vertices:
            world = mw @ vert.co
            # local weights in shell space
            lx = (world.x - center.x) / max(a, 1e-6)
            ly = (world.y - center.y) / max(b, 1e-6)
            lz = (world.z - center.z) / max(c, 1e-6)
            # ear band
            ear = smooth_step((abs(lx) - 0.55) / 0.45) * smooth_step(1.0 - abs(lz - 0.05) / 0.4)
            # neck / below jaw
            neck = smooth_step((-lz - 0.15) / 0.7)
            w = strength * (1.0 - EAR_PROTECT * ear) * (1.0 - 0.75 * neck)
            if w < 0.02:
                continue
            target = project_to_ellipsoid(world, center, a, b, c)
            # If point is inside ellipsoid, only pull mildly outward for vault
            d = world - center
            q = Vector((d.x / a, d.y / b, d.z / c))
            inside = q.length < 0.98
            if inside:
                w *= 0.55  # still allow outward fill for brachy width
            new_w = world.lerp(target, w)
            vert.co = imw @ new_w
        mesh.update()
    bpy.context.view_layer.update()
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
    uni, b_c, b_s = uniform_align_to_skull(muscles)
    metrics_pair("after_uni", muscles)

    H = float(b_s.z)
    a, b, c = H * A_OVER_H, H * B_OVER_H, H * C_OVER_H
    # Center shell on skull center, slightly up for vault
    center = Vector((b_c.x, b_c.y, b_c.z + H * 0.02))
    print(f"[shell] ellipsoid a={a:.4f} b={b:.4f} c={c:.4f} blend={BLEND}")
    apply_shell(muscles, center, a, b, c)
    recenter(muscles)
    after = metrics_pair("SHELL_v2", muscles)

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
        "method": "ellipsoid_radial_shell",
        "cranial_yx": cyx,
        "shell": {"a": a, "b": b, "c": c, "blend": BLEND},
        "agent_pass": False,
    }
    report = {
        "tag": TAG,
        "note": "短头椭球壳 v2：更宽更短、更强贴合",
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
        {"id": "SHELL_v1", "blend": "SHELL_v1.blend", "note": "上版·壳偏小偏长", "glb": True},
        {"id": "WRAP_v2", "blend": "WRAP_v2.blend", "note": "AABB路线对照", "glb": True},
        {"id": "SKULL_v2", "blend": "SKULL_v2.blend", "note": "坏例·前后过扁", "glb": True},
    ]
    C.write_json(OUT / "manifest.json", {"candidates": cands, "stage": "SHELL_v2"})
    print(json.dumps(judgment, ensure_ascii=False))
    print("[SHELL_v2] done — agent eye-check next")


if __name__ == "__main__":
    main()
