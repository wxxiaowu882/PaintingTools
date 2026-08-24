# -*- coding: utf-8 -*-
"""Dump ortho camera matrices used by compare renders (no image write)."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common as C  # noqa: E402

TAG = "SHELL_v8"
for arg in reversed(sys.argv):
    if arg.startswith("SHELL_"):
        TAG = arg
        break
BLEND = C.CHECKPOINTS / f"{TAG}.blend"
OUT = C.WORK / "compare_review" / "ours" / TAG / "camera_meta.json"
RES = 1600


def cam_pack(cam, flip_h: bool) -> dict:
    inv = cam.matrix_world.inverted()
    return {
        "ortho_scale": float(cam.data.ortho_scale),
        "flip_h": flip_h,
        "res": RES,
        "aspect": 1.0,
        "inv": [inv[i][j] for i in range(4) for j in range(4)],
        "location": list(cam.location),
    }


def main() -> None:
    if not BLEND.exists():
        raise FileNotFoundError(BLEND)
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    C.hide_aux_skull()
    for o in C.mesh_objects(C.objects_in_group("muscle")):
        if "Melns" in o.name or "pCylinder" in o.name:
            o.hide_render = True
    C.set_group_visibility("skull", False)
    muscles = C.muscle_exportable()
    C.configure_eevee(RES)
    meta = {"candidate": TAG, "padding": 1.10}
    for name, yaw, pitch in C.VIEW_SPECS_PRIMARY:
        for obj in list(bpy.data.objects):
            if obj.type in {"CAMERA", "LIGHT"}:
                bpy.data.objects.remove(obj, do_unlink=True)
        cam = C.setup_camera_for_objs(muscles, yaw, pitch)
        meta[name] = cam_pack(cam, flip_h=(name == "side"))
        print(f"[camera] {name} ortho={cam.data.ortho_scale:.4f}")
    C.write_json(OUT, meta)
    print(f"[write] {OUT}")


if __name__ == "__main__":
    main()
