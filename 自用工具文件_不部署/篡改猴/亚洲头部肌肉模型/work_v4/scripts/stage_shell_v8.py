# -*- coding: utf-8 -*-
"""SHELL_v8: from v7 — Base15 side hw_ratio + same facing/colors as Base15."""
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
import q7_form_fix as Q7  # noqa: E402

OUT = C.WORK / "compare_review"
BASE = C.CHECKPOINTS / "SHELL_v7.blend"
TAG = "SHELL_v8"
PY = shutil.which("python") or sys.executable
WIDTH_GATE = 1.08


def bone_objs():
    skull = C.get_obj("skull", "UnifiedSkull")
    mandible = C.get_obj("skull", "Mandible")
    return [o for o in (skull, mandible) if o]


def cranial_objs(muscles):
    out = []
    for o in muscles:
        n = o.name.lower()
        if "plastyma" in n or "platysma" in n:
            continue
        if "deform" in n or "skiedras" in n:
            out.append(o)
    return out or [C.get_obj("muscle", "Static")]


def smooth_step(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def deform_hw_lat(lat, y_mul: float, z_mul: float, vault_c: float, occ_boost: float):
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
                cranial = smooth_step((lz + 0.14) / 0.86) * (1.0 - 0.52 * smooth_step((-lz - 0.16) / 0.52))

                y_scale = 1.0 + (y_mul - 1.0) * smooth_step(0.42 + 0.58 * abs(ly)) * cranial
                occ = smooth_step((ly + 0.02) / 0.58) * smooth_step((lz + 0.02) / 0.62) * cranial
                y_scale += occ_boost * occ
                neck = smooth_step((-lz - 0.22) / 0.52) * smooth_step((ly + 0.12) / 0.72)
                y_scale -= 0.14 * neck

                z_scale = 1.0 + (z_mul - 1.0) * cranial
                top = smooth_step((lz - 0.04) / 0.60) * cranial

                new = co.copy()
                new.y = co.y * max(0.65, y_scale)
                new.z = co.z * z_scale * (1.0 - vault_c * top)
                mid = smooth_step(1.0 - abs(lz - 0.02) / 0.48) * smooth_step(abs(lx))
                new.x = co.x * (1.0 + 0.02 * mid * cranial)
                p.co_deform = new
    bpy.context.view_layer.update()


def recenter_to_skull(muscles):
    static = C.get_obj("muscle", "Static")
    bones = bone_objs()
    if not bones or static is None:
        return
    b_c, _ = C.bbox_center_size(bones)
    m_c, _ = C.bbox_center_size([static])
    for obj in muscles:
        obj.location += b_c - m_c
    C.apply_object_transforms(muscles)


def metrics_pair(tag: str, muscles):
    soft = Q7.metrics(f"{tag}_soft")
    cr = cranial_objs(muscles)
    _, s = C.bbox_center_size(cr)
    dw = s.y / max(s.x, 1e-8)
    hw = s.z / max(s.x, 1e-8)
    print(f"[{tag}_cranial] size=({s.x:.4f},{s.y:.4f},{s.z:.4f}) depth/width={dw:.3f} height/width={hw:.3f}")
    return {
        "soft": soft,
        "cranial": {"size": [s.x, s.y, s.z], "depth_over_width": dw, "height_over_width": hw},
    }


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


def score(ev: dict) -> float:
    m = ev.get("metrics", {})
    s = 0.0
    for key, w in [("hw_ratio", 3.0), ("occiput_ratio", 2.0), ("vault_ratio", 1.0), ("area_ratio", 1.0)]:
        if key in m:
            s += w * float(m[key].get("err", 1.0))
    s += 4.0 * float(m.get("profile_rmse", 1.0))
    return s


def render_top(objs, path: Path, res: int = 1000, label: str = "top"):
    C.ensure_dirs(path.parent)
    C.configure_eevee(res)
    C.prepare_compare_render()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting()
    center, size = C.bbox_center_size(objs)
    extent = max(size.x, size.y, size.z, 1e-6)
    cam_data = bpy.data.cameras.new("TopCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = extent * 1.45
    cam = bpy.data.objects.new("TopCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = center + Vector((0, 0, extent * 2.4))
    cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print(f"[render:{label}] {path}")


def set_hide_render(objs, hide: bool):
    for o in objs:
        o.hide_render = hide
        o.hide_set(hide)


def load_scene():
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    C.hide_aux_skull()
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    return C.muscle_exportable()


def hide_skull():
    C.set_group_visibility("skull", False)
    for o in C.mesh_objects(C.objects_in_group("skull")):
        o.hide_set(True)
        o.hide_render = True


def try_variant(y_mul, z_mul, vault_c, occ, tag: str):
    muscles = load_scene()
    lat = Q7.make_lattice(muscles, f"V8_{tag}", 11)
    deform_hw_lat(lat, y_mul, z_mul, vault_c, occ)
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    recenter_to_skull(muscles)
    hide_skull()
    probe = OUT / "ours" / TAG / f"_probe_{tag}"
    C.ensure_dirs(probe)
    side_png = probe / "muscle_side.png"
    C.render_side_only(muscles, side_png, res=900)
    ev = proportion_eval(side_png)
    sc = score(ev)
    hw = ev.get("metrics", {}).get("hw_ratio", {}).get("test", 0)
    rmse = ev.get("metrics", {}).get("profile_rmse", 1)
    print(f"[v8 {tag}] y={y_mul} z={z_mul} hw={hw:.3f} rmse={rmse:.4f} score={sc:.3f} pass={ev.get('pass')}")
    return muscles, ev, sc


def export_final(muscles, before, after, width_ratio, ev):
    C.save_blend(C.CHECKPOINTS / f"{TAG}.blend")
    dest = OUT / "ours" / TAG
    hide_skull()
    C.render_views(dest, muscles, "muscle", res=1000)
    render_top(muscles, dest / "muscle_top.png", 1000, "soft_top")
    hide_for_cranial = [
        o
        for o in muscles
        if ("static" in o.name.lower() or "plastyma" in o.name.lower() or "platysma" in o.name.lower())
    ]
    set_hide_render(hide_for_cranial, True)
    render_top(cranial_objs(muscles), dest / "muscle_top_cranial.png", 1000, "cranial_top")
    set_hide_render(hide_for_cranial, False)
    C.export_glb(OUT / "glb" / f"{TAG}.glb", muscles)

    report = {
        "tag": TAG,
        "note": "自v7：侧视同向+Base15色；大型比例 hw 对齐",
        "from": "SHELL_v7.blend",
        "before": before,
        "after": after,
        "proportion": ev,
        "judgment": {
            "chain": "v1→…→v7→v8",
            "width_ratio": width_ratio,
            "not_sphere_gate": width_ratio <= WIDTH_GATE,
            "proportion_pass": bool(ev.get("pass")),
            "review_ortho": True,
            "agent_pass": False,
        },
    }
    C.write_json(dest / "skull_report.json", report)
    for cn, en in [
        ("正", "front"),
        ("侧", "side"),
        ("前侧", "front_three_quarter"),
        ("后侧", "rear_three_quarter"),
        ("背面", "back"),
    ]:
        src = C.ROOT / f"Base15_{cn}.png"
        if src.exists():
            shutil.copy2(src, OUT / "base15" / f"{en}.png")

    cands = [
        {"id": TAG, "blend": f"{TAG}.blend", "note": report["note"], "glb": True},
        {"id": "SHELL_v7", "blend": "SHELL_v7.blend", "note": "上版·后枕+下颌", "glb": True},
        {"id": "SHELL_v6", "blend": "SHELL_v6.blend", "note": "后枕加强", "glb": True},
        {"id": "SHELL_v1", "blend": "SHELL_v1.blend", "note": "基线·约60分", "glb": True},
        {"id": "SHELL_v2", "blend": "SHELL_v2.blend", "note": "坏例·球形头颅", "glb": True},
    ]
    C.write_json(
        OUT / "manifest.json",
        {
            "candidates": cands,
            "stage": TAG,
            "default_review": TAG,
            "never_promote": ["SHELL_v2"],
            "review_ortho": True,
            "primary_views": ["front", "side", "back"],
        },
    )


def main():
    C.ensure_dirs(OUT / "ours" / TAG, OUT / "glb", C.CHECKPOINTS)
    if not BASE.exists():
        raise FileNotFoundError(BASE)

    muscles = load_scene()
    before = metrics_pair("from_v7", muscles)

    # v7 hw~0.93 vs Base15 1.27 — need much stronger cranial Z↑ / A-P Y↓
    grid = [
        ("e1", 0.68, 1.22, 0.08, 0.20),
        ("e2", 0.62, 1.28, 0.10, 0.22),
        ("e3", 0.58, 1.32, 0.10, 0.24),
        ("e4", 0.65, 1.25, 0.08, 0.18),
    ]

    best = None
    best_sc = 1e9
    best_params = grid[0]

    for tag, y, z, v, o in grid:
        muscles, ev, sc = try_variant(y, z, v, o, tag)
        if ev.get("pass"):
            best = (ev, sc, (y, z, v, o, tag))
            break
        if sc < best_sc:
            best_sc = sc
            best = (ev, sc, (y, z, v, o, tag))
            best_params = (y, z, v, o, tag)

    if not best:
        raise RuntimeError("v8 sweep failed")

    ev, sc, (y, z, v, o, tag) = best
    print(f"[v8] best={tag} y={y} z={z} score={sc:.3f} pass={ev.get('pass')}")

    # Re-open and re-apply best (Blender may invalidate mesh refs after reload)
    muscles = load_scene()
    lat = Q7.make_lattice(muscles, f"V8_{tag}_final", 11)
    deform_hw_lat(lat, y, z, v, o)
    Q7.apply_lattice(muscles, lat)
    C.apply_object_transforms(muscles)
    C.fix_normals(muscles)
    recenter_to_skull(muscles)
    after = metrics_pair(TAG, muscles)
    bx = before["cranial"]["size"][0]
    ax = after["cranial"]["size"][0]
    width_ratio = ax / max(bx, 1e-8)
    export_final(muscles, before, after, width_ratio, ev)
    print(json.dumps(ev, ensure_ascii=False))
    print(f"[{TAG}] done")


if __name__ == "__main__":
    main()
