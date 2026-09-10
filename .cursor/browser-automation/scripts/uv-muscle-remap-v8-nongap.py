#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""UV+左右 + 避开 V8 灰缝/头皮色，吸附到肌腹。"""
from __future__ import annotations

import json
import math
import struct
import time
from collections import defaultdict
from pathlib import Path

from PIL import Image

REPO = Path(r"d:/Git仓库位置/PaintingTools")
SRC_JSON = REPO / "docs/json/结构_头骨骨点肌肉/03 肌肉详解.json"
OUT_JSON = REPO / "docs/json/结构_头骨骨点肌肉/03 肌肉详解_黄种人女V8.json"
EURO_GLB = REPO / ".cursor/browser-automation/runs/_tmp_euro_decode.glb"
V8_GLB = REPO / ".cursor/browser-automation/runs/_tmp_v8_decode.glb"
V8_TEX = REPO / ".cursor/browser-automation/runs/_v8_tex/img_6.png"
NEW_MODEL_SRC = "../docs/model/头部肌肉_黄种人_女_V8_std_opt_20260905111512.glb"


def load_glb(path: Path):
    buf = path.read_bytes()
    n = struct.unpack_from("<I", buf, 12)[0]
    return json.loads(buf[20 : 20 + n]), memoryview(buf)[20 + n + 8 :]


def accessor_data(gltf, blob, acc_i):
    acc = gltf["accessors"][acc_i]
    bv = gltf["bufferViews"][acc["bufferView"]]
    start = (bv.get("byteOffset") or 0) + (acc.get("byteOffset") or 0)
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    ctype = acc["componentType"]
    fmt, nbytes = {5126: ("f", 4), 5121: ("B", 1), 5123: ("H", 2)}[ctype]
    stride = bv.get("byteStride") or comps * nbytes
    out = []
    for i in range(acc["count"]):
        o = start + i * stride
        out.append(list(struct.unpack_from("<" + fmt * comps, blob, o)))
    return out


def mat_mul(a, b):
    o = [0.0] * 16
    for r in range(4):
        for c in range(4):
            o[c * 4 + r] = sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
    return o


def trs_to_mat(n):
    if "matrix" in n:
        return list(n["matrix"])
    t = n.get("translation") or [0, 0, 0]
    r = n.get("rotation") or [0, 0, 0, 1]
    s = n.get("scale") or [1, 1, 1]
    x, y, z, w = r
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    rm = [
        1 - 2 * (yy + zz),
        2 * (xy + wz),
        2 * (xz - wy),
        0,
        2 * (xy - wz),
        1 - 2 * (xx + zz),
        2 * (yz + wx),
        0,
        2 * (xz + wy),
        2 * (yz - wz),
        1 - 2 * (xx + yy),
        0,
        0,
        0,
        0,
        1,
    ]
    sm = [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1]
    tm = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1]
    return mat_mul(tm, mat_mul(rm, sm))


def world_mats(gltf):
    nodes = gltf["nodes"]
    children = {i: [] for i in range(len(nodes))}
    roots = set(gltf["scenes"][gltf.get("scene", 0)]["nodes"])
    for i, n in enumerate(nodes):
        for c in n.get("children") or []:
            children[i].append(c)
    worlds = [None] * len(nodes)

    def walk(i, parent):
        local = trs_to_mat(nodes[i])
        worlds[i] = mat_mul(parent, local) if parent else local
        for c in children.get(i, []):
            walk(c, worlds[i])

    for r in roots:
        walk(r, None)
    return worlds


