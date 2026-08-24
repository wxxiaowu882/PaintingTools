# -*- coding: utf-8
"""Q69: zoned outer-shell profile fix on Q57-p1 + occ micro-tune."""
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
import q21_refine as Q21  # noqa: E402
import q37_profile_correct as Q37  # noqa: E402

OUT = C.STAGES / "Q69_zoned"
BASE = C.CHECKPOINTS / "Q57_p1_best.blend"
FALLBACK = C.CHECKPOINTS / "Q67_f0z0_best.blend"
PY = __import__("shutil").which("python") or sys.executable


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def deform_zoned(lat, strength: float, tail_pull: float, mid_occ_cut: float):
    """Row-zoned y correction from measured Q57-p1 profile deltas."""
    u, v, w = lat.data.points_u, lat.data.points_v, lat.data.points_w

    def index(i, j, k):
        return i + j * u + k * u * v

    for k in range(w):
        for j in range(v):
            for i in range(u):
                p = lat.data.points[index(i, j, k)]
                co = p.co.copy()
                ly = max(-1.0, min(1.0, co.y * 2.0))
                lz = max(-1.0, min(1.0, co.z * 2.0))
                h = (lz + 1.0) * 0.5
                cranial = smooth_step((lz + 0.04) / 0.92) * (
                    1.0 - 0.42 * smooth_step((-lz - 0.22) / 0.50)
                )
                if cranial < 0.04:
                    p.co_deform = co
                    continue

                front_shell = smooth_step((-ly - 0.10) / 0.38)
                back_shell = smooth_step((ly - 0.10) / 0.38)
                outer = max(front_shell, back_shell)

                # forehead / vault too back -> pull front forward
                fore = smooth_step((h - 0.04) / 0.10) * smooth_step((0.34 - h) / 0.12)
                # mid shallow dip at 40% -> slight back push on front
                mid_sh = smooth_step((h - 0.36) / 0.06) * smooth_step((0.46 - h) / 0.08)
                # occiput 70-85% too deep -> pull back shell forward
                occ = smooth_step((h - 0.66) / 0.06) * smooth_step((0.88 - h) / 0.10)
                # lower tail 90-95% too forward -> push back
                tail = smooth_step((h - 0.88) / 0.04) * smooth_step((0.98 - h) / 0.04)

                y_delta = strength * (
                    -0.09 * fore * front_shell
                    + 0.05 * mid_sh * front_shell
                    - 0.17 * occ * back_shell
                    + (tail_pull + 0.12) * tail * back_shell
                )
                # extra occ bulge trim (helps profile + occ ratio)
                occ_trim = mid_occ_cut * smooth_step((ly + 0.02) / 0.45) * smooth_step((h - 0.62) / 0.08) * smooth_step(
                    (0.88 - h) / 0.18
                ) * cranial

                new = co.copy()
                new.y = co.y * max(0.60, 1.0 + y_delta * outer - occ_trim)
                p.co_deform = new
    bpy.context.view_layer.update()


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


def run_one(tag, strength, tail_pull, mid_occ_cut, face, occ, zc):
    base_path = BASE if BASE.exists() else FALLBACK
    bpy.ops.wm.open_mainfile(filepath=str(base_path))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()

    lat = Q7.make_lattice(muscles, f"z{tag}", 13)
    deform_zoned(lat, strength, tail_pull, mid_occ_cut)
    Q7.apply_lattice(muscles, lat)

    if face > 0 or occ > 0:
        lat2 = Q7.make_lattice(muscles, f"b{tag}", 11)
        Q19.deform_balance(lat2, face, occ, 0.04)
        Q7.apply_lattice(muscles, lat2)
    if zc > 0:
        lat3 = Q7.make_lattice(muscles, f"h{tag}", 11)
        Q21.hw_trim_lat(lat3, zc)
        Q7.apply_lattice(muscles, lat3)

    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(
        f"[Q69] {tag} sc={sc:.3f} pass={ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        # strength, tail_pull, mid_occ_cut, face, occ, zc
        (0.22, 0.08, 0.06, 0.0, 0.0, 0.0),
        (0.28, 0.08, 0.08, 0.0, 0.0, 0.0),
        (0.28, 0.10, 0.10, 0.0, 0.0, 0.0),
        (0.32, 0.10, 0.10, 0.0, 0.0, 0.0),
        (0.28, 0.10, 0.10, 0.06, 0.04, 0.03),
        (0.28, 0.10, 0.10, 0.07, 0.05, 0.03),
        (0.28, 0.10, 0.10, 0.08, 0.05, 0.04),
        (0.32, 0.12, 0.12, 0.07, 0.05, 0.04),
        (0.35, 0.12, 0.12, 0.07, 0.06, 0.04),
    ]
    best_sc, best = 1e9, None
    for idx, (st, tp, mo, face, occ, zc) in enumerate(grid):
        tag = f"v{idx+1}"
        ev, sc, muscles = run_one(tag, st, tp, mo, face, occ, zc)
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q69_zoned.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q69_zoned.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q69_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q69_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q69] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
