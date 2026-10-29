# -*- coding: utf-8 -*-
"""Deep IPA accuracy audit — medical lexicon vs expected US IPA."""
from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path.cwd()
VOCAB = ROOT / "临时_METS二级备考" / "02_词汇"
OUT = ROOT / ".cursor" / "browser-automation" / "runs" / "mets-ipa-audit"
OUT.mkdir(parents=True, exist_ok=True)

db = json.loads((VOCAB / "vocab_db_sorted.json").read_text(encoding="utf-8"))
entries = db["entries"]
by = {e["en"]: e for e in entries}
by_low = {e["en"].lower().split("(")[0].strip(): e for e in entries}


def norm_style(s: str) -> str:
    s = s.strip().strip("/").strip("[]")
    s = s.replace("ʧ", "tʃ").replace("ʤ", "dʒ")
    s = s.replace("ɝ", "ɜr").replace("ɚ", "ər")
    s = s.replace("ː", "")
    s = s.replace("ɫ", "l")
    return s


# en -> acceptable US-ish IPA (raw); compared after norm_style
EXPECT: dict[str, list[str]] = {
    "abdomen": ["ˈæbdəmən", "æbˈdoʊmən"],
    "asthma": ["ˈæzmə"],
    "diabetes": ["ˌdaɪəˈbitiz", "ˌdaɪəˈbitis"],
    "diarrhea": ["ˌdaɪəˈriə"],
    "diarrhoea": ["ˌdaɪəˈriə"],
    "hemorrhage": ["ˈhɛmərɪdʒ"],
    "haemorrhage": ["ˈhɛmərɪdʒ"],
    "pneumonia": ["nuˈmoʊniə", "njuˈmoʊniə"],
    "vaccine": ["vækˈsin", "ˈvæksin"],
    "virus": ["ˈvaɪrəs"],
    "bacteria": ["bækˈtɪriə"],
    "pathogen": ["ˈpæθədʒən"],
    "inflammation": ["ˌɪnfləˈmeɪʃən"],
    "infection": ["ɪnˈfɛkʃən"],
    "contagious": ["kənˈteɪdʒəs"],
    "epidemic": ["ˌɛpɪˈdɛmɪk"],
    "pandemic": ["pænˈdɛmɪk"],
    "syndrome": ["ˈsɪndroʊm"],
    "symptom": ["ˈsɪmptəm"],
    "prognosis": ["prɑgˈnoʊsəs"],
    "diagnosis": ["ˌdaɪəgˈnoʊsəs"],
    "biopsy": ["ˈbaɪɑpsi"],
    "autopsy": ["ˈɔtɑpsi"],
    "catheter": ["ˈkæθətər"],
    "syringe": ["səˈrɪndʒ"],
    "scalpel": ["ˈskælpəl"],
    "suture": ["ˈsutʃər"],
    "stethoscope": ["ˈstɛθəˌskoʊp"],
    "thermometer": ["θərˈmɑmətər"],
    "auscultate": ["ˈɔskəlˌteɪt", "ˈɔskəlteɪt", "ɔˈskʌlteɪt"],
    "palpate": ["ˈpælpeɪt"],
    "otitis": ["oʊˈtaɪtəs"],
    "rhinitis": ["raɪˈnaɪtəs"],
    "pharyngitis": ["ˌfærənˈdʒaɪtəs"],
    "laryngitis": ["ˌlærənˈdʒaɪtəs"],
    "bronchitis": ["brɑŋˈkaɪtəs"],
    "meningitis": ["ˌmɛnɪnˈdʒaɪtəs", "ˌmɛnənˈdʒaɪtəs"],
    "hepatitis": ["ˌhɛpəˈtaɪtəs"],
    "nephritis": ["nəˈfraɪtəs"],
    "arthritis": ["ɑrˈθraɪtəs"],
    "dermatitis": ["ˌdɜrməˈtaɪtəs", "ˌdɝməˈtaɪtəs"],
    "appendicitis": ["əˌpɛndəˈsaɪtəs"],
    "tonsillitis": ["ˌtɑnsəˈlaɪtəs"],
    "sinusitis": ["ˌsaɪnəˈsaɪtəs"],
    "cystitis": ["sɪˈstaɪtəs"],
    "gastritis": ["gæˈstraɪtəs"],
    "colitis": ["kəˈlaɪtəs"],
    "ischemia": ["ɪˈskimiə"],
    "anemia": ["əˈnimiə"],
    "anaemia": ["əˈnimiə"],
    "leukemia": ["luˈkimiə"],
    "thrombosis": ["θrɑmˈboʊsəs"],
    "embolism": ["ˈɛmbəˌlɪzəm"],
    "infarction": ["ɪnˈfɑrkʃən"],
    "myocardial": ["ˌmaɪəˈkɑrdiəl"],
    "hypertension": ["ˌhaɪpərˈtɛnʃən"],
    "hypotension": ["ˌhaɪpoʊˈtɛnʃən"],
    "tachycardia": ["ˌtækiˈkɑrdiə"],
    "bradycardia": ["ˌbreɪdiˈkɑrdiə", "ˌbrædiˈkɑrdiə"],
    "arrhythmia": ["əˈrɪðmiə"],
    "dyspnea": ["ˈdɪspniə", "dɪspˈniə"],
    "apnea": ["ˈæpniə", "æpˈniə"],
    "tachypnea": ["ˌtækɪpˈniə", "təˈkɪpniə"],
    "cyanosis": ["ˌsaɪəˈnoʊsəs"],
    "jaundice": ["ˈdʒɔndəs", "ˈdʒɔndɪs"],
    "edema": ["ɪˈdimə"],
    "oedema": ["ɪˈdimə"],
    "cirrhosis": ["səˈroʊsəs"],
    "pancreatitis": ["ˌpæŋkriəˈtaɪtəs", "ˌpænkriəˈtaɪtəs"],
    "osteoporosis": ["ˌɑstioʊpəˈroʊsəs"],
    "rheumatoid": ["ˈruməˌtɔɪd"],
    "eczema": ["ˈɛkzəmə", "ˈɛgsəmə", "ɪgˈzimə"],
    "anaphylaxis": ["ˌænəfəˈlæksəs"],
    "epinephrine": ["ˌɛpəˈnɛfrən", "ˌɛpəˈnɛfrɪn"],
    "adrenaline": ["əˈdrɛnələn"],
    "insulin": ["ˈɪnsələn", "ˈɪnsəlɪn"],
    "glucose": ["ˈglukoʊs"],
    "hemoglobin": ["ˌhiməˈgloʊbən", "ˈhiməˌgloʊbən"],
    "platelet": ["ˈpleɪtlət"],
    "plasma": ["ˈplæzmə"],
    "serum": ["ˈsɪrəm"],
    "antigen": ["ˈæntədʒən"],
    "antibody": ["ˈæntiˌbɑdi", "ˈæntɪˌbɑdi"],
    "immunity": ["ɪˈmjunəti"],
    "palliative": ["ˈpæliətɪv"],
    "placebo": ["pləˈsiboʊ"],
    "lethal": ["ˈliθəl"],
    "fatal": ["ˈfeɪtl", "ˈfeɪtəl"],
    "etiology": ["ˌitiˈɑlədʒi"],
    "pathology": ["pəˈθɑlədʒi"],
    "oncology": ["ɑŋˈkɑlədʒi"],
    "radiology": ["ˌreɪdiˈɑlədʒi"],
    "endoscopy": ["ɛnˈdɑskəpi"],
    "colonoscopy": ["ˌkoʊləˈnɑskəpi"],
    "tracheostomy": ["ˌtreɪkiˈɑstəmi"],
    "amputation": ["ˌæmpjəˈteɪʃən"],
    "prosthesis": ["prɑsˈθisəs"],
    "orthopedic": ["ˌɔrθəˈpidɪk"],
    "physiotherapy": ["ˌfɪzioʊˈθɛrəpi"],
    "rehabilitation": ["ˌriəˌbɪləˈteɪʃən", "ˌrihəˌbɪləˈteɪʃən"],
    "intravenous": ["ˌɪntrəˈvinəs"],
    "intramuscular": ["ˌɪntrəˈmʌskjələr"],
    "subcutaneous": ["ˌsʌbkjuˈteɪniəs"],
    "pharyngeal": ["fəˈrɪndʒiəl"],
    "laryngeal": ["ləˈrɪndʒiəl"],
    "alveolar": ["ælˈviələr"],
    "cervical": ["ˈsɜrvəkəl", "ˈsɝvɪkəl", "sərˈvaɪkəl"],
    "thoracic": ["θəˈræsɪk"],
    "carotid": ["kəˈrɑtəd"],
    "varicose": ["ˈværəˌkoʊs"],
    "hemorrhoid": ["ˈhɛməˌrɔɪd"],
    "constipation": ["ˌkɑnstəˈpeɪʃən"],
    "nausea": ["ˈnɔziə", "ˈnɔʒə", "ˈnɑziə"],
    "dysphagia": ["dɪsˈfeɪdʒiə"],
    "dialysis": ["daɪˈæləsəs"],
    "chemotherapy": ["ˌkimoʊˈθɛrəpi"],
    "antibiotic": ["ˌæntibaɪˈɑtɪk", "ˌæntɪbaɪˈɑtɪk"],
    "analgesic": ["ˌænəlˈdʒizɪk"],
    "anesthetic": ["ˌænəsˈθɛtɪk"],
    "anaesthetic": ["ˌænəsˈθɛtɪk"],
    "morphine": ["ˈmɔrfin"],
    "aspirin": ["ˈæsprən", "ˈæspərən"],
    "penicillin": ["ˌpɛnəˈsɪlən"],
    "heparin": ["ˈhɛpərən"],
    "sane": ["ˈseɪn"],
    "insane": ["ɪnˈseɪn"],
    "psychosis": ["saɪˈkoʊsəs"],
    "schizophrenia": ["ˌskɪtsəˈfriniə", "ˌskɪdzəˈfriniə"],
    "dementia": ["dɪˈmɛnʃə"],
    "delirium": ["dɪˈlɪriəm"],
    "epilepsy": ["ˈɛpəˌlɛpsi"],
    "migraine": ["ˈmaɪgreɪn"],
    "paralysis": ["pəˈræləsəs"],
    "aphasia": ["əˈfeɪʒə"],
    "metastasis": ["məˈtæstəsəs"],
    "carcinoma": ["ˌkɑrsəˈnoʊmə"],
    "sarcoma": ["sɑrˈkoʊmə"],
    "lymphoma": ["lɪmˈfoʊmə"],
    "melanoma": ["ˌmɛləˈnoʊmə"],
    "benign": ["bəˈnaɪn", "bɪˈnaɪn"],
    "malignant": ["məˈlɪgnənt"],
    "sterile": ["ˈstɛrəl", "ˈstɛraɪl"],
    "aseptic": ["əˈsɛptɪk"],
    "hygiene": ["ˈhaɪdʒin"],
    "quarantine": ["ˈkwɔrənˌtin"],
    "nosocomial": ["ˌnɑsəˈkoʊmiəl"],
    "iatrogenic": ["aɪˌætrəˈdʒɛnɪk"],
    "idiopathic": ["ˌɪdioʊˈpæθɪk"],
    "congenital": ["kənˈdʒɛnətl", "kənˈdʒɛnətəl"],
    "chromosome": ["ˈkroʊməˌsoʊm"],
    "salivary": ["ˈsæləˌvɛri", "səˈlaɪvəri"],
    "gingiva": ["dʒɪnˈdʒaɪvə", "ˈdʒɪndʒɪvə"],
    "heme": ["ˈhim", "ˈhiːm"],
    "cecum": ["ˈsikəm", "ˈsiːkəm"],
    "varix": ["ˈvɛrɪks", "ˈværɪks"],
    "meatus": ["miˈeɪtəs"],
    "care": ["ˈkɛr", "ˈkeɚ", "ˈkɛɚ"],
    "nurse": ["ˈnɝs", "ˈnɜrs"],
    "patient": ["ˈpeɪʃənt"],
    "surgery": ["ˈsɜrdʒəri", "ˈsɝdʒəri"],
    "emergency": ["ɪˈmɜrdʒənsi", "ɪˈmɝdʒənsi"],
    "hospital": ["ˈhɑspɪtl", "ˈhɑspɪtəl"],
    "doctor": ["ˈdɑktər"],
    "blood": ["ˈblʌd"],
    "heart": ["ˈhɑrt"],
    "pain": ["ˈpeɪn"],
    "wound": ["ˈwund", "ˈwaʊnd"],
    "muscle": ["ˈmʌsəl"],
    "oxygen": ["ˈɑksɪdʒən"],
    "cough": ["ˈkɔf"],
    "fever": ["ˈfivər"],
    "cell": ["ˈsɛl"],
    "bone": ["ˈboʊn"],
    "skin": ["ˈskɪn"],
    "tongue": ["ˈtʌŋ"],
    "stomach": ["ˈstʌmək"],
    "liver": ["ˈlɪvər"],
    "kidney": ["ˈkɪdni"],
    "urine": ["ˈjʊrən", "ˈjʊrɪn"],
    "pulse": ["ˈpʌls"],
    "breath": ["ˈbrɛθ"],
    "breathe": ["ˈbrið"],
}

