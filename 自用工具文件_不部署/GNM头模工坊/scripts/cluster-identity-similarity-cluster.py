#!/usr/bin/env python3
"""
P0：位移幅度场相似度 + Ward 层次聚类报告。

背景：身份 PCA 基在有符号位移上近正交，直接余弦几乎全不相似。
改用每顶点 ||位移|| 幅度图（哪里在动），Ward 聚类，准且簇更均衡。

Usage:
  python scripts/cluster-identity-similarity-cluster.py
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "_runs" / "identity-similarity-p0"
TOP_K = 8
CANDIDATE_KS = [6, 8, 10, 12, 15, 18, 20, 24]
PREFERRED_K_RANGE = (10, 18)
# 独苗：幅度场最近邻 cos 低于全体最近邻分布的较低分位
SINGLETON_NEIGHBOR_PERCENTILE = 5.0


def load_mag(meta: dict) -> np.ndarray:
    n = meta["headCount"]
    path = OUT / "fingerprints_mag.f32"
    if path.exists():
        d = int(meta.get("magFeatDim") or meta["skinVertexCount"])
        fp = np.fromfile(path, dtype=np.float32).reshape(n, d)
    else:
        # 兼容仅有 signed 的旧产物
        d3 = int(meta.get("signedFeatDim") or meta.get("featDim"))
        skin = meta["skinVertexCount"]
        signed = np.fromfile(OUT / "fingerprints_pos.f32", dtype=np.float32).reshape(n, d3)
        norms = np.array(json.loads((OUT / "norms_before.json").read_text()), dtype=np.float64)
        raw = (signed * norms[:, None]).reshape(n, skin, 3)
        fp = np.linalg.norm(raw, axis=2).astype(np.float32)
    norms = np.linalg.norm(fp, axis=1, keepdims=True)
    fp = fp / np.maximum(norms, 1e-12)
    return fp.astype(np.float64)


def load_signed_diag(meta: dict):
    """有符号场仅作诊断，不参与主聚类。"""
    n = meta["headCount"]
    d3 = int(meta.get("signedFeatDim") or meta.get("featDim"))
    path = OUT / "fingerprints_pos.f32"
    if not path.exists():
        return None, None
    fp = np.fromfile(path, dtype=np.float32).reshape(n, d3).astype(np.float64)
    fp = fp / np.maximum(np.linalg.norm(fp, axis=1, keepdims=True), 1e-12)
    signed = np.clip(fp @ fp.T, -1.0, 1.0)
    abs_cos = np.abs(signed)
    np.fill_diagonal(abs_cos, 1.0)
    return signed, abs_cos


def cosine_matrix(fp: np.ndarray) -> np.ndarray:
    s = fp @ fp.T
    np.clip(s, -1.0, 1.0, out=s)
    np.fill_diagonal(s, 1.0)
    return s


def neighbors(sim: np.ndarray, k: int = TOP_K):
    n = sim.shape[0]
    out = []
    for i in range(n):
        order = np.argsort(-sim[i])
        row = []
        for j in order:
            if int(j) == i:
                continue
            row.append({"j": int(j), "magCos": round(float(sim[i, j]), 5)})
            if len(row) >= k:
                break
        out.append({"i": i, "top": row})
    return out


def cluster_cohesion(sim: np.ndarray, labels: np.ndarray) -> list[dict]:
    rows = []
    for cid in sorted(set(int(x) for x in labels)):
        members = np.where(labels == cid)[0]
        m = members.tolist()
        if len(m) == 1:
            rows.append(
                {
                    "cluster": cid,
                    "size": 1,
                    "members": m,
                    "meanMagCos": 1.0,
                    "minMagCos": 1.0,
                    "medoid": m[0],
                }
            )
            continue
        sub = sim[np.ix_(members, members)]
        iu = np.triu_indices(len(m), k=1)
        vals = sub[iu]
        mean_to_others = (sub.sum(axis=1) - 1.0) / (len(m) - 1)
        medoid_local = int(np.argmax(mean_to_others))
        rows.append(
            {
                "cluster": cid,
                "size": len(m),
                "members": m,
                "meanMagCos": round(float(vals.mean()), 5),
                "minMagCos": round(float(vals.min()), 5),
                "medoid": int(members[medoid_local]),
            }
        )
    rows.sort(key=lambda r: (-r["size"], r["cluster"]))
    return rows


def size_entropy_norm(sizes: list[int]) -> float:
    total = sum(sizes)
    if total <= 0 or len(sizes) <= 1:
        return 0.0
    ents = 0.0
    for s in sizes:
        if s <= 0:
            continue
        p = s / total
        ents -= p * math.log(p + 1e-15)
    max_ent = math.log(len(sizes))
    return float(ents / max_ent) if max_ent > 0 else 0.0


def regional_energy_hints(mag_rawish: np.ndarray, xyz: np.ndarray) -> list[dict]:
    """用中性皮肤坐标把幅度能量分到粗分区，仅供起名参考。"""
    x, y, z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    xmin, xmax = float(x.min()), float(x.max())
    ymin, ymax = float(y.min()), float(y.max())
    zmin, zmax = float(z.min()), float(z.max())
    w, h, d = xmax - xmin, ymax - ymin, zmax - zmin

    def mask_fore(i):
        return y[i] > ymin + h * 0.78 and z[i] > zmin + d * 0.35

    def mask_brow(i):
        return (
            z[i] > zmin + d * 0.5
            and ymin + h * 0.62 < y[i] < ymin + h * 0.78
        )

    def mask_cheek(i):
        return abs(x[i]) > w * 0.28 and ymin + h * 0.4 < y[i] < ymin + h * 0.62

    def mask_nose(i):
        return (
            abs(x[i]) < w * 0.08
            and ymin + h * 0.45 < y[i] < ymin + h * 0.62
            and z[i] > zmin + d * 0.65
        )

    def mask_chin(i):
        return y[i] < ymin + h * 0.32 and z[i] > zmin + d * 0.45

    def mask_lip(i):
        return (
            z[i] > zmin + d * 0.55
            and ymin + h * 0.28 < y[i] < ymin + h * 0.48
        )

    regions = [
        ("额", mask_fore),
        ("眉", mask_brow),
        ("颧颊", mask_cheek),
        ("鼻", mask_nose),
        ("口", mask_lip),
        ("颏", mask_chin),
    ]
    idx_all = np.arange(xyz.shape[0])
    masks = {name: np.array([fn(i) for i in idx_all], dtype=bool) for name, fn in regions}

    hints = []
    for i in range(mag_rawish.shape[0]):
        e = mag_rawish[i]
        scores = []
        for name, m in masks.items():
            if not m.any():
                continue
            scores.append((name, float(e[m].sum())))
        scores.sort(key=lambda t: -t[1])
        total = sum(s for _, s in scores) + 1e-12
        top = [
            {"region": a, "share": round(b / total, 4)}
            for a, b in scores[:3]
        ]
        hints.append({"i": i, "topRegions": top})
    return hints


def suggest_k(cut_stats: list[dict]) -> dict:
    scored = []
    for st in cut_stats:
        k = st["k"]
        if k < PREFERRED_K_RANGE[0] or k > PREFERRED_K_RANGE[1]:
            continue
        sing = st["singletonCount"] / max(k, 1)
        # 惩罚过大簇占比
        big = st["maxClusterSize"] / 170.0
        score = (
            st["meanCohesion"]
            * (1.0 - 0.4 * sing)
            * (0.55 + 0.45 * st["sizeEntropyNorm"])
            * (1.0 - 0.35 * max(0.0, big - 0.28))
        )
        scored.append({**st, "score": round(float(score), 5)})
    scored.sort(key=lambda x: -x["score"])
    return {
        "preferredKRange": list(PREFERRED_K_RANGE),
        "ranking": scored[:8],
        "suggestedK": scored[0]["k"] if scored else 12,
        "note": "Heuristic on Ward(mag). Confirm via cluster lists before P1 naming.",
    }


def main():
    meta = json.loads((OUT / "meta.json").read_text(encoding="utf-8"))
    mag = load_mag(meta)
    n = mag.shape[0]
    print(f"[cluster] mag fingerprints {mag.shape}")

    sim = cosine_matrix(mag)
    np.save(OUT / "sim_mag_cos.npy", sim.astype(np.float32))

    signed, abs_signed = load_signed_diag(meta)
    if abs_signed is not None:
        np.save(OUT / "sim_signed_abs_cos.npy", abs_signed.astype(np.float32))
        iu = np.triu_indices(n, k=1)
        signed_stats = {
            "mean": round(float(abs_signed[iu].mean()), 5),
            "median": round(float(np.median(abs_signed[iu])), 5),
            "max": round(float(abs_signed[iu].max()), 5),
            "note": "Near-orthogonal PCA bases → very low; not used for clustering.",
        }
    else:
        signed_stats = None

    # Ward on L2-normalized mag rows (= Euclidean clustering of magnitude patterns)
    print("[cluster] Ward linkage on magnitude maps…")
    Z = linkage(mag, method="ward")
    np.save(OUT / "linkage_ward_mag.npy", Z)

    # 对照：average on 1-cos
    dist = np.clip(1.0 - sim, 0.0, None)
    np.fill_diagonal(dist, 0.0)
    dist = (dist + dist.T) * 0.5
    from scipy.spatial.distance import squareform

    Z_avg = linkage(squareform(dist, checks=False), method="average")
    np.save(OUT / "linkage_average_mag.npy", Z_avg)

    neigh = neighbors(sim, TOP_K)
    (OUT / "neighbors_top8.json").write_text(
        json.dumps(neigh, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    max_neigh = np.array([neigh[i]["top"][0]["magCos"] for i in range(n)])
    thr = float(np.percentile(max_neigh, SINGLETON_NEIGHBOR_PERCENTILE))
    singletons = []
    for i, mx in enumerate(max_neigh):
        if mx < thr:
            singletons.append(
                {
                    "i": i,
                    "maxMagCos": round(float(mx), 5),
                    "nearest": neigh[i]["top"][0]["j"],
                }
            )

    iu = np.triu_indices(n, k=1)
    pair = sim[iu]
    pair_stats = {
        "mean": round(float(pair.mean()), 5),
        "median": round(float(np.median(pair)), 5),
        "p10": round(float(np.percentile(pair, 10)), 5),
        "p90": round(float(np.percentile(pair, 90)), 5),
    }

    cut_stats = []
    cuts_detail = {}
    for k in CANDIDATE_KS:
        labels = fcluster(Z, t=k, criterion="maxclust")
        coh = cluster_cohesion(sim, labels)
        sizes = [c["size"] for c in coh]
        mean_coh = float(np.mean([c["meanMagCos"] for c in coh if c["size"] > 1] or [1.0]))
        st = {
            "k": k,
            "meanCohesion": round(mean_coh, 5),
            "singletonCount": sum(1 for s in sizes if s == 1),
            "minClusterSize": min(sizes),
            "maxClusterSize": max(sizes),
            "sizeEntropyNorm": round(size_entropy_norm(sizes), 5),
        }
        cut_stats.append(st)
        cuts_detail[str(k)] = {
            "stats": st,
            "clusters": coh,
            "labelsByIndex": [int(x) for x in labels],
        }

    suggestion = suggest_k(cut_stats)
    suggested_k = int(suggestion["suggestedK"])
    suggested_labels = fcluster(Z, t=suggested_k, criterion="maxclust")
    suggested_clusters = cluster_cohesion(sim, suggested_labels)

    # 区域提示（起名用，不参与聚类）
    region_hints = None
    xyz_path = OUT / "skin_xyz.f32"
    if xyz_path.exists():
        xyz = np.fromfile(xyz_path, dtype=np.float32).reshape(-1, 3)
        # 用未归一前的相对幅度：mag 已归一，区域份额仍可比
        region_hints = regional_energy_hints(mag, xyz)
        (OUT / "region_hints.json").write_text(
            json.dumps(region_hints, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    summary = {
        "kind": "gnmIdentitySimilarityP0Report",
        "version": 2,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "meta": meta,
        "method": {
            "fingerprint": "per-vertex displacement magnitude ||d|| on full skin, L2-normalized, amp=+2.0",
            "whyNotSigned": "Identity PCA bases are nearly orthogonal in signed displacement; abs-cos max pair ~0.19.",
            "similarity": "cosine of magnitude maps",
            "linkage": "Ward (Euclidean on L2-normalized mag rows)",
            "alsoSaved": "average linkage on 1-cos(mag) for contrast; signed abs-cos diagnostic",
            "singletonRule": f"max mag-cos neighbor < P{SINGLETON_NEIGHBOR_PERCENTILE:.0f} ({thr:.4f})",
        },
        "pairMagCos": pair_stats,
        "signedAbsCosDiagnostic": signed_stats,
        "singletonCandidates": singletons,
        "cutStats": cut_stats,
        "suggestion": suggestion,
        "suggestedCut": {"k": suggested_k, "clusters": suggested_clusters},
    }
    (OUT / "report.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "cuts_detail.json").write_text(
        json.dumps(cuts_detail, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Markdown
    lines = [
        "# 身份维相似度聚类 · P0 报告（v2）",
        "",
        "## 方法结论",
        "",
        "1. **有符号位移场**：PCA 基近正交，两两 |cos| 极低（诊断见下），**不能**直接拿来聚类。",
        "2. **幅度场**（每顶点 ||位移||）：刻画「哪里在动」，作为主指纹。",
        "3. **Ward 层次聚类**（幅度图 L2 归一后的欧氏距离）：簇规模更均衡、更稳。",
        "4. 区域能量仅作 **起名提示**，不参与归类判决。",
        "",
        "## 全局统计",
        "",
        f"- 幅度场两两 cos：mean={pair_stats['mean']}, median={pair_stats['median']}, "
        f"p10={pair_stats['p10']}, p90={pair_stats['p90']}",
    ]
    if signed_stats:
        lines.append(
            f"- 有符号 |cos|（诊断）：mean={signed_stats['mean']}, max={signed_stats['max']} → 近正交"
        )
    lines += [
        f"- 独苗候选（最近邻 mag-cos < P{SINGLETON_NEIGHBOR_PERCENTILE:.0f}={thr:.4f}）："
        f"**{len(singletons)}** → `{[s['i'] for s in singletons]}`",
        "",
        "## Ward 切分候选",
        "",
        "| k | 簇内均 mag-cos | 单点簇 | 最小/最大簇 | sizeEntropy |",
        "|---|---|---|---|---|",
    ]
    for st in cut_stats:
        lines.append(
            f"| {st['k']} | {st['meanCohesion']} | {st['singletonCount']} | "
            f"{st['minClusterSize']}/{st['maxClusterSize']} | {st['sizeEntropyNorm']} |"
        )
    lines += [
        "",
        f"### 启发式建议：**k = {suggested_k}**",
        "",
    ]
    for r in suggestion.get("ranking", [])[:5]:
        lines.append(
            f"- k={r['k']} score={r['score']} cohesion={r['meanCohesion']} "
            f"singletons={r['singletonCount']} maxSize={r['maxClusterSize']}"
        )
    lines += ["", f"## 建议切分 k={suggested_k} 簇一览", ""]

    hint_by_i = {h["i"]: h for h in (region_hints or [])}
    for c in suggested_clusters:
        mem = ", ".join(str(x) for x in c["members"])
        lines += [
            f"### 簇 {c['cluster']} · n={c['size']} · meanCos={c['meanMagCos']} · "
            f"minCos={c['minMagCos']} · medoid=**{c['medoid']}**",
            "",
            f"成员：`[{mem}]`",
            "",
        ]
        mid = c["medoid"]
        if mid in hint_by_i:
            tops = ", ".join(
                f"{t['region']}({t['share']:.0%})" for t in hint_by_i[mid]["topRegions"]
            )
            lines.append(f"- medoid 区域能量提示（非归类依据）：{tops}")
        for m in c["members"][:3]:
            tip = ", ".join(
                f"{t['j']}(cos={t['magCos']})" for t in neigh[m]["top"][:3]
            )
            lines.append(f"- id{m} 最像：{tip}")
        lines.append("")

    lines += [
        "## 产物",
        "",
        "- `fingerprints_mag.f32` / `fingerprints_pos.f32` / `skin_xyz.f32` / `meta.json`",
        "- `sim_mag_cos.npy` / `linkage_ward_mag.npy`",
        "- `neighbors_top8.json` / `region_hints.json`",
        "- `report.json` / `cuts_detail.json` / 本文件",
        "",
        "## 下一步 P1",
        "",
        "1. 确认或微调 k",
        "2. 按 medoid + 区域提示给每簇起概括名",
        "3. 写入 taxonomy + UI",
        "",
    ]
    (OUT / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"[cluster] suggested k={suggested_k}, singletons={len(singletons)}")
    print(f"[cluster] wrote {OUT / 'REPORT.md'}")


if __name__ == "__main__":
    main()
