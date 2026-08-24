# -*- coding: utf-8 -*-
"""Render exposure gate: fg brightness must be in Base15 ballpark (not blown out)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

REVIEW = Path(__file__).resolve().parents[1] / "compare_review"
CAND = sys.argv[1] if len(sys.argv) > 1 else "SHELL_v8"
VIEW = sys.argv[2] if len(sys.argv) > 2 else "front"

REF_MEAN = np.array([137.6, 134.4, 133.5])
REF_P95 = np.array([186.0, 184.0, 177.0])
MEAN_TOL = 42.0
P95_MAX = 195.0
CLIP_FRAC_MAX = 0.01
BG_MIN = 250.0


def stats(path: Path) -> dict:
    rgb = np.array(Image.open(path).convert("RGB"))
    bg = rgb[0, 0].astype(np.float32)
    fg_mask = np.linalg.norm(rgb.astype(np.float32) - bg, axis=2) > 20
    fg = rgb[fg_mask]
    if len(fg) == 0:
        return {"ok": False, "reason": "no foreground"}
    mean = fg.mean(0)
    p95 = np.percentile(fg, 95, axis=0)
    clip = (fg >= 250).all(axis=1).mean()
    return {"ok": True, "mean": mean, "p95": p95, "clip": float(clip), "bg": bg}


def check(label: str, path: Path, strict: bool) -> bool:
    if not path.exists():
        print(f"[skip] {label} missing {path}")
        return True
    s = stats(path)
    if not s.get("ok"):
        print(f"[FAIL] {label} {s.get('reason')}")
        return False
    mean_d = float(np.linalg.norm(s["mean"] - REF_MEAN))
    p95_ok = float(s["p95"].max()) <= P95_MAX
    mean_ok = mean_d <= MEAN_TOL
    clip_ok = s["clip"] <= CLIP_FRAC_MAX
    bg_ok = float(s["bg"].min()) >= BG_MIN if strict else True
    ok = p95_ok and mean_ok and clip_ok and bg_ok
    print(
        f"[{'OK' if ok else 'FAIL'}] {label} mean={s['mean'].round(1)} p95={s['p95'].round(1)}"
        f" clip={s['clip']:.1%} bg={s['bg'].round(0)}"
    )
    if not p95_ok:
        print(f"       -> overexposed p95 max {s['p95'].max():.0f} > {P95_MAX}")
    if not mean_ok:
        print(f"       -> mean delta {mean_d:.1f} > {MEAN_TOL}")
    if not clip_ok:
        print(f"       -> highlight clip {s['clip']:.1%}")
    if strict and not bg_ok:
        print(f"       -> background too dark {s['bg'].min():.0f} < {BG_MIN}")
    return ok


def main() -> int:
    base = REVIEW / "base15" / f"{VIEW}.png"
    ours = REVIEW / "ours" / CAND / f"muscle_{VIEW}.png"
    check("BASE ref", base, False)
    ok = check("OURS", ours, True)
    if not ok:
        print("[exposure] FAIL")
        return 1
    print("[exposure] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
