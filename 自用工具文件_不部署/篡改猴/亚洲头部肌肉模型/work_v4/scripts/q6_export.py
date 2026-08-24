# -*- coding: utf-8 -*-
"""Q6: export blend/glb + comparison collages."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402


def remove_cages():
    for obj in list(bpy.data.objects):
        if obj.type == "LATTICE" or obj.get("asset_group") == "cage" or "Cage" in obj.name:
            bpy.data.objects.remove(obj, do_unlink=True)


def collages():
    try:
        from PIL import Image
    except Exception as e:
        print(f"[Q6] PIL skip: {e}")
        return
    out = C.STAGES / "Q6_final"
    mapping = [
        ("正", "front"),
        ("侧", "side"),
        ("前侧", "front_three_quarter"),
        ("后侧", "rear_three_quarter"),
        ("背面", "back"),
        ("后侧2", "rear_three_quarter_2"),
    ]
    for cn, en in mapping:
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
        dest = out / f"compare_Base15_vs_ours_{en}.png"
        canvas.save(dest)
        print(f"[Q6] {dest}")


def main():
    C.ensure_dirs(C.STAGES / "Q6_final", C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(C.CHECKPOINTS / "Q5_cleanup.blend"))
    remove_cages()
    muscles = C.muscle_exportable()
    C.fix_normals(muscles)
    C.apply_object_transforms(muscles)
    C.assert_head_scale([C.get_obj("muscle", "Static")], 0.18, "Q6")
    C.make_skull_transparent(0.22)
    C.render_views(C.STAGES / "Q6_final", C.visible_skull_muscle(), "overlay", res=1100)
    C.set_group_visibility("skull", False)
    C.render_views(C.STAGES / "Q6_final", muscles, "muscle", res=1100)
    C.set_group_visibility("skull", True)
    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.CHECKPOINTS / "Q6_final.blend")
    C.save_blend(C.BLEND_FINAL)
    C.write_notes(
        C.STAGES / "Q6_final",
        "\n".join(
            [
                "# Q6 final",
                f"- Blend: `{C.BLEND_FINAL}`",
                f"- GLB: `{C.GLB_FINAL}`",
                "- Compare: compare_Base15_vs_ours_*.png",
                "",
                "No annotations. Structure from euro source; color/form toward Base15.",
            ]
        ),
    )
    collages()
    print("[Q6] done")


if __name__ == "__main__":
    main()
