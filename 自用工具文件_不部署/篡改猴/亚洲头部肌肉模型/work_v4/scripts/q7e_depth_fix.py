# -*- coding: utf-8 -*-
"""
Q7e: cranial A-P depth restore from Q4_packed, with neck-tail guard.
Iterates lattice strength until cranial metrics pass, then recolor + export.
"""
from __future__ import annotations

import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q1_recolor as R  # noqa: E402
import q6b_force_recolor_export as Q6B  # noqa: E402
import q7_form_fix as Q7  # noqa: E402

OUT = C.STAGES / "Q7e_depth_fix"
SOURCE = C.CHECKPOINTS / "Q4_packed.blend"


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def cranial_metrics():
    static = C.get_obj("muscle", "Static")
    if not static:
        return Q7.metrics("cranial")
    bm = bmesh.new()
    bm.from_mesh(static.data)
    bm.transform(static.matrix_world)
    zs = [v.co.z for v in bm.verts]
    z_cut = sorted(zs)[int(len(zs) * 0.22)]
    xs, ys, zs2 = [], [], []
    for v in bm.verts:
        if v.co.z >= z_cut:
            xs.append(v.co.x)
            ys.append(v.co.y)
            zs2.append(v.co.z)
    bm.free()
    if not xs:
        return Q7.metrics("cranial")
    mn = Vector((min(xs), min(ys), min(zs2)))
    mx = Vector((max(xs), max(ys), max(zs2)))
    s = mx - mn
    dw = s.y / max(s.x, 1e-8)
    hw = s.z / max(s.x, 1e-8)
    print(f"[cranial] size=({s.x:.4f},{s.y:.4f},{s.z:.4f}) d/w={dw:.3f} h/w={hw:.3f}")
    return {"size": [s.x, s.y, s.z], "depth_over_width": dw, "height_over_width": hw}


def eval_cranial(m: dict) -> dict:
    dw, hw = m["depth_over_width"], m["height_over_width"]
    ok_dw = 1.02 <= dw <= 1.18
    ok_hw = 0.96 <= hw <= 1.12
    notes = []
    if dw < 1.02:
        notes.append(f"cranial d/w={dw:.2f} too flat")
    elif dw > 1.18:
        notes.append(f"cranial d/w={dw:.2f} too long A-P")
    else:
        notes.append(f"cranial d/w={dw:.2f} OK")
    if hw < 0.96:
        notes.append(f"cranial h/w={hw:.2f} vault low")
    elif hw > 1.12:
        notes.append(f"cranial h/w={hw:.2f} vault high")
    else:
        notes.append(f"cranial h/w={hw:.2f} OK")
    return {"pass": ok_dw and ok_hw, "ok_dw": ok_dw, "ok_hw": ok_hw, "notes": notes}


def deform_cranial_depth(lat, depth_strength: float, vault_tweak: float = 0.0, widen: float = 0.0):
    """depth_strength ~0.5-0.9; vault_tweak negative compresses crown; widen adds midface width."""
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

                cranial = smooth_step((lz + 0.15) / 0.85) * (
                    1.0 - 0.55 * smooth_step((-lz - 0.15) / 0.5)
                )
                occ_upper = smooth_step((ly + 0.05) / 0.7) * smooth_step((lz - 0.0) / 0.6)

                y_scale = 1.0 + depth_strength * smooth_step(0.55 + 0.45 * abs(ly)) * cranial
                y_scale += 0.38 * depth_strength * occ_upper * cranial

                neck_tail = smooth_step((-lz - 0.25) / 0.55) * smooth_step((ly + 0.2) / 0.8)
                y_scale -= 0.32 * neck_tail
                if ly > 0.15:
                    y_scale -= 0.24 * smooth_step((ly - 0.15) / 0.85) * smooth_step((-lz - 0.1) / 0.6)

                new = co.copy()
                new.y = co.y * max(0.65, y_scale)

                if vault_tweak:
                    vault = smooth_step((lz - 0.05) / 0.72) * (1.0 - 0.25 * smooth_step(abs(lx)))
                    new.z = co.z * (1.0 + vault_tweak * vault)

                # keep cranial depth passes from ballooning width
                outer = smooth_step((abs(lx) - 0.22) / 0.55) * cranial
                new.x = co.x * (1.0 - 0.07 * outer)
                if widen:
                    mid = smooth_step(1.0 - abs(lz - 0.0) / 0.5) * smooth_step(abs(lx))
                    new.x = co.x * (1.0 + widen * mid)

                p.co_deform = new
    bpy.context.view_layer.update()


