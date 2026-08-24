# -*- coding: utf-8
"""
Strict Base15 proportion gate — NO nudge/mirror tricks for pass/fail.
Compares side-profile ratios and normalized profile curve RMSE.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(r"D:\Git仓库位置\PaintingTools\自用工具文件_不部署\篡改猴\亚洲头部肌肉模型")
WORK = ROOT / "work_v4"

# tolerances vs Base15 reference (strict)
TOL = {
    "hw_ratio": 0.06,       # |test-ref|/ref
    "depth_ratio": 0.08,    # occiput/face depth split
    "vault_ratio": 0.08,    # cranial top segment / total H
    "profile_rmse": 0.055,  # normalized outer profile
    "area_ratio": 0.10,
}


def _load_mask(path: Path) -> np.ndarray:
    from PIL import Image

    rgb = np.array(Image.open(path).convert("RGB"))
    h, w = rgb.shape[:2]
    corners = np.array([rgb[0, 0], rgb[0, w - 1], rgb[h - 1, 0], rgb[h - 1, w - 1]], dtype=np.float32)
    bg = np.median(corners, axis=0)
    # 15: 3D EEVEE 渲染有抗锯齿，阈值 18 会系统性低估面积
    return np.linalg.norm(rgb.astype(np.float32) - bg, axis=2) > 15.0


def _crop(mask: np.ndarray) -> np.ndarray:
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any():
        return mask
    r0, r1 = np.where(rows)[0][[0, -1]]
    c0, c1 = np.where(cols)[0][[0, -1]]
    return mask[r0 : r1 + 1, c0 : c1 + 1]


def _head_mask(mask: np.ndarray, drop_neck: float = 0.16) -> np.ndarray:
    m = _crop(mask)
    rows = np.any(m, axis=1)
    r0, r1 = np.where(rows)[0][[0, -1]]
    cut = r0 + int((r1 - r0 + 1) * (1.0 - drop_neck))
    out = m.copy()
    out[cut + 1 :] = False
    return _crop(out)


def _normalize_profile(mask: np.ndarray) -> dict:
    """Side view facing left: outer edge = min-x per row."""
    m = _head_mask(mask)
    h, w = m.shape
    if h < 8 or w < 8:
        return {}
    rows = np.any(m, axis=1)
    r0, r1 = np.where(rows)[0][[0, -1]]
    hh = r1 - r0 + 1
    prof = []
    widths = []
    for y in range(r0, r1 + 1):
        cols = np.where(m[y])[0]
        if len(cols) < 2:
            continue
        left = float(cols.min())
        right = float(cols.max())
        prof.append(left)
        widths.append(right - left)
    if len(prof) < 10:
        return {}
    prof = np.array(prof, dtype=np.float32)
    widths = np.array(widths, dtype=np.float32)
    # normalize: height=1, front (min left) aligned 0, scale by max depth
    depth = float(widths.max())
    prof_n = (prof - prof.min()) / max(depth, 1.0)
    # metrics
    hw = hh / max(depth, 1.0)
    # cranial vault: top 38% rows — how far back vs total depth
    top_n = max(3, int(len(widths) * 0.38))
    vault_depth = float(widths[:top_n].max()) / max(depth, 1.0)
    # occiput bulge: bottom-back vs mid
    mid = len(widths) // 2
    occiput = float(widths[mid:].max()) / max(float(widths[:mid].max()), 1e-6)
    area = float(m.sum()) / max(h * w, 1)
    return {
        "hw_ratio": hw,
        "vault_ratio": vault_depth,
        "occiput_ratio": occiput,
        "area_norm": area,
        "profile": prof_n,
        "depth_px": depth,
        "height_px": float(hh),
    }


def _compare(ref: dict, test: dict) -> dict:
    notes = []
    ok = True

    def chk(name, rv, tv, tol):
        nonlocal ok
        err = abs(tv - rv) / max(abs(rv), 1e-6)
        passed = err <= tol
        if not passed:
            ok = False
            notes.append(f"{name}: ref={rv:.3f} test={tv:.3f} err={err:.1%} (max {tol:.0%})")
        else:
            notes.append(f"{name}: OK ref={rv:.3f} test={tv:.3f}")
        return passed, err

    metrics = {}
    for key, tol in [
        ("hw_ratio", TOL["hw_ratio"]),
        ("vault_ratio", TOL["vault_ratio"]),
        ("occiput_ratio", TOL["depth_ratio"]),
    ]:
        if key not in ref or key not in test:
            continue
        p, e = chk(key, ref[key], test[key], tol)
        metrics[key] = {"ref": float(ref[key]), "test": float(test[key]), "err": float(e), "pass": bool(p)}

    # area
    if "area_norm" in ref and "area_norm" in test:
        ar = test["area_norm"] / max(ref["area_norm"], 1e-6)
        ae = abs(ar - 1.0)
        if ae > TOL["area_ratio"]:
            ok = False
            notes.append(f"area_ratio: ref=1.0 test={ar:.3f} err={ae:.1%}")
        else:
            notes.append(f"area_ratio: OK ({ar:.3f})")
        metrics["area_ratio"] = {"ref": 1.0, "test": float(ar), "err": float(ae), "pass": bool(ae <= TOL["area_ratio"])}

    # profile curve RMSE (resample to same length)
    pr, pt = ref.get("profile"), test.get("profile")
    prof_rmse = 1.0
    if pr is not None and pt is not None and len(pr) >= 8 and len(pt) >= 8:
        n = min(len(pr), len(pt))
        # resample
        xi = np.linspace(0, len(pr) - 1, n)
        xj = np.linspace(0, len(pt) - 1, n)
        prs = np.interp(xi, np.arange(len(pr)), pr)
        pts = np.interp(xj, np.arange(len(pt)), pt)
        prof_rmse = float(np.sqrt(np.mean((prs - pts) ** 2)))
        if prof_rmse > TOL["profile_rmse"]:
            ok = False
            notes.append(f"profile_rmse={prof_rmse:.4f} high (max {TOL['profile_rmse']})")
        else:
            notes.append(f"profile_rmse={prof_rmse:.4f} OK")
    metrics["profile_rmse"] = prof_rmse

    return {"pass": bool(ok), "notes": notes, "metrics": metrics}


def eval_side(ref_png: Path, test_png: Path) -> dict:
    ref = _normalize_profile(_load_mask(ref_png))
    test = _normalize_profile(_load_mask(test_png))
    if not ref or not test:
        return {"pass": False, "notes": ["mask extract failed"]}
    out = _compare(ref, test)
    out["ref_png"] = str(ref_png)
    out["test_png"] = str(test_png)
    return out


def main():
    ref = ROOT / "Base15_侧.png"
    if len(sys.argv) >= 2:
        test = Path(sys.argv[1])
    else:
        test = WORK / "stages" / "Q10_occiput" / "after" / "muscle_side.png"
    report = eval_side(ref, test)
    out = test.parent / "base15_proportion_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print("PASS" if report.get("pass") else "FAIL")
    return 0 if report.get("pass") else 1


if __name__ == "__main__":
    raise SystemExit(main())
