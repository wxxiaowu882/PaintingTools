# -*- coding: utf-8 -*-
"""Incremental: seal masseter top to Static inferior rim (no gap), tuck medial.

Run on current SHELL_v8.blend (after prior attach). Does not restore pre_arch.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
from _euro_masseter_attach import (  # noqa: E402
    beam_slab,
    lookup_slab,
    strip_stats,
    world_pts,
)

DST = C.CHECKPOINTS / "SHELL_v8.blend"
MAX_MOVE = 0.008
BLEND = 0.85
TARGET_OUT = -0.011  # closer to Euro out_p50 ≈ -0.009~-0.010, a bit more medial
TARGET_HANG = -0.0015  # Euro hang_p50 ≈ -0.0017


def seal_to_rim(shell_def, shell_st):
    sd = world_pts(shell_def)
    s_c, s_s = C.bbox_center_size([shell_st])
    slab, dy = beam_slab(shell_st, s_c, s_s * 0.5)
    mw = shell_def.matrix_world
    imw = mw.inverted()
    moved = 0
    dists = []
    for i, cur in enumerate(sd):
        row = lookup_slab(slab, dy, cur.y, 1 if cur.x >= s_c.x else -1)
        if row is None:
            continue
        inf, mid, sup, xlat = row
        # Origin band: lateral + near inferior half of beam.
        if abs(cur.x) < abs(xlat) - 0.016:
            continue
        if cur.z > mid + 0.003:
            continue
        if cur.z < inf - 0.014:
            continue
        # Temporalis: above mid and clearly medial.
        if cur.z > mid and abs(cur.x) < abs(xlat) - 0.006:
            continue

        need_raise = cur.z < inf + TARGET_HANG - 0.001
        need_tuck = abs(cur.x) > abs(xlat) + TARGET_OUT + 0.002
        need_drop = cur.z > inf + 0.0025 and abs(cur.x) > abs(xlat) - 0.004
        if not (need_raise or need_tuck or need_drop):
            continue

        target_z = cur.z
        if need_raise or need_drop:
            target_z = inf + TARGET_HANG
        target_ax = abs(cur.x)
        if need_tuck or need_drop:
            target_ax = abs(xlat) + TARGET_OUT
        target = Vector((math.copysign(target_ax, cur.x), cur.y, target_z))
        nxt = cur.lerp(target, BLEND)
        delta = nxt - cur
        if delta.length > MAX_MOVE:
            nxt = cur + delta.normalized() * MAX_MOVE
            delta = nxt - cur
        if delta.length < 1e-6:
            continue
        dists.append(delta.length)
        shell_def.data.vertices[i].co = imw @ nxt
        moved += 1
    shell_def.data.update()
    dists.sort()
    med = dists[len(dists) // 2] if dists else 0.0
    p95 = dists[int(0.95 * (len(dists) - 1))] if dists else 0.0
    return moved, med, p95


def main():
    bpy.ops.wm.open_mainfile(filepath=str(DST))
    C.hide_aux_skull()
    C.set_group_visibility("skull", False)
    C.import_glb(C.MUSCLE_GLB, "euro")
    C.apply_object_transforms(C.mesh_objects(C.objects_in_group("euro")))
    euro_st = C.get_obj("euro", "Static")
    euro_def = C.get_obj("euro", "Deform")
    shell_st = C.get_obj("muscle", "Static")
    shell_def = C.get_obj("muscle", "Deform")

    before = strip_stats(shell_st, shell_def, "before")
    euro_ref = strip_stats(euro_st, euro_def, "euro")
    moved, med, p95 = seal_to_rim(shell_def, shell_st)
    after = strip_stats(shell_st, shell_def, "after")
    for o in C.objects_in_group("euro"):
        o.hide_set(True)
        o.hide_render = True

    report = {
        "moved": moved,
        "move_median_m": round(med, 5),
        "move_p95_m": round(p95, 5),
        "before": before,
        "after": after,
        "euro_ref": euro_ref,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if p95 > 0.012:
        raise RuntimeError(f"move_p95 too large {p95}")
    # Must not reopen a big gap: under_rim should stay near euro.
    if (after.get("under_rim_pct") or 0) + 10 < (euro_ref.get("under_rim_pct") or 0):
        raise RuntimeError("under_rim drifted away from euro")
    if (after.get("out_p50") or 0) > (euro_ref.get("out_p50") or 0) + 0.005:
        raise RuntimeError("still too lateral vs euro")
    C.save_blend(DST)


if __name__ == "__main__":
    main()
