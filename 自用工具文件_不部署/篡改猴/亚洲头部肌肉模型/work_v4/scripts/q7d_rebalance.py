# -*- coding: utf-8
"""
Q7d: rebalance head — fix over-stretched occiput/neck; raise crown only.
Includes multi-angle self-eval gate before export.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q7_form_fix as Q7  # noqa: E402

OUT = C.STAGES / "Q7d_rebalance"
# Revert to pre-Q7 over-stretch (Q4 had good color + reasonable form before depth disaster)
SOURCE = C.CHECKPOINTS / "Q4_packed.blend"


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def cranial_metrics():
    """Metrics on upper-head verts only (exclude neck/platysma tail)."""
    static = C.get_obj("muscle", "Static")
    if not static:
        return Q7.metrics("cranial")
    me = static.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.transform(static.matrix_world)
    zs = [v.co.z for v in bm.verts]
    z_cut = sorted(zs)[int(len(zs) * 0.22)]  # drop lowest 22% (neck base)
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
    return {
        "size": [s.x, s.y, s.z],
        "depth_over_width": dw,
        "height_over_width": hw,
    }


def eval_cranial(m: dict) -> dict:
    dw, hw = m["depth_over_width"], m["height_over_width"]
    # Base15-like Asian head: brachycephalic but not pancake, not horse-head
    ok_dw = 1.02 <= dw <= 1.18
    ok_hw = 0.96 <= hw <= 1.12
    notes = []
    if dw < 1.02:
        notes.append(f"cranial d/w={dw:.2f} too flat")
    elif dw > 1.18:
        notes.append(f"cranial d/w={dw:.2f} too long A-P (horse head)")
    else:
        notes.append(f"cranial d/w={dw:.2f} OK")
    if hw < 0.96:
        notes.append(f"cranial h/w={hw:.2f} vault low")
    elif hw > 1.12:
        notes.append(f"cranial h/w={hw:.2f} vault high")
    else:
        notes.append(f"cranial h/w={hw:.2f} OK")
    return {"pass": ok_dw and ok_hw, "ok_dw": ok_dw, "ok_hw": ok_hw, "notes": notes}


def deform_rebalance(lat):
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

                new = co.copy()

                # 1) Moderate A-P depth on CRANIUM only (not neck tail)
                cranial = smooth_step((lz + 0.15) / 0.85) * (1.0 - 0.55 * smooth_step((-lz - 0.15) / 0.5))
                # face -Y, occiput +Y — add depth mostly upper-back
                occ_upper = smooth_step((ly + 0.05) / 0.7) * smooth_step((lz - 0.0) / 0.6)
                y_scale = 1.0 + 0.42 * cranial * (0.5 + 0.5 * occ_upper)

                # 2) Compress neck / lower occiput tail that was over-stretched
                neck_tail = smooth_step((-lz - 0.25) / 0.55) * smooth_step((ly + 0.2) / 0.8)
                y_scale -= 0.28 * neck_tail
                if ly > 0.15:
                    y_scale -= 0.18 * smooth_step((ly - 0.15) / 0.85) * smooth_step((-lz - 0.1) / 0.6)

                new.y = co.y * max(0.72, y_scale)

                # 3) Raise crown
                vault = smooth_step((lz - 0.05) / 0.72) * (1.0 - 0.3 * smooth_step(abs(lx)))
                new.z = co.z * (1.0 + 0.20 * vault)

                # 4) Mild midface widen (Asian)
                mid = smooth_step(1.0 - abs(lz - 0.0) / 0.5) * smooth_step(abs(lx))
                new.x = co.x * (1.0 + 0.06 * mid)

                # 5) Eyes: shallow + almond
                eye = smooth_step(1.0 - abs(lz - 0.18) / 0.28) * smooth_step(1.0 - abs(abs(lx) - 0.30) / 0.28)
                if ly < 0:
                    new.y = new.y * (1.0 - 0.10 * eye)
                new.x = new.x * (1.0 + 0.05 * eye * smooth_step(abs(lx)))

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
            w.x = center.x + (w.x - center.x) * 1.10
            w.y = center.y + (w.y - center.y) * 0.96
            w.z = center.z + (w.z - center.z) * 1.06
            v.co = obj.matrix_world.inverted() @ w
        obj.data.update()
        C.apply_object_transforms([obj])


def self_eval_render(tag: str):
    C.ensure_dirs(OUT / tag)
    muscles = C.muscle_exportable()
    C.set_group_visibility("skull", False)
    C.render_views(OUT / tag, muscles, "muscle", res=900)
    # top-ish view
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


def collages(tag="final"):
    try:
        from PIL import Image

        d = OUT / tag
        for cn, en in [("正", "front"), ("侧", "side"), ("前侧", "front_three_quarter"), ("背面", "back")]:
            a = C.ROOT / f"Base15_{cn}.png"
            b = d / f"muscle_{en}.png"
            if not a.exists() or not b.exists():
                continue
            ia = Image.open(a).convert("RGB")
            ib = Image.open(b).convert("RGB")
            h = 820
            ia = ia.resize((int(ia.width * h / ia.height), h))
            ib = ib.resize((int(ib.width * h / ib.height), h))
            canvas = Image.new("RGB", (ia.width + ib.width + 24, h + 8), (248, 248, 248))
            canvas.paste(ia, (0, 8))
            canvas.paste(ib, (ia.width + 24, 8))
            canvas.save(d / f"compare_Base15_{en}.png")
    except Exception as e:
        print("[collage]", e)


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    if not SOURCE.exists():
        raise RuntimeError(f"missing {SOURCE}")
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True

    muscles = C.muscle_exportable()
    print("[Q7d] from Q4_packed baseline")
    before = cranial_metrics()
    self_eval_render("before")

    lat = Q7.make_lattice(muscles, "Rebalance", 11)
    deform_rebalance(lat)
    Q7.apply_lattice(muscles, lat)
    scale_eyes()

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)

    after = cranial_metrics()
    ev = eval_cranial(after)
    self_eval_render("after")

    report = {"before": before, "after": after, "eval": ev, "source": str(SOURCE)}
    C.write_json(OUT / "self_eval_report.json", report)

    if not ev["pass"]:
        print("[Q7d] SELF-EVAL FAIL — saving checkpoint only, not overwriting final GLB")
        C.save_blend(C.CHECKPOINTS / "Q7d_rebalance_FAIL.blend")
        collages("after")
        raise RuntimeError("Self-eval failed: " + "; ".join(ev["notes"]))

    collages("after")
    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.CHECKPOINTS / "Q7d_rebalance.blend")
    C.save_blend(C.BLEND_FINAL)
    C.write_notes(
        OUT / "notes.md",
        "# Q7d rebalance\n\n"
        + "\n".join(f"- {n}" for n in ev["notes"])
        + "\n\nSelf-eval passed. Multi-angle renders in before/ and after/.\n",
    )
    print("[Q7d] PASS", ev)


if __name__ == "__main__":
    main()
