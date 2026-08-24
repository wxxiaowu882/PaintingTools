# -*- coding: utf-8 -*-
"""Verify rendered PNG facing matches base15. Primary views (正/侧/背) must pass."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
from PIL import Image

REVIEW = Path(__file__).resolve().parents[1] / "compare_review"
SCRIPTS = Path(__file__).resolve().parent
CAND = sys.argv[1] if len(sys.argv) > 1 else "SHELL_v7"
PRIMARY = ["front", "side", "back"]
AUX = ["front_three_quarter", "rear_three_quarter"]
MAX_CX_DELTA = 0.08
MAX_LR_DELTA = 0.12
AUX_LR_DELTA = 0.18
MAX_SIDE_PROFILE_RMSE = 0.055


def _load_prop_eval():
    spec = importlib.util.spec_from_file_location("base15_proportion_eval", SCRIPTS / "base15_proportion_eval.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def metrics(path: Path) -> tuple[float, float]:
    im = Image.open(path).convert("RGBA").resize((600, 600), Image.Resampling.BILINEAR)
    a = np.array(im)
    rgb = a[..., :3]
    bg = np.array([rgb[0, 0], rgb[-1, -1]], dtype=float).mean(0)
    mask = np.abs(rgb - bg).sum(2) > 20
    xs = np.where(mask.any(0))[0]
    cx = ((xs.min() + xs.max()) * 0.5 / 600) if len(xs) else 0.5
    lr = mask[:, :300].sum() / max(mask.sum(), 1)
    return cx, lr


def side_profile_rmse(base: Path, ours: Path, flip_ours: bool) -> float:
    B = _load_prop_eval()
    ref = B._normalize_profile(B._load_mask(base))
    im = Image.open(ours).convert("RGB")
    if flip_ours:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    tmp = REVIEW / "_tmp_side_check.png"
    im.save(tmp)
    test = B._normalize_profile(B._load_mask(tmp))
    if not ref or not test:
        return 1.0
    pr, pt = ref.get("profile"), test.get("profile")
    if pr is None or pt is None or len(pr) < 8 or len(pt) < 8:
        return 1.0
    n = min(len(pr), len(pt))
    xi = np.linspace(0, len(pr) - 1, n)
    xj = np.linspace(0, len(pt) - 1, n)
    prs = np.interp(xi, np.arange(len(pr)), pr)
    pts = np.interp(xj, np.arange(len(pt)), pt)
    return float(np.sqrt(np.mean((prs - pts) ** 2)))


def check(view: str, strict: bool) -> bool:
    base = REVIEW / "base15" / f"{view}.png"
    ours = REVIEW / "ours" / CAND / f"muscle_{view}.png"
    if not base.exists() or not ours.exists():
        print("[skip]", view)
        return True

    if view == "side" and strict:
        rmse = side_profile_rmse(base, ours, False)
        rmse_flip = side_profile_rmse(base, ours, True)
        mirrored = rmse_flip < rmse * 0.98
        ok = not mirrored
        tag = "PRIMARY"
        print(
            f"[{'OK' if ok else 'FAIL'}] {tag} {view:22} profile_rmse={rmse:.4f}"
            f" flip_rmse={rmse_flip:.4f}"
            + (" MIRRORED" if mirrored else "")
        )
        if ok and rmse > MAX_SIDE_PROFILE_RMSE:
            print(f"       -> WARN profile_rmse high ({rmse:.4f} > {MAX_SIDE_PROFILE_RMSE}); see proportion gate")
        return ok

    bcx, blr = metrics(base)
    ocx, olr = metrics(ours)
    dcx = abs(bcx - ocx)
    dlr = abs(blr - olr)
    lr_lim = MAX_LR_DELTA if strict else AUX_LR_DELTA
    ok = dcx <= MAX_CX_DELTA and dlr <= lr_lim
    tag = "PRIMARY" if strict else "AUX"
    print(f"[{'OK' if ok else 'WARN' if not strict else 'FAIL'}] {tag} {view:22} dcx={dcx:.3f} dlr={dlr:.3f}")
    return ok if strict else True


def main() -> int:
    fails = [v for v in PRIMARY if not check(v, True)]
    for v in AUX:
        check(v, False)
    if fails:
        print("[view-dir] FAIL primary:", ", ".join(fails))
        return 1
    print("[view-dir] PASS primary (正/侧/背); aux (前侧/后侧) reference only")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
