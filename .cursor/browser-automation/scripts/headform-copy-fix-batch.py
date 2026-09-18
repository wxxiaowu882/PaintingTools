# -*- coding: utf-8 -*-
"""头部造型规律文案/笔误修复（只改约定条目，不改 209 女05 灯光）。"""
import json
import re
from pathlib import Path

root = Path("docs/json/沙盒_头部造型规律")
changed = []


def load(name):
    p = root / name
    return p, json.loads(p.read_text(encoding="utf-8"))


def save(p, data):
    p.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def note(fn, field, what):
    changed.append(f"{fn} | {field} | {what}")


# ---- 1/2: 208 & 209 对照句 ----
for fn in [
    "208_【交界线规律】背侧光 · 背侧交界A.json",
    "208_女05_【交界线规律】背侧光 · 背侧交界A.json",
]:
    p, j = load(fn)
    meta = j.setdefault("meta", {})
    for key in ("keyPoints", "keyPointsRich"):
        t = meta.get(key) or ""
        if not t:
            continue
        nt = t
        nt = nt.replace("背面光 · 背侧交界A", "背面光 · 背侧交界B")
        nt = nt.replace(
            "对照：B 更偏侧后，交界更往脸侧结构点靠。",
            "对照：本场景（A）更偏侧后、交界更靠脸侧；下一场景（B）更贴正后背侧亮边。",
        )
        if nt != t:
            meta[key] = nt
            note(fn, key, "208对照句")
    save(p, j)

for fn in [
    "209_【交界线规律】背面光 · 背侧交界B.json",
    "209_女05_【交界线规律】背面光 · 背侧交界B.json",
]:
    p, j = load(fn)
    meta = j.setdefault("meta", {})
    for key in ("keyPoints", "keyPointsRich"):
        t = meta.get(key) or ""
        if not t:
            continue
        nt = t
        nt = nt.replace("背侧光 · 背侧交界B", "背侧光 · 背侧交界A")
        nt = nt.replace(
            "对照：A 更贴正后背侧亮边。",
            "对照：本场景（B）更贴正后背侧亮边；上一场景（A）更偏侧后、交界更靠脸侧。",
        )
        if nt != t:
            meta[key] = nt
            note(fn, key, "209对照句")
    save(p, j)

# ---- 4: 大本 203/205 id ----
for fn, new_id in [
    ("203_【交界线规律】正前略高 · 蝴蝶光（Butterfly）.json", "L03"),
    ("205_【交界线规律】正前光 · 头侧交界.json", "L05"),
]:
    p, j = load(fn)
    old = j.get("id")
    if old != new_id:
        j["id"] = new_id
        meta = j.setdefault("meta", {})
        url = (((j.get("items") or [{}])[0]).get("url") or "")
        if ("大本" in url or "蝙蝠侠" in url) and meta.get("status"):
            meta["status"] = "handtuned"
        note(fn, "id", f"{old} -> {new_id}")
        save(p, j)

# ---- 5+7: 103 大本计数与粘连 ----
fn = "103_【外轮廓规律】大半侧.json"
p, j = load(fn)
meta = j.setdefault("meta", {})
for key in ("keyPoints", "keyPointsRich"):
    t = meta.get(key) or ""
    if not t:
        continue
    nt = t.replace(
        "1–6 是轮廓上的凸起，A–E 是外轮廓上的重要凹陷",
        "1–7 是轮廓上的凸起，A–F 是外轮廓上的重要凹陷",
    )
    if key == "keyPoints":
        nt = nt.replace("6.颏肌7.颏底", "6.颏肌\n7.颏底")
    else:
        nt = nt.replace("6.颏肌7.颏底", "6.颏肌<br>7.颏底")
    if nt != t:
        meta[key] = nt
        note(fn, key, "103计数+粘连")
save(p, j)

