# -*- coding: utf-8 -*-
"""Q7c: raise vault toward Base15 + scale eye meshes slightly."""
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


def scale_eye_meshes():
    for name_part in ("Acs", "AcsLeca"):
        obj = C.get_obj("muscle", name_part)
        if not obj:
            continue
        static = C.get_obj("muscle", "Static")
        center, _ = C.bbox_center_size([static])
        # scale about static center: wider almond, slightly larger
        for axis, f in ((0, 1.08), (1, 0.94), (2, 1.05)):
            for v in obj.data.vertices:
                w = obj.matrix_world @ v.co
                w[axis] = center[axis] + (w[axis] - center[axis]) * f
                v.co = obj.matrix_world.inverted() @ w
        obj.data.update()
        C.apply_object_transforms([obj])
        print(f"[Q7c] scaled {obj.name}")


def deform_vault_only(lat, z_boost=0.18):
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                lz = max(-1.0, min(1.0, co.z * 2.0))
                vault = Q7.smooth_step((lz - 0.0) / 0.72) * (1.0 - 0.2 * Q7.smooth_step(abs(co.x * 2.0)))
                new = co.copy()
                new.z = co.z * (1.0 + z_boost * vault)
                p.co_deform = new
    bpy.context.view_layer.update()


def main():
    out = C.STAGES / "Q7_form_fix"
    bpy.ops.wm.open_mainfile(filepath=str(C.BLEND_FINAL))
    muscles = C.muscle_exportable()
    before = Q7.metrics("Q7c_before")

    lat = Q7.make_lattice(muscles, "VaultOnly", 11)
    deform_vault_only(lat, 0.16)
    Q7.apply_lattice(muscles, lat)
    scale_eye_meshes()
    after = Q7.metrics("Q7c_after")

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)

    C.set_group_visibility("skull", False)
    C.render_views(out, C.muscle_exportable(), "muscle_final", res=1100)
    C.set_group_visibility("skull", True)
    C.make_skull_transparent(0.25)
    C.render_views(out, C.visible_skull_muscle(), "overlay_final", res=1000)

    report = {"before": before, "after": after, "eval": Q7.evaluate(after)}
    C.write_json(out / "proportion_report_v3.json", report)

    C.export_glb(C.GLB_FINAL, C.muscle_exportable())
    C.save_blend(C.BLEND_FINAL)

    try:
        from PIL import Image

        for cn, en in [("正", "front"), ("侧", "side"), ("前侧", "front_three_quarter"), ("背面", "back")]:
            a = C.ROOT / f"Base15_{cn}.png"
            b = out / f"muscle_final_{en}.png"
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
            print("wrote", en)
    except Exception as e:
        print("collage", e)

    C.write_notes(
        out / "notes_final.md",
        "\n".join(
            [
                "# Q7 头型+眼修正（最终）",
                "",
                f"- 深度/宽度：{before['depth_over_width']:.2f} → {after['depth_over_width']:.2f}（目标 1.05–1.25）",
                f"- 高度/宽度：{before['height_over_width']:.2f} → {after['height_over_width']:.2f}（目标约 0.95–1.15）",
                "",
                "评估：" + "; ".join(report["eval"]["notes"]),
                "",
                "已重导出 `asian_head_muscles_base15.glb`。请 Babylon 刷新查看。",
            ]
        ),
    )
    print("[Q7c] done", report["eval"])


if __name__ == "__main__":
    main()