ok, miss, not_found = [], [], []
for en, accepts in EXPECT.items():
    e = by.get(en) or by_low.get(en.lower())
    if not e:
        not_found.append(en)
        continue
    got = (e.get("ipa") or "").strip()
    if not got:
        miss.append((en, "(empty)", accepts))
        continue
    ng = norm_style(got)
    na = [norm_style(x) for x in accepts]
    if ng in na:
        ok.append((en, got))
    else:
        miss.append((en, got, accepts))

pattern_flags: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
for e in entries:
    en, ipa = e["en"], (e.get("ipa") or "")
    if not ipa:
        continue
    low = en.lower()
    if low.endswith("itis") and "aɪt" not in ipa:
        pattern_flags["itis_no_aɪt"].append((en, ipa))
    if low.endswith("ology") and "ɑlə" not in ipa and "ɒlə" not in ipa:
        pattern_flags["ology_no_ɑlə"].append((en, ipa))
    if "*" in ipa:
        pattern_flags["star_mark"].append((en, ipa))
    # primary stress appears twice
    if ipa.count("ˈ") >= 2:
        pattern_flags["multi_primary_stress"].append((en, ipa))
    # looks like eng_to_ipa failed and returned English letters only weird
    if re.fullmatch(r"[ˈˌa-z]+", ipa) and len(ipa) > 12 and not any(
        c in ipa for c in "əɪæɑɔʊʌɛθðʃʒŋ"
    ):
        pattern_flags["ascii_only_long"].append((en, ipa))

