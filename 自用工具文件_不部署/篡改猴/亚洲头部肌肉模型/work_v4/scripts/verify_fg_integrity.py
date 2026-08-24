# -*- coding: utf-8 -*-
"""Detect broken renders: missing fg vs Base / white holes inside head bbox."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

REVIEW = Path(__file__).resolve().parents[1] / "compare_review"
CAND = sys.argv[1] if len(sys.argv) > 1 else "SHELL_v8"
PRIMARY = ["front", "side", "back"]
FG_FRAC_RATIO_MIN = 0.62
BBOX_FILL_RATIO_MIN = 0.72


def fg_frac(rgb: np.ndarray) -> float:
    return float(fg_mask(rgb).mean())


def fg_mask(rgb: np.ndarray, tol: float = 20.0) -> np.ndarray:
    bg = rgb[0, 0].astype(np.float32)
    return np.linalg.norm(rgb.astype(np.float32) - bg, axis=2) > tol


def bbox_fg_fill(rgb: np.ndarray) -> tuple[float, float]:
    m = fg_mask(rgb)
    ys, xs = np.where(m)
    if len(ys) < 50:
        return 0.0, 0.0
    sub_m = m[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    fill = float(sub_m.mean())
    area = int(m.sum())
    return fill, area


def check(view: str) -> bool:
    base_p = REVIEW / "base15" / f"{view}.png"
    ours_p = REVIEW / "ours" / CAND / f"muscle_{view}.png"
    if not base_p.exists() or not ours_p.exists():
        print(f"[skip] {view}")
        return True
    base = np.array(Image.open(base_p).convert("RGB"))
    ours = np.array(Image.open(ours_p).convert("RGB"))
    base_fill, _ = bbox_fg_fill(base)
    fill, _ = bbox_fg_fill(ours)
    frac_ratio = fg_frac(ours) / max(fg_frac(base), 1e-6)
    fill_ratio = fill / max(base_fill, 1e-6)
    ok = frac_ratio >= FG_FRAC_RATIO_MIN and fill_ratio >= BBOX_FILL_RATIO_MIN
    print(
        f"[{'OK' if ok else 'FAIL'}] {view.upper()} fg_frac_ratio={frac_ratio:.3f} "
        f"bbox_fill_ratio={fill_ratio:.3f} (need frac>={FG_FRAC_RATIO_MIN}, fill>={BBOX_FILL_RATIO_MIN})"
    )
    if not ok:
        if frac_ratio < FG_FRAC_RATIO_MIN:
            print("       -> too much white / model too sparse vs Base")
        if fill_ratio < BBOX_FILL_RATIO_MIN:
            print("       -> white holes inside head bbox")
    return ok


def main() -> int:
    fails = [v for v in PRIMARY if not check(v)]
    if fails:
        print("[fg-integrity] FAIL:", ", ".join(fails))
        return 1
    print("[fg-integrity] PASS primary")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
