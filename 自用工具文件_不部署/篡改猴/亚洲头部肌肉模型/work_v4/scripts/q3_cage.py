# -*- coding: utf-8 -*-
"""Q3: one shared lattice for Asian proportions (relative point moves only)."""
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


def make_lattice(muscles, name="AsianCage", res=9):
    static = C.get_obj("muscle", "Static")
    center, size = C.bbox_center_size([static])
    from mathutils import Vector as V
    size = size + V((0.03, 0.03, 0.03))
    lat_data = bpy.data.lattices.new(name)
    lat_data.points_u = res
    lat_data.points_v = res
    lat_data.points_w = res
    lat = bpy.data.objects.new(name, lat_data)
    bpy.context.scene.collection.objects.link(lat)
    lat.location = center
    lat.scale = (size.x, size.y, size.z)
    lat["asset_group"] = "cage"
    bpy.context.view_layer.update()
    for obj in muscles:
        for mod in list(obj.modifiers):
            if mod.type == "LATTICE":
                obj.modifiers.remove(mod)
        mod = obj.modifiers.new("AsianLattice", "LATTICE")
        mod.object = lat
        mod.strength = 1.0
    return lat


def deform_lattice(lat, strength=1.0):
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
                s = strength
                mid_h = smooth_step(1.0 - abs(lz - 0.05) / 0.75)
                outer = smooth_step(abs(lx))
                widen = 1.0 + 0.16 * mid_h * outer * s
                widen *= 1.0 + 0.07 * smooth_step((lz + 0.15) / 0.85) * smooth_step(abs(lx) * 0.7) * s
                widen *= 1.0 + 0.11 * smooth_step((-lz + 0.2) / 0.75) * smooth_step(abs(lx)) * s
                nose = smooth_step(1.0 - abs(lx) / 0.35) * smooth_step(1.0 - abs(lz - 0.05) / 0.45)
                cheek = mid_h * smooth_step((abs(lx) - 0.12) / 0.55)
                new = co.copy()
                new.x = co.x * widen
                if ly < 0:
                    new.y = co.y * (1.0 - (0.14 * nose + 0.07 * cheek) * s)
                new.z = co.z - 0.012 * nose * s
                p.co_deform = new
    bpy.context.view_layer.update()


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


def main():
    C.ensure_dirs(C.STAGES / "Q3", C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(C.CHECKPOINTS / "Q2_align.blend"))
    muscles = C.muscle_exportable()
    static = C.get_obj("muscle", "Static")
    before = C.bbox_center_size([static])[1].x

    # round 1
    lat = make_lattice(muscles, "CageR1", 9)
    deform_lattice(lat, 1.0)
    apply_lattice(muscles, lat)
    C.assert_head_scale([static], before * 0.85, "Q3r1")
    C.make_skull_transparent(0.26)
    C.render_views(C.STAGES / "Q3", C.visible_skull_muscle(), "r1_overlay", res=800)

    # round 2 milder extra zygoma/jaw
    lat = make_lattice(muscles, "CageR2", 9)
    deform_lattice(lat, 0.45)
    apply_lattice(muscles, lat)
    C.assert_head_scale([static], before * 0.85, "Q3r2")

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    C.render_views(C.STAGES / "Q3", C.visible_skull_muscle(), "overlay", res=900)
    C.set_group_visibility("skull", False)
    C.render_views(C.STAGES / "Q3", C.muscle_exportable(), "muscle", res=900)
    C.set_group_visibility("skull", True)
    C.save_blend(C.CHECKPOINTS / "Q3_cage.blend")
    C.write_notes(C.STAGES / "Q3", "# Q3 shared cage\n\nTwo relative lattice rounds. Layers stay in sync.\n")
    print("[Q3] done")


if __name__ == "__main__":
    main()
