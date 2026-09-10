#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按 Deform 贴图颜色把标注贴回对应肌肉：
1) 原版每个点 → 最近 Deform 顶点 → UV 采样颜色（肌肉 ID）
2) V8 上找同色顶点，优先靠近「相对口轮匝肌的解剖偏移」目标
3) 写回 03 肌肉详解_黄种人女V8.json（不覆盖原版）
"""
from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path

from PIL import Image

REPO = Path(r"d:/Git仓库位置/PaintingTools")
SRC_JSON = REPO / "docs/json/结构_头骨骨点肌肉/03 肌肉详解.json"
OUT_JSON = REPO / "docs/json/结构_头骨骨点肌肉/03 肌肉详解_黄种人女V8.json"
EURO_GLB = REPO / ".cursor/browser-automation/runs/_tmp_euro_decode.glb"
V8_GLB = REPO / ".cursor/browser-automation/runs/_tmp_v8_decode.glb"
EURO_TEX = REPO / ".cursor/browser-automation/runs/_euro_tex/img_2.png"  # Deform_Col
V8_TEX = REPO / ".cursor/browser-automation/runs/_v8_tex/img_6.png"
REPORT = REPO / ".cursor/browser-automation/runs/_muscle-color-remap-report.json"

NEW_MODEL_SRC = "../docs/model/头部肌肉_黄种人_女_V8_std_opt_20260905111512.glb"


def load_glb(path: Path):
    buf = path.read_bytes()
    json_len = struct.unpack_from("<I", buf, 12)[0]
    gltf = json.loads(buf[20 : 20 + json_len])
    bin_start = 20 + json_len + 8
    blob = memoryview(buf)[bin_start:]
    return gltf, blob


def accessor_data(gltf, blob, acc_i):
    acc = gltf["accessors"][acc_i]
    bv = gltf["bufferViews"][acc["bufferView"]]
    start = (bv.get("byteOffset") or 0) + (acc.get("byteOffset") or 0)
    typ = acc["type"]
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[typ]
    ctype = acc["componentType"]
    if ctype == 5126:
        fmt, nbytes = "f", 4
    elif ctype == 5121:
        fmt, nbytes = "B", 1
    elif ctype == 5123:
        fmt, nbytes = "H", 2
    else:
        raise ValueError(ctype)
    stride = bv.get("byteStride") or comps * nbytes
    out = []
    for i in range(acc["count"]):
        o = start + i * stride
        row = list(struct.unpack_from("<" + fmt * comps, blob, o))
        out.append(row)
    return out


def find_deform(gltf, blob):
    for node in gltf.get("nodes") or []:
        if "mesh" not in node:
            continue
        mesh = gltf["meshes"][node["mesh"]]
        name = node.get("name") or mesh.get("name") or ""
        if "Deform" not in name and "deform" not in name:
            continue
        prim = mesh["primitives"][0]
        attrs = prim["attributes"]
        pos = accessor_data(gltf, blob, attrs["POSITION"])
        nrm = accessor_data(gltf, blob, attrs["NORMAL"]) if "NORMAL" in attrs else None
        uv = accessor_data(gltf, blob, attrs["TEXCOORD_0"]) if "TEXCOORD_0" in attrs else None
        return {"name": name, "pos": pos, "nrm": nrm, "uv": uv}
    raise RuntimeError("Deform mesh not found")


def parse_vec(s: str):
    return [float(x.replace("m", "")) for x in s.split()]


def fmt_vec(v):
    return f"{v[0]:.4f}m {v[1]:.4f}m {v[2]:.4f}m"


def nearest_idx(positions, point):
    best_i, best_d = 0, 1e18
    px, py, pz = point
    for i, (x, y, z) in enumerate(positions):
        d = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2
        if d < best_d:
            best_d, best_i = d, i
    return best_i, math.sqrt(best_d)


def sample_rgb(img: Image.Image, uv):
    u, v = uv
    # glTF UV: v often bottom-up; PIL is top-down → flip V
    w, h = img.size
    x = int(max(0, min(w - 1, round((u % 1) * (w - 1)))))
    y = int(max(0, min(h - 1, round((1.0 - (v % 1)) * (h - 1)))))
    r, g, b = img.getpixel((x, y))[:3]
    return (r, g, b), (x, y)


def color_key(rgb, quant=18):
    # coarse bucket so slight bake differences still match
    return tuple(int(c // quant) * quant for c in rgb)


def dist3(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def main():
    src = json.loads(SRC_JSON.read_text(encoding="utf-8"))
    out = json.loads(OUT_JSON.read_text(encoding="utf-8"))

    euro_gltf, euro_blob = load_glb(EURO_GLB)
    v8_gltf, v8_blob = load_glb(V8_GLB)
    euro = find_deform(euro_gltf, euro_blob)
    v8 = find_deform(v8_gltf, v8_blob)
    euro_img = Image.open(EURO_TEX).convert("RGB")
    v8_img = Image.open(V8_TEX).convert("RGB")

    print(f"euro Deform verts={len(euro['pos'])}  v8={len(v8['pos'])}")
    print(f"tex euro={EURO_TEX.name} v8={V8_TEX.name}")

    # Build V8 color → vertex indices (and positions)
    buckets: dict[tuple, list[int]] = {}
    for i, uv in enumerate(v8["uv"]):
        rgb, _ = sample_rgb(v8_img, uv)
        k = color_key(rgb)
        buckets.setdefault(k, []).append(i)
    print(f"v8 color buckets: {len(buckets)}")

    mouth_src = next(p for p in src["pointsData"] if p["text"] == "口轮匝肌")
    mouth_v8_guess = next(p for p in out["pointsData"] if p["text"] == "口轮匝肌")
    ms = parse_vec(mouth_src["pos"])

    # First pass: remap mouth by color alone near front lip zone
    results = []
    by_text_out = {p["text"]: p for p in out["pointsData"]}

    for sp in src["pointsData"]:
        text = sp["text"]
        spos = parse_vec(sp["pos"])
        snorm = parse_vec(sp["norm"])
        ei, ed = nearest_idx(euro["pos"], spos)
        euv = euro["uv"][ei]
        ergb, epx = sample_rgb(euro_img, euv)
        ek = color_key(ergb)

        # relative offset from mouth on euro
        rel = [spos[0] - ms[0], spos[1] - ms[1], spos[2] - ms[2]]

        cand = buckets.get(ek, [])
        # If exact bucket empty, expand by RGB distance
        if len(cand) < 20:
            scored = []
            for k, idxs in buckets.items():
                cd = abs(k[0] - ek[0]) + abs(k[1] - ek[1]) + abs(k[2] - ek[2])
                if cd <= 36:
                    scored.append((cd, idxs))
            scored.sort(key=lambda x: x[0])
            cand = []
            for _, idxs in scored[:8]:
                cand.extend(idxs)

        if not cand:
            results.append({"text": text, "ok": False, "error": "no color match", "euroRgb": ergb})
            continue

        # provisional mouth on V8: use current out or search later; use current mouth pos as anchor
        mv = parse_vec(by_text_out["口轮匝肌"]["pos"])
        target = [mv[0] + rel[0], mv[1] + rel[1], mv[2] + rel[2]]

        # Prefer candidates near target; also prefer outward (+z for face, -z for occiput)
        best = None
        for i in cand:
            p = v8["pos"][i]
            d = dist3(p, target)
            # soft prior: front face muscles shouldn't land on back of head
            back_pen = 0.0
            if text != "枕肌" and p[2] < -0.05:
                back_pen = 0.15
            if text == "枕肌" and p[2] > 0:
                back_pen = 0.15
            score = d + back_pen
            if best is None or score < best[0]:
                best = (score, i, d)

        i = best[1]
        pos = v8["pos"][i]
        nrm = v8["nrm"][i] if v8["nrm"] else [0, 0, 1]
        # orient normal toward euro normal hemisphere
        if nrm[0] * snorm[0] + nrm[1] * snorm[1] + nrm[2] * snorm[2] < 0:
            nrm = [-nrm[0], -nrm[1], -nrm[2]]
        # normalize
        ln = math.sqrt(nrm[0] ** 2 + nrm[1] ** 2 + nrm[2] ** 2) or 1
        nrm = [nrm[0] / ln, nrm[1] / ln, nrm[2] / ln]

        vrgb, vpx = sample_rgb(v8_img, v8["uv"][i])
        by_text_out[text]["pos"] = fmt_vec(pos)
        by_text_out[text]["norm"] = fmt_vec(nrm)
        results.append(
            {
                "text": text,
                "ok": True,
                "euroRgbDist": round(ed, 5),
                "euroRgb": ergb,
                "v8Rgb": vrgb,
                "colorKey": list(ek),
                "cand": len(cand),
                "targetDist": round(best[2], 5),
                "pos": by_text_out[text]["pos"],
                "norm": by_text_out[text]["norm"],
                "euroUvPx": list(epx),
                "v8UvPx": list(vpx),
            }
        )

    # Second pass: re-anchor relative to newly remapped mouth, re-pick from same color pools
    mouth_new = parse_vec(by_text_out["口轮匝肌"]["pos"])
    for sp, r in zip(src["pointsData"], results):
        if not r.get("ok") or sp["text"] == "口轮匝肌":
            continue
        text = sp["text"]
        spos = parse_vec(sp["pos"])
        snorm = parse_vec(sp["norm"])
        rel = [spos[0] - ms[0], spos[1] - ms[1], spos[2] - ms[2]]
        target = [mouth_new[0] + rel[0], mouth_new[1] + rel[1], mouth_new[2] + rel[2]]
        ek = tuple(r["colorKey"])
        cand = buckets.get(ek, [])
        if len(cand) < 20:
            scored = []
            for k, idxs in buckets.items():
                cd = abs(k[0] - ek[0]) + abs(k[1] - ek[1]) + abs(k[2] - ek[2])
                if cd <= 36:
                    scored.append((cd, idxs))
            scored.sort(key=lambda x: x[0])
            cand = []
            for _, idxs in scored[:8]:
                cand.extend(idxs)
        best = None
        for i in cand:
            p = v8["pos"][i]
            d = dist3(p, target)
            back_pen = 0.0
            if text != "枕肌" and p[2] < -0.05:
                back_pen = 0.15
            if text == "枕肌" and p[2] > 0:
                back_pen = 0.15
            score = d + back_pen
            if best is None or score < best[0]:
                best = (score, i, d)
        i = best[1]
        pos = v8["pos"][i]
        nrm = v8["nrm"][i] if v8["nrm"] else [0, 0, 1]
        if nrm[0] * snorm[0] + nrm[1] * snorm[1] + nrm[2] * snorm[2] < 0:
            nrm = [-nrm[0], -nrm[1], -nrm[2]]
        ln = math.sqrt(nrm[0] ** 2 + nrm[1] ** 2 + nrm[2] ** 2) or 1
        nrm = [nrm[0] / ln, nrm[1] / ln, nrm[2] / ln]
        by_text_out[text]["pos"] = fmt_vec(pos)
        by_text_out[text]["norm"] = fmt_vec(nrm)
        r["pos"] = by_text_out[text]["pos"]
        r["norm"] = by_text_out[text]["norm"]
        r["targetDist"] = round(best[2], 5)
        r["pass"] = 2

    out["modelSrc"] = NEW_MODEL_SRC
    out["timestamp"] = int(__import__("time").time() * 1000)
    # keep pointsData order from out file
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    REPORT.write_text(json.dumps({"results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    ok = sum(1 for r in results if r.get("ok"))
    print(f"wrote {OUT_JSON}")
    print(f"ok {ok}/{len(results)}")
    for r in results:
        status = "OK" if r.get("ok") else "FAIL"
        print(
            f"{status:4s} {r['text']:12s} euroRGB={r.get('euroRgb')} v8RGB={r.get('v8Rgb')} dist={r.get('targetDist')} pos={r.get('pos')}"
        )


if __name__ == "__main__":
    main()