bare_open_e = []
for e in entries:
    ipa = e.get("ipa") or ""
    if "ɜ" not in ipa:
        continue
    for m in re.finditer("ɜ", ipa):
        i = m.start()
        nxt = ipa[i + 1 : i + 2]
        if nxt != "r":
            bare_open_e.append((e["en"], ipa))
            break

# ʤ/ʧ mixture inconsistency within same lemma family — already style
# Find entries where IPA contains clearly wrong English residue
residue = []
for e in entries:
    ipa = e.get("ipa") or ""
    if re.search(r"(tion|sion|ough|augh|ight)", ipa):
        residue.append((e["en"], ipa))

summary = {
    "accuracy_ok": len(ok),
    "accuracy_miss": len(miss),
    "not_found_n": len(not_found),
    "not_found": not_found,
    "misses": [
        {
            "en": a[0],
            "got": a[1],
            "got_norm": norm_style(a[1]) if a[1] != "(empty)" else "",
            "accept": a[2],
        }
        for a in miss
    ],
    "pattern_counts": {k: len(v) for k, v in pattern_flags.items()},
    "pattern_flags": {k: v[:30] for k, v in pattern_flags.items()},
    "bare_ɜ_n": len(bare_open_e),
    "bare_ɜ_sample": bare_open_e[:30],
    "english_residue_in_ipa": residue[:20],
}

