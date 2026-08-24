# -*- coding: utf-8 -*-
"""Generate base15/align.json from compare_review/base15 PNGs."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

REVIEW = Path(__file__).resolve().parents[1] / "compare_review"
BASE = REVIEW / "base15"
VIEWS = ["front", "side", "back", "front_three_quarter", "rear_three_quarter"]
PRIMARY = ["front", "side", "back"]


def analyze(arr: np.ndarray, band=(0.22, 0.78), min_row: int = 4):
    rgb = arr[..., :3]
    a = arr[..., 3]
    h, w = arr.shape[:2]
    corners = np.array([rgb[0, 0], rgb[0, w - 1], rgb[h - 1, 0], rgb[h - 1, w - 1]], dtype=np.float32)
    bg = corners.mean(axis=0)

    def fg(r, g, b, alpha):
        if alpha < 8:
            return False
        return abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 14

    mask = np.zeros((h, w), dtype=bool)
    for y in range(h):
        for x in range(w):
            r, g, b, alpha = a[y, x] if a.ndim == 0 else (*rgb[y, x], a[y, x])
            mask[y, x] = fg(float(rgb[y, x, 0]), float(rgb[y, x, 1]), float(rgb[y, x, 2]), int(a[y, x]))

    ys, xs = np.where(mask)
    if len(xs) == 0:
        return {"left": 0, "top": 0, "right": 1, "bottom": 1, "cx": 0.5, "cy": 0.5, "span": 1, "w": 1, "h": 1}
    x0, x1 = int(w * band[0]), int(w * band[1])
    top, bottom = h, -1
    cx_sum = 0.0
    cx_n = 0
    for y in range(h):
        row = mask[y, x0:x1]
        if row.sum() >= min_row:
            xs2 = np.where(row)[0] + x0
            top = min(top, y)
            bottom = max(bottom, y)
            cx_sum += xs2.mean()
            cx_n += 1
    if bottom < 0:
        top, bottom = ys.min(), ys.max()
        cx_sum = (xs.min() + xs.max()) / 2
        cx_n = 1
    left, right = xs.min(), xs.max()
    top_n = top / h
    bottom_n = (bottom + 1) / h
    left_n = left / w
    right_n = (right + 1) / w
    span = bottom_n - top_n
    cx = (cx_sum / max(cx_n, 1)) / w
    cy = (top_n + bottom_n) * 0.5
    return {
        "left": left_n,
        "top": top_n,
        "right": right_n,
        "bottom": bottom_n,
        "cx": cx,
        "cy": cy,
        "span": span,
        "w": right_n - left_n,
        "h": span,
    }


def load(path: Path, max_side: int = 1600) -> np.ndarray:
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    if max(w, h) > max_side:
        s = max_side / max(w, h)
        im = im.resize((int(w * s), int(h * s)), Image.Resampling.BILINEAR)
    return np.array(im)


def main():
    out = {}
    for view in VIEWS:
        src = BASE / f"{view}.png"
        if not src.exists():
            print("[skip]", src.name)
            continue
        box = analyze(load(src))
        out[view] = box
        print(view, "span", round(box["span"], 4), "top", round(box["top"], 4), "bottom", round(box["bottom"], 4))
    dest = BASE / "align.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[write]", dest)


if __name__ == "__main__":
    main()
