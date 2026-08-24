# -*- coding: utf-8 -*-
"""Shared helpers for Base15 quality rebuild (work_v4)."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(r"D:\Git仓库位置\PaintingTools\自用工具文件_不部署\篡改猴\亚洲头部肌肉模型")
WORK = ROOT / "work_v4"
STAGES = WORK / "stages"
CHECKPOINTS = WORK / "checkpoints"
TEXTURES = WORK / "textures"
SKULL_GLB = ROOT / "头骨_20260324184350_opt_std.glb"
MUSCLE_GLB = ROOT / "参考用_欧洲人头部肌肉_20260324204416_opt.glb"
BLEND_FINAL = WORK / "asian_head_muscles_base15.blend"
GLB_FINAL = WORK / "asian_head_muscles_base15.glb"

# 主审三视：正 / 侧 / 背 —— 大型比例验收唯一依据
VIEW_SPECS_PRIMARY = [
    ("front", 0.0, 0.0),
    ("side", -90.0, 0.0),
    ("back", 180.0, 0.0),
]
# 辅助参考（相机角与 Base15 画稿未必一致，不对大型比例作硬结论）
VIEW_SPECS_AUX = [
    ("front_three_quarter", 40.0, 12.0),
    ("rear_three_quarter", -140.0, 12.0),
]
VIEW_SPECS = VIEW_SPECS_PRIMARY + VIEW_SPECS_AUX


def ensure_dirs(*paths: Path) -> None:
    for p in paths:
        p.mkdir(parents=True, exist_ok=True)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll_name in ("meshes", "materials", "images", "cameras", "lights", "lattices"):
        blocks = getattr(bpy.data, coll_name, None)
        if blocks is None:
            continue
        for block in list(blocks):
            if getattr(block, "users", 1) == 0:
                blocks.remove(block)


def import_glb(path: Path, collection_name: str) -> list:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = [o for o in bpy.data.objects if o not in before]
    coll = bpy.data.collections.get(collection_name)
    if coll is None:
        coll = bpy.data.collections.new(collection_name)
        bpy.context.scene.collection.children.link(coll)
    for obj in imported:
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        coll.objects.link(obj)
        obj["asset_group"] = collection_name
    return imported


def mesh_objects(objs=None):
    if objs is None:
        objs = bpy.data.objects
    return [o for o in objs if o.type == "MESH"]


def objects_in_group(group: str):
    return [o for o in bpy.data.objects if o.get("asset_group") == group]


def get_obj(group: str, substr: str):
    for obj in mesh_objects(objects_in_group(group)):
        if substr.lower() in obj.name.lower():
            return obj
    return None


def world_bbox(objs):
    mins = Vector((1e18, 1e18, 1e18))
    maxs = Vector((-1e18, -1e18, -1e18))
    found = False
    for obj in mesh_objects(objs):
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            mins = Vector((min(mins.x, w.x), min(mins.y, w.y), min(mins.z, w.z)))
            maxs = Vector((max(maxs.x, w.x), max(maxs.y, w.y), max(maxs.z, w.z)))
            found = True
    if not found:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    return mins, maxs


def bbox_center_size(objs):
    mins, maxs = world_bbox(objs)
    return (mins + maxs) * 0.5, (maxs - mins)


def apply_object_transforms(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
    if objs:
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        bpy.ops.object.select_all(action="DESELECT")


def parent_empty(name: str, objs):
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "PLAIN_AXES"
    bpy.context.scene.collection.objects.link(empty)
    empty["asset_group"] = objs[0].get("asset_group") if objs else name
    for obj in objs:
        obj.parent = empty
        obj.matrix_parent_inverse = empty.matrix_world.inverted()
    return empty


def set_group_visibility(group: str, visible: bool):
    for obj in objects_in_group(group):
        obj.hide_render = not visible
        obj.hide_viewport = not visible


def hide_aux_skull():
    for obj in objects_in_group("skull"):
        if "aux" in obj.name.lower():
            obj.hide_viewport = True
            obj.hide_render = True
            obj.hide_set(True)


def make_skull_transparent(alpha: float = 0.28):
    for obj in mesh_objects(objects_in_group("skull")):
        if "aux" in obj.name.lower():
            continue
        for slot in obj.material_slots:
            mat = slot.material
            if not mat:
                continue
            mat.use_nodes = True
            principled = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if principled and "Alpha" in principled.inputs:
                principled.inputs["Alpha"].default_value = alpha
            if "Base Color" in principled.inputs:
                principled.inputs["Base Color"].default_value = (0.75, 0.78, 0.82, 1.0)
            mat.blend_method = "BLEND"


def setup_compositor_white_bg():
    """Transparent film; exact #FFF via alpha composite in finalize_compare_png."""
    scene = bpy.context.scene
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.use_compositing = False


