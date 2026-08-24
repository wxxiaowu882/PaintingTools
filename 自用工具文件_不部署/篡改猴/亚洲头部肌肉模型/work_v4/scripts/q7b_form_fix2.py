# -*- coding: utf-8 -*-
"""Q7b: second pass — push depth/height into anthropometric range + eye tune."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q7_form_fix as Q7  # noqa: E402


def deform_push_to_target(lat, y_boost=0.38, z_boost=0.28):
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

                # More occiput (+Y) and crown (+Z)
                occiput = Q7.smooth_step((ly + 0.1) / 0.85) * Q7.smooth_step((lz + 0.05) / 0.9)
                vault = Q7.smooth_step((lz - 0.0) / 0.75) * (1.0 - 0.25 * Q7.smooth_step(abs(lx)))
                y_scale = 1.0 + y_boost * (0.55 + 0.45 * abs(ly)) + 0.35 * y_boost * occiput
                z_scale = 1.0 + z_boost * vault

                # Eyes: shallower, slightly wider almond
                eye = Q7.smooth_step(1.0 - abs(lz - 0.20) / 0.30) * Q7.smooth_step(1.0 - abs(abs(lx) - 0.30) / 0.30)
                new = co.copy()
                new.x = co.x * (1.0 + 0.05 * eye * Q7.smooth_step(abs(lx)))
                new.y = co.y * y_scale
                if ly < 0:
                    new.y = new.y * (1.0 - 0.12 * eye)
                new.z = co.z * z_scale - 0.012 * 0.5 * eye * Q7.smooth_step((abs(lx) - 0.2) / 0.5)
                p.co_deform = new
    bpy.context.view_layer.update()


def main():
    out = C.STAGES / "Q7_form_fix"
    C.ensure_dirs(out, C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(C.BLEND_FINAL))
    muscles = C.muscle_exportable()
    before = Q7.metrics("Q7b_before")

    lat = Q7.make_lattice(muscles, "FixPass2", 11)
    deform_push_to_target(lat, y_boost=0.42, z_boost=0.32)
    Q7.apply_lattice(muscles, lat)
    after = Q7.metrics("Q7b_after")
    C.assert_head_scale([C.get_obj("muscle", "Static")], 0.20, "Q7b")

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)

    C.make_skull_transparent(0.25)
    C.render_views(out, C.visible_skull_muscle(), "overlay2", res=1000)
    C.set_group_visibility("skull", False)
    C.render_views(out, C.muscle_exportable(), "muscle2", res=1100)
    C.set_group_visibility("skull", True)

    report = {
        "before": before,
        "after": after,
        "eval": Q7.evaluate(after),
    }
    C.write_json(out / "proportion_report_v2.json", report)

    C.export_glb(C.GLB_FINAL, C.muscle_exportable())
    C.save_blend(C.CHECKPOINTS / "Q7b_form_fix.blend")
    C.save_blend(C.BLEND_FINAL)

    try:
        from PIL import Image

        for cn, en, src in [
            ("正", "front", "muscle2"),
            ("侧", "side", "muscle2"),
            ("前侧", "front_three_quarter", "muscle2"),
            ("背面", "back", "muscle2"),
        ]:
            a = C.ROOT / f"Base15_{cn}.png"
            b = out / f"{src}_{en}.png"
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
            canvas.save(out / f"compare_Base15_v2_{en}.png")
    except Exception as e:
        print("collage", e)

    notes = report["eval"]["notes"]
    C.write_notes(out / "notes_v2.md", "# Q7b second pass\n\n" + "\n".join(f"- {n}" for n in notes))
    print("[Q7b] done", report["eval"])


if __name__ == "__main__":
    main()