(OUT / "accuracy_deep.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
)

# Merge into human report
prev = (OUT / "问题清单.md").read_text(encoding="utf-8") if (OUT / "问题清单.md").exists() else ""
extra = []
extra.append("\n\n---\n\n# 深度准确性（医疗词抽检，符号变体已归一）\n")
extra.append(
    f"- 抽检期望表 **{len(EXPECT)}** 词：命中 **{len(ok)}**；疑似不准 **{len(miss)}**；库中无词 **{len(not_found)}**\n"
)
extra.append("\n## 疑似不准（规范化后仍对不上）\n")
for a in miss:
    extra.append(f"- **{a[0]}**: 库=`{a[1]}`；期望≈ `{' | '.join(a[2][:3])}`\n")
extra.append("\n## 模式扫描\n")
for k, n in summary["pattern_counts"].items():
    extra.append(f"\n### {k}（{n}）\n")
    for en, ipa in pattern_flags[k][:20]:
        extra.append(f"- `{en}` → `{ipa}`\n")
extra.append(f"\n## `ɜ` 后无 `r`（美式常作 ɝ / ər；共 {len(bare_open_e)}）\n")
for en, ipa in bare_open_e[:25]:
    extra.append(f"- `{en}` → `{ipa}`\n")
if residue:
    extra.append("\n## IPA 里残留英语拼写片段\n")
    for en, ipa in residue[:20]:
        extra.append(f"- `{en}` → `{ipa}`\n")

extra.append(
    "\n\n> 说明：本报告**只找问题、未改库**。体系层（美式、无长音 ː、ʧ/ʤ 合体）与个别词对错分开看。终审以词典 + 你们选定的口音体系为准。\n"
)

(OUT / "问题清单.md").write_text(prev + "".join(extra), encoding="utf-8")
print(f"ok={len(ok)} miss={len(miss)} not_found={len(not_found)}")
print("patterns", summary["pattern_counts"])
print("bare_ɜ", len(bare_open_e))
print("MISS:")
for a in miss:
    print(f"  {a[0]}: {a[1]}")
