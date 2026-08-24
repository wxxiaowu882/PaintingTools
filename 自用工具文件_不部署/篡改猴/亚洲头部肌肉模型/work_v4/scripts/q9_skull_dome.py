# -*- coding: utf-8
"""
Q9: cranial cap from Asian skull ellipsoid — kill occipital spike, match Base15 dome.
Mandatory Base15 silhouette eval; export only if side IoU improves.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q6b_force_recolor_export as Q6B  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.STAGES / "Q9_skull_dome"
SOURCE = C.CHECKPOINTS / "Q7e_depth_fix.blend"
PY = shutil.which("python") or shutil.which("python3")
BASELINE_IOU = 0.484


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def skull_cap_params():
    skull = C.get_obj("skull", "UnifiedSkull")
    if not skull:
        static = C.get_obj("muscle", "Static")
        c, s = C.bbox_center_size([static])
        return c + Vector((0, 0, s.z * 0.05)), Vector((s.x * 0.48, s.y * 0.50, s.z * 0.44))
    c, s = C.bbox_center_size([skull])
    return c + Vector((0, 0, s.z * 0.06)), Vector((s.x * 0.50, s.y * 0.51, s.z * 0.46))


def fit_cranial_cap(muscles, blend: float = 0.82, shell: float = 0.014):
    """Pull upper/outside verts onto skull-scaled ellipsoid (rounded dome)."""
    cap_c, radii = skull_cap_params()
    rx, ry, rz = radii.x, radii.y, radii.z
    z_floor = cap_c.z - rz * 0.55
    print(f"[Q9] cap center={tuple(round(x, 4) for x in cap_c)} radii={tuple(round(x, 4) for x in radii)}")

    for obj in muscles:
        me = obj.data
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            if w.z < z_floor:
                continue
            p = Vector(
                (
                    (w.x - cap_c.x) / max(rx, 1e-6),
                    (w.y - cap_c.y) / max(ry, 1e-6),
                    (w.z - cap_c.z) / max(rz, 1e-6),
                )
            )
            r = p.length
            if r < 0.72:
                continue
            # occiput / vault spike: outside ellipsoid
            pn = p / max(r, 1e-6)
            scale_out = 1.0 + shell / max(rz, 1e-6)
            on = cap_c + Vector((pn.x * rx * scale_out, pn.y * ry * scale_out, pn.z * rz * scale_out))
            t = smooth_step((r - 0.78) / 0.55)
            # stronger on top-back spike
            if pn.z > 0.25 and pn.y > 0.05:
                t = min(1.0, t * 1.35)
            w2 = w.lerp(on, t * blend)
            v.co = obj.matrix_world.inverted() @ w2
        me.update()


def lattice_dome_polish(muscles):
    lat = Q7.make_lattice(muscles, "DomePolish", 11)
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
                top = smooth_step((lz - 0.08) / 0.58) * (1.0 - 0.3 * smooth_step(abs(lx)))
                occ_tail = smooth_step((ly + 0.35) / 0.65) * smooth_step((lz - 0.0) / 0.5)
                new = co.copy()
                new.z = co.z * (1.0 - 0.12 * top)
                new.y = co.y * (1.0 - 0.15 * occ_tail)
                dome = top * (1.0 - 0.35 * smooth_step(abs(lx)))
                new.x = co.x * (1.0 + 0.06 * dome)
                new.y = new.y * (1.0 + 0.04 * dome)
                p.co_deform = new
    bpy.context.view_layer.update()
    Q7.apply_lattice(muscles, lat)


def render_and_eval(tag: str) -> dict:
    C.ensure_dirs(OUT / tag)
    muscles = C.muscle_exportable()
    C.set_group_visibility("skull", False)
    C.render_views(OUT / tag, muscles, "muscle", res=1000)
    static = C.get_obj("muscle", "Static")
    center, size = C.bbox_center_size([static])
    cam_data = bpy.data.cameras.new("TopCam")
    cam = bpy.data.objects.new("TopCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = center + Vector((0, 0, max(size) * 2.2))
    cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = str(OUT / tag / "muscle_top.png")
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    C.set_group_visibility("skull", True)

    proc = subprocess.run(
        [PY, str(SCRIPTS / "base15_silhouette_eval.py"), str(OUT), tag],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(proc.stdout)
    rp = OUT / f"base15_eval_{tag}.json"
    if rp.exists():
        return json.loads(rp.read_text(encoding="utf-8"))
    return {"pass": False, "side_iou": 0}


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True

    muscles = C.muscle_exportable()
    print("[Q9] skull ellipsoid cap from Q7e")

    render_and_eval("before")

    fit_cranial_cap(muscles, blend=0.82, shell=0.014)
    lattice_dome_polish(muscles)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    Q8.force_recolor()

    report = render_and_eval("after")
    subprocess.run([PY, str(SCRIPTS / "make_collages.py"), "Q9_skull_dome", "after"], check=False)

    side_iou = report.get("side_iou") or 0
    C.write_json(OUT / "self_eval_report.json", report)
    C.save_blend(C.CHECKPOINTS / "Q9_skull_dome.blend")

    print(f"[Q9] side IoU={side_iou} baseline={BASELINE_IOU}")

    if side_iou >= BASELINE_IOU + 0.02:
        C.export_glb(C.GLB_FINAL, muscles)
        C.save_blend(C.BLEND_FINAL)
        print("[Q9] exported — IoU improved vs Q7e")
    else:
        print("[Q9] no GLB overwrite — review stages/Q9_skull_dome/after/")


if __name__ == "__main__":
    main()
