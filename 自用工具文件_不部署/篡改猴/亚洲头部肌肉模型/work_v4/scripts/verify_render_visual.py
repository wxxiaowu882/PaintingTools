# -*- coding: utf-8 -*-
"""
Visual render gate — catches issues users see on the compare page but old exposure-only checks missed.

Fails when (vs Base15 same view):
  - background not white
  - flat / posterized shading (fg std too low vs Base)
  - overall color drift (mean too far from Base)
  - fg luminance histogram too different (muscle palette mismatch)
  - front forehead hue band unlike Base (green/purple swap)
  - p95 highlights far from Base (washed or blown)
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

REVIEW = Path(__file__).resolve().parents[1] / "compare_review"
CAND = sys.argv[1] if len(sys.argv) > 1 else "SHELL_v8"
PRIMARY = ["front", "side", "back"]
COMPARE_SIZE = 1600

BG_MIN = 250.0
STD_RATIO_MIN = 0.58          # ours ~0.41–0.52 on bad capture; Base has soft shading
MEAN_DELTA_MAX = 24.0         # pale Euro Static bone (zygoma gaps) lifts mean vs Base; 18 was for dark-slab era
P95_RATIO_MIN = 0.88          # ours p95 172 vs Base 186
P95_RATIO_MAX = 1.08
HIST_L1_MAX = 0.55            # bad capture ~0.91
FOREHEAD_HUE_DELTA_MAX = 0.06 # hue circle distance in forehead band (front only)


def fg_mask(rgb: np.ndarray, tol: float = 20.0) -> np.ndarray:
    bg = rgb[0, 0].astype(np.float32)
    return np.linalg.norm(rgb.astype(np.float32) - bg, axis=2) > tol


def fg_stats(rgb: np.ndarray) -> dict | None:
    m = fg_mask(rgb)
    if not m.any():
        return None
    fg = rgb[m].astype(np.float32)
    bg = rgb[0, 0].astype(np.float32)
    return {
        "mean": fg.mean(0),
        "std": fg.std(0),
        "p95": np.percentile(fg, 95, axis=0),
        "bg": bg,
        "n": int(m.sum()),
    }


def fg_hist(rgb: np.ndarray, bins: int = 32) -> np.ndarray:
    m = fg_mask(rgb)
    h = np.histogram(rgb[m].ravel(), bins=bins, range=(0, 256))[0].astype(np.float64)
    s = h.sum()
    return h / s if s > 0 else h


def forehead_mean(rgb: np.ndarray) -> np.ndarray | None:
    m = fg_mask(rgb)
    ys, xs = np.where(m)
    if len(ys) < 20:
        return None
    y0, y1 = ys.min(), ys.max()
    y_cut = y0 + int((y1 - y0) * 0.35)
    band = rgb[y0:y_cut, :]
    bm = fg_mask(band)
    if bm.sum() < 20:
        return None
    return band[bm].mean(0)


def rgb_to_hue(rgb: np.ndarray) -> float:
    r, g, b = rgb / 255.0
    mx, mn = max(r, g, b), min(r, g, b)
    if mx - mn < 1e-6:
        return 0.0
    d = mx - mn
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return float(h / 6.0)


def hue_dist(a: float, b: float) -> float:
    d = abs(a - b) % 1.0
    return min(d, 1.0 - d)


def load_pair(view: str) -> tuple[np.ndarray, np.ndarray] | None:
    base_p = REVIEW / "base15" / f"{view}.png"
    ours_p = REVIEW / "ours" / CAND / f"muscle_{view}.png"
    if not base_p.exists() or not ours_p.exists():
        return None
    base_im = Image.open(base_p).convert("RGB")
    ours_im = Image.open(ours_p).convert("RGB")

    def fit(im: Image.Image) -> np.ndarray:
        w, h = im.size
        s = COMPARE_SIZE / max(w, h)
        nw, nh = max(1, int(w * s)), max(1, int(h * s))
        return np.array(im.resize((nw, nh), Image.Resampling.BILINEAR))

    return fit(base_im), fit(ours_im)


def check_view(view: str) -> bool:
    pair = load_pair(view)
    if pair is None:
        print(f"[skip] {view} missing base or ours png")
        return True

    base, ours = pair
    sb, so = fg_stats(base), fg_stats(ours)
    if sb is None or so is None:
        print(f"[FAIL] {view} empty foreground")
        return False

    ok = True
    tag = view.upper()

    bg_ok = float(so["bg"].min()) >= BG_MIN
    print(f"[{'OK' if bg_ok else 'FAIL'}] {tag} bg={so['bg'].round(0)}")
    ok &= bg_ok

    std_ratio = so["std"] / np.maximum(sb["std"], 1e-6)
    std_ok = float(std_ratio.min()) >= STD_RATIO_MIN
    print(
        f"[{'OK' if std_ok else 'FAIL'}] {tag} fg_std={so['std'].round(1)} "
        f"base_std={sb['std'].round(1)} ratio_min={std_ratio.min():.2f} (need>={STD_RATIO_MIN})"
    )
    if not std_ok:
        print("       -> flat shading / no Base-like soft light (用户看到的「糊成一片、没层次」)")
    ok &= std_ok

    mean_d = float(np.linalg.norm(so["mean"] - sb["mean"]))
    mean_ok = mean_d <= MEAN_DELTA_MAX
    print(
        f"[{'OK' if mean_ok else 'FAIL'}] {tag} mean={so['mean'].round(1)} "
        f"base_mean={sb['mean'].round(1)} delta={mean_d:.1f} (max {MEAN_DELTA_MAX})"
    )
    if not mean_ok:
        print("       -> overall color brightness drift vs Base")
    ok &= mean_ok

    p95_ref = float(sb["p95"].max())
    p95_test = float(so["p95"].max())
    p95_ratio = p95_test / max(p95_ref, 1e-6)
    p95_ok = P95_RATIO_MIN <= p95_ratio <= P95_RATIO_MAX
    print(
        f"[{'OK' if p95_ok else 'FAIL'}] {tag} p95={so['p95'].round(1)} "
        f"base_p95={sb['p95'].round(1)} ratio={p95_ratio:.2f}"
    )
    if not p95_ok:
        print("       -> highlight range unlike Base (过曝或发灰)")
    ok &= p95_ok

    h1, h2 = fg_hist(base), fg_hist(ours)
    hist_l1 = float(np.abs(h1 - h2).sum())
    hist_ok = hist_l1 <= HIST_L1_MAX
    print(f"[{'OK' if hist_ok else 'FAIL'}] {tag} hist_L1={hist_l1:.3f} (max {HIST_L1_MAX})")
    if not hist_ok:
        print("       -> muscle palette / tonal distribution unlike Base（配色整体不对）")
    ok &= hist_ok

    if view == "front":
        fb, fo = forehead_mean(base), forehead_mean(ours)
        if fb is not None and fo is not None:
            hb, ho = rgb_to_hue(fb), rgb_to_hue(fo)
            hd = hue_dist(hb, ho)
            hue_ok = hd <= FOREHEAD_HUE_DELTA_MAX
            print(
                f"[{'OK' if hue_ok else 'FAIL'}] {tag} forehead_hue delta={hd:.3f} "
                f"(ours={fo.round(1)} base={fb.round(1)})"
            )
            if not hue_ok:
                print("       -> regional hue mismatch (如额部绿/紫对调)")
            ok &= hue_ok

    return ok


def main() -> int:
    fails = [v for v in PRIMARY if not check_view(v)]
    if fails:
        print("[visual] FAIL primary:", ", ".join(fails))
        return 1
    print("[visual] PASS primary (color/shading/hist vs Base15)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