def xform(m, p, is_dir=False):
    x, y, z = p
    if is_dir:
        return [
            m[0] * x + m[4] * y + m[8] * z,
            m[1] * x + m[5] * y + m[9] * z,
            m[2] * x + m[6] * y + m[10] * z,
        ]
    w = m[3] * x + m[7] * y + m[11] * z + m[15]
    return [
        (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
        (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
        (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
    ]


def load_deform(path: Path):
    gltf, blob = load_glb(path)
    W = world_mats(gltf)
    for i, n in enumerate(gltf["nodes"]):
        if "mesh" not in n:
            continue
        mesh = gltf["meshes"][n["mesh"]]
        name = n.get("name") or mesh.get("name") or ""
        if "Deform" not in name:
            continue
        prim = mesh["primitives"][0]
        pos = accessor_data(gltf, blob, prim["attributes"]["POSITION"])
        nrm = accessor_data(gltf, blob, prim["attributes"]["NORMAL"])
        uv = accessor_data(gltf, blob, prim["attributes"]["TEXCOORD_0"])
        m = W[i]
        wpos = [xform(m, p) for p in pos]
        wnrm = []
        for v in nrm:
            d = xform(m, v, True)
            L = math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2) or 1
            wnrm.append([d[0] / L, d[1] / L, d[2] / L])
        return {"pos": wpos, "nrm": wnrm, "uv": uv}
    raise RuntimeError("no deform")


def parse_vec(s):
    return [float(x.replace("m", "")) for x in s.split()]


def fmt_vec(v):
    return f"{v[0]:.4f}m {v[1]:.4f}m {v[2]:.4f}m"


def dist3(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def sample_rgb(img, uv):
    bg = (175, 175, 175)
    best = None
    u, v = uv
    for flip in (True, False):
        x = int(max(0, min(1023, round((u % 1) * 1023))))
        y = int(max(0, min(1023, round(((1 - (v % 1)) if flip else (v % 1)) * 1023))))
        rgb = img.getpixel((x, y))
        sat = max(rgb) - min(rgb)
        score = sat * 2 + abs(rgb[0] - bg[0]) + abs(rgb[1] - bg[1]) + abs(rgb[2] - bg[2])
        if best is None or score > best[0]:
            best = (score, rgb)
    return best[1], best[0]


def is_gap_color(rgb):
    r, g, b = rgb
    sat = max(rgb) - min(rgb)
    if sat < 28:
        return True
    if abs(r - g) < 25 and abs(g - b) < 25 and abs(r - b) < 25 and 150 < r < 210:
        return True
    if r > 160 and b > 160 and g < r - 10 and abs(r - b) < 30 and sat < 50:
        return True
    return False


def main():
    src = json.loads(SRC_JSON.read_text(encoding="utf-8"))
    out = json.loads(OUT_JSON.read_text(encoding="utf-8"))
    euro = load_deform(EURO_GLB)
    v8 = load_deform(V8_GLB)
    img = Image.open(V8_TEX).convert("RGB")

    v8_rgb = []
    v8_score = []
    for uv in v8["uv"]:
        rgb, sc = sample_rgb(img, uv)
        v8_rgb.append(rgb)
        v8_score.append(sc)

    res = 128
    grid = defaultdict(list)
    for i, (u, v) in enumerate(v8["uv"]):
        grid[(int(u * res) % res, int(v * res) % res)].append(i)

    def uv_cands(u, v, max_uv=0.02):
        gu, gv = int(u * res) % res, int(v * res) % res
        seen = {}
        for rad in range(0, 8):
            for du in range(-rad, rad + 1):
                for dv in range(-rad, rad + 1):
                    if max(abs(du), abs(dv)) != rad and rad > 0:
                        continue
                    for j in grid[((gu + du) % res, (gv + dv) % res)]:
                        d = math.hypot(v8["uv"][j][0] - u, v8["uv"][j][1] - v)
                        if d <= max_uv and j not in seen:
                            seen[j] = d
            if len(seen) >= 500:
                break
        return list(seen.items())

    by = {p["text"]: p for p in out["pointsData"]}
    results = []
    for sp in src["pointsData"]:
        text = sp["text"]
        spos = parse_vec(sp["pos"])
        snorm = parse_vec(sp["norm"])
        ei = min(
            range(len(euro["pos"])),
            key=lambda i: (euro["pos"][i][0] - spos[0]) ** 2
            + (euro["pos"][i][1] - spos[1]) ** 2
            + (euro["pos"][i][2] - spos[2]) ** 2,
        )
        u, v = euro["uv"][ei]
        cands = uv_cands(u, v)
        if not cands:
            results.append({"text": text, "ok": False})
            continue

        best = None
        for j, uvd in cands:
            p = v8["pos"][j]
            rgb = v8_rgb[j]
            side_pen = 0.0
            if abs(spos[0]) > 0.01 and spos[0] * p[0] < 0:
                side_pen += 0.05
            if text != "枕肌" and p[2] < -0.08:
                side_pen += 0.08
            if text == "枕肌" and p[2] > 0.02:
                side_pen += 0.08
            gap_pen = 0.06 if is_gap_color(rgb) else 0.0
            vivid = v8_score[j] / 400.0
            spatial = dist3(p, spos)
            score = spatial + side_pen + gap_pen + uvd * 0.4 - vivid * 0.015
            if best is None or score < best[0]:
                best = (score, j)

        j = best[1]
        if is_gap_color(v8_rgb[j]):
            target = v8["pos"][j]
            local = None
            for k, p in enumerate(v8["pos"]):
                if dist3(p, target) > 0.028:
                    continue
                if abs(spos[0]) > 0.01 and spos[0] * p[0] < 0:
                    continue
                if is_gap_color(v8_rgb[k]):
                    continue
                d = dist3(p, spos)
                sc = d - v8_score[k] / 500.0
                if local is None or sc < local[0]:
                    local = (sc, k)
            if local:
                j = local[1]

        pos = v8["pos"][j]
        nrm = list(v8["nrm"][j])
        if nrm[0] * snorm[0] + nrm[1] * snorm[1] + nrm[2] * snorm[2] < 0:
            nrm = [-nrm[0], -nrm[1], -nrm[2]]
        L = math.sqrt(nrm[0] ** 2 + nrm[1] ** 2 + nrm[2] ** 2) or 1
        nrm = [nrm[0] / L, nrm[1] / L, nrm[2] / L]
        if text != "枕肌" and nrm[2] < 0 and pos[2] > 0.05 and abs(nrm[2]) > 0.3:
            nrm = [-nrm[0], -nrm[1], -nrm[2]]

        by[text]["pos"] = fmt_vec(pos)
        by[text]["norm"] = fmt_vec(nrm)
        results.append(
            {
                "text": text,
                "ok": True,
                "rgb": list(v8_rgb[j]),
                "gap": is_gap_color(v8_rgb[j]),
                "pos": by[text]["pos"],
                "spatial": round(dist3(pos, spos), 4),
            }
        )

    out["modelSrc"] = NEW_MODEL_SRC
    out["timestamp"] = int(time.time() * 1000)
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote", OUT_JSON)
    for r in results:
        print(
            f"{r['text']:12s} gap={r.get('gap')} rgb={r.get('rgb')} spat={r.get('spatial')} {r.get('pos')}"
        )


if __name__ == "__main__":
    main()