# 103 女05 仅粘连（若有）
fn = "103_女05_【外轮廓规律】大半侧.json"
p, j = load(fn)
meta = j.setdefault("meta", {})
for key in ("keyPoints", "keyPointsRich"):
    t = meta.get(key) or ""
    if not t:
        continue
    if key == "keyPoints":
        nt = t.replace("6.颏肌7.颏底", "6.颏肌\n7.颏底")
    else:
        nt = t.replace("6.颏肌7.颏底", "6.颏肌<br>7.颏底")
    if nt != t:
        meta[key] = nt
        note(fn, key, "103女05粘连")
        save(p, j)

# ---- 7: 102 粘连 ----
for fn in [
    "102_【外轮廓规律】正面.json",
    "102_女05_【外轮廓规律】正面.json",
]:
    p, j = load(fn)
    meta = j.setdefault("meta", {})
    hit = False
    for key in ("keyPoints", "keyPointsRich"):
        t = meta.get(key) or ""
        if not t:
            continue
        if key == "keyPoints":
            nt = t.replace("5.颏结节6.颏底", "5.颏结节\n6.颏底")
        else:
            nt = t.replace("5.颏结节6.颏底", "5.颏结节<br>6.颏底")
        nt = nt.replace("5 、6", "5、6")
        if nt != t:
            meta[key] = nt
            note(fn, key, "102粘连")
            hit = True
    if hit:
        save(p, j)

# ---- 6: 107 眉弓重复 + 括号 ----
for fn in [
    "107_【外轮廓规律】顶视.json",
    "107_女05_【外轮廓规律】顶视.json",
]:
    p, j = load(fn)
    meta = j.setdefault("meta", {})
    hit = False
    for key in ("keyPoints", "keyPointsRich"):
        t = meta.get(key) or ""
        if not t:
            continue
        nt = t.replace("2.眉弓2.眉弓", "2.眉弓")
        # 半角右括号收尾 → 全角句号+括号
        nt = nt.replace("颧隆突比眉弓更凸)", "颧隆突比眉弓更凸。）")
        # 未闭合：更凸 后直接换行/结束
        nt = re.sub(
            r"(颧隆突比眉弓更凸)(?![。）\)])",
            r"\1。）",
            nt,
        )
        # 避免双句号
        nt = nt.replace("。。", "。")
        nt = nt.replace("。）。）", "。）")
        if nt != t:
            meta[key] = nt
            note(fn, key, "107眉弓/括号")
            hit = True
    if hit:
        save(p, j)

# ---- 8: 207 的的 ----
for fn in [
    "207_【交界线规律】底前光 · 底前交界.json",
    "207_女05_【交界线规律】底前光 · 底前交界.json",
]:
    p, j = load(fn)
    meta = j.setdefault("meta", {})
    hit = False
    for key in ("keyPoints", "keyPointsRich"):
        t = meta.get(key) or ""
        if "的的" in t:
            meta[key] = t.replace("的的", "的")
            note(fn, key, "207的的")
            hit = True
    if hit:
        save(p, j)

# ---- 9: 101 圆标换行 ----
for fn in [
    "101_【外轮廓规律】侧前（四分之三）.json",
    "101_女05_【外轮廓规律】侧前（四分之三）.json",
]:
    p, j = load(fn)
    nfix = 0
    for it in j.get("items") or []:
        for a in it.get("annotations") or []:
            txt = a.get("text")
            if isinstance(txt, str) and ("\n" in txt or txt != txt.strip()):
                cleaned = txt.replace("\n", "").strip()
                if cleaned != txt:
                    a["text"] = cleaned
                    nfix += 1
    if nfix:
        note(fn, "annotations", f"清理 {nfix} 条换行")
        save(p, j)

