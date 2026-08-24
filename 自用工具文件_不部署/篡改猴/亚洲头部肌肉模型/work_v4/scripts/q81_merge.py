# -*- coding: utf-8
"""Q81: light Static mesh nudge on occ-best (Q64) or balanced (Q57) bases."""
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
import q75_mesh as Q75  # noqa: E402
import q79_static as Q79  # noqa: E402

OUT = C.STAGES / "Q81_merge"
BASES = [
    ("p1", C.CHECKPOINTS / "Q57_p1_best.blend"),
    ("f4", C.CHECKPOINTS / "Q55_f4_best.blend"),
    ("o4", C.CHECKPOINTS / "Q64_f125z15_best.blend"),
]
PY = __import__("shutil").which("python") or sys.executable


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


def run(bp, tag, base, flat, oy, ox, fy, ty):
    if not base.exists():
        return None
    bpy.ops.wm.open_mainfile(filepath=str(base))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    if flat:
        Q75.apply_f2_flat(muscles)
    Q79.nudge_targets(muscles, oy, ox, fy, ty, 1.0, 0.0)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{bp}_{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = eval_png(png)
    sc = Q12.score(ev)
    m = ev.get("metrics", {})
    print(
        f"[Q81] {bp}_{tag} sc={sc:.3f} pass={ev.get('pass')} "
        f"hw={m.get('hw_ratio', {}).get('test')} occ={m.get('occiput_ratio', {}).get('test')} "
        f"area={m.get('area_ratio', {}).get('test')} pr={m.get('profile_rmse')}"
    )
    return ev, sc, muscles


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grids = [
        ("l1", True, 0.18, 0.28, 0.08, 0.05),
        ("l2", True, 0.22, 0.32, 0.10, 0.06),
        ("l3", False, 0.18, 0.28, 0.08, 0.05),
        ("l4", False, 0.22, 0.32, 0.10, 0.06),
    ]
    best_sc, best = 1e9, None
    for bp, base in BASES:
        for row in grids:
            tag = row[0]
            res = run(bp, tag, base, *row[1:])
            if res is None:
                continue
            ev, sc, muscles = res
            if ev.get("pass"):
                Q8.force_recolor()
                C.export_glb(C.GLB_FINAL, muscles)
                C.save_blend(C.BLEND_FINAL)
                C.save_blend(C.CHECKPOINTS / "Q81_merge.blend")
                C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": "Q81_merge.blend", "pass": True, "report": ev})
                return
            if sc < best_sc:
                best_sc, best = sc, (f"{bp}_{tag}", ev, muscles)
                C.save_blend(C.CHECKPOINTS / f"Q81_{bp}_{tag}_best.blend")
    if best:
        tag, ev, _ = best
        C.write_json(C.STAGES / "BEST_INTERNAL.json", {"checkpoint": f"Q81_{tag}_best.blend", "pass": False, "report": ev})
        print(f"[Q81] best={tag} sc={best_sc:.3f}")


if __name__ == "__main__":
    main()
