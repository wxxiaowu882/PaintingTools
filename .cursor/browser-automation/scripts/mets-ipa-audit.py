# -*- coding: utf-8 -*-
"""METS IPA audit — find issues only, no writes to vocab."""
from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path

ROOT = Path.cwd()
VOCAB = ROOT / "临时_METS二级备考" / "02_词汇"
OUT = ROOT / ".cursor" / "browser-automation" / "runs" / "mets-ipa-audit"
OUT.mkdir(parents=True, exist_ok=True)

db = json.loads((VOCAB / "vocab_db_sorted.json").read_text(encoding="utf-8"))
entries = db["entries"] if isinstance(db, dict) else db
ov = json.loads((VOCAB / "_build" / "ipa_overrides.json").read_text(encoding="utf-8"))

char_count: collections.Counter[str] = collections.Counter()
empty: list[str] = []
has_slash: list[tuple[str, str]] = []
has_bracket: list[tuple[str, str]] = []
has_space: list[tuple[str, str]] = []
has_ascii_apos: list[tuple[str, str]] = []
has_colon_ascii: list[tuple[str, str]] = []
no_stress: list[tuple[str, str]] = []
multi_primary: list[tuple[str, str]] = []
leading_weird: list[tuple[str, str]] = []
suspicious: list[tuple[str, str, str]] = []
override_diff: list[tuple[str, str, str]] = []

ok_lead = set(
    "ˈˌabcdefghijklmnopqrstuvwxyzɑɒæʌəɚɝɨɪueɛɔoʊθðʃʒʧʤŋɹɾɥ"
)

for e in entries:
    en = e.get("en") or ""
    ipa = (e.get("ipa") or "").strip()
    for ch in ipa:
        char_count[ch] += 1
    if not ipa:
        empty.append(en)
        continue
    if "/" in ipa or "\\" in ipa:
        has_slash.append((en, ipa))
    if "[" in ipa or "]" in ipa:
        has_bracket.append((en, ipa))
    if " " in ipa or "\u00a0" in ipa:
        has_space.append((en, ipa))
    if "'" in ipa or '"' in ipa or "`" in ipa:
        has_ascii_apos.append((en, ipa))
    if ":" in ipa:
        has_colon_ascii.append((en, ipa))
    if "ˈ" not in ipa and "ˌ" not in ipa:
        no_stress.append((en, ipa))
    if ipa.count("ˈ") >= 2:
        multi_primary.append((en, ipa))
    if ipa[0] not in ok_lead:
        leading_weird.append((en, ipa))
    if re.search(r"[A-Z0-9]", ipa):
        suspicious.append(("upper/digit", en, ipa))
    if ".." in ipa or "・・" in ipa:
        suspicious.append(("dots", en, ipa))

for e in entries:
    en = e["en"]
    got = (e.get("ipa") or "").strip()
    for k in (en, en.lower(), en.split("(")[0].strip()):
        if k in ov:
            want = (ov[k] or "").strip()
            if want and got != want:
                override_diff.append((en, want, got))
            break

n_tsh = sum(1 for e in entries if "tʃ" in (e.get("ipa") or ""))
n_ch = sum(1 for e in entries if "ʧ" in (e.get("ipa") or ""))
n_dzh = sum(1 for e in entries if "dʒ" in (e.get("ipa") or ""))
n_j = sum(1 for e in entries if "ʤ" in (e.get("ipa") or ""))
n_long = sum(1 for e in entries if "ː" in (e.get("ipa") or ""))
n_er = sum(1 for e in entries if "ɚ" in (e.get("ipa") or "") or "ɝ" in (e.get("ipa") or ""))
n_schwa_r = sum(1 for e in entries if "ər" in (e.get("ipa") or ""))

common = set(
    list("abcdefghijklmnopqrstuvwxyzˈˌː·.-θðʃʒʧʤŋæɑɒɔəɚɝɪʊʌɛɨ̃͡ɹɾ()")
)
uncommon = [(ch, n) for ch, n in char_count.items() if ch not in common]

