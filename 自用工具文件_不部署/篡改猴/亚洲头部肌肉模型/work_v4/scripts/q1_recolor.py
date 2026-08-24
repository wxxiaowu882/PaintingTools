# -*- coding: utf-8 -*-
"""Q1: remapping albedo hues toward Base15 + dark eyes + gray neck."""
from __future__ import annotations

import colorsys
import json
import sys
from pathlib import Path

import bpy
import numpy as np

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402


def rgb01_to_hsv(r, g, b):
    return colorsys.rgb_to_hsv(float(r), float(g), float(b))


def hsv_to_rgb01(h, s, v):
    return colorsys.hsv_to_rgb(h, s, v)


def rgb_to_hsv_np(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    df = mx - mn
    h = np.zeros_like(mx)
    mask = df > 1e-8
    rmax = mask & (mx == r)
    gmax = mask & (mx == g) & ~rmax
    bmax = mask & (mx == b) & ~rmax & ~gmax
    h[rmax] = np.mod((g[rmax] - b[rmax]) / df[rmax], 6.0) / 6.0
    h[gmax] = ((b[gmax] - r[gmax]) / df[gmax] + 2.0) / 6.0
    h[bmax] = ((r[bmax] - g[bmax]) / df[bmax] + 4.0) / 6.0
    s = np.zeros_like(mx)
    s[mx > 1e-8] = df[mx > 1e-8] / mx[mx > 1e-8]
    return np.stack([h, s, mx], axis=-1)


def hsv_to_rgb_np(hsv: np.ndarray) -> np.ndarray:
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    i = np.floor(h * 6.0).astype(np.int32)
    f = h * 6.0 - i
    p = v * (1.0 - s)
    q = v * (1.0 - f * s)
    t = v * (1.0 - (1.0 - f) * s)
    i = np.mod(i, 6)
    out = np.zeros_like(hsv)
    conds = [
        (i == 0, (v, t, p)),
        (i == 1, (q, v, p)),
        (i == 2, (p, v, t)),
        (i == 3, (p, q, v)),
        (i == 4, (t, p, v)),
        (i == 5, (v, p, q)),
    ]
    for m, (rr, gg, bb) in conds:
        out[m, 0], out[m, 1], out[m, 2] = rr[m], gg[m], bb[m]
    return out


def apply_hue(rgb, mask, target_h, sat_scale=1.0, sat_min=0.12, sat_max=0.85):
    if not np.any(mask):
        return rgb
    hsv = rgb_to_hsv_np(rgb)
    hsv[mask, 0] = target_h
    hsv[mask, 1] = np.clip(hsv[mask, 1] * sat_scale, sat_min, sat_max)
    rgb[mask] = hsv_to_rgb_np(hsv)[mask]
    return rgb


def _copy_raw_pixels(img: bpy.types.Image, path: Path) -> bool:
    try:
        tmp = bpy.data.images.load(str(path), check_existing=True)
        if tmp.size[0] != img.size[0] or tmp.size[1] != img.size[1]:
            tmp.scale(img.size[0], img.size[1])
        img.pixels[:] = tmp.pixels[:]
        if tmp is not img and tmp.users == 0:
            bpy.data.images.remove(tmp)
        print(f"[recolor] raw pixels {img.name or path.stem} <- {path.name}")
        return True
    except Exception as e:
        print(f"[warn] raw copy failed {path.name}: {e}")
        return False


def reload_raw_texture(img: bpy.types.Image, obj_hint: str = "") -> bool:
    """Reload Q1 raw dump if present — remap must start from Euro source hues."""
    name_l = (img.name or "").lower()
    hint_l = (obj_hint or "").lower()
    key = None
    for k in ("deform", "skiedras", "plastyma", "acs", "static", "eye"):
        if k in hint_l or k in name_l:
            key = "eye" if k == "acs" else k
            break
    if not key:
        return False
    if img.name:
        path = C.TEXTURES / f"{key}_{img.name}_raw.png"
        if path.exists():
            return _copy_raw_pixels(img, path)
    w, h = img.size
    for path in sorted(C.TEXTURES.glob(f"{key}_*_raw.png")):
        try:
            tmp = bpy.data.images.load(str(path), check_existing=True)
            tw, th = tmp.size[0], tmp.size[1]
            if tmp is not img and tmp.users == 0:
                bpy.data.images.remove(tmp)
            if tw == w and th == h:
                return _copy_raw_pixels(img, path)
        except Exception:
            continue
    return False


def remap_array(arr: np.ndarray, mode: str) -> np.ndarray:
    rgb = arr[..., :3].copy()
    a = arr[..., 3:4] if arr.shape[-1] == 4 else np.ones((*rgb.shape[:2], 1), dtype=np.float32)
    hsv = rgb_to_hsv_np(rgb)
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]

    if mode == "face":
        # Euro source bands -> Base15 (see textures/base15_palette.json euro_source_approx)
        rgb = apply_hue(rgb, (H >= 0.48) & (H <= 0.72) & (S > 0.08), 0.32, 1.05)  # blue frontalis -> Base green
        rgb = apply_hue(rgb, (H >= 0.20) & (H < 0.42) & (S > 0.12), 0.78, 0.75)  # green temporalis -> purple
        rgb = apply_hue(rgb, (H >= 0.10) & (H < 0.20) & (S > 0.12), 0.97, 0.70)  # yellow orb -> pink
        rgb = apply_hue(rgb, ((H < 0.06) | (H > 0.94)) & (S > 0.14), 0.78, 0.70)  # red masseter -> purple
        rgb = apply_hue(rgb, (H >= 0.06) & (H < 0.10) & (S > 0.14), 0.97, 0.65)  # cheek pink
        rgb = apply_hue(rgb, (H >= 0.42) & (H < 0.48) & (S > 0.12), 0.48, 0.55)
        rgb = apply_hue(rgb, (H >= 0.72) & (H < 0.90) & (S > 0.10), 0.78, 0.75)  # lavender -> purple
        gray = S < 0.10
        tgt = np.array([190 / 255, 188 / 255, 185 / 255], dtype=np.float32)
        rgb[gray] = 0.72 * rgb[gray] + 0.28 * tgt
        near_white = (S < 0.20) & (V > 0.58)
        rgb[near_white] = 0.18 * rgb[near_white] + 0.82 * tgt
    elif mode == "skiedras":
        # Skiedras: temporalis / occipital — purple & pink, not frontalis green
        rgb = apply_hue(rgb, (H >= 0.48) & (H <= 0.72) & (S > 0.06), 0.78, 0.85)
        rgb = apply_hue(rgb, (H >= 0.18) & (H < 0.48) & (S > 0.06), 0.78, 0.85)
        rgb = apply_hue(rgb, (H >= 0.10) & (H < 0.20) & (S > 0.12), 0.97, 0.70)
        rgb = apply_hue(rgb, ((H < 0.06) | (H > 0.94)) & (S > 0.14), 0.78, 0.70)
        rgb = apply_hue(rgb, (H >= 0.72) & (H < 0.90) & (S > 0.10), 0.97, 0.70)
        gray = S < 0.10
        tgt = np.array([190 / 255, 188 / 255, 185 / 255], dtype=np.float32)
        rgb[gray] = 0.72 * rgb[gray] + 0.28 * tgt
        near_white = (S < 0.20) & (V > 0.58)
        rgb[near_white] = 0.18 * rgb[near_white] + 0.82 * tgt
    elif mode == "static":
        tgt = np.array([190 / 255, 188 / 255, 185 / 255], dtype=np.float32)
        lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])[..., None]
        grain = (lum - lum.mean()) * 0.10
        base = np.clip(tgt + grain, 0.08, 0.80)
        rgb = 0.10 * rgb + 0.90 * base
    elif mode == "neck":
        tgt = np.array([175 / 255, 175 / 255, 178 / 255], dtype=np.float32)
        lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])[..., None]
        grain = (lum - lum.mean()) * 0.18
        base = np.clip(tgt + grain, 0, 1)
        rgb = 0.22 * rgb + 0.78 * base
    elif mode == "eye":
        iris = (H > 0.45) & (H < 0.75) & (S > 0.15) & (V > 0.12)
        rgb = apply_hue(rgb, iris, 0.06, 0.55)
        rgb[iris] *= 0.28
        pupil = ((H < 0.06) | (H > 0.92)) & (S > 0.25) & (V > 0.15)
        rgb[pupil] = np.array([0.04, 0.03, 0.025], dtype=np.float32)
        leftover = (S > 0.25) & (V > 0.25) & (~iris) & (~pupil)
        rgb[leftover] = rgb[leftover] * 0.35 + np.array([0.12, 0.09, 0.07], dtype=np.float32)

    return np.concatenate([np.clip(rgb, 0, 1), a], axis=-1).astype(np.float32)


