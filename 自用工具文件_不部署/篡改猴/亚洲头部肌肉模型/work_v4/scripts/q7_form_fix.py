# -*- coding: utf-8 -*-
"""Q7: fix flat cranium (depth) + vault + eyes vs Base15 / anthropometry."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def metrics(tag: str):
    st = C.get_obj("muscle", "Static")
    c, s = C.bbox_center_size([st])
    dw = s.y / max(s.x, 1e-8)
    hw = s.z / max(s.x, 1e-8)
    print(f"[{tag}] size=({s.x:.4f},{s.y:.4f},{s.z:.4f}) depth/width={dw:.3f} height/width={hw:.3f}")
    return {"size": [s.x, s.y, s.z], "depth_over_width": dw, "height_over_width": hw, "center": [c.x, c.y, c.z]}


def make_lattice(muscles, name, res=11):
    static = C.get_obj("muscle", "Static")
    center, size = C.bbox_center_size([static])
    size = size + Vector((0.04, 0.04, 0.04))
    lat_data = bpy.data.lattices.new(name)
    lat_data.points_u = lat_data.points_v = lat_data.points_w = res
    lat = bpy.data.objects.new(name, lat_data)
    bpy.context.scene.collection.objects.link(lat)
    lat.location = center
    lat.scale = (size.x, size.y, size.z)
    bpy.context.view_layer.update()
    for obj in muscles:
        for mod in list(obj.modifiers):
            if mod.type == "LATTICE":
                obj.modifiers.remove(mod)
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


def deform_restore_depth_and_vault(lat):
    """Expand A-P depth (esp. occiput +Y) and raise cranial vault; soften eye sockets."""
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

                # Global depth restore: stretch Y strongly (face -Y, occiput +Y)
                # Bring depth/width from ~0.45 toward ~1.05–1.15
                y_scale = 1.0 + 0.95 * smooth_step(0.55 + 0.45 * abs(ly))  # ~1.0–1.95
                # Extra occiput bulge (back + upper)
                occiput = smooth_step((ly + 0.05) / 0.9) * smooth_step((lz + 0.15) / 0.85)
                y_scale += 0.55 * occiput

                # Vault height: raise crown
                vault = smooth_step((lz - 0.05) / 0.7) * (1.0 - 0.35 * smooth_step(abs(lx)))
                z_scale = 1.0 + 0.22 * vault

                # Mildly reduce over-width from prior Asian widen (keep cheeks, trim extremes)
                outer = smooth_step((abs(lx) - 0.35) / 0.55)
                x_scale = 1.0 - 0.08 * outer * smooth_step((lz + 0.2) / 0.9)

                # Eyes: less deep-set — pull mid-upper face points that are very -Y toward center a bit less extreme
                eye_z = smooth_step(1.0 - abs(lz - 0.22) / 0.28)
                eye_x = smooth_step(1.0 - abs(abs(lx) - 0.32) / 0.28)
                eye = eye_z * eye_x
                # face is -Y: deep-set means more negative ly locally; push toward 0 (shallower)
                eye_y_pull = 0.0
                if ly < 0:
                    eye_y_pull = 0.18 * eye  # reduce |ly|

                # Almond: slight vertical compress of orbit ring, slight lateral
                eye_z_adj = -0.04 * eye * (1.0 if abs(lz - 0.22) < 0.35 else 0.0)

                new = co.copy()
                new.x = co.x * x_scale
                new.y = co.y * y_scale
                if ly < 0:
                    # apply eye shallowing in lattice units
                    new.y = new.y * (1.0 - eye_y_pull) 
                new.z = co.z * z_scale + eye_z_adj * 0.5
                p.co_deform = new
    bpy.context.view_layer.update()


def deform_eyes_pass(lat):
    """Second pass focused on periocular volume matching Base15 fuller oculi."""
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
                eye_z = smooth_step(1.0 - abs(lz - 0.20) / 0.32)
                eye_x = smooth_step(1.0 - abs(abs(lx) - 0.30) / 0.32)
                eye = eye_z * eye_x
                new = co.copy()
                # inflate slightly outward in X and forward/shallow in Y
                new.x = co.x * (1.0 + 0.06 * eye * smooth_step(abs(lx)))
                if ly < 0:
                    new.y = co.y * (1.0 - 0.10 * eye)
                # slight drop of outer canthus feel: lower outer eye a touch
                outer = smooth_step((abs(lx) - 0.25) / 0.4)
                new.z = co.z - 0.015 * 0.5 * eye * outer
                p.co_deform = new
    bpy.context.view_layer.update()


def evaluate(m: dict) -> dict:
    """Anthropometric sanity ranges for adult head soft-tissue bbox ratios."""
    dw = m["depth_over_width"]
    hw = m["height_over_width"]
    # Cephalic-related: length≈depth, breadth≈width; Asian often brachycephalic (W/L high => L/W ~1.15-1.30)
    ok_dw = 0.95 <= dw <= 1.35
    ok_hw = 0.85 <= hw <= 1.25
    notes = []
    if dw < 0.95:
        notes.append(f"depth/width={dw:.2f} still flat (want ~1.05–1.25)")
    elif dw > 1.35:
        notes.append(f"depth/width={dw:.2f} too long A-P")
    else:
        notes.append(f"depth/width={dw:.2f} in range")
    if hw < 0.85:
        notes.append(f"height/width={hw:.2f} vault short (want ~0.95–1.15)")
    elif hw > 1.25:
        notes.append(f"height/width={hw:.2f} vault tall")
    else:
        notes.append(f"height/width={hw:.2f} in range")
    return {"ok_depth": ok_dw, "ok_height": ok_hw, "notes": notes}


def main():
    out = C.STAGES / "Q7_form_fix"
    C.ensure_dirs(out, C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(C.BLEND_FINAL))

    muscles = C.muscle_exportable()
    before = metrics("before")

    # Pass 1: depth + vault
    lat = make_lattice(muscles, "FixDepth", 11)
    deform_restore_depth_and_vault(lat)
    apply_lattice(muscles, lat)
    mid = metrics("after_depth")
    C.assert_head_scale([C.get_obj("muscle", "Static")], 0.20, "Q7_depth")

    # Pass 2: eyes
    lat = make_lattice(muscles, "FixEyes", 11)
    deform_eyes_pass(lat)
    apply_lattice(muscles, lat)
    after = metrics("after_eyes")

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)

    C.make_skull_transparent(0.25)
    C.render_views(out, C.visible_skull_muscle(), "overlay", res=1000)
    C.set_group_visibility("skull", False)
    C.render_views(out, C.muscle_exportable(), "muscle", res=1100)
    C.set_group_visibility("skull", True)

    report = {
        "before": before,
        "after_depth": mid,
        "after": after,
        "eval": evaluate(after),
        "targets": {
            "depth_over_width": [1.05, 1.25],
            "height_over_width": [0.95, 1.15],
            "note": "Asian adult head soft-tissue bbox vs Base15 silhouette; skull d/w~1.37 is bone envelope",
        },
    }
    C.write_json(out / "proportion_report.json", report)

    # export
    C.export_glb(C.GLB_FINAL, C.muscle_exportable())
    C.save_blend(C.CHECKPOINTS / "Q7_form_fix.blend")
    C.save_blend(C.BLEND_FINAL)

    # collages
    try:
        from PIL import Image

        for cn, en in [("正", "front"), ("侧", "side"), ("前侧", "front_three_quarter"), ("背面", "back")]:
            a = C.ROOT / f"Base15_{cn}.png"
            b = out / f"muscle_{en}.png"
            if not a.exists() or not b.exists():
                continue
            ia = Image.open(a).convert("RGB")
            ib = Image.open(b).convert("RGB")
            h = 850
            ia = ia.resize((int(ia.width * h / ia.height), h))
            ib = ib.resize((int(ib.width * h / ib.height), h))
            canvas = Image.new("RGB", (ia.width + ib.width + 24, h + 8), (248, 248, 248))
            canvas.paste(ia, (0, 8))
            canvas.paste(ib, (ia.width + 24, 8))
            canvas.save(out / f"compare_Base15_{en}.png")
    except Exception as e:
        print("collage skip", e)

    C.write_notes(
        out,
        "\n".join(
            [
                "# Q7 form fix",
                "",
                f"- Before depth/width={before['depth_over_width']:.3f}",
                f"- After depth/width={after['depth_over_width']:.3f}",
                f"- After height/width={after['height_over_width']:.3f}",
                "",
                "Eval: " + "; ".join(report["eval"]["notes"]),
                "",
                "Shared lattice only; layers stay synced. Eyes: shallower orbits + slight almond adjust.",
            ]
        ),
    )
    print("[Q7] done", report["eval"])


if __name__ == "__main__":
    main()
