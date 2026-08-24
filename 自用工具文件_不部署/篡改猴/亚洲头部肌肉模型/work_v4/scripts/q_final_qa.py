# -*- coding: utf-8
"""Final QA: six views + proportion + silhouette; export only if proportion PASS."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.STAGES / "Q_FINAL_qa"
PY = shutil.which("python") or sys.executable
BLEND = C.CHECKPOINTS / "Q82_PASS.blend"
FALLBACK = C.CHECKPOINTS / "Q82_best.blend"


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    src = BLEND if BLEND.exists() else FALLBACK
    if not src.exists():
        src = C.CHECKPOINTS / "Q57_p1_best.blend"
    bpy.ops.wm.open_mainfile(filepath=str(src))
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    muscles = C.muscle_exportable()
    Q8.force_recolor()
    C.set_group_visibility("skull", False)
    views = C.render_views(OUT, muscles, "muscle", res=1100)
    side = OUT / "muscle_side.png"
    proc = subprocess.run(
        [PY, str(SCRIPTS / "base15_proportion_eval.py"), str(side)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    t = proc.stdout
    i, j = t.find("{"), t.rfind("}") + 1
    prop = json.loads(t[i:j]) if i >= 0 else {"pass": False}
    sil = {}
    if (SCRIPTS / "base15_silhouette_eval.py").exists():
        proc2 = subprocess.run(
            [PY, str(SCRIPTS / "base15_silhouette_eval.py"), str(OUT)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        try:
            ti, tj = proc2.stdout.find("{"), proc2.stdout.rfind("}") + 1
            sil = json.loads(proc2.stdout[ti:tj]) if ti >= 0 else {}
        except Exception:
            sil = {"raw": proc2.stdout[-2000:]}

    report = {"proportion": prop, "silhouette": sil, "views": [str(v) for v in views], "source": str(src)}
    C.write_json(OUT / "final_qa_report.json", report)

    try:
        from PIL import Image

        for cn, en in [
            ("正", "front"),
            ("侧", "side"),
            ("前侧", "front_three_quarter"),
            ("后侧", "back"),
            ("后侧2", "rear_three_quarter_2"),
            ("背面", "back"),
        ]:
            a = C.ROOT / f"Base15_{cn}.png"
            b = OUT / f"muscle_{en}.png"
            if not a.exists() or not b.exists():
                continue
            ia = Image.open(a).convert("RGB")
            ib = Image.open(b).convert("RGB")
            h = 850
            ia = ia.resize((int(ia.width * h / ia.height), h))
            ib = ib.resize((int(ib.width * h / ib.height), h))
            canvas = __import__("PIL").Image.new("RGB", (ia.width + ib.width + 24, h + 8), (248, 248, 248))
            canvas.paste(ia, (0, 8))
            canvas.paste(ib, (ia.width + 24, 8))
            canvas.save(OUT / f"compare_Base15_{en}.png")
    except Exception as e:
        print("collage skip", e)

    if prop.get("pass"):
        C.export_glb(C.GLB_FINAL, muscles)
        C.save_blend(C.BLEND_FINAL)
        print("[FINAL] PASS — exported", C.GLB_FINAL)
    else:
        print("[FINAL] FAIL proportion gate — no export overwrite")
        for line in prop.get("notes", []):
            print(" ", line)
    return 0 if prop.get("pass") else 1


if __name__ == "__main__":
    raise SystemExit(main())