def image_to_np(img: bpy.types.Image) -> np.ndarray:
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32)
    ch = 4
    return px.reshape(h, w, ch)


def np_to_image(img: bpy.types.Image, arr: np.ndarray):
    img.pixels[:] = arr.reshape(-1)
    img.update()


def unique_images_from_obj(obj) -> list:
    imgs = []
    seen = set()
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image and n.image.name not in seen:
                # prefer color/albedo: skip if clearly a normal map by name
                nm = (n.image.name or "").lower()
                if "normal" in nm or "nrm" in nm:
                    continue
                seen.add(n.image.name)
                imgs.append(n.image)
    return imgs


def save_png(img: bpy.types.Image, path: Path):
    C.ensure_dirs(path.parent)
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()


def darken_eye_principled():
    obj = C.get_obj("muscle", "Acs")
    if not obj:
        return
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        p = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if p and "Base Color" in p.inputs and not p.inputs["Base Color"].is_linked:
            p.inputs["Base Color"].default_value = (0.12, 0.09, 0.07, 1.0)


def gray_plastyma_principled():
    obj = C.get_obj("muscle", "Plastyma")
    if not obj:
        return
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        p = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if p and "Base Color" in p.inputs and not p.inputs["Base Color"].is_linked:
            p.inputs["Base Color"].default_value = (0.69, 0.69, 0.70, 1.0)


