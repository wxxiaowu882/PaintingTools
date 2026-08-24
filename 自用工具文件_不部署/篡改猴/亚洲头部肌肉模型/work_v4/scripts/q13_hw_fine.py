# -*- coding: utf-8
"""Q13: fine-tune A-P depth (y_mul 1.42–1.58) from Q4_packed."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q12_hw_match as Q12  # noqa: E402

OUT = C.STAGES / "Q13_hw_fine"
PY = shutil.which("python") or shutil.which("python3") or sys.executable


def proportion_eval(side_png: Path) -> dict:
    proc = subprocess.run(
        [PY, str(SCRIPTS / "base15_proportion_eval.py"), str(side_png)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(proc.stdout)
    text = proc.stdout
    i, j = text.find("{"), text.rfind("}") + 1
    return json.loads(text[i:j]) if i >= 0 and j > i else {"pass": False}


def run(tag: str, y: float, z: float, v: float, o: float):
    import bpy

    bpy.ops.wm.open_mainfile(filepath=str(Q12.SOURCE))
    muscles = Q12.load_muscles()
    import q7_form_fix as Q7

    lat = Q7.make_lattice(muscles, f"HW_{tag}", 11)
    Q12.deform_hw_lat(lat, y, z, v, o)
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    Q12.render_side(muscles, png)
    ev = proportion_eval(png)
    sc = Q12.score(ev)
    hw = ev.get("metrics", {}).get("hw_ratio", {}).get("test")
    print(f"[Q13] {tag} y={y} score={sc:.3f} hw={hw} pass={ev.get('pass')}")
    return ev, muscles, sc


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    grid = [
        ("i", 1.42, 0.99, 0.11, 0.20),
        ("j", 1.46, 0.98, 0.11, 0.22),
        ("k", 1.50, 0.97, 0.12, 0.24),
        ("l", 1.54, 0.96, 0.12, 0.26),
        ("m", 1.48, 0.96, 0.13, 0.24),
        ("n", 1.52, 0.95, 0.13, 0.26),
        ("o", 1.58, 0.94, 0.12, 0.28),
    ]
    best_sc, best = 1e9, None
    for tag, y, z, v, o in grid:
        ev, muscles, sc = run(tag, y, z, v, o)
        if ev.get("pass"):
            Q12.export_pass(muscles, ev)
            C.write_json(OUT / "self_eval_report.json", ev)
            return
        if sc < best_sc:
            best_sc, best = sc, (tag, ev, muscles)
            C.save_blend(C.CHECKPOINTS / f"Q13_{tag}_best.blend")

    if best:
        tag, ev, muscles = best
        C.write_json(OUT / "self_eval_report.json", ev)
        C.save_blend(C.CHECKPOINTS / "Q13_hw_fine_FAIL.blend")
        print("[Q13] best", tag, best_sc, ev.get("notes"))


if __name__ == "__main__":
    main()
