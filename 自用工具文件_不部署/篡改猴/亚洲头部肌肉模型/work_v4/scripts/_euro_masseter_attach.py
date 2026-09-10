# -*- coding: utf-8 -*-
"""Restore pre_arch; hang masseter under zygomatic inferior rim like Euro.

Key Euro signal (same vert topology):
  hang_p50 ≈ -1.7mm below inferior rim
  out_p50  ≈ -10mm medial of outer rim  → bone occludes muscle top in side view

Does NOT snap to a 2D red line.
"""
from __future__ import annotations

import json
import math
import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Vector, kdtree

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402

SRC = C.CHECKPOINTS / "SHELL_v8_pre_arch.blend"
DST = C.CHECKPOINTS / "SHELL_v8.blend"
BLEND = 0.80
MAX_MOVE = 0.011
DY = 0.004


def world_pts(obj):
    mw = obj.matrix_world
    return [mw @ v.co.copy() for v in obj.data.vertices]


def bbox_n(p, center, half):
    return (
        (p.x - center.x) / max(half.x, 1e-8),
        (p.y - center.y) / max(half.y, 1e-8),
        (p.z - center.z) / max(half.z, 1e-8),
    )


def kdt(pts):
    tree = kdtree.KDTree(len(pts))
    for i, p in enumerate(pts):
        tree.insert(p, i)
    tree.balance()
    return tree