def recolor_occiput_green_to_purple():
    """Occipitofrontalis shares Deform albedo: face remap turns both bellies green.
    Base15 paints the occipital belly purple. Recolor texels mostly used by back-facing polys."""
    total = 0
    stamp = 8
    for obj in C.mesh_objects(C.objects_in_group("muscle")):
        nlow = obj.name.lower()
        if any(k in nlow for k in ("static", "plastyma", "platysma", "acs", "melns")):
            continue
        if not obj.data.uv_layers:
            continue
        imgs = unique_images_from_obj(obj)
        if not imgs:
            continue
        img = imgs[0]
        arr = image_to_np(img)
        h, w = arr.shape[:2]
        uv_layer = obj.data.uv_layers.active.data
        mw3 = obj.matrix_world.to_3x3()
        back_w = np.zeros((h, w), dtype=np.float32)
        front_w = np.zeros((h, w), dtype=np.float32)
        for poly in obj.data.polygons:
            n = mw3 @ poly.normal
            if n.length < 1e-8:
                continue
            n.normalize()
            back = n.y > 0.05
            for li in poly.loop_indices:
                u, v = uv_layer[li].uv
                x = int(np.clip((u % 1.0) * (w - 1), 0, w - 1))
                y = int(np.clip((v % 1.0) * (h - 1), 0, h - 1))
                y0, y1 = max(0, y - stamp), min(h, y + stamp + 1)
                x0, x1 = max(0, x - stamp), min(w, x + stamp + 1)
                if back:
                    back_w[y0:y1, x0:x1] += 1.0
                else:
                    front_w[y0:y1, x0:x1] += 1.0
        use_back = back_w > front_w
        if not use_back.any():
            continue
        hsv = rgb_to_hsv_np(arr[..., :3])
        sel = use_back & (hsv[..., 1] > 0.04) & (hsv[..., 0] > 0.10) & (hsv[..., 0] < 0.52)
        nsel = int(sel.sum())
        if nsel < 20:
            continue
        arr[..., :3] = apply_hue(arr[..., :3], sel, 0.78, 0.92)
        np_to_image(img, arr)
        img.pack()
        total += nsel
        print(f"[recolor] occiput green->purple {obj.name} pixels={nsel}")
    print(f"[recolor] occiput total pixels={total}")


def process_named(substr: str, mode: str, dump_prefix: str):
    obj = C.get_obj("muscle", substr)
    if not obj:
        print(f"[Q1] missing {substr}")
        return
    for img in unique_images_from_obj(obj):
        if not img.has_data:
            try:
                img.reload()
            except Exception:
                pass
        arr = image_to_np(img)
        raw_path = C.TEXTURES / f"{dump_prefix}_{img.name}_raw.png"
        try:
            save_png(img, raw_path)
        except Exception as e:
            print(f"[Q1] save raw skip {img.name}: {e}")
        rem = remap_array(arr, mode)
        np_to_image(img, rem)
        out_path = C.TEXTURES / f"{dump_prefix}_{img.name}_base15.png"
        try:
            save_png(img, out_path)
        except Exception as e:
            print(f"[Q1] save remap skip {img.name}: {e}")
        print(f"[Q1] remapped {obj.name} / {img.name} mode={mode}")


def side_by_side_notes():
    C.write_notes(
        C.STAGES / "Q1",
        "# Q1 recolor\n\n- Face albedo hue buckets -> Base15 palette (keep value/fiber).\n- Eyes: dark brown iris, black pupil.\n- Neck/platysma toward cool gray.\n",
    )


def main():
    C.ensure_dirs(C.STAGES / "Q1", C.TEXTURES, C.CHECKPOINTS)
    bpy.ops.wm.open_mainfile(filepath=str(C.CHECKPOINTS / "Q0_baseline.blend"))

    process_named("Static", "face", "static")
    process_named("Deform", "face", "deform")
    process_named("Skiedras", "face", "skiedras")
    process_named("Plastyma", "neck", "plastyma")
    process_named("Acs", "eye", "eye")
    darken_eye_principled()
    gray_plastyma_principled()

    C.set_group_visibility("skull", False)
    C.render_views(C.STAGES / "Q1", C.muscle_exportable(), "muscle", res=900)
    C.set_group_visibility("skull", True)

    C.save_blend(C.CHECKPOINTS / "Q1_recolor.blend")
    side_by_side_notes()
    print("[Q1] done")


if __name__ == "__main__":
    main()
