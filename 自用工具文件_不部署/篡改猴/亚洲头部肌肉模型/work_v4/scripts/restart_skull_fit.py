# -*- coding: utf-8
"""Restart: skull-first proportion — abandon PROP/Q57 profile lineage.

Base = Q1_recolor (palette OK, euro muscle not yet silhouette-warped).
Fit muscle group to Asian skull AABB (skull-derived scales only).
"""
from __future__ import annotations

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
TAG = "SKULL_v1"


def bone_objs():
    skull = C.get_obj("skull", "UnifiedSkull")
    mandible = C.get_obj("skull", "Mandible")
    return [o for o in (skull, mandible) if o]


def soft_pad(size: Vector, pad=(1.06, 1.10, 1.05)) -> Vector:
    """Muscle soft-tissue slightly larger than bone."""
    return Vector((size.x * pad[0], size.y * pad[1], size.z * pad[2]))


def rigid_then_skull_aabb(muscles):
    """1) Uniform scale to skull height. 2) Lattice to skull soft AABB (skull-derived)."""
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    if not bones or not static:
        raise RuntimeError("missing skull or Static muscle")

    b_c, b_s = C.bbox_center_size(bones)
    m_c, m_s = C.bbox_center_size([static])
    # Step 1: uniform by height — keep relative muscle shape
    uni = (b_s.z / max(m_s.z, 1e-8)) * 1.04
    print(f"[SKULL] uniform_height_scale={uni:.4f}")

    root = C.parent_empty("MuscleRoot", muscles)
    root["asset_group"] = "muscle"
    root.scale = (uni, uni, uni)
    bpy.context.view_layer.update()

    m_c2, m_s2 = C.bbox_center_size([static])
    b_min, b_max = C.world_bbox(bones)
    m_min, m_max = C.world_bbox([static])
    # place: center X, align top of head, mild Y toward skull front-back mid
    root.location += Vector(
        (
            b_c.x - m_c2.x,
            b_c.y - m_c2.y,
            (b_max.z - m_max.z) * 0.95 + (b_c.z - m_c2.z) * 0.05,
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

    # Step 2: skull-derived soft AABB (NOT arbitrary PROP factors)
    _, m_s3 = C.bbox_center_size([static])
    target = soft_pad(b_s)
    sx = target.x / max(m_s3.x, 1e-8)
    sy = target.y / max(m_s3.y, 1e-8)
    sz = target.z / max(m_s3.z, 1e-8)
    # clamp: never more than 18% off uniform — prevents giraffe/pancake
    def clamp_r(r, lo=0.85, hi=1.15):
        return max(lo, min(hi, r))

    sx, sy, sz = clamp_r(sx), clamp_r(sy), clamp_r(sz)
    print(f"[SKULL] soft_aabb sx={sx:.3f} sy={sy:.3f} sz={sz:.3f} (from skull)")

    lat = Q7.make_lattice(muscles, "SKULL_AABB", 7)
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                new = co.copy()
                new.x = co.x * sx
                new.y = co.y * sy
                new.z = co.z * sz
                p.co_deform = new
    bpy.context.view_layer.update()
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)

    # re-center after lattice
    m_c4, _ = C.bbox_center_size([static])
    delta = b_c - m_c4
    for obj in muscles:
        obj.location += delta
    C.apply_object_transforms(muscles)

    after = Q7.metrics("SKULL_v1")
    bone_m = {
        "size": [float(b_s.x), float(b_s.y), float(b_s.z)],
        "depth_over_width": float(b_s.y / max(b_s.x, 1e-8)),
        "height_over_width": float(b_s.z / max(b_s.x, 1e-8)),
    }
    return {"muscle": after, "skull": bone_m, "sx": sx, "sy": sy, "sz": sz, "uni": uni}


def main():
    C.ensure_dirs(OUT / "ours" / TAG, OUT / "glb", OUT / "base15", C.CHECKPOINTS)
    if not BASE.exists():
        raise SystemExit(f"missing base {BASE}")

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

    before = Q7.metrics("before")
    report = rigid_then_skull_aabb(muscles)
    report["before"] = before
    report["note"] = "重开·头骨优先：Q1→等高均匀缩放→按亚洲头骨软组织包络微调（钳制±15%）"
    report["tag"] = TAG

    C.save_blend(C.CHECKPOINTS / f"{TAG}.blend")

    # muscle-only views
    C.set_group_visibility("skull", False)
    dest = OUT / "ours" / TAG
    C.render_views(dest, muscles, "muscle", res=1000)
    C.write_json(dest / "skull_report.json", report)

    # overlay with transparent skull for sanity
    C.set_group_visibility("skull", True)
    C.make_skull_transparent(0.28)
    C.render_views(dest, C.visible_skull_muscle(), "overlay", res=900)

    # GLB muscle only
    C.set_group_visibility("skull", False)
    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True
    C.export_glb(OUT / "glb" / f"{TAG}.glb", muscles)

    # also refresh Q2 as contrast baseline if renders missing
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
        {"id": "PROP_v2", "blend": "PROP_v2.blend", "note": "已废弃·全局乱压深拉高（对照坏例）", "glb": True},
        {"id": "Q85_t5", "blend": "Q85_t5_best.blend", "note": "已废弃·旧数字最优（比例崩）", "glb": False},
    ]
    # copy early Q2 muscle renders into compare if present
    q2 = C.STAGES / "Q2"
    if q2.exists():
        q2_dest = OUT / "ours" / "Q2_align"
        q2_dest.mkdir(parents=True, exist_ok=True)
        for p in q2.glob("muscle_*.png"):
            shutil.copy2(p, q2_dest / p.name)
        cands.insert(1, {"id": "Q2_align", "blend": "Q2_align.blend", "note": "早期刚体对齐头骨（改比例前参考）", "glb": False})

    C.write_json(OUT / "manifest.json", {"candidates": cands, "stage": "RESTART_skull_first"})
    print("[SKULL] done — open compare page, select SKULL_v1 + 3D预览")


if __name__ == "__main__":
    main()
