# -*- coding: utf-8 -*-
"""Self-test compare_review head-top/chin alignment (offline PNG compose)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "compare_review"
OUT = ROOT / "_selftest"
PRIMARY_VIEWS = ["front", "side", "back"]
AUX_VIEWS = ["front_three_quarter", "rear_three_quarter"]
VIEWS = PRIMARY_VIEWS + AUX_VIEWS
CAND = sys.argv[1] if len(sys.argv) > 1 else "SHELL_v8"


def load(path: Path, max_side: int = 1200) -> Image.Image:
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    if max(w, h) > max_side:
        s = max_side / max(w, h)
        im = im.resize((int(w * s), int(h * s)), Image.Resampling.BILINEAR)
    return im


def analyze(arr: np.ndarray, threshold: int = 248, band=(0.22, 0.78), min_row: int = 4):
    rgb = arr[..., :3]
    a = arr[..., 3]
    mask = (a >= 8) & ~((rgb[:, :, 0] >= threshold) & (rgb[:, :, 1] >= threshold) & (rgb[:, :, 2] >= threshold))
    h, w = mask.shape
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return dict(top_n=0.0, bottom_n=1.0, span_n=1.0, cx_n=0.5)
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
    return dict(
        top_n=top / h,
        bottom_n=(bottom + 1) / h,
        span_n=(bottom - top + 1) / h,
        cx_n=(cx_sum / max(cx_n, 1)) / w,
    )


def compose(base_path: Path, ours_path: Path, out_path: Path, size: int = 960) -> tuple[float, float]:
    ba = np.array(load(base_path))
    oa = np.array(load(ours_path))
    ref = analyze(ba)
    bb = analyze(ba)
    ob = analyze(oa)
    canvas = Image.new("RGBA", (size, size), (17, 17, 17, 255))

    def blit(arr, box):
        ih, iw = arr.shape[:2]
        scale = (ref["span_n"] * size) / max(box["span_n"] * ih, 1)
        dw, dh = int(iw * scale), int(ih * scale)
        im = Image.fromarray(arr).resize((dw, dh), Image.Resampling.BILINEAR)
        left = int(ref["cx_n"] * size - box["cx_n"] * dw)
        top = int(ref["top_n"] * size - box["top_n"] * dh)
        return im, left, top, dh

    oim, ox, oy, odh = blit(oa, ob)
    canvas.alpha_composite(oim, (ox, oy))
    bim, bx, by, bdh = blit(ba, bb)
    left_half = Image.new("RGBA", (size // 2, size), (0, 0, 0, 0))
    left_half.alpha_composite(bim, (bx, by))
    canvas.paste(left_half, (0, 0), left_half)
    d = ImageDraw.Draw(canvas)
    y1 = int(ref["top_n"] * size)
    y2 = int(ref["bottom_n"] * size) - 1
    d.line([(0, y1), (size, y1)], fill=(255, 80, 80, 255), width=2)
    d.line([(0, y2), (size, y2)], fill=(80, 180, 255, 255), width=2)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)
    ours_top = int(ref["top_n"] * size - ob["top_n"] * odh + ob["top_n"] * odh)
    ours_bottom = int(ref["top_n"] * size - ob["top_n"] * odh + ob["bottom_n"] * odh) - 1
    return 0.0, 0.0


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for view in VIEWS:
        base = ROOT / "base15" / f"{view}.png"
        ours = ROOT / "ours" / CAND / f"muscle_{view}.png"
        if not base.exists() or not ours.exists():
            print("[skip]", view)
            continue
        out = OUT / f"aligned_{view}.png"
        compose(base, ours, out)
        print("[ok]", out.name)
    print("[selftest] done ->", OUT)


if __name__ == "__main__":
    main()
