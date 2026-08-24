# -*- coding: utf-8
"""Print row profile deltas test-ref vs Base15 ref. Usage: python measure_profile_delta.py <test_side.png>"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import base15_proportion_eval as E  # noqa: E402

ROOT = Path(r"D:\Git仓库位置\PaintingTools\自用工具文件_不部署\篡改猴\亚洲头部肌肉模型")


def main():
    ref_png = ROOT / "Base15_侧.png"
    test_png = Path(sys.argv[1]) if len(sys.argv) >= 2 else None
    if not test_png or not test_png.exists():
        print(json.dumps({"error": "missing test png"}))
        return 1
    ref = E._normalize_profile(E._load_mask(ref_png))
    test = E._normalize_profile(E._load_mask(test_png))
    pr, pt = ref["profile"], test["profile"]
    n = min(len(pr), len(pt))
    prs = np.interp(np.linspace(0, len(pr) - 1, n), np.arange(len(pr)), pr)
    pts = np.interp(np.linspace(0, len(pt) - 1, n), np.arange(len(pt)), pt)
    pcts = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 85, 90, 95]
    deltas = []
    for pct in pcts:
        i = int(pct / 100 * (n - 1))
        deltas.append([pct / 100.0, float(pts[i] - prs[i])])
    rmse = float(np.sqrt(np.mean((prs - pts) ** 2)))
    print(json.dumps({"deltas": deltas, "profile_rmse": rmse}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