def whiten_png_background(path: Path, tol: float = 32.0):
    """Ensure corner/empty pixels are #FFFFFF (same contract as Base15 PNGs)."""
    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        print(f"[warn] whiten skip (no PIL): {path}")
        return
    im = Image.open(path).convert("RGB")
    arr = np.array(im)
    corners = np.array([arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]], dtype=np.float32)
    bg = np.median(corners, axis=0)
    dist = np.linalg.norm(arr.astype(np.float32) - bg, axis=2)
    arr[dist < tol] = (255, 255, 255)
    Image.fromarray(arr).save(path)


def finalize_compare_png(path: Path, flip_h: bool = False):
    import shutil
    import subprocess

    py = shutil.which("python") or shutil.which("python3")
    script = Path(__file__).resolve().parent / "whiten_png_background.py"
    if py and script.exists():
        try:
            cmd = [py, str(script)]
            if flip_h:
                cmd.append("--flip")
            cmd.append(str(path))
            subprocess.run(cmd, check=True)
            return
        except subprocess.CalledProcessError as e:
            print(f"[warn] whiten subprocess failed: {e}")
    whiten_png_background(path)


def setup_world_gray(strength: float = 1.0, level: float = 0.745):
    """Gray world — mesh gaps render as static-like gray, not white holes."""
    scene = bpy.context.scene
    world = bpy.data.worlds.new("WorldGray")
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    g = level
    bg.inputs[0].default_value = (g, g * 0.993, g * 0.978, 1)
    bg.inputs[1].default_value = strength


def setup_world_white(strength: float = 1.0):
    scene = bpy.context.scene
    world = bpy.data.worlds.new("WorldWhite")
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = strength
    # film_transparent set in setup_compositor_white_bg


def configure_color_management():
    """Filmic + exposure tuned to Base15 fg levels."""
    scene = bpy.context.scene
    vs = scene.view_settings
    vs.view_transform = "Filmic"
    vs.look = "None"
    vs.exposure = -0.97
    vs.gamma = 1.0


def darken_static_albedo(max_v: float = 0.68):
    """Pull Static bright/white albedo toward Base15-like gray underlay."""
    try:
        import numpy as np
        import q1_recolor as R
    except ImportError as e:
        print(f"[warn] darken_static_albedo skip: {e}")
        return
    static = get_obj("muscle", "Static")
    if not static:
        return
    tgt = np.array([0.745, 0.738, 0.732], dtype=np.float32)
    for img in R.unique_images_from_obj(static):
        arr = R.image_to_np(img)
        rgb = arr[..., :3].copy()
        hsv = R.rgb_to_hsv_np(rgb)
        bright = (hsv[..., 2] > max_v) | ((hsv[..., 1] < 0.22) & (hsv[..., 2] > 0.42))
        rgb[bright] = tgt
        hsv = R.rgb_to_hsv_np(rgb)
        hsv[..., 2] = np.minimum(hsv[..., 2], 0.70)
        rgb = R.hsv_to_rgb_np(hsv)
        out = np.concatenate([np.clip(rgb, 0, 1), arr[..., 3:4]], axis=-1).astype(np.float32)
        R.np_to_image(img, out)
        img.pack()
    print("[render] darken_static_albedo done")


def dampen_compare_normals(strength: float = 0.45):
    """Keep muscle fiber readable; platysma normals cause neck spikes."""
    for obj in muscle_exportable():
        n_strength = 0.05 if "plastyma" in obj.name.lower() or "platysma" in obj.name.lower() else strength
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            for n in mat.node_tree.nodes:
                if n.type == "NORMAL_MAP" and "Strength" in n.inputs:
                    n.inputs["Strength"].default_value = n_strength
                if n.type == "BUMP" and "Strength" in n.inputs:
                    n.inputs["Strength"].default_value = n_strength * 0.5


