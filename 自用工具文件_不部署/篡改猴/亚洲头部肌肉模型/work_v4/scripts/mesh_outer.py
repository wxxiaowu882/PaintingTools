# -*- coding: utf-8
"""Outer-shell weighted mesh nudge helpers."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import common as C  # noqa: E402
import q75_mesh as Q75  # noqa: E402


def smooth_step(t: float) -> float:
    return Q75.smooth_step(t)


def _ref_bbox(muscles):
    ref = C.get_obj("muscle", "Static") or muscles[0]
    center, size = C.bbox_center_size([ref])
    rx = max(size.x * 0.5, 1e-6)
    ry = max(size.y * 0.5, 1e-6)
    rz = max(size.z * 0.5, 1e-6)
    return ref, center, rx, ry, rz


def mesh_weight(name: str, static_w=1.0, deform_w=0.0) -> float:
    low = name.lower()
    if "static" in low:
        return static_w
    if "deform" in low:
        return deform_w
    return 0.0


def nudge_outer(
    muscles,
    occ_y: float,
    occ_x: float,
    fore_y: float,
    tail_y: float,
    static_w=1.0,
    deform_w=0.0,
    occ_h0=0.58,
    occ_h1=0.88,
    shell_x=0.22,
):
    """Nudge outer-shell verts; default occ band targets 70-80% profile rows."""
    _, center, rx, ry, rz = _ref_bbox(muscles)
    for obj in muscles:
        mw = mesh_weight(obj.name, static_w, deform_w)
        if mw <= 0:
            continue
        me = obj.data
        inv = obj.matrix_world.inverted()
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            lx = max(-1.0, min(1.0, (w.x - center.x) / rx))
            ly = max(-1.0, min(1.0, (w.y - center.y) / ry))
            lz = max(-1.0, min(1.0, (w.z - center.z) / rz))
            h = (lz + 1.0) * 0.5
            outer = smooth_step((abs(lx) - shell_x) / 0.38)

            occ = (
                outer
                * smooth_step((ly - 0.08) / 0.38)
                * smooth_step((h - occ_h0) / 0.06)
                * smooth_step((occ_h1 - h) / 0.10)
            )
            fore = (
                outer
                * smooth_step((-ly - 0.06) / 0.36)
                * smooth_step((h - 0.04) / 0.08)
                * smooth_step((0.34 - h) / 0.12)
            )
            tail = (
                outer
                * smooth_step((ly - 0.04) / 0.42)
                * smooth_step((0.88 - h) / 0.05)
                * smooth_step((0.98 - h) / 0.04)
            )
            if occ < 0.01 and fore < 0.01 and tail < 0.01:
                continue
            w2 = w.copy()
            if occ > 0.01:
                w2.y = center.y + (w.y - center.y) * (1.0 - occ_y * occ * mw)
                w2.x = center.x + (w.x - center.x) * (1.0 - occ_x * occ * mw)
            if fore > 0.01 and ly < 0:
                w2.y = center.y + (w.y - center.y) * (1.0 + fore_y * fore * mw)
            if tail > 0.01:
                w2.y = center.y + (w.y - center.y) * (1.0 + tail_y * tail * mw)
            v.co = inv @ w2
        me.update()


def nudge_adaptive(muscles, row_delta, strength: float, static_w=1.0, deform_w=0.0, shell_x=0.20):
    """Apply row-delta table to outer shell (positive delta = too deep/back)."""
    _, center, rx, ry, rz = _ref_bbox(muscles)
    xs = [r[0] for r in row_delta]
    ys = [r[1] for r in row_delta]

    def sample(h: float) -> float:
        h = max(0.0, min(1.0, h))
        if h <= xs[0]:
            return ys[0]
        if h >= xs[-1]:
            return ys[-1]
        for i in range(len(xs) - 1):
            if xs[i] <= h <= xs[i + 1]:
                t = (h - xs[i]) / max(xs[i + 1] - xs[i], 1e-6)
                return ys[i] * (1 - t) + ys[i + 1] * t
        return 0.0

    for obj in muscles:
        mw = mesh_weight(obj.name, static_w, deform_w)
        if mw <= 0:
            continue
        me = obj.data
        inv = obj.matrix_world.inverted()
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            lx = max(-1.0, min(1.0, (w.x - center.x) / rx))
            ly = max(-1.0, min(1.0, (w.y - center.y) / ry))
            lz = max(-1.0, min(1.0, (w.z - center.z) / rz))
            h = (lz + 1.0) * 0.5
            d = sample(h)
            if abs(d) < 0.008:
                continue
            outer = smooth_step((abs(lx) - shell_x) / 0.40)
            cranial = smooth_step((lz + 0.04) / 0.92) * (1.0 - 0.42 * smooth_step((-lz - 0.22) / 0.50))
            wgt = strength * outer * cranial * mw
            if wgt < 0.005:
                continue
            front = smooth_step((-ly - 0.02) / 0.42) if ly < 0 else 0.0
            back = smooth_step((ly - 0.02) / 0.42) if ly > 0 else 0.0
            w2 = w.copy()
            if d > 0:
                y_mul = 1.0 - wgt * d * (0.65 * front + 0.90 * back)
                w2.y = center.y + (w.y - center.y) * max(0.55, y_mul)
            else:
                y_mul = 1.0 + wgt * abs(d) * (0.55 * front + 0.75 * back)
                w2.y = center.y + (w.y - center.y) * y_mul
            v.co = inv @ w2
        me.update()


def measure_row_delta(ref_png, test_png, pcts=None):
    """Return [(pct, test-ref)] profile deltas via system Python."""
    import subprocess

    py = __import__("shutil").which("python") or sys.executable
    proc = subprocess.run(
        [py, str(Path(__file__).resolve().parent / "measure_profile_delta.py"), str(test_png)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    data = json.loads(proc.stdout[proc.stdout.find("{") : proc.stdout.rfind("}") + 1])
    return [(float(a), float(b)) for a, b in data["deltas"]]
