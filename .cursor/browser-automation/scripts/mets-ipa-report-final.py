# -*- coding: utf-8 -*-
"""Compile final IPA diagnosis report (no vocab writes)."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

VOCAB = Path("临时_METS二级备考/02_词汇")
OUT = Path(".cursor/browser-automation/runs/mets-ipa-audit")
OUT.mkdir(parents=True, exist_ok=True)

db = json.loads((VOCAB / "vocab_db_sorted.json").read_text(encoding="utf-8"))
entries = db["entries"]
deep = json.loads((OUT / "accuracy_deep.json").read_text(encoding="utf-8"))

n = len(entries)
with_ipa = sum(1 for e in entries if (e.get("ipa") or "").strip())
n_ch = sum(1 for e in entries if "ʧ" in (e.get("ipa") or ""))
n_tsh = sum(1 for e in entries if "tʃ" in (e.get("ipa") or ""))
n_j = sum(1 for e in entries if "ʤ" in (e.get("ipa") or ""))
n_dzh = sum(1 for e in entries if "dʒ" in (e.get("ipa") or ""))
n_long = sum(1 for e in entries if "ː" in (e.get("ipa") or ""))
n_er = sum(1 for e in entries if any(c in (e.get("ipa") or "") for c in "ɚɝ"))
n_schwa_r = sum(
    1 for e in entries if "ər" in (e.get("ipa") or "") or "ɜr" in (e.get("ipa") or "")
)

dual = [(e["en"], e["ipa"]) for e in entries if (e.get("ipa") or "").count("ˈ") >= 2]

empty_single, empty_phrase = [], []
for e in entries:
    if (e.get("ipa") or "").strip():
        continue
    en = e["en"]
    if " " in en or "(" in en:
        empty_phrase.append(en)
    else:
        empty_single.append(en)

suffix_issues = []
for e in entries:
    en = e["en"].lower().split("(")[0].strip()
    ipa = e.get("ipa") or ""
    if not ipa:
        continue
    if en.endswith("ation") and "eɪʃən" not in ipa:
        suffix_issues.append((e["en"], ipa, "-ation 缺 eɪʃən"))
    if en.endswith("itis") and "aɪtəs" not in ipa:
        suffix_issues.append((e["en"], ipa, "-itis 缺 aɪtəs"))
    if en.endswith("ology") and "ɑlə" not in ipa and "ɒlə" not in ipa:
        suffix_issues.append((e["en"], ipa, "-ology 缺 ɑlə"))

fail_like = []
for e in entries:
    en = re.sub(r"\s*\(.*\)\s*", "", e["en"]).strip().lower().replace("-", "")
    ipa = (e.get("ipa") or "").strip()
    if not ipa:
        continue
    bare = re.sub(r"[ˈˌː\-]", "", ipa).lower()
    if bare == en:
        fail_like.append((e["en"], ipa))
    elif bare.isascii() and set(bare) <= set("abcdefghijklmnopqrstuvwxyz") and len(bare) >= 4:
        if not any(c in ipa for c in "əɪæɑɔʊʌɛθðʃʒŋɝɚʧʤ"):
            fail_like.append((e["en"], ipa))

lines: list[str] = []
a = lines.append

a("# METS 二级词汇 · 音标问题清单（只诊断，未改数据）")
a("")
a(
    "> 数据源：`02_词汇/vocab_db_sorted.json`（权威）→ 背词页 `catalog.json` 照抄。"
    "生成：`eng_to_ipa` + `ipa_overrides.json`（426 条）。"
)
a("")
a(f"- 总词 **{n}**，有音标 **{with_ipa}**，空音标 **{n - with_ipa}**")
a("- overrides 与库：**0** 条不一致（覆盖已写入）")
a("")
a("---")
a("")
a("## 一、体系性问题（影响面大，不是个别 typo）")
a("")
a("当前整体是 **美式、eng_to_ipa / CMU 风格**，和国内教材常见「英式 DJ / 牛津」不一致：")
a("")
a("| 现象 | 数量 | 含义 |")
a("|------|------|------|")
a(f"| 合体塞擦音 `ʧ` | {n_ch} | 教材多用 `tʃ` |")
a(f"| 分写 `tʃ` | {n_tsh} | 与上混用 |")
a(f"| 合体 `ʤ` | {n_j} | 教材多用 `dʒ` |")
a(f"| 分写 `dʒ` | {n_dzh} | 与上混用 |")
a(f"| 长音符号 `ː` | {n_long} | **全库为 0**；英式 `iː ɑː ɔː uː ɜː` 几乎不出现 |")
a(f"| 儿化 `ɚ/ɝ` | {n_er} | 美式儿化；英式常写 `ə/ɜː` |")
a(f"| `ər`/`ɜr` 分写 | {n_schwa_r} | 与儿化符号并存 |")
a("")
a(
    "**结论：** 若产品要对齐「国内医护英语教材音标」，需要**统一体例**"
    "（英式 vs 美式、分写 vs 合体、是否标长音），不是改几个词能了事。"
)
a("")
a(
    "格式层：库内音标**无**斜杠/方括号/空格/ASCII 撇号；有音标的都带了重音符号。"
    "UI 自加 `/.../`、Word 用 `[...]`——属展示约定，不算数据错误。"
)
a("")
a("---")
a("")
a("## 二、明确的结构错误（建议优先修）")
a("")
a("### 2.1 双主重音（不合法 / 极罕见）")
a("")
for en, ipa in dual:
    a(f"- `{en}` → `{ipa}`")
a("")
a("| 词 | 库内 | 问题 |")
a("|----|------|------|")
a("| shuffling | `ˈʃəˈfʊlɪŋ` | 双主重音 + 切音怪；宜 ≈ `ˈʃʌflɪŋ` |")
a("| duration | `ˈdʊˈreɪʃən` | 双主重音；宜 ≈ `dʊˈreɪʃən` |")
a("| reactivate | `ˈriˈæktəˌveɪt` | 双主重音挤在前部 |")
a("| subacute | `ˈsəbəˈkjut` | 宜 ≈ `ˌsʌbəˈkjut` |")
a("| overactive | `ˈoʊvərˈæktɪv` | 宜 ≈ `ˌoʊvərˈæktɪv` |")
a("| in-patient | `ˈɪn-ˈpeɪʃənt` | 连字符两侧被 `ensure_stress` 各加主重 |")
a("")
a("### 2.2 空音标")
a("")
a(
    f"- 短语/带括号：**{len(empty_phrase)}** 条（管线设计跳过）。"
    "若列/闪卡要显示，需另定规则。"
)
a(
    f"- 单词级空音标：**{len(empty_single)}**"
    + (f" → `{empty_single[0]}`" if empty_single else "")
)
a("")
a("---")
a("")
a("## 三、准确性疑点（医疗/高频抽检）")
a("")
a(
    f"抽检期望表命中 **{deep['accuracy_ok']}**，疑似不准 **{deep['accuracy_miss']}**"
    f"（库中无该抽检词 {deep['not_found_n']} 条，属词表覆盖差，不算错标）。"
)
a("")
a("| 词 | 库内 | 期望近似 |")
a("|----|------|----------|")
for m in deep["misses"]:
    a(f"| {m['en']} | `{m['got']}` | `{' / '.join(m['accept'][:2])}` |")
a("")
a("overrides 里建议人工再对词典：")
a("")
a("| 词 | 库内 | 备注 |")
a("|----|------|------|")
a("| gingiva | `dʒɪnˈdʒaɪvə` | 亦作 `ˈdʒɪndʒɪvə` |")
a("| salivary | `ˈsæləˌvɛri` | 亦作 `səˈlaɪvəri` |")
a("| auscultate | `ˈɔskəlteɪt` | 亦作 `ɔːˈskʌlteɪt` |")
a("| heme | `ˈhim` | 英式常 `hiːm` |")
a("| cecum | `ˈsikəm` | 英式常 `ˈsiːkəm` |")
a("")
a("---")
a("")
a("## 四、后缀 / 转换失败扫描")
a("")
a(f"- 后缀模式可疑：**{len(suffix_issues)}** 条")
for en, ipa, why in suffix_issues[:20]:
    a(f"  - `{en}` → `{ipa}`（{why}）")
a(f"- 音标几乎等于英文拼写 / 无 IPA 元音符号：**{len(fail_like)}** 条")
for en, ipa in fail_like[:15]:
    a(f"  - `{en}` → `{ipa}`")
a("")
a("---")
a("")
a("## 五、建议下一步（仍先不改，等定口径）")
a("")
a("1. **先定体例**：英式教材风 vs 维持美式；是否统一 `tʃ/dʒ`、是否补 `ː`。")
a("2. **先修结构硬伤**：双主重音 6 条 + `AIDS` 是否补标。")
a("3. **再开准确性轮次**：按场景分批对照词典 → `ipa_overrides.json` → 重跑 sorted/catalog。")
a("")
a(
    "机器可读：`.cursor/browser-automation/runs/mets-ipa-audit/norm_report.json`、"
    "`accuracy_deep.json`"
)

text = "\n".join(lines)
(OUT / "问题清单.md").write_text(text, encoding="utf-8")
print(text)
print("\n[stats]", {"fail_like": len(fail_like), "suffix": len(suffix_issues), "dual": len(dual)})