# ---- 10: 女05 去掉自动映射打底 ----
for p in sorted(root.glob("*_女05_*.json")):
    j = json.loads(p.read_text(encoding="utf-8"))
    meta = j.setdefault("meta", {})
    hit = False
    for key in ("keyPoints", "keyPointsRich", "detail"):
        t = meta.get(key) or ""
        if "自动映射" not in t and "可再手调" not in t and "打底" not in t:
            continue
        nt = t
        nt = nt.replace(
            "本场景是同一课的对比个体（女05）。点位框架与参考模（大本）一致，请对照凹凸强弱与宽窄差异；本版为自动映射打底，可再手调。",
            "本场景是同一课的对比个体（女05）。点位框架与参考模（大本）一致，请对照凹凸强弱与宽窄差异。",
        )
        nt = nt.replace("；本版为自动映射打底，可再手调。", "。")
        nt = nt.replace("本版为自动映射打底，可再手调。", "")
        nt = nt.replace("自动映射打底，可再手调", "")
        nt = nt.replace("自动映射打底", "")
        nt = re.sub(r"；\s*。", "。", nt)
        nt = re.sub(r"。{2,}", "。", nt)
        if nt != t:
            meta[key] = nt
            note(p.name, key, "去打底口吻")
            hit = True
    if hit:
        save(p, j)

# ---- 重生成统合 JSON ----
files = sorted(
    [
        fn
        for fn in root.iterdir()
        if fn.is_file()
        and fn.suffix == ".json"
        and fn.name != "沙盒_头部造型规律.json"
        and re.match(r"^\d+[A-Za-z]?_.+\.json$", fn.name)
    ],
    key=lambda x: x.name,
)
agg = [json.loads(f.read_text(encoding="utf-8")) for f in files]
agg_path = root / "沙盒_头部造型规律.json"
agg_path.write_text(
    json.dumps(agg, ensure_ascii=False, separators=(",", ":")) + "\n",
    encoding="utf-8",
)
note(agg_path.name, "aggregate", f"重生成 {len(agg)} 条")

print("CHANGED", len(changed))
for c in changed:
    print(c)

# 校验
print("\nVERIFY")
checks = []
p, j = load("208_【交界线规律】背侧光 · 背侧交界A.json")
checks.append(("208对照B", "背侧交界B" in (j["meta"].get("keyPoints") or "") and "背侧交界A」对照" not in (j["meta"].get("keyPoints") or "")))
p, j = load("209_【交界线规律】背面光 · 背侧交界B.json")
kp = j["meta"].get("keyPoints") or ""
checks.append(("209对照A", "背侧交界A" in kp and "上一场景「背侧光 · 背侧交界B」" not in kp))
p, j = load("203_【交界线规律】正前略高 · 蝴蝶光（Butterfly）.json")
checks.append(("203id", j.get("id") == "L03"))
p, j = load("205_【交界线规律】正前光 · 头侧交界.json")
checks.append(("205id", j.get("id") == "L05"))
p, j = load("103_【外轮廓规律】大半侧.json")
checks.append(("103计数", "1–7 是轮廓上的凸起，A–F" in (j["meta"].get("keyPoints") or "")))
p, j = load("107_【外轮廓规律】顶视.json")
checks.append(("107眉弓", "2.眉弓2.眉弓" not in (j["meta"].get("keyPoints") or "")))
p, j = load("102_【外轮廓规律】正面.json")
checks.append(("102粘连", "5.颏结节6.颏底" not in (j["meta"].get("keyPoints") or "")))
p, j = load("207_【交界线规律】底前光 · 底前交界.json")
checks.append(("207的的", "的的" not in (j["meta"].get("keyPoints") or "")))
p, j = load("101_【外轮廓规律】侧前（四分之三）.json")
ann = ((j.get("items") or [{}])[0].get("annotations") or [])
checks.append(("101换行", not any("\n" in str(a.get("text") or "") for a in ann)))
# 女05 打底残留
remain = []
for p in root.glob("*_女05_*.json"):
    j = json.loads(p.read_text(encoding="utf-8"))
    meta = j.get("meta") or {}
    blob = " ".join(str(meta.get(k) or "") for k in ("keyPoints", "keyPointsRich", "detail"))
    if "自动映射" in blob or "打底" in blob:
        remain.append(p.name)
checks.append(("女05无打底", len(remain) == 0))
if remain:
    print("REMAIN打底", remain)
for name, ok in checks:
    print(("OK" if ok else "FAIL"), name)
