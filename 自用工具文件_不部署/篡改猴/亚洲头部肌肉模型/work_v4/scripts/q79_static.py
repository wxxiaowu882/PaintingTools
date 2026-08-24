# -*- coding: utf-8
"""Q79: Static-only (optional Deform blend) mesh nudge — preserve hw/occ."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q12_hw_match as Q12  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402
import q19_back_balance as Q19  # noqa: E402
import q75_mesh as Q75  # noqa: E402

OUT = C.STAGES / "Q79_static"
BASE = C.CHECKPOINTS / "Q57_p1_best.blend"
PY = __import__("shutil").which("python") or sys.executable


def nudge_targets(muscles, occ_y, occ_x, fore_y, tail_y, static_w=1.0, deform_w=0.0):
    """Vertex nudge on Static (full) + Deform (partial) only."""
    ref = C.get_obj("muscle", "Static") or muscles[0]
    center, size = C.bbox_center_size([ref])
    rx = max(size.x * 0.5, 1e-6)
    ry = max(size.y * 0.5, 1e-6)
    rz = max(size.z * 0.5, 1e-6)

    def mesh_weight(name: str) -> float:
        low = name.lower()
        if "static" in low:
            return static_w
        if "deform" in low:
            return deform_w
        return 0.0

    for obj in muscles:
        mw = mesh_weight(obj.name)
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

            occ = (
                Q75.smooth_step((ly - 0.04) / 0.42)
                * Q75.smooth_step((h - 0.56) / 0.10)
                * Q75.smooth_step((0.90 - h) / 0.14)
            )
            fore = (
                Q75.smooth_step((-ly - 0.04) / 0.40)
                * Q75.smooth_step((h - 0.04) / 0.10)
                * Q75.smooth_step((0.36 - h) / 0.14)
            )
            tail = (
                Q75.smooth_step((ly - 0.02) / 0.45)
                * Q75.smooth_step((0.86 - h) / 0.06)
                * Q75.smooth_step((0.98 - h) / 0.05)
            )
            if occ < 0.01 and fore < 0.01 and tail < 0.01:
                continue

            w2 = w.copy()
            if occ > 0.01:
                oy = occ_y * occ * mw
                ox = occ_x * occ * mw
                w2.y = center.y + (w.y - center.y) * (1.0 - oy)
                w2.x = center.x + (w.x - center.x) * (1.0 - ox)
            if fore > 0.01 and ly < 0:
                fy = fore_y * fore * mw
                w2.y = center.y + (w.y - center.y) * (1.0 + fy)
            if tail > 0.01:
                ty = tail_y * tail * mw
                w2.y = center.y + (w.y - center.y) * (1.0 + ty)
            v.co = inv @ w2
        me.update()


def eval_png(png: Path) -> dict:
    import subprocess

    proc = subprocess.run(
        [PY, str(SCRIPTS / "base15_proportion_eval.py"), str(png)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    t = proc.stdout
    i, j = t.find("{"), t.rfind("}") + 1
    return json.loads(t[i:j])


def run(tag, use_flat, occ_y, occ_x, fore_y, tail_y, static_w, deform_w, face, occ_b):
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()

    if use_flat:
        Q75.apply_f2_flat(muscles)

    nudge_targets(muscles, occ_y, occ_x, fore_y, tail_y, static_w, deform_w)

    if face > 0 or occ_b > 0:
        lat = Q7.make_lattice(muscles, f"b{tag}", 11)
        Q19.deform_balance(lat, face, occ_b, 0.04)
        Q7.apply_lattice(muscles, lat)

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(
        f"[Q79] {tag} sc={sc:.3f} pass={ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        # flat, oy, ox, fy, ty, sw, dw, face, occ_b
        ("s1", True, 0.22, 0.32, 0.10, 0.08, 1.0, 0.0, 0.0, 0.0),
        ("s2", True, 0.28, 0.38, 0.12, 0.08, 1.0, 0.0, 0.0, 0.0),
        ("s3", True, 0.32, 0.42, 0.12, 0.06, 1.0, 0.0, 0.0, 0.0),
        ("sd1", True, 0.25, 0.35, 0.10, 0.08, 1.0, 0.35, 0.0, 0.0),
        ("sd2", True, 0.28, 0.38, 0.12, 0.08, 1.0, 0.40, 0.0, 0.0),
        ("o1", True, 0.25, 0.35, 0.10, 0.08, 1.0, 0.35, 0.06, 0.04),
        ("o2", True, 0.28, 0.38, 0.12, 0.08, 1.0, 0.35, 0.07, 0.05),
        ("o3", True, 0.22, 0.32, 0.10, 0.06, 1.0, 0.30, 0.06, 0.04),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        ev, sc, muscles = run(tag, *row[1:])
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q79_static.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q79_static.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q79_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q79_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q79] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
