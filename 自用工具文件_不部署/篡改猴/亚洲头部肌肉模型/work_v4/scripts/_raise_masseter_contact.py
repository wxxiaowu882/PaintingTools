# -*- coding: utf-8 -*-
"""Raise masseter silhouette to contact Static inferior rim (close visible gap).

Incremental on current SHELL_v8.blend. Temporalis untouched.
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
from _euro_masseter_attach import beam_slab, lookup_slab, strip_stats, world_pts  # noqa: E402

DST = C.CHECKPOINTS / "SHELL_v8.blend"
MAX_MOVE = 0.010
BLEND = 0.92
CONTACT = -0.0008  # just under inferior rim


def raise_to_contact(shell_def, shell_st):
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
        # Temporalis above roof / fossa.
        if cur.z > mid + 0.002 and abs(cur.x) < abs(xlat) - 0.005:
            continue
        if cur.z > mid + 0.004:
            continue
        # Only masseter origin neighborhood: lateral + near rim height.
        if abs(cur.x) < abs(xlat) - 0.014:
            continue
        if cur.z > inf + 0.003:
            # still covering outer face → tuck medial under rim
            if abs(cur.x) < abs(xlat) - 0.002:
                continue
            target = Vector(
                (math.copysign(abs(xlat) - 0.010, cur.x), cur.y, inf + CONTACT)
            )
        elif cur.z < inf + CONTACT - 0.0005:
            # gap below rim → raise to contact
            target = Vector((cur.x, cur.y, inf + CONTACT))
            # also keep slightly medial of outer face
            if abs(cur.x) > abs(xlat) - 0.004:
                target.x = math.copysign(abs(xlat) - 0.009, cur.x)
        else:
            continue
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
    shell_st = C.get_obj("muscle", "Static")
    shell_def = C.get_obj("muscle", "Deform")
    before = strip_stats(shell_st, shell_def, "before")
    moved, med, p95 = raise_to_contact(shell_def, shell_st)
    after = strip_stats(shell_st, shell_def, "after")
    report = {
        "moved": moved,
        "move_median_m": round(med, 5),
        "move_p95_m": round(p95, 5),
        "before": before,
        "after": after,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if moved < 30:
        raise RuntimeError(f"too few verts moved ({moved})")
    if p95 > 0.012:
        raise RuntimeError(f"move_p95 too large {p95}")
    C.save_blend(DST)


if __name__ == "__main__":
    main()
