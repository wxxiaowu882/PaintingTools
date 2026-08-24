# -*- coding: utf-8
"""Q64: narrow face sweep on Q55-f4 for occ>=0.917."""
from __future__ import annotations

import json, sys
from pathlib import Path
import bpy

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import common as C, q12_hw_match as Q12, q7_form_fix as Q7, q8_base_profile as Q8
import q19_back_balance as Q19, q21_refine as Q21

OUT = C.STAGES / "Q64_narrow"
BASE = C.CHECKPOINTS / "Q55_f4_best.blend"
PY = __import__("shutil").which("python") or sys.executable

def eval_png(png):
    import subprocess
    proc = subprocess.run([PY, str(SCRIPTS/"base15_proportion_eval.py"), str(png)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    t = proc.stdout; i,j = t.find("{"), t.rfind("}")+1
    return json.loads(t[i:j])

def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    best_sc, best = 1e9, None
    for face in [0.125, 0.130, 0.135, 0.140, 0.145, 0.150]:
        for zc in [0.015, 0.020, 0.025]:
            tag = f"f{int(face*1000)}z{int(zc*1000)}"
            bpy.ops.wm.open_mainfile(filepath=str(BASE))
            for o in C.mesh_objects(C.objects_in_group("muscle")):
                if "Melns" in o.name or "pCylinder" in o.name: o.hide_render = True
            muscles = C.muscle_exportable()
            lat = Q7.make_lattice(muscles, tag, 11)
            Q19.deform_balance(lat, face, 0.0, 0.05)
            Q7.apply_lattice(muscles, lat)
            lat2 = Q7.make_lattice(muscles, f"z{tag}", 11)
            Q21.hw_trim_lat(lat2, zc)
            Q7.apply_lattice(muscles, lat2)
            C.apply_object_transforms(muscles); C.fix_normals(muscles)
            png = OUT / f"{tag}_side.png"
            C.set_group_visibility("skull", False)
            Q12.render_side(muscles, png)
            ev = eval_png(png); sc = Q12.score(ev); m = ev["metrics"]
            occ = m["occiput_ratio"]["test"]
            print(f"[Q64] {tag} sc={sc:.3f} pass={ev['pass']} occ={occ} area={m['area_ratio']['test']} pr={m['profile_rmse']}")
            if ev.get("pass"):
                Q8.force_recolor(); C.export_glb(C.GLB_FINAL, muscles); C.save_blend(C.BLEND_FINAL)
                C.save_blend(C.CHECKPOINTS/"Q64_narrow.blend")
                C.write_json(C.STAGES/"BEST_INTERNAL.json", {"checkpoint":"Q64_narrow.blend","pass":True,"report":ev})
                return
            if sc < best_sc: best_sc, best = sc, (tag, ev); C.save_blend(C.CHECKPOINTS/f"Q64_{tag}_best.blend")
    if best:
        C.write_json(C.STAGES/"BEST_INTERNAL.json", {"checkpoint":f"Q64_{best[0]}_best.blend","pass":False,"report":best[1]})
        print(f"[Q64] best={best[0]} sc={best_sc:.3f}")

if __name__ == "__main__": main()
