# -*- coding: utf-8
"""Prune obsolete sweep artifacts; keep pipeline + best checkpoints."""
from __future__ import annotations

import shutil
from pathlib import Path

WORK = Path(r"D:/Git仓库位置/PaintingTools/自用工具文件_不部署/篡改猴/亚洲头部肌肉模型/work_v4")
CK = WORK / "checkpoints"
ST = WORK / "stages"

KEEP_CK = {
    # pipeline chain
    "Q0_baseline.blend",
    "Q1_recolor.blend",
    "Q2_align.blend",
    "Q3_cage.blend",
    "Q4_packed.blend",
    "Q4_regional.blend",
    "Q5_cleanup.blend",
    "Q6_final.blend",
    "Q7_form_fix.blend",
    "Q7e_depth_fix.blend",
    "Q9_skull_dome.blend",
    "Q13_o_best.blend",
    "Q29_t3_best.blend",
    "Q56_t2_best.blend",
    "Q57_p1_best.blend",
    # specialists
    "Q55_f4_best.blend",
    "Q64_f125z15_best.blend",
    "Q72_f2_best.blend",
    # current best sweep results
    "Q84_a6_best.blend",
    "Q84_best.blend",
    "Q85_t5_best.blend",
    "Q85_best.blend",
}

# entire stage dirs safe to remove (superseded grid sweeps)
DROP_STAGE_DIRS = [
    "Q68_delta",
    "Q69_zoned",
    "Q70_q37",
    "Q71_push",
    "Q72_trim",
    "Q73_flat",
    "Q74_f2occ",
    "Q75_mesh",
    "Q76_recover",
    "Q77_balance",
    "Q78_fine",
    "Q79_static",
    "Q80_fine",
    "Q81_merge",
    "Q82_auto",
    "Q83_refine",
    "Q86_profile",
    "Q87_merge",
    "Q88_continue",
    "Q89_profile",
]

# trim png sweeps inside these dirs (keep json + named bests)
TRIM_STAGE_DIRS = {
    "Q84_aggressive": ["a6_p12_side.png", "a2_p7_side.png", "t5_p14_side.png", "a6_side.png", "t5_side.png"],
    "Q85_tune": ["t5_p14_side.png", "t5_side.png"],
}


def main():
    removed_ck = 0
    for p in CK.glob("*.blend*"):
        if p.name not in KEEP_CK:
            p.unlink(missing_ok=True)
            removed_ck += 1
            print(f"[rm ck] {p.name}")

    removed_dirs = 0
    for name in DROP_STAGE_DIRS:
        d = ST / name
        if d.is_dir():
            shutil.rmtree(d, ignore_errors=True)
            removed_dirs += 1
            print(f"[rm stage] {name}")

    removed_png = 0
    for dirname, keep_names in TRIM_STAGE_DIRS.items():
        d = ST / dirname
        if not d.is_dir():
            continue
        for png in d.glob("*.png"):
            if png.name not in keep_names:
                png.unlink(missing_ok=True)
                removed_png += 1
        print(f"[trim] {dirname} kept {keep_names}")

    print(f"done: removed {removed_ck} checkpoints, {removed_dirs} stage dirs, {removed_png} pngs")
    print(f"kept {len(KEEP_CK)} checkpoints")


if __name__ == "__main__":
    main()
