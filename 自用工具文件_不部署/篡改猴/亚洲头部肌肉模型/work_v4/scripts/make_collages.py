# -*- coding: utf-8 -*-
"""Build Base15 side-by-side collages (run with system Python, not Blender)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(r"D:\Git仓库位置\PaintingTools\自用工具文件_不部署\篡改猴\亚洲头部肌肉模型")
WORK = ROOT / "work_v4"
STAGES = WORK / "stages"

PAIRS = [
    ("正", "front"),
    ("侧", "side"),
    ("前侧", "front_three_quarter"),
    ("背面", "back"),
]


def main():
    try:
        from PIL import Image
    except ImportError:
        print("PIL not installed; skip collages")
        return 1

    stage = STAGES / (sys.argv[1] if len(sys.argv) > 1 else "Q7e_depth_fix")
    tag = sys.argv[2] if len(sys.argv) > 2 else "after"
    d = stage / tag
    if not d.exists():
        print("missing", d)
        return 1

    for cn, en in PAIRS:
        a = ROOT / f"Base15_{cn}.png"
        b = d / f"muscle_{en}.png"
        if not a.exists() or not b.exists():
            print("skip", cn, en)
            continue
        ia = Image.open(a).convert("RGB")
        ib = Image.open(b).convert("RGB")
        h = 820
        ia = ia.resize((int(ia.width * h / ia.height), h))
        ib = ib.resize((int(ib.width * h / ib.height), h))
        canvas = Image.new("RGB", (ia.width + ib.width + 24, h + 8), (248, 248, 248))
        canvas.paste(ia, (0, 8))
        canvas.paste(ib, (ia.width + 24, 8))
        out = d / f"compare_Base15_{en}.png"
        canvas.save(out)
        print("saved", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
