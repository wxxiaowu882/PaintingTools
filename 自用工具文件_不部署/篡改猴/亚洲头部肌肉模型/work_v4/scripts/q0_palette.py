# -*- coding: utf-8 -*-
"""Sample Base15 palette from design images (system Python)."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image
import numpy as np

ROOT = Path(r"D:\Git仓库位置\PaintingTools\自用工具文件_不部署\篡改猴\亚洲头部肌肉模型")
OUT = ROOT / "work_v4" / "textures" / "base15_palette.json"


def rgb_at(img: Image.Image, xy, r=8):
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    h, w = arr.shape[:2]
    x, y = xy
    x0, x1 = max(0, x - r), min(w, x + r + 1)
    y0, y1 = max(0, y - r), min(h, y + r + 1)
    patch = arr[y0:y1, x0:x1].reshape(-1, 3)
    # reject near-white background
    mask = patch.mean(axis=1) < 245
    if mask.any():
        patch = patch[mask]
    mean = patch.mean(axis=0)
    return [int(round(c)) for c in mean]


def main():
    front = Image.open(ROOT / "Base15_正.png")
    side = Image.open(ROOT / "Base15_侧.png")
    w, h = front.size
    # Approximate sample points on Base15_正 (normalized -> pixel)
    # Based on typical centered bust composition
    pts = {
        "frontalis": (0.50, 0.18),
        "orbicularis_oculi": (0.35, 0.32),
        "temporalis": (0.18, 0.30),
        "nasalis": (0.50, 0.40),
        "zygomatic_band": (0.38, 0.48),
        "masseter": (0.22, 0.55),
        "orbicularis_oris": (0.50, 0.58),
        "mentalis": (0.50, 0.68),
        "lips": (0.50, 0.55),
        "neck": (0.50, 0.82),
        "ear": (0.12, 0.45),
        "eye_iris": (0.38, 0.33),
    }
    colors = {}
    for name, (nx, ny) in pts.items():
        px, py = int(nx * w), int(ny * h)
        colors[name] = {"rgb": rgb_at(front, (px, py)), "sample_px": [px, py]}

    # side temporalis / occiput
    sw, sh = side.size
    colors["side_temporalis"] = {
        "rgb": rgb_at(side, (int(0.45 * sw), int(0.35 * sh))),
        "sample_px": [int(0.45 * sw), int(0.35 * sh)],
    }
    colors["side_occiput"] = {
        "rgb": rgb_at(side, (int(0.70 * sw), int(0.28 * sh))),
        "sample_px": [int(0.70 * sw), int(0.28 * sh)],
    }

    # Explicit Base15 design targets (override noisy samples if needed)
    # These match the agreed design language from plan + image review
    targets = {
        "frontalis": [168, 196, 150],
        "orbicularis_oculi": [210, 160, 168],
        "temporalis": [150, 130, 170],
        "nasalis": [190, 175, 155],
        "zygomatic_band_a": [170, 195, 200],
        "zygomatic_band_b": [220, 205, 170],
        "masseter": [145, 120, 165],
        "orbicularis_oris": [175, 155, 185],
        "mentalis": [165, 190, 150],
        "lips": [175, 170, 168],
        "neck": [175, 175, 178],
        "ear": [180, 178, 175],
        "eye_iris": [35, 28, 24],
        "eye_sclera": [230, 228, 225],
        "base_skin_gray": [190, 188, 185],
    }

    # Euro source typical hues to remap FROM (approximate)
    euro_source = {
        "frontalis_blue": [120, 130, 190],
        "orbicularis_yellow": [200, 205, 140],
        "temporalis_green": [150, 190, 150],
        "masseter_red": [180, 90, 90],
        "cheek_pink": [200, 130, 140],
        "neck_white": [230, 230, 230],
    }

    payload = {
        "sampled": colors,
        "targets": targets,
        "euro_source_approx": euro_source,
        "notes": "targets preferred for Q1 remapping; sampled used as cross-check",
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", OUT)
    for k, v in targets.items():
        print(k, v)


if __name__ == "__main__":
    main()
