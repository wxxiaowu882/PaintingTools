# -*- coding: utf-8
"""Q89: profile-only refinement on Q85-t5 (4/5 PASS base)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import mesh_outer as MO  # noqa: E402
import q12_hw_match as Q12  # noqa: E402
import q19_back_balance as Q19  # noqa: E402
import q20_profile_fit as Q20  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q84_aggressive as Q84  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.STAGES / "Q89_profile"
BASE = C.CHECKPOINTS / "Q85_t5_best.blend"
FALLBACK = C.CHECKPOINTS / "Q84_a6_best.blend"
REF = C.ROOT / "Base15_侧.png"
PY = __import__("shutil").which("python") or sys.executable


def eval_png(png):
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


def static_q20(muscles, strength, bulk):
    static = C.get_obj("muscle", "Static")
    if not static:
        return
    wn, on = Q20.load_targets()
    lat = Q7.make_lattice([static], "s20", 13)
    Q20.deform_to_targets(lat, wn, on, strength, bulk)
    Q7.apply_lattice([static], lat)


def profile_pass(muscles, tag, q20_st, oy, ox, fy, h0, h1, adapt_n, adapt_st, occ_guard=False):
    if q20_st > 0:
        static_q20(muscles, q20_st, 0.04)
    Q84.nudge_static_full(muscles, oy, ox, fy, h0, h1)
    MO.nudge_outer(muscles, oy * 0.6, ox * 0.6, fy * 0.5, 0.03, 1.0, 0.40, h0, h1, 0.12)

    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    best_ev, best_sc = ev, Q12.score(ev)

    for pi in range(adapt_n):
        if best_ev.get("pass"):
            break
        pr = float(best_ev.get("metrics", {}).get("profile_rmse", 1.0))
        occ = float(best_ev.get("occiput_ratio", {}).get("test", 0.0))
        if pr <= 0.055:
            break
        deltas = MO.measure_row_delta(REF, png)
        MO.nudge_adaptive(muscles, deltas, adapt_st, 1.0, 0.40, 0.10)
        Q84.nudge_static_full(muscles, 0.04, 0.07, 0.03, 0.64, 0.82)
        # occ dropped below gate -> tiny recovery (no face shrink)
        if occ_guard and occ < 0.915:
            lat = Q7.make_lattice(muscles, f"og{pi}", 11)
            Q19.deform_balance(lat, 0.0, 0.03, 0.03)
            Q7.apply_lattice(muscles, lat)
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        png = OUT / f"{tag}_p{pi+1}_side.png"
        Q12.render_side(muscles, png)
        ev = eval_png(png)
        sc = Q12.score(ev)
        if sc < best_sc:
            best_sc, best_ev = sc, ev
    return best_ev, best_sc


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    base = BASE if BASE.exists() else FALLBACK
    grid = [
        ("a1", 0.08, 0.28, 0.42, 0.10, 0.62, 0.84, 12, 0.14, True),
        ("a2", 0.10, 0.30, 0.44, 0.11, 0.60, 0.82, 14, 0.15, True),
        ("a3", 0.10, 0.32, 0.46, 0.11, 0.60, 0.82, 16, 0.16, True),
        ("a4", 0.12, 0.32, 0.46, 0.12, 0.58, 0.80, 16, 0.16, True),
        ("a5", 0.10, 0.30, 0.44, 0.11, 0.62, 0.84, 14, 0.14, False),
    ]
    best_sc, best = 1e9, None
    for row in grid:
        tag = row[0]
        bpy.ops.wm.open_mainfile(filepath=str(base))
        for o in C.mesh_objects(C.objects_in_group("muscle")):
            if "Melns" in o.name or "pCylinder" in o.name:
                o.hide_render = True
        muscles = C.muscle_exportable()
        ev, sc = profile_pass(muscles, tag, *row[1:])
        C.apply_object_transforms(muscles)
        C.fix_normals(muscles)
        m = ev.get("metrics", {})
        gates = sum(1 for k in ("hw_ratio", "vault_ratio", "occiput_ratio", "area_ratio") if m.get(k, {}).get("pass"))
        print(
            f"[Q89] {tag} sc={sc:.3f} pass={ev.get('pass')} gates={gates}/4 "
            f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
            f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
        )
        if ev.get("pass"):
            Q8.force_recolor()
            C.export_glb(C.GLB_FINAL, muscles)
            C.save_blend(C.BLEND_FINAL)
            C.save_blend(C.CHECKPOINTS / "Q89_PASS.blend")
            C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q89_PASS.blend", "pass": True, "report": ev})
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q89_{tag}_best.blend")
    if best:
        tag, ev, muscles = best
        C.save_blend(C.CHECKPOINTS / "Q89_best.blend")
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q89_best.blend", "pass": False, "report": ev, "tag": tag})
        print(f"[Q89] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
