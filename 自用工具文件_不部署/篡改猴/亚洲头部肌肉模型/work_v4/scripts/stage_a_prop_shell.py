# -*- coding: utf-8
"""Stage A: global proportion shell — fix non-human head ratios (no profile-RMSE chase)."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.WORK / "compare_review"
BASE = C.CHECKPOINTS / "Q57_p1_best.blend"


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def deform_global_prop(lat, sx: float, sy: float, sz: float, back_extra: float, top_extra: float):
    """Global lattice scale with mild cranial/occiput bias. x=width y=depth z=height."""
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                lx = max(-1.0, min(1.0, co.x * 2.0))
                ly = max(-1.0, min(1.0, co.y * 2.0))
                lz = max(-1.0, min(1.0, co.z * 2.0))
                back = smooth_step((ly + 0.05) / 0.55)
                top = smooth_step((lz - 0.05) / 0.55)
                low = smooth_step((-lz - 0.05) / 0.45)
                y_s = sy * (1.0 - back_extra * back)
                z_s = sz * (1.0 + top_extra * top) * (1.0 - 0.04 * low)
                x_s = sx * (1.0 - 0.03 * abs(lx) * smooth_step((lz + 0.1) / 0.7))
                new = co.copy()
                new.x = co.x * x_s
                new.y = co.y * y_s
                new.z = co.z * z_s
                p.co_deform = new
    bpy.context.view_layer.update()


def run_variant(tag: str, sx, sy, sz, back_extra, top_extra, note: str):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    try:
        Q8.force_recolor()
    except Exception as e:
        print(f"[warn] recolor: {e}")

    before = Q7.metrics(f"{tag}_before")
    lat = Q7.make_lattice(muscles, f"PROP_{tag}", 9)
    deform_global_prop(lat, sx, sy, sz, back_extra, top_extra)
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    after = Q7.metrics(f"{tag}_after")

    C.save_blend(C.CHECKPOINTS / f"PROP_{tag}.blend")
    dest = OUT / "ours" / f"PROP_{tag}"
    C.ensure_dirs(dest)
    C.set_group_visibility("skull", False)
    C.render_views(dest, muscles, "muscle", res=1000)

    report = {
        "tag": f"PROP_{tag}",
        "base": str(BASE.name),
        "note": note,
        "params": {"sx": sx, "sy": sy, "sz": sz, "back_extra": back_extra, "top_extra": top_extra},
        "before": before,
        "after": after,
    }
    C.write_json(dest / "prop_report.json", report)
    print(f"[PROP] saved {tag}", report["params"])
    return report


def update_manifest(reports):
    C.ensure_dirs(OUT / "base15")
    mapping = [
        ("正", "front"),
        ("侧", "side"),
        ("前侧", "front_three_quarter"),
        ("后侧", "rear_three_quarter"),
        ("后侧2", "rear_three_quarter_2"),
        ("背面", "back"),
    ]
    for cn, en in mapping:
        src = C.ROOT / f"Base15_{cn}.png"
        if src.exists():
            shutil.copy2(src, OUT / "base15" / f"{en}.png")

    cands = [{"id": r["tag"], "blend": f"{r['tag']}.blend", "note": r["note"]} for r in reports]
    for extra in [
        {"id": "Q57_p1", "blend": "Q57_p1_best.blend", "note": "旧主线基线（改比例前）"},
        {"id": "Q85_t5", "blend": "Q85_t5_best.blend", "note": "旧数字最优（比例已崩）"},
    ]:
        if (OUT / "ours" / extra["id"]).exists():
            cands.append(extra)
    C.write_json(OUT / "manifest.json", {"candidates": cands, "stage": "A_proportion_shell"})


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("v1", 0.93, 0.78, 1.16, 0.10, 0.08, "阶段A·全局比例v1：收前后深、抬颅高、略收宽"),
        ("v2", 0.90, 0.72, 1.22, 0.14, 0.10, "阶段A·全局比例v2：更强收深+抬高（备选）"),
    ]
    reports = []
    for row in grid:
        reports.append(run_variant(*row))
    update_manifest(reports)
    print("[PROP] Stage A done — open 打开对照页.bat and review PROP_v1 / PROP_v2")


if __name__ == "__main__":
    main()