def flatten_solid_principled(obj, gray, unlink_normal: bool = True):
    """Unlit-looking solid gray: drop albedo/alpha (and optional normal) links."""
    if not obj:
        return
    for slot in obj.material_slots:
        mat = slot.material
        if not mat:
            continue
        if not mat.use_nodes:
            mat.use_nodes = True
        nt = mat.node_tree
        p = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not p:
            continue
        drop = {"base color", "alpha"}
        if unlink_normal:
            drop.add("normal")
        for link in list(nt.links):
            sock = (link.to_socket.name or "").lower()
            if link.to_node == p and sock in drop:
                nt.links.remove(link)
        p.inputs["Base Color"].default_value = gray
        if "Roughness" in p.inputs:
            p.inputs["Roughness"].default_value = 0.62
        for key in ("Specular IOR Level", "Specular"):
            if key in p.inputs:
                p.inputs[key].default_value = 0.18


def assign_static_occipital_purple():
    """Back view: Base15 shows large purple occipital patches; Euro Static is all gray."""
    static = get_obj("muscle", "Static")
    if not static or not static.data.polygons:
        return
    purple_name = "StaticOccipital"
    purple = bpy.data.materials.get(purple_name) or bpy.data.materials.new(purple_name)
    purple.use_nodes = True
    p = next((n for n in purple.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not p:
        return
    for link in list(purple.node_tree.links):
        if link.to_node == p and (link.to_socket.name or "").lower() in ("base color", "alpha", "normal"):
            purple.node_tree.links.remove(link)
    # Base15 occipital purple ≈ sampled temporalis band
    p.inputs["Base Color"].default_value = (0.58, 0.50, 0.65, 1.0)
    if "Roughness" in p.inputs:
        p.inputs["Roughness"].default_value = 0.55
    for key in ("Specular IOR Level", "Specular"):
        if key in p.inputs:
            p.inputs[key].default_value = 0.22

    if len(static.data.materials) < 2:
        static.data.materials.append(purple)
    else:
        static.data.materials[1] = purple

    mins, maxs = world_bbox([static])
    cz = (mins.z + maxs.z) * 0.5
    z_band = (maxs.z - mins.z) * 0.22
    mw = static.matrix_world
    n_purple = 0
    for poly in static.data.polygons:
        center = Vector((0.0, 0.0, 0.0))
        for vi in poly.vertices:
            center += static.data.vertices[vi].co
        center /= len(poly.vertices)
        wc = mw @ center
        wn = (mw.to_3x3() @ poly.normal).normalized()
        occ = wn.y > 0.18 and wc.z > cz - z_band and wc.z < cz + (maxs.z - mins.z) * 0.35
        poly.material_index = 1 if occ else 0
        if occ:
            n_purple += 1
    print(f"[render] static occipital purple polys={n_purple}")


def flatten_static_shader(gray=(0.20, 0.215, 0.205, 1.0)):
    """Solid gray underlay (slightly green-gray ≈ Base15 forehead). Keep Static normals; drop platysma normals."""
    static = get_obj("muscle", "Static")
    if static:
        if not static.material_slots:
            static.data.materials.append(bpy.data.materials.new("Static"))
        mat = static.material_slots[0].material
        if mat:
            if not mat.use_nodes:
                mat.use_nodes = True
            nt = mat.node_tree
            p = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if p:
                for link in list(nt.links):
                    sock = (link.to_socket.name or "").lower()
                    if link.to_node == p and sock in ("base color", "alpha"):
                        nt.links.remove(link)
                p.inputs["Base Color"].default_value = gray
                if "Roughness" in p.inputs:
                    p.inputs["Roughness"].default_value = 0.62
                for key in ("Specular IOR Level", "Specular"):
                    if key in p.inputs:
                        p.inputs[key].default_value = 0.18
        assign_static_occipital_purple()
    flatten_solid_principled(get_obj("muscle", "Plastyma"), (0.18, 0.18, 0.185, 1.0), unlink_normal=True)


def prepare_compare_materials():
    """Static/neck visible on white bg — Base15 has gray underlay, not white holes."""
    dampen_compare_normals()
    try:
        import q1_recolor as R

        R.darken_eye_principled()
        R.gray_plastyma_principled()
    except Exception as e:
        print(f"[warn] eye/neck material prep: {e}")
    flatten_static_shader()


def prepare_compare_render(recolor: bool = False):
    """Transparent film + solid Static gray; alpha composite to #FFF (do not flood-eat gray)."""
    configure_color_management()
    setup_world_white(1.0)
    setup_compositor_white_bg()
    prepare_compare_materials()
    if not recolor:
        return
    try:
        import q8_base_profile as Q8

        Q8.force_recolor()
    except Exception as e:
        print(f"[warn] force_recolor skipped: {e}")


def setup_lighting(objs=None, yaw_deg: float = 0.0, back_boost: bool = False):
    """Key/fill/rim in camera space so back/side get the same shading as front."""
    center = Vector((0, 0, 0))
    if objs:
        center, _ = bbox_center_size(objs)
    yaw = math.radians(yaw_deg)
    cy, sy = math.cos(yaw), math.sin(yaw)

    def rot_xy(x, y, z):
        return Vector((x * cy - y * sy, x * sy + y * cy, z))

    # Front/side: Base fg mean ~138; back is brighter (~161) so extra key/fill.
    rim_e, fill_e, key_e = (58, 20, 115) if back_boost else (30, 6, 64)
    for name, loc, energy in [
        ("Key", (1.2, -1.6, 1.4), key_e),
        ("Fill", (-1.4, -0.8, 0.9), fill_e),
        ("Rim", (0.2, 1.8, 1.0), rim_e),
    ]:
        light_data = bpy.data.lights.new(name=name, type="AREA")
        light_data.energy = energy
        light_data.size = 0.70
        light_obj = bpy.data.objects.new(name, light_data)
        bpy.context.scene.collection.objects.link(light_obj)
        light_obj.location = center + rot_xy(*loc)
        aim = center - light_obj.location
        if aim.length > 1e-8:
            light_obj.rotation_euler = aim.to_track_quat("-Z", "Y").to_euler()


def _projected_bbox_spans(cam, objs):
    mins, maxs = world_bbox(objs)
    corners = [
        Vector((mins.x, mins.y, mins.z)),
        Vector((maxs.x, mins.y, mins.z)),
        Vector((mins.x, maxs.y, mins.z)),
        Vector((maxs.x, maxs.y, mins.z)),
        Vector((mins.x, mins.y, maxs.z)),
        Vector((maxs.x, mins.y, maxs.z)),
        Vector((mins.x, maxs.y, maxs.z)),
        Vector((maxs.x, maxs.y, maxs.z)),
    ]
    inv = cam.matrix_world.inverted()
    min_x = min_y = 1e18
    max_x = max_y = -1e18
    for corner in corners:
        p = inv @ corner
        min_x = min(min_x, p.x)
        max_x = max(max_x, p.x)
        min_y = min(min_y, p.y)
        max_y = max(max_y, p.y)
    return max_x - min_x, max_y - min_y


def setup_camera_for_objs(objs, yaw_deg: float, pitch_deg: float, padding: float = 1.10):
    """Orthographic stage camera — matches Base15 design (no perspective)."""
    center, size = bbox_center_size(objs)
    extent = max(size.x, size.y, size.z, 1e-6)
    dist = extent * 2.2
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    offset = Vector(
        (
            dist * math.sin(yaw) * math.cos(pitch),
            -dist * math.cos(yaw) * math.cos(pitch),
            dist * math.sin(pitch) + extent * 0.04,
        )
    )
    cam_data = bpy.data.cameras.new("StageCam")
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.001
    cam_data.clip_end = 1000
    cam = bpy.data.objects.new("StageCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = center + offset
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    # Fixed ortho scale (do NOT refit per view) so align.json matches across views / Base15.
    cam_data.ortho_scale = extent * padding
    bpy.context.scene.camera = cam
    return cam


def projected_frame_norm(cam, objs):
    """Map object world bbox into normalized 0-1 render UV (top-left origin)."""
    bpy.context.view_layer.update()
    mins, maxs = world_bbox(objs)
    corners = [
        Vector((mins.x, mins.y, mins.z)),
        Vector((maxs.x, mins.y, mins.z)),
        Vector((mins.x, maxs.y, mins.z)),
        Vector((maxs.x, maxs.y, mins.z)),
        Vector((mins.x, mins.y, maxs.z)),
        Vector((maxs.x, mins.y, maxs.z)),
        Vector((mins.x, maxs.y, maxs.z)),
        Vector((maxs.x, maxs.y, maxs.z)),
    ]
    inv = cam.matrix_world.inverted()
    xs = []
    ys = []
    for corner in corners:
        p = inv @ corner
        xs.append(p.x)
        ys.append(p.y)
    scene = bpy.context.scene
    aspect = scene.render.resolution_x / max(scene.render.resolution_y, 1)
    ortho = cam.data.ortho_scale
    half_h = ortho / 2.0
    half_w = half_h * aspect
    us = []
    vs = []
    for px, py in zip(xs, ys):
        us.append((px + half_w) / max(2.0 * half_w, 1e-8))
        vs.append((half_h - py) / max(2.0 * half_h, 1e-8))
    left = min(us)
    right = max(us)
    top = min(vs)
    bottom = max(vs)
    return {
        "left": left,
        "right": right,
        "top": top,
        "bottom": bottom,
        "cx": (left + right) * 0.5,
        "cy": (top + bottom) * 0.5,
        "span": bottom - top,
        "w": right - left,
        "h": bottom - top,
    }


def render_side_only(objs, path: Path, res: int = 900):
    """Fast side probe for proportion sweep (primary review view only)."""
    ensure_dirs(path.parent)
    configure_eevee(res)
    prepare_compare_render()
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    side_yaw = next(y for n, y, _ in VIEW_SPECS if n == "side")
    setup_lighting(objs, yaw_deg=side_yaw)
    for obj in list(bpy.data.objects):
        if obj.type == "CAMERA":
            bpy.data.objects.remove(obj, do_unlink=True)
    cam = setup_camera_for_objs(objs, side_yaw, 0.0)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    base_ref = WORK / "compare_review" / "base15" / "side.png"
    finalize_compare_png(path, flip_h=True)
    print(f"[render:side] {path}")
    return cam


def render_views(out_dir: Path, objs, prefix: str, res: int = 1024):
    ensure_dirs(out_dir)
    configure_eevee(res)
    prepare_compare_render()
    paths = []
    align = {}
    for name, yaw, pitch in VIEW_SPECS:
        for obj in list(bpy.data.objects):
            if obj.type in {"CAMERA", "LIGHT"}:
                bpy.data.objects.remove(obj, do_unlink=True)
        setup_lighting(objs, yaw_deg=yaw, back_boost=(name == "back"))
        cam = setup_camera_for_objs(objs, yaw, pitch)
        align[name] = projected_frame_norm(cam, objs)
        out = out_dir / f"{prefix}_{name}.png"
        bpy.context.scene.render.filepath = str(out)
        bpy.ops.render.render(write_still=True)
        finalize_compare_png(out, flip_h=(name == "side"))
        paths.append(out)
        print(f"[render] {out}")
    write_json(out_dir / "align.json", align)
    return paths


def configure_eevee(res: int = 1024):
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            scene.render.engine = engine
            break
        except Exception:
            continue
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    configure_color_management()
    for attr in ("eevee", "eevee_next"):
        ev = getattr(scene, attr, None)
        if ev is None:
            continue
        if hasattr(ev, "use_gtao"):
            ev.use_gtao = True
        if hasattr(ev, "gtao_distance"):
            ev.gtao_distance = 0.25
        if hasattr(ev, "gtao_factor"):
            ev.gtao_factor = 1.2
        break


def save_blend(path: Path):
    ensure_dirs(path.parent)
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    print(f"[save] {path}")


def export_glb(path: Path, objs):
    ensure_dirs(path.parent)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )
    print(f"[export] {path}")


def write_notes(stage_dir: Path, text: str):
    ensure_dirs(stage_dir)
    (stage_dir / "notes.md").write_text(text, encoding="utf-8")


def write_json(path: Path, data):
    ensure_dirs(path.parent)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def muscle_exportable():
    out = []
    for o in mesh_objects(objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            continue
        if o.hide_render:
            continue
        out.append(o)
    return out


def visible_skull_muscle():
    out = []
    for o in mesh_objects():
        g = o.get("asset_group")
        if g == "muscle" and not o.hide_render and "Melns" not in o.name and "pCylinder" not in o.name:
            out.append(o)
        elif g == "skull" and "aux" not in o.name.lower():
            out.append(o)
    return out


def assert_head_scale(objs, min_width=0.12, tag="scale"):
    _, size = bbox_center_size(objs)
    print(f"[{tag}] size={tuple(round(x, 4) for x in size)}")
    if size.x < min_width:
        raise RuntimeError(f"{tag}: mesh too small width={size.x}")


def fix_normals(objs):
    for obj in objs:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode="OBJECT")
