# -*- coding: utf-8 -*-
"""Measure ivory-beam thickness in isolation side PNGs (pink=muscle, ivory=bone)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image


def beam_rows(path: Path) -> dict:
    im = np.array(Image.open(path).convert("RGB"), dtype=np.float32)
    h, w = im.shape[:2]
    lum = im.mean(axis=2)
    sat = im.max(axis=2) - im.min(axis=2)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    pink = (r > 140) & (r > g + 40) & (r > b + 20)
    ivory = (lum > 165) & (sat < 38) & ~pink & (lum < 252)
    bg = lum > 248
    # Search the anterior-of-ear band: right 35-70% of crop (cheek), mid height
    x0, x1 = int(w * 0.38), int(w * 0.78)
    y0, y1 = int(h * 0.28), int(h * 0.72)
    col_ivory = ivory[y0:y1, x0:x1].mean(axis=1)
    # longest run of rows with enough ivory
    thick = 0
    best = 0
    for v in col_ivory > 0.06:
        if v:
            thick += 1
            best = max(best, thick)
        else:
            thick = 0
    return {
        "file": path.name,
        "ivory_pct_roi": round(float(ivory[y0:y1, x0:x1].mean() * 100), 2),
        "pink_pct_roi": round(float(pink[y0:y1, x0:x1].mean() * 100), 2),
        "bg_pct_roi": round(float(bg[y0:y1, x0:x1].mean() * 100), 2),
        "beam_rows": int(best),
        "beam_frac_h": round(best / max(h, 1), 4),
    }


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    files = sorted(root.glob("*.png"))
    for p in files:
        if p.name.startswith(("iter_", "euro_", "shell_v8_side")):
            print(beam_rows(p))


if __name__ == "__main__":
    main()
