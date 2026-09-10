# -*- coding: utf-8 -*-
"""PoC: RBF landmark/space warp — Euro muscle bundle → Asian Static shape.

Idea (industry / Inside Humans style):
  1) Align Euro Static roughly to Asian Static (bbox)
  2) Sample control points on Euro Static; map to nearest Asian Static
  3) Build one thin-plate RBF displacement field
  4) Apply the SAME field to Static + Deform + other muscle meshes

Topology / UV / local attachment stay; only space warps.
Does NOT hand-tweak masseter verts.

Usage:
  blender --background --python work_v4/scripts/rbf_euro_to_asian_poc.py
  blender --background --python work_v4/scripts/rbf_euro_to_asian_poc.py -- --n-ctrl 120
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402

OUT = C.WORK / "compare_review" / "_rbf_poc"
N_CTRL = 120
SMOOTH = 1e-4  # small ridge so TPS is stable


def parse_args():
    global N_CTRL
    argv = sys.argv
    if "--" in argv:
        args = argv[argv.index("--") + 1 :]
        for i, a in enumerate(args):
            if a == "--n-ctrl" and i + 1 < len(args):
                N_CTRL = int(args[i + 1])


def world_pts_np(obj) -> np.ndarray:
    mw = obj.matrix_world
    return np.array([(mw @ v.co)[:] for v in obj.data.vertices], dtype=np.float64)


def set_world_pts(obj, pts: np.ndarray) -> None:
    imw = obj.matrix_world.inverted()
    for i, p in enumerate(pts):
        obj.data.vertices[i].co = imw @ Vector((float(p[0]), float(p[1]), float(p[2])))
    obj.data.update()


def bbox_of(pts: np.ndarray):
    mn = pts.min(axis=0)
    mx = pts.max(axis=0)
    return mn, mx, 0.5 * (mn + mx), (mx - mn)


def rigid_scale_align(src: np.ndarray, dst: np.ndarray):
    """Uniform scale + translate so src bbox center/size matches dst (no rotation)."""
    _, _, sc, ss = bbox_of(src)
    _, _, dc, ds = bbox_of(dst)
    scale = float(np.median(ds / np.maximum(ss, 1e-8)))
    # x' = scale*(x - sc) + dc
    return scale, sc, dc


def apply_align(pts: np.ndarray, scale: float, sc: np.ndarray, dc: np.ndarray) -> np.ndarray:
    return scale * (pts - sc) + dc


def bvh_of(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    return BVHTree.FromObject(obj.evaluated_get(deps), deps)


def farthest_point_sample(pts: np.ndarray, n: int, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = min(n, len(pts))
    idxs = np.empty(n, dtype=np.int64)
    idxs[0] = int(rng.integers(0, len(pts)))
    dist = np.full(len(pts), np.inf)
    for i in range(1, n):
        last = pts[idxs[i - 1]]
        d = np.sum((pts - last) ** 2, axis=1)
        dist = np.minimum(dist, d)
        idxs[i] = int(np.argmax(dist))
    return idxs


def anatomical_seed_idxs(pts: np.ndarray, center: np.ndarray, half: np.ndarray) -> list[int]:
    """Extra landmark-like extrema in bbox-normalized ROIs (both meshes share ROIs)."""
    nrm = (pts - center) / np.maximum(half, 1e-8)
    seeds = []

    def pick(mask, score):
        ids = np.where(mask)[0]
        if len(ids) == 0:
            return
        seeds.append(int(ids[np.argmax(score[ids])]))

    # vertex (top)
    pick(nrm[:, 2] > 0.55, nrm[:, 2])
    # chin (bottom front)
    pick((nrm[:, 2] < -0.45) & (nrm[:, 1] > -0.15), -nrm[:, 2] - 0.3 * nrm[:, 1])
    # nose tip (front)
    pick((np.abs(nrm[:, 0]) < 0.18) & (nrm[:, 1] > 0.25) & (nrm[:, 2] > -0.15), nrm[:, 1])
    # occiput (back)
    pick(nrm[:, 1] < -0.45, -nrm[:, 1])
    # zygion L/R
    pick((nrm[:, 0] > 0.45) & (np.abs(nrm[:, 2]) < 0.25) & (np.abs(nrm[:, 1]) < 0.35), nrm[:, 0])
    pick((nrm[:, 0] < -0.45) & (np.abs(nrm[:, 2]) < 0.25) & (np.abs(nrm[:, 1]) < 0.35), -nrm[:, 0])
    # gonion-ish L/R
    pick((nrm[:, 0] > 0.35) & (nrm[:, 2] < -0.25) & (nrm[:, 1] < 0.1), nrm[:, 0] - nrm[:, 2])
    pick((nrm[:, 0] < -0.35) & (nrm[:, 2] < -0.25) & (nrm[:, 1] < 0.1), -nrm[:, 0] - nrm[:, 2])
    # tragion-ish (ear front)
    pick((nrm[:, 0] > 0.35) & (nrm[:, 1] < -0.15) & (np.abs(nrm[:, 2]) < 0.2), -nrm[:, 1] + 0.5 * nrm[:, 0])
    pick((nrm[:, 0] < -0.35) & (nrm[:, 1] < -0.15) & (np.abs(nrm[:, 2]) < 0.2), -nrm[:, 1] - 0.5 * nrm[:, 0])
    return seeds


def thin_plate(r: np.ndarray) -> np.ndarray:
    # φ(r) = r² log(r) with φ(0)=0
    out = np.zeros_like(r)
    m = r > 1e-12
    rm = r[m]
    out[m] = (rm * rm) * np.log(rm)
    return out


def fit_tps(src: np.ndarray, dst: np.ndarray, smooth: float = SMOOTH):
    """Fit 3D thin-plate spline: src -> dst. Returns callable(pts)->warped."""
    n = src.shape[0]
    # pairwise distances
    d = np.linalg.norm(src[:, None, :] - src[None, :, :], axis=2)
    K = thin_plate(d)
    K = K + smooth * np.eye(n)
    P = np.concatenate([np.ones((n, 1)), src], axis=1)  # [1,x,y,z]
    # System: [K P; P^T 0] [W; A] = [dst; 0]
    top = np.concatenate([K, P], axis=1)
    bot = np.concatenate([P.T, np.zeros((4, 4))], axis=1)
    L = np.concatenate([top, bot], axis=0)
    rhs = np.concatenate([dst, np.zeros((4, 3))], axis=0)
    try:
        coef = np.linalg.solve(L, rhs)
    except np.linalg.LinAlgError:
        coef = np.linalg.lstsq(L, rhs, rcond=None)[0]
    W = coef[:n]  # (n,3)
    A = coef[n:]  # (4,3)

    def warp(pts: np.ndarray) -> np.ndarray:
        # chunk to limit memory
        out = np.empty_like(pts)
        bs = 4000
        for i in range(0, len(pts), bs):
            chunk = pts[i : i + bs]
            dd = np.linalg.norm(chunk[:, None, :] - src[None, :, :], axis=2)
            phi = thin_plate(dd)
            poly = np.concatenate([np.ones((len(chunk), 1)), chunk], axis=1)
            out[i : i + bs] = phi @ W + poly @ A
        return out

    return warp


def project_to_mesh(bvh: BVHTree, pts: np.ndarray) -> np.ndarray:
    out = np.empty_like(pts)
    for i, p in enumerate(pts):
        loc, _n, _idx, _d = bvh.find_nearest(Vector(p))
        if loc is None:
            out[i] = p
        else:
            out[i] = (loc.x, loc.y, loc.z)
    return out


def hide_group(name: str, hide: bool = True):
    for o in C.objects_in_group(name):
        o.hide_set(hide)
        o.hide_render = hide
        o.hide_viewport = hide


def render_iso_side(static, deform, path: Path):
    keep = [static, deform]
    for o in C.mesh_objects():
        h = o not in keep
        o.hide_render = h
        o.hide_set(h)
    C.flatten_solid_principled(static, (0.90, 0.88, 0.78, 1.0), unlink_normal=True)
    C.flatten_solid_principled(deform, (0.78, 0.16, 0.32, 1.0), unlink_normal=True)
    C.configure_eevee(1000)
    C.configure_color_management()
    C.setup_world_white(1.0)
    C.setup_compositor_white_bg()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    C.setup_lighting(keep, yaw_deg=-90.0)
    center, size = C.bbox_center_size(keep)
    # aim mid-zygoma band
    cheek = Vector((center.x, center.y - size.y * 0.02, center.z + size.z * 0.02))
    cam = C.setup_camera_for_objs(keep, -90.0, 0.0, padding=1.12)
    extent = max(size.x, size.y, size.z)
    cam.data.ortho_scale = extent * 0.42
    dist = extent * 2.2
    cam.location = cheek + Vector((-dist, 0.0, 0.0))
    cam.rotation_euler = (cheek - cam.location).to_track_quat("-Z", "Y").to_euler()
    C.ensure_dirs(path.parent)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    C.finalize_compare_png(path)
    print(f"[iso] {path}")


def strip_attach_stats(static, deform):
    """Rough: lateral arch strip — how medial Deform is vs Static outer rim."""
    sp = world_pts_np(static)
    dp = world_pts_np(deform)
    sc, ss = C.bbox_center_size([static])
    half = np.array([ss.x, ss.y, ss.z], dtype=np.float64) * 0.5
    center = np.array([sc.x, sc.y, sc.z], dtype=np.float64)
    # Static outer |x| along mid-face band
    sn = (sp - center) / np.maximum(half, 1e-8)
    band = (np.abs(sn[:, 0]) > 0.35) & (np.abs(sn[:, 2]) < 0.22) & (sn[:, 1] > -0.45) & (sn[:, 1] < 0.30)
    if not np.any(band):
        return None
    static_hw = float(np.percentile(np.abs(sp[band, 0]), 90))
    dn = (dp - center) / np.maximum(half, 1e-8)
    dband = (np.abs(dn[:, 0]) > 0.28) & (dn[:, 2] > -0.12) & (dn[:, 2] < 0.22) & (dn[:, 1] > -0.40)
    if not np.any(dband):
        return None
    deform_hw = float(np.percentile(np.abs(dp[dband, 0]), 90))
    return {
        "static_arch_hw": round(static_hw, 5),
        "deform_arch_hw": round(deform_hw, 5),
        "muscle_minus_bone": round(deform_hw - static_hw, 5),
    }


def main():
    parse_args()
    C.ensure_dirs(OUT)
    C.clear_scene()

    # Target Asian shape = SHELL Static (already Asian-proportion Static)
    bpy.ops.wm.open_mainfile(filepath=str(C.CHECKPOINTS / "SHELL_v8.blend"))
    C.hide_aux_skull()
    C.set_group_visibility("skull", False)
    hide_group("skull", True)
    asian_st = C.get_obj("muscle", "Static")
    if asian_st is None:
        raise RuntimeError("Asian Static missing in SHELL_v8")
    asian_pts = world_pts_np(asian_st)

    # Source Euro bundle
    C.import_glb(C.MUSCLE_GLB, "euro")
    C.apply_object_transforms(C.mesh_objects(C.objects_in_group("euro")))
    euro_st = C.get_obj("euro", "Static")
    euro_def = C.get_obj("euro", "Deform")
    if euro_st is None or euro_def is None:
        raise RuntimeError("Euro Static/Deform missing")

    euro_st_pts0 = world_pts_np(euro_st)
    scale, sc, dc = rigid_scale_align(euro_st_pts0, asian_pts)

    # Align all euro meshes into Asian bbox frame first (rigid scale+translate)
    euro_meshes = [o for o in C.mesh_objects(C.objects_in_group("euro")) if o.type == "MESH"]
    aligned = {}
    for o in euro_meshes:
        p0 = world_pts_np(o)
        p1 = apply_align(p0, scale, sc, dc)
        set_world_pts(o, p1)
        aligned[o.name] = p1

    euro_st_pts = aligned[euro_st.name]
    asian_bvh = bvh_of(asian_st)

    # Control points: anatomical seeds + FPS on Euro Static
    _, _, e_c, e_s = bbox_of(euro_st_pts)
    e_half = e_s * 0.5
    seed = anatomical_seed_idxs(euro_st_pts, e_c, e_half)
    # denser sample excluding deep interior-ish by taking surface verts only (all Static verts are surface)
    fps = farthest_point_sample(euro_st_pts, max(N_CTRL - len(seed), 32), seed=7)
    ctrl_idx = np.unique(np.concatenate([np.array(seed, dtype=np.int64), fps]))
    src_ctrl = euro_st_pts[ctrl_idx]
    dst_ctrl = project_to_mesh(asian_bvh, src_ctrl)

    # Stabilize with a few bbox corners (small move = identity-ish)
    mn, mx, _, _ = bbox_of(euro_st_pts)
    corners = np.array(
        [
            [mn[0], mn[1], mn[2]],
            [mx[0], mn[1], mn[2]],
            [mn[0], mx[1], mn[2]],
            [mx[0], mx[1], mn[2]],
            [mn[0], mn[1], mx[2]],
            [mx[0], mn[1], mx[2]],
            [mn[0], mx[1], mx[2]],
            [mx[0], mx[1], mx[2]],
        ],
        dtype=np.float64,
    )
    corner_dst = project_to_mesh(asian_bvh, corners)
    # blend corners halfway so they don't over-pull
    corner_dst = 0.5 * corners + 0.5 * corner_dst
    src_ctrl = np.concatenate([src_ctrl, corners], axis=0)
    dst_ctrl = np.concatenate([dst_ctrl, corner_dst], axis=0)

    residual = float(np.mean(np.linalg.norm(dst_ctrl - src_ctrl, axis=1)))
    warp = fit_tps(src_ctrl, dst_ctrl, smooth=SMOOTH)

    before_attach = strip_attach_stats(euro_st, euro_def)

    for o in euro_meshes:
        p = world_pts_np(o)
        set_world_pts(o, warp(p))

    after_attach = strip_attach_stats(euro_st, euro_def)

    # Hide Asian / skull; show warped euro only for iso
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        o.hide_set(True)
        o.hide_render = True
    hide_group("skull", True)

    render_iso_side(euro_st, euro_def, OUT / "rbf_warped_side.png")
    # also full side of all euro muscle meshes tinted? keep Static+Deform iso as attachment check

    # Save a working blend + GLB of warped euro
    blend_out = C.CHECKPOINTS / "RBF_euro_to_asian_poc.blend"
    # move euro objects into muscle-like visibility for export
    for o in euro_meshes:
        o.hide_set(False)
        o.hide_render = False
    C.save_blend(blend_out)
    glb_out = OUT / "RBF_euro_to_asian_poc.glb"
    C.export_glb(glb_out, euro_meshes)

    report = {
        "n_ctrl": int(len(src_ctrl)),
        "n_anatomical_seeds": len(seed),
        "align_scale": round(scale, 5),
        "ctrl_mean_move_m": round(residual, 5),
        "smooth": SMOOTH,
        "attach_before": before_attach,
        "attach_after": after_attach,
        "blend": str(blend_out),
        "glb": str(glb_out),
        "iso": str(OUT / "rbf_warped_side.png"),
        "note": "PoC: same RBF field on all Euro meshes toward Asian SHELL Static.",
    }
    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

    # Soft gate for PoC: muscle should stay medial to bone outer (negative muscle_minus_bone)
    if after_attach and after_attach["muscle_minus_bone"] > 0.002:
        raise RuntimeError(
            f"PoC attach FAIL: muscle outside bone hw Δ={after_attach['muscle_minus_bone']}"
        )


if __name__ == "__main__":
    main()