# accuracy spot-check vs a small known-good dict (US GenAm style, no slashes)
# Sources: common textbook / Cambridge-ish US
KNOWN = {
    "patient": ["ˈpeɪʃənt"],
    "nurse": ["ˈnɝs", "ˈnɜrs", "ˈnɜːs"],
    "care": ["ˈkɛr", "ˈkeə", "ˈkeɚ", "ˈkɛɚ"],
    "sane": ["ˈseɪn"],
    "blood": ["ˈblʌd"],
    "heart": ["ˈhɑrt", "ˈhɑːt"],
    "pain": ["ˈpeɪn"],
    "fever": ["ˈfivər", "ˈfiːvə"],
    "cough": ["ˈkɔf", "ˈkɒf"],
    "wound": ["ˈwund", "ˈwaʊnd"],  # both exist by POS
    "cell": ["ˈsɛl"],
    "virus": ["ˈvaɪrəs"],
    "cancer": ["ˈkænsər"],
    "doctor": ["ˈdɑktər", "ˈdɒktə"],
    "hospital": ["ˈhɑspɪtl", "ˈhɒspɪtl", "ˈhɑːspɪtl"],
    "oxygen": ["ˈɑksɪdʒən", "ˈɒksɪdʒən"],
    "muscle": ["ˈmʌsəl"],
    "bone": ["ˈboʊn", "ˈbəʊn"],
    "skin": ["ˈskɪn"],
    "eye": ["ˈaɪ"],
    "ear": ["ˈɪr", "ˈɪə", "ˈɪɚ"],
    "nose": ["ˈnoʊz", "ˈnəʊz"],
    "mouth": ["ˈmaʊθ"],
    "tooth": ["ˈtuθ"],
    "tongue": ["ˈtʌŋ"],
    "stomach": ["ˈstʌmək"],
    "liver": ["ˈlɪvər"],
    "kidney": ["ˈkɪdni"],
    "urine": ["ˈjʊrən", "ˈjʊərɪn", "ˈjʊrɪn"],
    "pulse": ["ˈpʌls"],
    "breath": ["ˈbrɛθ"],
    "breathe": ["ˈbrið"],
    "inject": ["ɪnˈdʒɛkt"],
    "surgery": ["ˈsɝdʒəri", "ˈsɜːdʒəri"],
    "vaccine": ["vækˈsin", "ˈvæksin"],
    "allergy": ["ˈælərdʒi"],
    "infection": ["ɪnˈfɛkʃən"],
    "inflammation": ["ˌɪnfləˈmeɪʃən"],
    "diabetes": ["ˌdaɪəˈbitiz", "ˌdaɪəˈbiːtiːz"],
    "asthma": ["ˈæzmə"],
    "pneumonia": ["nuˈmoʊniə", "njuːˈməʊniə"],
    "tuberculosis": ["tuˌbɝkjəˈloʊsəs", "tjuːˌbɜːkjʊˈləʊsɪs"],
    "hemorrhage": ["ˈhɛmərɪdʒ", "ˈhemərɪdʒ"],
    "diarrhoea": ["ˌdaɪəˈriə"],
    "diarrhea": ["ˌdaɪəˈriə"],
    "nausea": ["ˈnɔziə", "ˈnɔʒə", "ˈnɔːziə"],
    "vomit": ["ˈvɑmət", "ˈvɒmɪt"],
    "swelling": ["ˈswɛlɪŋ"],
    "fracture": ["ˈfræktʃər"],
    "bruise": ["ˈbruz"],
    "bandage": ["ˈbændɪdʒ"],
    "sterile": ["ˈstɛrəl", "ˈstɛraɪl"],
    "immune": ["ɪˈmjun"],
    "antibody": ["ˈæntiˌbɑdi", "ˈæntɪˌbɒdi"],
    "auscultate": ["ˈɔskəlteɪt", "ɔːˈskʌlteɪt"],
    "suture": ["ˈsutʃər"],
    "scalpel": ["ˈskælpəl"],
    "syringe": ["səˈrɪndʒ"],
    "catheter": ["ˈkæθətər", "ˈkæθɪtə"],
    "abdomen": ["ˈæbdəmən", "æbˈdoʊmən"],
    "thorax": ["ˈθɔræks"],
    "cranium": ["ˈkreɪniəm"],
    "femur": ["ˈfimər"],
    "tibia": ["ˈtɪbiə"],
    "ulcer": ["ˈʌlsər"],
    "tumor": ["ˈtumər", "ˈtjuːmə"],
    "tumour": ["ˈtumər", "ˈtjuːmə"],
    "malignant": ["məˈlɪgnənt"],
    "benign": ["bəˈnaɪn"],
    "chronic": ["ˈkrɑnɪk", "ˈkrɒnɪk"],
    "acute": ["əˈkjut"],
    "vital": ["ˈvaɪtl"],
    "lethal": ["ˈliθəl"],
    "fatal": ["ˈfeɪtl"],
    "diagnose": ["ˈdaɪəgnoʊs", "ˌdaɪəgˈnəʊz"],
    "symptom": ["ˈsɪmptəm"],
    "syndrome": ["ˈsɪndroʊm"],
    "therapy": ["ˈθɛrəpi"],
    "treatment": ["ˈtritmənt"],
    "prescription": ["prəˈskrɪpʃən"],
    "dosage": ["ˈdoʊsɪdʒ"],
    "tablet": ["ˈtæblət"],
    "capsule": ["ˈkæpsəl", "ˈkæpsjul"],
    "ointment": ["ˈɔɪntmənt"],
    "gauze": ["ˈgɔz"],
    "cotton": ["ˈkɑtn", "ˈkɒtn"],
    "ambulance": ["ˈæmbjələns"],
    "ward": ["ˈwɔrd"],
    "clinic": ["ˈklɪnɪk"],
    "pharmacy": ["ˈfɑrməsi"],
    "midwife": ["ˈmɪdˌwaɪf"],
    "paramedic": ["ˌpærəˈmɛdɪk"],
    "physiotherapy": ["ˌfɪzioʊˈθɛrəpi"],
    "radiology": ["ˌreɪdiˈɑlədʒi"],
    "pathology": ["pəˈθɑlədʒi"],
    "anatomy": ["əˈnætəmi"],
    "physiology": ["ˌfɪziˈɑlədʒi"],
    "psychology": ["saɪˈkɑlədʒi"],
    "psychiatry": ["saɪˈkaɪətri", "sɪˈkaɪətri"],
    "neurology": ["nʊˈrɑlədʒi", "njʊˈrɒlədʒi"],
    "cardiology": ["ˌkɑrdiˈɑlədʒi"],
    "oncology": ["ɑŋˈkɑlədʒi", "ɒŋˈkɒlədʒi"],
    "pediatrics": ["ˌpidiˈætrɪks"],
    "paediatrics": ["ˌpidiˈætrɪks"],
    "obstetrics": ["əbˈstɛtrɪks"],
    "gynecology": ["ˌgaɪnəˈkɑlədʒi"],
    "urology": ["jʊˈrɑlədʒi"],
    "dermatology": ["ˌdɝməˈtɑlədʒi"],
    "ophthalmology": ["ˌɑfθəlˈmɑlədʒi", "ˌɒfθælˈmɒlədʒi"],
    "otolaryngology": ["ˌoʊtoʊˌlærɪŋˈgɑlədʒi"],
    "emergency": ["ɪˈmɝdʒənsi", "ɪˈmɜːdʒənsi"],
    "intensive": ["ɪnˈtɛnsɪv"],
    "isolation": ["ˌaɪsəˈleɪʃən"],
    "quarantine": ["ˈkwɔrənˌtin", "ˈkwɒrəntiːn"],
    "hygiene": ["ˈhaɪdʒin"],
    "sanitary": ["ˈsænɪˌtɛri"],
    "disinfect": ["ˌdɪsɪnˈfɛkt"],
    "antiseptic": ["ˌæntɪˈsɛptɪk"],
    "antibiotic": ["ˌæntibaɪˈɑtɪk", "ˌæntɪbaɪˈɒtɪk"],
    "analgesic": ["ˌænəlˈdʒizɪk", "ˌænəlˈdʒiːzɪk"],
    "anesthetic": ["ˌænəsˈθɛtɪk"],
    "anaesthetic": ["ˌænəsˈθɛtɪk"],
    "sedative": ["ˈsɛdətɪv"],
    "laxative": ["ˈlæksətɪv"],
    "diuretic": ["ˌdaɪjʊˈrɛtɪk"],
    "insulin": ["ˈɪnsələn"],
    "glucose": ["ˈglukoʊs"],
    "protein": ["ˈproʊtin"],
    "vitamin": ["ˈvaɪtəmən"],
    "calorie": ["ˈkæləri"],
    "obesity": ["oʊˈbisəti"],
    "malnutrition": ["ˌmælnuˈtrɪʃən"],
    "dehydration": ["ˌdihaɪˈdreɪʃən"],
    "constipation": ["ˌkɑnstəˈpeɪʃən"],
    "diarrhea": ["ˌdaɪəˈriə"],
    "hemorrhoid": ["ˈhɛməˌrɔɪd"],
    "haemorrhoid": ["ˈhɛməˌrɔɪd"],
    "menstruation": ["ˌmɛnstruˈeɪʃən"],
    "pregnancy": ["ˈprɛgnənsi"],
    "delivery": ["dɪˈlɪvəri"],
    "miscarriage": ["ˈmɪsˌkærɪdʒ", "ˌmɪsˈkærɪdʒ"],
    "infertility": ["ˌɪnfərˈtɪləti"],
    "contraception": ["ˌkɑntrəˈsɛpʃən"],
    "abortion": ["əˈbɔrʃən"],
    "neonatal": ["ˌnioʊˈneɪtl"],
    "pediatric": ["ˌpidiˈætrɪk"],
    "geriatric": ["ˌdʒɛriˈætrɪk"],
    "palliative": ["ˈpæliətɪv"],
    "hospice": ["ˈhɑspəs"],
    "mortality": ["mɔrˈtæləti"],
    "morbidity": ["mɔrˈbɪdəti"],
    "prognosis": ["prɑgˈnoʊsəs"],
    "diagnosis": ["ˌdaɪəgˈnoʊsəs"],
    "biopsy": ["ˈbaɪɑpsi"],
    "autopsy": ["ˈɔtɑpsi"],
    "specimen": ["ˈspɛsəmən"],
    "culture": ["ˈkʌltʃər"],
    "stool": ["ˈstul"],
    "sputum": ["ˈspjutəm"],
    "swab": ["ˈswɑb"],
    "x-ray": ["ˈɛksˌreɪ"],
    "ultrasound": ["ˈʌltrəˌsaʊnd"],
    "scan": ["ˈskæn"],
    "mri": ["ˌɛmˌɑrˈaɪ"],
    "ct": ["ˌsiˈti"],
    "ecg": ["ˌiˌsiˈdʒi"],
    "eeg": ["ˌiˌiˈdʒi"],
}

