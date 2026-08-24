# -*- coding: utf-8 -*-
"""Q4: regional shared-lattice passes vs Base15."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def make_lattice(muscles, name, res=11):
    static = C.get_obj("muscle", "Static")
    center, size = C.bbox_center_size([static])
    from mathutils import Vector as V
    size = size + V((0.025, 0.025, 0.025))
    lat_data = bpy.data.lattices.new(name)
    lat_data.points_u = lat_data.points_v = lat_data.points_w = res
    lat = bpy.data.objects.new(name, lat_data)
    bpy.context.scene.collection.objects.link(lat)
    lat.location = center
    lat.scale = (size.x, size.y, size.z)
    bpy.context.view_layer.update()
    for obj in muscles:
        mod = obj.modifiers.new(name, "LATTICE")
        mod.object = lat
        mod.strength = 1.0
    return lat


def apply_lattice(muscles, lat):
    for obj in muscles:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        for mod in list(obj.modifiers):
            if mod.type == "LATTICE" and mod.object == lat:
                bpy.ops.object.modifier_apply(modifier=mod.name)
    name = lat.name
    bpy.data.objects.remove(lat, do_unlink=True)
    if name in bpy.data.lattices:
        bpy.data.lattices.remove(bpy.data.lattices[name])


def region_weight(lx, ly, lz, region: str) -> float:
    if region == "forehead_eyes":
        return smooth_step((lz - 0.05) / 0.55) * smooth_step(1.0 - abs(lx) / 0.95)
    if region == "nose":
        return smooth_step(1.0 - abs(lx) / 0.20) * smooth_step(1.0 - abs(lz - 0.08) / 0.30)
    if region == "zygomatic":
        return smooth_step(1.0 - abs(lz - 0.0) / 0.45) * smooth_step((abs(lx) - 0.12) / 0.55)
    if region == "masseter_jaw":
        return smooth_step((-lz + 0.05) / 0.55) * smooth_step((abs(lx) - 0.18) / 0.55)
    if region == "mouth_chin":
        return smooth_step((-lz - 0.12) / 0.45) * smooth_step(1.0 - abs(lx) / 0.48)
    if region == "occiput_neck":
        back = smooth_step((ly + 0.05) / 0.85)
        low = smooth_step((-lz - 0.15) / 0.6)
        return max(back * 0.75, low)
    return 0.0


def deform_region(lat, region: str, widen=0.0, flatten=0.0, dz=0.0):
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
                wt = region_weight(lx, ly, lz, region)
                if wt < 1e-4:
                    p.co_deform = co
                    continue
                new = co.copy()
                new.x = co.x * (1.0 + widen * wt)
                if ly < 0:
                    new.y = co.y * (1.0 - flatten * wt)
                new.z = co.z + dz * 0.5 * wt
                p.co_deform = new
    bpy.context.view_layer.update()


REGIONS = [
    ("forehead_eyes", dict(widen=0.03, flatten=0.06, dz=0.0)),
    ("nose", dict(widen=0.04, flatten=0.18, dz=-0.018)),
    ("zygomatic", dict(widen=0.10, flatten=0.06, dz=0.0)),
    ("masseter_jaw", dict(widen=0.09, flatten=0.02, dz=0.0)),
    ("mouth_chin", dict(widen=0.03, flatten=0.05, dz=0.0)),
    ("occiput_neck", dict(widen=0.04, flatten=0.0, dz=0.0)),
]


def main():
    C.ensure_dirs(C.STAGES / "Q4", C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(C.CHECKPOINTS / "Q3_cage.blend"))
    muscles = C.muscle_exportable()
    static = C.get_obj("muscle", "Static")
    min_w = C.bbox_center_size([static])[1].x * 0.88

    for name, params in REGIONS:
        print(f"[Q4] region {name}")
        lat = make_lattice(muscles, f"Cage_{name}", 11)
        deform_region(lat, name, **params)
        apply_lattice(muscles, lat)
        C.assert_head_scale([static], min_w, f"Q4_{name}")
        C.make_skull_transparent(0.26)
        C.render_views(C.STAGES / "Q4", C.visible_skull_muscle(), f"r_{name}", res=720)

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    C.render_views(C.STAGES / "Q4", C.visible_skull_muscle(), "overlay", res=900)
    C.set_group_visibility("skull", False)
    C.render_views(C.STAGES / "Q4", C.muscle_exportable(), "muscle", res=900)
    C.set_group_visibility("skull", True)
    C.save_blend(C.CHECKPOINTS / "Q4_regional.blend")
    C.write_notes(C.STAGES / "Q4", "# Q4 regional\n\nShared lattice per region; layers stay synced.\n")
    print("[Q4] done")


if __name__ == "__main__":
    main()
