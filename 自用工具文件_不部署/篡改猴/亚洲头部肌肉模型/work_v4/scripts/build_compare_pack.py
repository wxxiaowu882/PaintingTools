# -*- coding: utf-8
"""Render multi-candidate six-views for Base15 visual compare page (no GLB overwrite)."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.WORK / "compare_review"
CANDIDATES = [
    ("Q85_t5", "Q85_t5_best.blend", "当前内部最优（4/5 数字门控）"),
    ("Q84_a6", "Q84_a6_best.blend", "侧视轮廓较好"),
    ("Q90_best", "Q90_best.blend", "轻量 occ 微调"),
    ("Q57_p1", "Q57_p1_best.blend", "主线基线"),
]


def render_one(tag: str, blend_name: str):
    src = C.CHECKPOINTS / blend_name
    if not src.exists():
        print(f"[skip] missing {src}")
        return False
    bpy.ops.wm.open_mainfile(filepath=str(src))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    try:
        Q8.force_recolor()
    except Exception as e:
        print(f"[warn] recolor {tag}: {e}")
    C.set_group_visibility("skull", False)
    dest = OUT / "ours" / tag
    C.ensure_dirs(dest)
    C.render_views(dest, muscles, "muscle", res=1000)
    print(f"[ok] {tag} -> {dest}")
    return True


def main():
    C.ensure_dirs(OUT / "ours", OUT / "base15")
    # copy Base15 refs next to page for relative URLs
    import shutil

    mapping = [
        ("正", "front"),
        ("侧", "side"),
        ("前侧", "front_three_quarter"),
        ("后侧", "rear_three_quarter"),
        ("后侧2", "rear_three_quarter_2"),
        ("背面", "back"),
    ]
    for cn, en in mapping:
        src = C.ROOT / f"Base15_{cn}.png"
        if src.exists():
            shutil.copy2(src, OUT / "base15" / f"{en}.png")
            print(f"[copy] Base15_{cn} -> base15/{en}.png")
    done = []
    for tag, blend, _note in CANDIDATES:
        if render_one(tag, blend):
            done.append(tag)
    meta = {"candidates": [{"id": a, "blend": b, "note": c} for a, b, c in CANDIDATES if a in done]}
    C.write_json(OUT / "manifest.json", meta)
    print("[done] candidates:", done)


if __name__ == "__main__":
    main()