def beam_slab(static, center, half, dy=DY):
    groups = {}
    for p in world_pts(static):
        lx, ly, lz = bbox_n(p, center, half)
        if abs(lx) < 0.32:
            continue
        if ly > 0.32 or ly < -0.52:
            continue
        if lz < -0.18 or lz > 0.24:
            continue
        side = 1 if p.x >= center.x else -1
        key = (int(round(p.y / dy)), side)
        groups.setdefault(key, []).append(p)
    slab = {}
    for key, pts in groups.items():
        if len(pts) < 4:
            continue
        xs = sorted(abs(p.x - center.x) for p in pts)
        cut = xs[int(0.65 * (len(xs) - 1))]
        lat = [p for p in pts if abs(p.x - center.x) >= cut]
        if len(lat) < 3:
            continue
        zs = sorted(p.z for p in lat)
        inf = zs[int(0.08 * (len(zs) - 1))]
        mid = zs[len(zs) // 2]
        sup = zs[int(0.90 * (len(zs) - 1))]
        xlat = sorted(lat, key=lambda q: abs(q.x), reverse=True)[0].x
        slab[key] = (inf, mid, sup, xlat)
    return slab, dy


def lookup_slab(slab, dy, y, side):
    key0 = int(round(y / dy))
    acc = []
    for k in range(key0 - 5, key0 + 6):
        row = slab.get((k, side))
        if row is not None:
            acc.append(row)
    if not acc:
        return None
    return (
        sum(a[0] for a in acc) / len(acc),
        sum(a[1] for a in acc) / len(acc),
        sum(a[2] for a in acc) / len(acc),
        sum(a[3] for a in acc) / len(acc),
    )


def euro_origin_mask(edef, est, e_c, e_half):
    slab, dy = beam_slab(est, e_c, e_half)
    stree = kdt(world_pts(est))
    dpts = world_pts(edef)
    mask = [False] * len(dpts)
    hangs, outs = [], []
    for i, p in enumerate(dpts):
        side = 1 if p.x >= e_c.x else -1
        row = lookup_slab(slab, dy, p.y, side)
        if row is None:
            continue
        inf, mid, sup, xlat = row
        if p.z > mid + 0.004 and abs(p.x) < abs(xlat) - 0.008:
            continue
        if p.z > inf + 0.006:
            continue
        if p.z < inf - 0.014:
            continue
        if abs(p.x) < abs(xlat) - 0.016:
            continue
        _co, _idx, dist = stree.find(p)
        if dist > 0.012:
            continue
        mask[i] = True
        hangs.append(p.z - inf)
        outs.append(abs(p.x) - abs(xlat))
    hangs.sort()
    outs.sort()
    return mask, hangs, outs, slab, dy


def q(xs, p):
    if not xs:
        return None
    return round(xs[int((len(xs) - 1) * p)], 5)


def strip_stats(static, deform, tag):
    """Lateral arch strip: how much muscle is still on/above the inferior rim."""
    c, s = C.bbox_center_size([static])
    slab, dy = beam_slab(static, c, s * 0.5)
    above = 0
    under = 0
    lateral_out = 0
    n = 0
    outs = []
    for p in world_pts(deform):
        row = lookup_slab(slab, dy, p.y, 1 if p.x >= c.x else -1)
        if row is None:
            continue
        inf, mid, _sup, xlat = row
        if abs(p.x) < abs(xlat) - 0.014:
            continue
        if p.z < inf - 0.012 or p.z > mid + 0.006:
            continue
        n += 1
        out = abs(p.x) - abs(xlat)
        outs.append(out)
        if out > -0.002:
            lateral_out += 1
        if p.z > inf + 0.001:
            above += 1
        else:
            under += 1
    outs.sort()
    return {
        "tag": tag,
        "n": n,
        "above_rim_pct": None if n == 0 else round(100.0 * above / n, 2),
        "under_rim_pct": None if n == 0 else round(100.0 * under / n, 2),
        "lateral_out_pct": None if n == 0 else round(100.0 * lateral_out / n, 2),
        "out_p50": q(outs, 0.5),
    }


def apply_tuck(shell_def, shell_st, euro_def, euro_st, mask):
    sd = world_pts(shell_def)
    ed = world_pts(euro_def)
    e_c, e_s = C.bbox_center_size([euro_st])
    s_c, s_s = C.bbox_center_size([shell_st])
    e_slab, dy = beam_slab(euro_st, e_c, e_s * 0.5)
    s_slab, _ = beam_slab(shell_st, s_c, s_s * 0.5)
    sx = s_s.x / max(e_s.x, 1e-8)
    sz = s_s.z / max(e_s.z, 1e-8)

    mw = shell_def.matrix_world
    imw = mw.inverted()
    moved = 0
    dists = []

    def commit(i, cur, target, w):
        nonlocal moved
        nxt = cur.lerp(target, w)
        delta = nxt - cur
        if delta.length > MAX_MOVE:
            nxt = cur + delta.normalized() * MAX_MOVE
            delta = nxt - cur
        if delta.length < 1e-6:
            return
        dists.append(delta.length)
        shell_def.data.vertices[i].co = imw @ nxt
        moved += 1

    for i, flag in enumerate(mask):
        if not flag:
            continue
        er = lookup_slab(e_slab, dy, ed[i].y, 1 if ed[i].x >= e_c.x else -1)
        sr = lookup_slab(s_slab, dy, sd[i].y, 1 if sd[i].x >= s_c.x else -1)
        if er is None or sr is None:
            continue
        e_inf, e_mid, e_sup, e_x = er
        s_inf, s_mid, s_sup, s_x = sr
        if sd[i].z > s_sup + 0.002 and abs(sd[i].x) < abs(s_x) - 0.004:
            continue
        hang = max(-0.008, min(0.002, (ed[i].z - e_inf) * sz))
        out = max(-0.014, min(-0.006, (abs(ed[i].x) - abs(e_x)) * sx))
        target = Vector(
            (math.copysign(abs(s_x) + out, sd[i].x), sd[i].y, s_inf + hang)
        )
        commit(i, sd[i], target, BLEND)

    # Covering pass: outer-face riders only (keep Z near rim, pull medial).
    sd = world_pts(shell_def)
    for i, cur in enumerate(sd):
        sr = lookup_slab(s_slab, dy, cur.y, 1 if cur.x >= s_c.x else -1)
        if sr is None:
            continue
        s_inf, s_mid, s_sup, s_x = sr
        if cur.z > s_mid + 0.002:
            continue
        if cur.z < s_inf - 0.004:
            continue
        if abs(cur.x) < abs(s_x) - 0.003:
            continue
        if cur.z > s_mid and abs(cur.x) < abs(s_x) - 0.002:
            continue
        target = Vector(
            (
                math.copysign(abs(s_x) - 0.009, cur.x),
                cur.y,
                min(cur.z, s_inf - 0.0015),
            )
        )
        h = max(s_mid - s_inf, 1e-4)
        w = max(0.4, min(1.0, (cur.z - s_inf) / h)) * 0.75
        commit(i, cur, target, w)

    shell_def.data.update()
    dists.sort()
    med = dists[len(dists) // 2] if dists else 0.0
    p95 = dists[int(0.95 * (len(dists) - 1))] if dists else 0.0
    return moved, med, p95


def hide_euro():
    for o in C.objects_in_group("euro"):
        o.hide_set(True)
        o.hide_render = True
        o.hide_viewport = True


def main():
    if not SRC.exists():
        raise FileNotFoundError(SRC)
    shutil.copy2(SRC, DST)
    bpy.ops.wm.open_mainfile(filepath=str(DST))
    C.hide_aux_skull()
    C.set_group_visibility("skull", False)
    C.import_glb(C.MUSCLE_GLB, "euro")
    C.apply_object_transforms(C.mesh_objects(C.objects_in_group("euro")))

    euro_st = C.get_obj("euro", "Static")
    euro_def = C.get_obj("euro", "Deform")
    shell_st = C.get_obj("muscle", "Static")
    shell_def = C.get_obj("muscle", "Deform")

    before = strip_stats(shell_st, shell_def, "shell_before")
    euro_ref = strip_stats(euro_st, euro_def, "euro_ref")
    e_c, e_s = C.bbox_center_size([euro_st])
    mask, hangs, outs, _slab, _dy = euro_origin_mask(
        euro_def, euro_st, e_c, e_s * 0.5
    )
    nmask = sum(1 for x in mask if x)
    print(json.dumps({
        "before": before,
        "euro_ref": euro_ref,
        "origin_verts": nmask,
        "euro_hang_p50": q(hangs, 0.5),
        "euro_out_p50": q(outs, 0.5),
    }))
    if nmask < 40:
        raise RuntimeError(f"origin mask too small ({nmask})")

    moved, med, p95 = apply_tuck(shell_def, shell_st, euro_def, euro_st, mask)
    after = strip_stats(shell_st, shell_def, "shell_after")
    hide_euro()

    report = {
        "moved": moved,
        "move_median_m": round(med, 5),
        "move_p95_m": round(p95, 5),
        "before": before,
        "after": after,
        "euro_ref": euro_ref,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if p95 > 0.014:
        raise RuntimeError(f"move_p95 too large {p95:.4f}")

    # Self-check: under-rim share and medial out should approach Euro.
    eu_under = euro_ref.get("under_rim_pct") or 0
    af_under = after.get("under_rim_pct") or 0
    eu_out = euro_ref.get("out_p50")
    af_out = after.get("out_p50")
    if af_under + 8 < eu_under:
        raise RuntimeError(
            f"self-check FAIL under_rim {af_under}% vs euro {eu_under}%"
        )
    if eu_out is not None and af_out is not None and af_out > eu_out + 0.006:
        raise RuntimeError(
            f"self-check FAIL still too lateral out_p50={af_out} euro={eu_out}"
        )
    C.save_blend(DST)


if __name__ == "__main__":
    main()