accuracy_hits = []
accuracy_miss = []
accuracy_missing_word = []
by_en = {e["en"].lower().split("(")[0].strip(): e for e in entries}
# also exact
by_en_exact = {e["en"]: e for e in entries}

for word, accepts in KNOWN.items():
    e = by_en_exact.get(word) or by_en.get(word.lower())
    if not e:
        accuracy_missing_word.append(word)
        continue
    got = (e.get("ipa") or "").strip()
    if not got:
        accuracy_miss.append((word, got, accepts, "empty"))
        continue
    # normalize soft compare: strip secondary differences later
    if got in accepts:
        accuracy_hits.append((word, got))
    else:
        # soft: ignore ː vs none already in accepts list
        accuracy_miss.append((word, got, accepts, "mismatch"))

# eng_to_ipa recompute drift for non-override words (optional)
drift = []
try:
    import eng_to_ipa as ipa_lib

    sys.path.insert(0, str(VOCAB / "_build"))
    # lightweight: sample 200 non-override single tokens
    ov_set = set(ov.keys()) | {k.lower() for k in ov}
    sample = []
    for e in entries:
        en = e["en"]
        if " " in en or "(" in en or "-" in en:
            continue
        if en in ov_set or en.lower() in ov_set:
            continue
        if not (e.get("ipa") or "").strip():
            continue
        sample.append(e)
        if len(sample) >= 250:
            break
    for e in sample:
        en = e["en"]
        got = e["ipa"].strip()
        try:
            raw = ipa_lib.convert(en)
        except Exception:
            continue
        raw = (raw or "").strip()
        if not raw or raw == en:
            continue
        # strip */ marks eng_to_ipa may add
        raw = raw.strip("*/ ")
        if got.replace("ˈ", "").replace("ˌ", "") != raw.replace("ˈ", "").replace("ˌ", ""):
            if got != raw and f"ˈ{raw}" != got and raw != got.lstrip("ˈˌ"):
                drift.append((en, got, raw))
