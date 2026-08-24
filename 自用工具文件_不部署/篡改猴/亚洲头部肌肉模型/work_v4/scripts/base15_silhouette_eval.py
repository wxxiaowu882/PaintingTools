# -*- coding: utf-8 -*-
"""Compare muscle render silhouettes against Base15 reference PNGs."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ROOT = Path(r"D:\Git仓库位置\PaintingTools\自用工具文件_不部署\篡改猴\亚洲头部肌肉模型")
WORK = ROOT / "work_v4"

VIEW_MAP = {
    "side": ("侧", "muscle_side.png"),
    "front": ("正", "muscle_front.png"),
    "front_three_quarter": ("前侧", "muscle_front_three_quarter.png"),
    "back": ("背面", "muscle_back.png"),
}


def _load_mask(path: Path) -> np.ndarray:
    from PIL import Image

    rgb = np.array(Image.open(path).convert("RGB"))
    h, w = rgb.shape[:2]
    corners = np.array(
        [rgb[0, 0], rgb[0, w - 1], rgb[h - 1, 0], rgb[h - 1, w - 1]], dtype=np.float32
    )
    bg = np.median(corners, axis=0)
    dist = np.linalg.norm(rgb.astype(np.float32) - bg, axis=2)
    # adaptive threshold: model pixels differ from corner bg
    return dist > 18.0


def _crop_mask(mask: np.ndarray) -> np.ndarray:
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any() or not cols.any():
        return mask
    r0, r1 = np.where(rows)[0][[0, -1]]
    c0, c1 = np.where(cols)[0][[0, -1]]
    return mask[r0 : r1 + 1, c0 : c1 + 1]


def _resize_mask(mask: np.ndarray, h: int = 512) -> np.ndarray:
    from PIL import Image

    pil = Image.fromarray(mask.astype(np.uint8) * 255)
    w = max(1, int(pil.width * h / max(pil.height, 1)))
    pil = pil.resize((w, h), Image.Resampling.NEAREST)
    return np.array(pil) > 127


def _shift_mask(mask: np.ndarray, dx: int, dy: int) -> np.ndarray:
    h, w = mask.shape
    out = np.zeros_like(mask)
    sx0 = max(0, dx)
    sy0 = max(0, dy)
    sx1 = min(w, w + dx)
    sy1 = min(h, h + dy)
    dx0 = max(0, -dx)
    dy0 = max(0, -dy)
    dx1 = dx0 + (sx1 - sx0)
    dy1 = dy0 + (sy1 - sy0)
    if sx1 > sx0 and sy1 > sy0:
        out[dy0:dy1, dx0:dx1] = mask[sy0:sy1, sx0:sx1]
    return out


def _nudge_align(ref: np.ndarray, test: np.ndarray) -> tuple[np.ndarray, int, int]:
    """Small translation search to account for camera/framing drift."""
    best = (0.0, 0, 0)
    for dy in range(-18, 19, 3):
        for dx in range(-18, 19, 3):
            t = _shift_mask(test, dx, dy) if (dx or dy) else test
            h = min(ref.shape[0], t.shape[0])
            w = min(ref.shape[1], t.shape[1])
            inter = np.logical_and(ref[:h, :w], t[:h, :w]).sum()
            union = np.logical_or(ref[:h, :w], t[:h, :w]).sum()
            iou = float(inter / max(union, 1))
            if iou > best[0]:
                best = (iou, dx, dy)
    _, dx, dy = best
    if dx or dy:
        test = _shift_mask(test, dx, dy)
    return test, dx, dy


def _align_masks(ref: np.ndarray, test: np.ndarray) -> tuple[np.ndarray, np.ndarray, bool, int, int]:
    """Pad to same canvas; bottom-align; try mirror; nudge translate."""
    best = None
    nudge = (0, 0)
    for mirrored in (False, True):
        t = np.fliplr(test) if mirrored else test
        h = max(ref.shape[0], t.shape[0])
        w = max(ref.shape[1], t.shape[1])
        out_r = np.zeros((h, w), dtype=bool)
        out_t = np.zeros((h, w), dtype=bool)
        r0 = h - ref.shape[0]
        c0 = (w - ref.shape[1]) // 2
        out_r[r0 : r0 + ref.shape[0], c0 : c0 + ref.shape[1]] = ref
        t0 = h - t.shape[0]
        tc = (w - t.shape[1]) // 2
        out_t[t0 : t0 + t.shape[0], tc : tc + t.shape[1]] = t
        out_t, dx, dy = _nudge_align(out_r, out_t)
        nudge = (dx, dy)
        inter = np.logical_and(out_r, out_t).sum()
        union = np.logical_or(out_r, out_t).sum()
        iou = float(inter / max(union, 1))
        if best is None or iou > best[0]:
            best = (iou, out_r, out_t, mirrored, dx, dy)
    _, out_r, out_t, mirrored, dx, dy = best
    return out_r, out_t, mirrored, dx, dy


def profile_rmse(ref: np.ndarray, test: np.ndarray) -> dict:
    """Per-row left/right edge RMSE (normalized by width). Lower is better."""
    h = min(ref.shape[0], test.shape[0])
    errs = []
    for y in range(h):
        r_cols = np.where(ref[y])[0]
        t_cols = np.where(test[y])[0]
        if len(r_cols) < 2 or len(t_cols) < 2:
            continue
        r_lr = np.array([r_cols[0], r_cols[-1]], dtype=np.float32)
        t_lr = np.array([t_cols[0], t_cols[-1]], dtype=np.float32)
        w = max(r_lr[1] - r_lr[0], 1.0)
        errs.append(np.mean((r_lr - t_lr) ** 2) / (w * w))
    rmse = float(np.sqrt(np.mean(errs))) if errs else 1.0
    return {"profile_rmse": rmse, "rows_used": len(errs)}


def _crop_head_only(mask: np.ndarray, drop_bottom_frac: float = 0.14) -> np.ndarray:
    """Remove lower neck/shoulder for fairer head silhouette compare."""
    rows = np.any(mask, axis=1)
    if not rows.any():
        return mask
    r0, r1 = np.where(rows)[0][[0, -1]]
    h = r1 - r0 + 1
    cut = r0 + int(h * (1.0 - drop_bottom_frac))
    out = mask.copy()
    out[cut + 1 :] = False
    return _crop_mask(out)


def _outer_profile_rmse(ref: np.ndarray, test: np.ndarray, facing: str = "left") -> float:
    """RMSE of outer silhouette edge per row (normalized). facing=left -> min x."""
    h = min(ref.shape[0], test.shape[0])
    errs = []
    for y in range(h):
        r_cols = np.where(ref[y])[0]
        t_cols = np.where(test[y])[0]
        if len(r_cols) < 1 or len(t_cols) < 1:
            continue
        if facing == "left":
            re, te = float(r_cols.min()), float(t_cols.min())
        else:
            re, te = float(r_cols.max()), float(t_cols.max())
        w = max(ref.shape[1], test.shape[1], 1)
        errs.append(((re - te) / w) ** 2)
    return float(np.sqrt(np.mean(errs))) if errs else 1.0


def compare_pair(ref_path: Path, test_path: Path, head_only: bool = True) -> dict:
    ref = _resize_mask(_crop_mask(_load_mask(ref_path)))
    test = _resize_mask(_crop_mask(_load_mask(test_path)))
    if head_only:
        ref = _crop_head_only(ref)
        test = _crop_head_only(test)
    ref, test, mirrored, dx, dy = _align_masks(ref, test)
    inter = np.logical_and(ref, test).sum()
    union = np.logical_or(ref, test).sum()
    iou = float(inter / max(union, 1))
    prof_lr = profile_rmse(ref, test)
    outer = _outer_profile_rmse(ref, test, "left")
    ok_iou = iou >= 0.55
    ok_outer = outer <= 0.04
    notes = []
    if mirrored:
        notes.append("test mirrored to match ref facing")
    if dx or dy:
        notes.append(f"nudge dx={dx} dy={dy}")
    if not ok_iou:
        notes.append(f"IoU={iou:.3f} low (need >=0.55)")
    else:
        notes.append(f"IoU={iou:.3f} OK")
    if not ok_outer:
        notes.append(f"outer_profile={outer:.4f} high (need <=0.04)")
    else:
        notes.append(f"outer_profile={outer:.4f} OK")
    return {
        "ref": str(ref_path),
        "test": str(test_path),
        "mirrored": mirrored,
        "iou": iou,
        "outer_profile_rmse": outer,
        "ok_iou": ok_iou,
        "ok_outer": ok_outer,
        "pass": ok_iou and ok_outer,
        "notes": notes,
        **prof_lr,
    }


def eval_stage(stage_dir: Path, tag: str = "final") -> dict:
    render_dir = stage_dir / tag
    results = {}
    all_pass = True
    for view, (cn, fname) in VIEW_MAP.items():
        ref = ROOT / f"Base15_{cn}.png"
        test = render_dir / fname
        if not ref.exists() or not test.exists():
            results[view] = {"pass": False, "notes": ["missing file"]}
            if view == "side":
                all_pass = False
            continue
        r = compare_pair(ref, test)
        results[view] = r
        if view == "side" and not r["pass"]:
            all_pass = False
    side = results.get("side", {})
    report = {
        "stage": str(stage_dir),
        "tag": tag,
        "pass": all_pass,
        "side_iou": side.get("iou"),
        "side_profile_rmse": side.get("profile_rmse"),
        "views": results,
    }
    return report


def write_overlay(ref_path: Path, test_path: Path, out_path: Path):
    """Red=ref edge, Green=test edge overlay for visual QA."""
    from PIL import Image

    ref = _resize_mask(_crop_mask(_load_mask(ref_path)))
    test = _resize_mask(_crop_mask(_load_mask(test_path)))
    ref, test, mirrored, dx, dy = _align_masks(ref, test)
    h, w = ref.shape
    canvas = np.ones((h, w, 3), dtype=np.uint8) * 255
    canvas[ref] = [220, 80, 80]
    canvas[test] = [80, 180, 80]
    canvas[np.logical_and(ref, test)] = [120, 120, 220]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(canvas).save(out_path)


def main():
    import sys

    stage = Path(sys.argv[1]) if len(sys.argv) > 1 else WORK / "stages" / "Q7e_depth_fix"
    tag = sys.argv[2] if len(sys.argv) > 2 else "final"
    report = eval_stage(stage, tag)
    out = stage / f"base15_eval_{tag}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    side_ref = ROOT / "Base15_侧.png"
    side_test = stage / tag / "muscle_side.png"
    if side_ref.exists() and side_test.exists():
        write_overlay(side_ref, side_test, stage / tag / "silhouette_overlay_side.png")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print("PASS" if report["pass"] else "FAIL")
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
