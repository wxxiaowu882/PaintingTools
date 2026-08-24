# -*- coding: utf-8
"""Q11: rebuild proportions from Q4_packed — strict Base15 side gate before any export."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402
import q10_occiput as Q10  # noqa: E402
import q7_form_fix as Q7  # noqa: E402
import q8_base_profile as Q8  # noqa: E402

OUT = C.STAGES / "Q11_proportion"
SOURCE = C.CHECKPOINTS / "Q4_packed.blend"
PY = shutil.which("python") or shutil.which("python3") or sys.executable
REF_SIDE = C.ROOT / "Base15_侧.png"


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def read_ref_targets() -> dict:
    code = (
        "import json,sys; sys.path.insert(0,r'%s');"
        "import base15_proportion_eval as P; from pathlib import Path;"
        "ref=P._normalize_profile(P._load_mask(Path(r'%s')));"
        "print(json.dumps({k:ref[k] for k in ('hw_ratio','vault_ratio','occiput_ratio')}))"
    ) % (str(SCRIPTS).replace("\\", "\\\\"), str(REF_SIDE).replace("\\", "\\\\"))
    proc = subprocess.run([PY, "-c", code], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode == 0 and proc.stdout.strip():
        return json.loads(proc.stdout.strip())
    return {"hw_ratio": 1.273, "vault_ratio": 0.987, "occiput_ratio": 1.0}


def cranial_bbox_metrics(muscles):
    static = C.get_obj("muscle", "Static")
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(static.data)
    bm.transform(static.matrix_world)
    zs = [v.co.z for v in bm.verts]
    z_cut = sorted(zs)[int(len(zs) * 0.20)]
    xs, ys, zs2 = [], [], []
    for v in bm.verts:
        if v.co.z >= z_cut:
            xs.append(v.co.x)
            ys.append(v.co.y)
            zs2.append(v.co.z)
    bm.free()
    mn = Vector((min(xs), min(ys), min(zs2)))
    mx = Vector((max(xs), max(ys), max(zs2)))
    s = mx - mn
    return {"hw": s.z / max(s.x, 1e-8), "dw": s.y / max(s.x, 1e-8)}


def deform_base15_proportions(lat, hw_scale: float, dw_scale: float, occiput_boost: float, vault_compress: float):
    """Side-profile targets: taller vault, fuller occiput bulge, rounded top."""
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
                cranial = smooth_step((lz + 0.12) / 0.88) * (1.0 - 0.5 * smooth_step((-lz - 0.18) / 0.55))

                new = co.copy()

                # height — Base15 H/W ~1.27
                z_mul = 1.0 + (hw_scale - 1.0) * cranial
                top = smooth_step((lz - 0.02) / 0.62) * cranial
                new.z = co.z * z_mul * (1.0 - vault_compress * top)

                # A-P depth — expand occiput (+Y) to match Base15 bulge
                y_base = 1.0 + (dw_scale - 1.0) * smooth_step(0.35 + 0.65 * abs(ly)) * cranial
                occ = smooth_step((ly + 0.05) / 0.55) * smooth_step((lz + 0.05) / 0.60) * cranial
                face = smooth_step((-ly - 0.05) / 0.45) * smooth_step((lz + 0.10) / 0.55) * cranial
                y_mul = y_base + occiput_boost * occ + 0.06 * face
                neck = smooth_step((-lz - 0.25) / 0.50) * smooth_step((ly + 0.10) / 0.70)
                y_mul -= 0.10 * neck
                new.y = co.y * max(0.72, y_mul)

                # mild Asian midface width
                mid = smooth_step(1.0 - abs(lz - 0.05) / 0.48) * smooth_step(abs(lx))
                new.x = co.x * (1.0 + 0.035 * mid * cranial)

                p.co_deform = new
    bpy.context.view_layer.update()


def render_side(muscles, path: Path, res: int = 900):
    C.configure_eevee(res)
    C.setup_world_white()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting()
    Q10.setup_camera_side_tight(muscles, 90.0, 0.0, 1.78)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def proportion_eval(side_png: Path) -> dict:
    proc = subprocess.run(
        [PY, str(SCRIPTS / "base15_proportion_eval.py"), str(side_png)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(proc.stdout)
    rp = side_png.parent / "base15_proportion_report.json"
    return json.loads(rp.read_text(encoding="utf-8")) if rp.exists() else {"pass": False}


def score_report(ev: dict) -> float:
    """Lower is better — weighted proportion error."""
    m = ev.get("metrics", {})
    s = 0.0
    for key, w in [("hw_ratio", 2.0), ("occiput_ratio", 2.5), ("vault_ratio", 1.0), ("area_ratio", 1.5)]:
        if key in m:
            s += w * float(m[key].get("err", 1.0))
    s += 3.0 * float(m.get("profile_rmse", 1.0))
    return s


def load_muscles():
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    return C.muscle_exportable()


def run_variant(params: tuple, tag: str) -> tuple[dict, Path, list]:
    hw_s, dw_s, occ_b, vault_c = params
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    muscles = load_muscles()
    lat = Q7.make_lattice(muscles, f"Prop_{tag}", 11)
    deform_base15_proportions(lat, hw_s, dw_s, occ_b, vault_c)
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    print(f"[Q11] {tag} hw={hw_s} dw={dw_s} occ={occ_b} vault={vault_c}", cranial_bbox_metrics(muscles))
    png = OUT / f"{tag}_side.png"
    C.set_group_visibility("skull", False)
    render_side(muscles, png)
    ev = proportion_eval(png)
    return ev, png, muscles


def export_if_pass(muscles, report: dict):
    if not report.get("pass"):
        print("[Q11] PROPORTION FAIL — no export")
        C.save_blend(C.CHECKPOINTS / "Q11_proportion_FAIL.blend")
        return False
    Q8.force_recolor()
    C.export_glb(C.GLB_FINAL, muscles)
    C.save_blend(C.BLEND_FINAL)
    C.save_blend(C.CHECKPOINTS / "Q11_proportion.blend")
    print("[Q11] EXPORTED after strict proportion pass")
    return True


def main():
    C.ensure_dirs(OUT, C.CHECKPOINTS)
    targets = read_ref_targets()
    print("[Q11] Base15 targets", targets)

    # baseline from Q4
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    muscles = load_muscles()
    side0 = OUT / "iter0_Q4_side.png"
    C.set_group_visibility("skull", False)
    render_side(muscles, side0)
    ev0 = proportion_eval(side0)
    print("[Q11] Q4 baseline score", score_report(ev0), ev0.get("notes"))

    variants = [
        ("v1", (1.12, 0.22, 0.18, 0.10)),
        ("v2", (1.15, 0.28, 0.24, 0.12)),
        ("v3", (1.18, 0.32, 0.30, 0.14)),
        ("v4", (1.20, 0.35, 0.34, 0.16)),
        ("v5", (1.22, 0.38, 0.38, 0.18)),
        ("v6", (1.14, 0.30, 0.28, 0.08)),
    ]

    best_ev, best_png, best_muscles = ev0, side0, muscles
    best_score = score_report(ev0)

    for tag, params in variants:
        ev, png, muscles = run_variant(params, tag)
        sc = score_report(ev)
        print(f"[Q11] {tag} score={sc:.4f} pass={ev.get('pass')}")
        if ev.get("pass"):
            export_if_pass(muscles, ev)
            subprocess.run([PY, str(SCRIPTS / "make_collages.py"), "Q11_proportion", tag], check=False)
            C.write_json(OUT / "self_eval_report.json", ev)
            return
        if sc < best_score:
            best_score, best_ev, best_png, best_muscles = sc, ev, png, muscles
            C.save_blend(C.CHECKPOINTS / f"Q11_{tag}_best.blend")

    C.write_json(OUT / "self_eval_report.json", best_ev)
    print("[Q11] best effort (NOT exported):", best_ev.get("notes"), "score=", best_score)
    C.save_blend(C.CHECKPOINTS / "Q11_proportion_FAIL.blend")


if __name__ == "__main__":
    main()
