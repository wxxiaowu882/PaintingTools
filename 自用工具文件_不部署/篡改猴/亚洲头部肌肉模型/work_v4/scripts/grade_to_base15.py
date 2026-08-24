# -*- coding: utf-8 -*-
"""Match rendered PNG fg tones to Base15 reference (color grade only, geometry unchanged)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

REVIEW = Path(__file__).resolve().parents[1] / "compare_review"
VIEWS = ["front", "side", "back", "front_three_quarter", "rear_three_quarter"]


def fg_mask(rgb: np.ndarray, tol: float = 20.0) -> np.ndarray:
    bg = rgb[0, 0].astype(np.float32)
    return np.linalg.norm(rgb.astype(np.float32) - bg, axis=2) > tol


def match_channel(src: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Monotonic histogram match src -> ref (uint8 fg samples)."""
    if src.size < 32 or ref.size < 32:
        return src
    src_u = src.astype(np.uint8)
    ref_u = ref.astype(np.uint8)
    src_hist = np.bincount(src_u, minlength=256).astype(np.float64)
    ref_hist = np.bincount(ref_u, minlength=256).astype(np.float64)
    src_cdf = np.cumsum(src_hist)
    ref_cdf = np.cumsum(ref_hist)
    if src_cdf[-1] <= 0 or ref_cdf[-1] <= 0:
        return src
    src_cdf /= src_cdf[-1]
    ref_cdf /= ref_cdf[-1]
    lut = np.zeros(256, dtype=np.uint8)
    j = 0
    for i in range(256):
        while j < 255 and ref_cdf[j] < src_cdf[i]:
            j += 1
        lut[i] = j
    return lut[src_u]


def forehead_band_mask(rgb: np.ndarray) -> np.ndarray:
    m = fg_mask(rgb)
    ys, xs = np.where(m)
    if len(ys) < 20:
        return m & False
    y0, y1 = ys.min(), ys.max()
    y_cut = y0 + int((y1 - y0) * 0.35)
    band = np.zeros_like(m)
    band[y0:y_cut, :] = True
    return band & m


def grade(path: Path, ref_path: Path, flip_h: bool = False) -> None:
    im = Image.open(path).convert("RGB")
    if flip_h:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    ours = np.array(im)
    ref = np.array(Image.open(ref_path).convert("RGB").resize(ours.shape[1::-1], Image.Resampling.BILINEAR))
    m = fg_mask(ours)
    if not m.any():
        Image.fromarray(ours).save(path)
        return
    out = ours.copy()
    for c in range(3):
        out[..., c][m] = match_channel(ours[..., c][m], ref[..., c][m])
    # Front: tighten forehead band to Base hue (global hist can miss regional swap)
    if ref_path.stem == "front":
        fb = forehead_band_mask(out)
        fr = forehead_band_mask(ref)
        if fb.sum() > 32 and fr.sum() > 32:
            for c in range(3):
                out[..., c][fb] = match_channel(out[..., c][fb], ref[..., c][fr])
    Image.fromarray(out).save(path)


def main() -> int:
    if len(sys.argv) >= 4 and sys.argv[1] == "--one":
        grade(Path(sys.argv[2]), Path(sys.argv[3]), flip_h="--flip" in sys.argv)
        print("[grade]", sys.argv[2])
        return 0
    cand = sys.argv[1] if len(sys.argv) > 1 else "SHELL_v8"
    ours_dir = REVIEW / "ours" / cand
    base_dir = REVIEW / "base15"
    for view in VIEWS:
        op = ours_dir / f"muscle_{view}.png"
        bp = base_dir / f"{view}.png"
        if not op.exists() or not bp.exists():
            continue
        flip = view == "side"
        grade(op, bp, flip_h=False)  # side already flipped at render finalize
        print("[grade]", op.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
