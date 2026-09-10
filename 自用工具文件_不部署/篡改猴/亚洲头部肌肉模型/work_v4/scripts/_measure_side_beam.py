# -*- coding: utf-8 -*-
"""Find zygomatic-arch ivory sandwich (muscle / bone / muscle) on side PNGs."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


def to_int(rgb):
    return int(rgb[0]), int(rgb[1]), int(rgb[2])


def is_muscle(r, g, b):
    sat = max(r, g, b) - min(r, g, b)
    if sat < 18:
        return False
    # purple / magenta masseter-temporalis
    if r > 90 and b > 80 and g < r - 8:
        return True
    # pink
    if r > 130 and r > g + 25 and r > b + 8:
        return True
    return False


def is_bone(r, g, b):
    lum = (r + g + b) / 3.0
    sat = max(r, g, b) - min(r, g, b)
    if lum < 168 or lum > 252:
        return False
    if sat > 42:
        return False
    if is_muscle(r, g, b):
        return False
    return True


def sandwich_stats(path: Path, x0=0.30, x1=0.62, y0=0.34, y1=0.62):
    im = np.array(Image.open(path).convert("RGB"))
    h, w = im.shape[:2]
    xs = range(int(w * x0), int(w * x1), max(1, w // 80))
    ys = range(int(h * y0), int(h * y1))
    widths = []
    samples = []
    for x in xs:
        labels = []
        for y in ys:
            r, g, b = to_int(im[y, x])
            if is_muscle(r, g, b):
                labels.append("M")
            elif is_bone(r, g, b):
                labels.append("B")
            else:
                labels.append(".")
        # longest B run that has M above and M below in this column
        best = 0
        i = 0
        n = len(labels)
        while i < n:
            if labels[i] != "B":
                i += 1
                continue
            j = i
            while j < n and labels[j] == "B":
                j += 1
            above = any(c == "M" for c in labels[max(0, i - 12) : i])
            below = any(c == "M" for c in labels[j : min(n, j + 12)])
            run = j - i
            if above and below:
                best = max(best, run)
            i = j
        if best:
            widths.append(best)
            samples.append(best)
    widths_n = np.array(widths, dtype=float) if widths else np.array([0.0])
    return {
        "file": path.name,
        "size": [w, h],
        "n_cols_with_beam": int(len(widths)),
        "beam_rows_median": float(np.median(widths_n)),
        "beam_rows_p75": float(np.percentile(widths_n, 75)),
        "beam_frac_h": float(np.median(widths_n) / h),
        "beam_span_cols": int(len(widths)),
    }


def main():
    root = Path("work_v4/compare_review")
    files = [
        root / "base15" / "side.png",
        root / "ours" / "SHELL_v8" / "muscle_side.png",
    ]
    for p in files:
        print(sandwich_stats(p))


if __name__ == "__main__":
    main()