except Exception as ex:
    drift = [("__import_error__", str(ex), "")]

report = {
    "total": len(entries),
    "with_ipa": sum(1 for e in entries if (e.get("ipa") or "").strip()),
    "empty_ipa_n": len(empty),
    "empty_ipa_sample": empty[:50],
    "norm": {
        "has_slash": has_slash[:20],
        "has_bracket": has_bracket[:20],
        "has_space_n": len(has_space),
        "has_space": has_space[:30],
        "has_ascii_apos": has_ascii_apos[:30],
        "has_colon_ascii": has_colon_ascii[:30],
        "no_stress_n": len(no_stress),
        "no_stress": no_stress[:40],
        "multi_primary": multi_primary[:30],
        "leading_weird": leading_weird[:20],
        "suspicious": suspicious[:40],
    },
    "style": {
        "tʃ_entries": n_tsh,
        "ʧ_entries": n_ch,
        "dʒ_entries": n_dzh,
        "ʤ_entries": n_j,
        "ː_entries": n_long,
        "ɚɝ_entries": n_er,
        "ər_entries": n_schwa_r,
        "note": "体系偏美式 eng_to_ipa：合体 ʧ/ʤ 多、长音 ː 极少",
    },
    "uncommon_chars": uncommon,
    "char_freq_top": char_count.most_common(50),
    "override_diff_n": len(override_diff),
    "override_diff_sample": override_diff[:40],
    "accuracy_spotcheck": {
        "known_n": len(KNOWN),
        "hit_n": len(accuracy_hits),
        "miss_n": len(accuracy_miss),
        "word_not_in_db": accuracy_missing_word,
        "misses": [
            {"en": a[0], "got": a[1], "accept": a[2], "why": a[3]} for a in accuracy_miss
        ],
        "hits_sample": accuracy_hits[:20],
    },
    "eng_to_ipa_drift_sample_n": len(drift),
    "eng_to_ipa_drift_sample": drift[:40],
}