def scale_eyes():
    for name_part in ("Acs", "AcsLeca"):
        obj = C.get_obj("muscle", name_part)
        if not obj:
            continue
        static = C.get_obj("muscle", "Static")
        center, _ = C.bbox_center_size([static])
        for v in obj.data.vertices:
            w = obj.matrix_world @ v.co
            w.x = center.x + (w.x - center.x) * 1.08
            w.y = center.y + (w.y - center.y) * 0.97
            w.z = center.z + (w.z - center.z) * 1.04
            v.co = obj.matrix_world.inverted() @ w
        obj.data.update()
        C.apply_object_transforms([obj])


def self_eval_render(tag: str):
    C.ensure_dirs(OUT / tag)
    muscles = C.muscle_exportable()
    C.set_group_visibility("skull", False)
    C.render_views(OUT / tag, muscles, "muscle", res=900)
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


def force_recolor():
    for obj_name, img, _sock in Q6B.albedo_images():
        mode = "face"
        if "plastyma" in obj_name.lower() or "Image_1" in img.name:
            mode = "neck"
        if "Acs" in obj_name or "eye" in img.name.lower() or "Image_0" in img.name:
            mode = "eye"
        rem = R.remap_array(R.image_to_np(img), mode)
        R.np_to_image(img, rem)
        if mode == "eye":
            Q6B.force_dark_eye_pixels(img)
        img.pack()
        print(f"[Q7e recolor] {obj_name} {img.name} mode={mode}")
    for obj in C.mesh_objects(C.objects_in_group("muscle")):
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            for n in mat.node_tree.nodes:
                if n.type != "TEX_IMAGE" or not n.image:
                    continue
                for out in n.outputs:
                    for link in out.links:
                        if link.to_node.type == "SEPARATE_COLOR":
                            rem = R.remap_array(R.image_to_np(n.image), "face")
                            R.np_to_image(n.image, rem)
                            n.image.pack()
    R.darken_eye_principled()
    R.gray_plastyma_principled()
    bpy.ops.file.pack_all()


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    if not SOURCE.exists():
        raise RuntimeError(f"missing {SOURCE}")
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True

    muscles = C.muscle_exportable()
    print("[Q7e] from Q4_packed")
    before = cranial_metrics()
    self_eval_render("before")

    passes = [(0.78, 0.0, 0.0), (0.26, -0.03, 0.0), (0.14, 0.10, 0.0)]
    after = before
    ev = eval_cranial(before)
    for idx, (depth, vault, widen) in enumerate(passes):
        if ev["pass"]:
            break
        lat = Q7.make_lattice(muscles, f"DepthPass{idx}", 11)
        deform_cranial_depth(lat, depth, vault, widen)
        Q7.apply_lattice(muscles, lat)
        after = cranial_metrics()
        ev = eval_cranial(after)
        print(f"[Q7e] pass {idx} depth={depth} vault={vault}", ev)
    # one Y-only top-up if depth still short
    if not ev["pass"] and after["depth_over_width"] < 1.02:
        gap = 1.04 - after["depth_over_width"]
        depth = max(0.12, min(0.24, gap * 2.2))
        lat = Q7.make_lattice(muscles, "DepthTopUp", 11)
        deform_cranial_depth(lat, depth, 0.0, 0.0)
        Q7.apply_lattice(muscles, lat)
        after = cranial_metrics()
        ev = eval_cranial(after)
        print(f"[Q7e] top-up depth={depth:.2f}", ev)
    if not ev["ok_hw"] and after["height_over_width"] < 0.96:
        lat = Q7.make_lattice(muscles, "VaultTopUp", 11)
        deform_cranial_depth(lat, 0.0, 0.08, 0.0)
        Q7.apply_lattice(muscles, lat)
        after = cranial_metrics()
        ev = eval_cranial(after)
        print("[Q7e] vault top-up", ev)

    scale_eyes()
    lat = Q7.make_lattice(muscles, "EyePass", 11)
    Q7.deform_eyes_pass(lat)
    Q7.apply_lattice(muscles, lat)

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    after = cranial_metrics()
    ev = eval_cranial(after)
    self_eval_render("after")

    report = {"before": before, "after": after, "eval": ev, "source": str(SOURCE)}
    C.write_json(OUT / "self_eval_report.json", report)

    if not ev["pass"]:
        print("[Q7e] SELF-EVAL FAIL — checkpoint only")
        C.save_blend(C.CHECKPOINTS / "Q7e_depth_FAIL.blend")
        raise RuntimeError("Self-eval failed: " + "; ".join(ev["notes"]))

    force_recolor()
    self_eval_render("final")
    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.CHECKPOINTS / "Q7e_depth_fix.blend")
    C.save_blend(C.BLEND_FINAL)
    C.write_notes(
        OUT / "notes.md",
        "# Q7e depth fix\n\n"
        + "\n".join(f"- {n}" for n in ev["notes"])
        + "\n\nSelf-eval passed. Renders: before/ after/.\n",
    )
    print("[Q7e] PASS", ev)


if __name__ == "__main__":
    main()
