# -*- coding: utf-8 -*-
"""Whiten PNG background to #FFFFFF (post 3D ortho render)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image


def composite_alpha_on_white(im: Image.Image) -> np.ndarray:
    """Keep mesh pixels; only empty (alpha~0) becomes #FFF. Avoids eating Filmic-gray Static."""
    rgba = np.array(im.convert("RGBA"))
    rgb = rgba[..., :3].astype(np.float32)
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    out = rgb * a + 255.0 * (1.0 - a)
    return np.clip(out, 0, 255).astype(np.uint8)


def whiten(path: Path, tol: float = 32.0, flip_h: bool = False, outer_only: bool = True) -> None:
    im = Image.open(path)
    if flip_h:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        arr = composite_alpha_on_white(im)
        Image.fromarray(arr).save(path)
        return
    arr = np.array(im.convert("RGB"))
    corners = np.array([arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]], dtype=np.float32)
    bg = np.median(corners, axis=0)
    dist = np.linalg.norm(arr.astype(np.float32) - bg, axis=2)
    candidate = dist < tol
    outer = np.zeros(arr.shape[:2], dtype=bool)
    if outer_only:
        h, w = candidate.shape
        from collections import deque

        q = deque()
        for x in range(w):
            for y in (0, h - 1):
                if candidate[y, x]:
                    outer[y, x] = True
                    q.append((y, x))
        for y in range(h):
            for x in (0, w - 1):
                if candidate[y, x] and not outer[y, x]:
                    outer[y, x] = True
                    q.append((y, x))
        while q:
            y, x = q.popleft()
            for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and candidate[ny, nx] and not outer[ny, nx]:
                    outer[ny, nx] = True
                    q.append((ny, nx))
        arr[outer] = (255, 255, 255)
    else:
        arr[candidate] = (255, 255, 255)
    Image.fromarray(arr).save(path)


def main() -> int:
    args = sys.argv[1:]
    flip_h = False
    paths: list[Path] = []
    for a in args:
        if a == "--flip":
            flip_h = True
        else:
            paths.append(Path(a))
    for p in paths:
        whiten(p, flip_h=flip_h)
        tag = "[whiten+flip]" if flip_h else "[whiten]"
        print(tag, p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