(OUT / "norm_report.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
)

# human markdown summary
lines = []
lines.append("# METS 音标问题清单（只找问题，未改数据）")
lines.append("")
lines.append(f"- 总词 **{report['total']}**，有音标 **{report['with_ipa']}**，空音标 **{report['empty_ipa_n']}**")
lines.append(f"- 人工 overrides **{len(ov)}** 条；与库不一致 **{report['override_diff_n']}** 条")
lines.append("")
lines.append("## A. 规范性 / 体系")
lines.append("")
st = report["style"]
lines.append(
    f"- 符号体系偏 **美式 eng_to_ipa**：合体塞擦音 `ʧ`={st['ʧ_entries']} / `ʤ`={st['ʤ_entries']}；"
    f"分写 `tʃ`={st['tʃ_entries']} / `dʒ`={st['dʒ_entries']}；长音 `ː` 仅 {st['ː_entries']} 条。"
)
lines.append("- 若产品期望「英式教材 /tʃ dʒ/ + 长元音 ː」，则属**体系性偏差**，不是个别 typo。")
lines.append(f"- 无重音标记：{report['norm']['no_stress_n']} 条（样本见 JSON）")
lines.append(f"- 含空格：{report['norm']['has_space_n']} 条")
lines.append(f"- ASCII 撇号/'：{len(has_ascii_apos)}；ASCII 冒号 `:`：{len(has_colon_ascii)}")
lines.append(f"- 斜杠/方括号：slash={len(has_slash)} bracket={len(has_bracket)}")
if uncommon:
    lines.append(f"- 非常见字符：{uncommon[:20]}")
lines.append("")
lines.append("## B. 空音标（多为短语/缩写，需确认是否应补）")
lines.append("")
for w in empty[:40]:
    lines.append(f"- `{w}`")
if len(empty) > 40:
    lines.append(f"- … 共 {len(empty)} 条")
lines.append("")
lines.append("## C. overrides 与库不一致")
lines.append("")
for en, want, got in override_diff[:30]:
    lines.append(f"- `{en}`: override=`{want}` 库=`{got}`")
if len(override_diff) > 30:
    lines.append(f"- … 共 {len(override_diff)} 条")
lines.append("")
lines.append("## D. 准确性抽检（对照自建可接受列表，美式为主）")
lines.append("")
acc = report["accuracy_spotcheck"]
lines.append(
    f"- 抽检词表 {acc['known_n']}；命中 {acc['hit_n']}；疑似不准/不一致 {acc['miss_n']}；库中无此词 {len(acc['word_not_in_db'])}"
)
lines.append("")
lines.append("### 疑似问题（got vs 可接受）")
lines.append("")
for m in acc["misses"]:
    lines.append(
        f"- **{m['en']}**: 库=`{m['got']}`；可接受≈ `{ ' | '.join(m['accept']) }`（{m['why']}）"
    )
lines.append("")
lines.append("## E. 与 eng_to_ipa 现算漂移（非 override 样本）")
lines.append(f"- 样本漂移约 {report['eng_to_ipa_drift_sample_n']} 条（前 40 见 JSON）")
lines.append("")
lines.append("详细机器可读：`.cursor/browser-automation/runs/mets-ipa-audit/norm_report.json`")

(OUT / "问题清单.md").write_text("\n".join(lines), encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
print("\n".join(lines[:80]))
print("...")
print("FULL", OUT / "问题清单.md")
