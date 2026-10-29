# -*- coding: utf-8 -*-
"""Strict quality audit of regenerated British IPA."""
from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

OUT = Path(".cursor/browser-automation/runs/mets-ipa-audit")
OUT.mkdir(parents=True, exist_ok=True)

db = json.loads(
    Path("临时_METS二级备考/02_词汇/vocab_db_sorted.json").read_text(encoding="utf-8")
)
entries = db["entries"]
assert str(db.get("ipa_engine", "")).startswith("espeak"), "engine not british espeak"

issues: dict[str, list] = collections.defaultdict(list)

for e in entries:
    en, ipa = e["en"], (e.get("ipa") or "").strip()
    if not ipa:
        continue
    if ipa.count("ˈ") >= 2:
        issues["dual_primary"].append((en, ipa))
    if "ˈ" not in ipa and "ˌ" not in ipa:
        issues["no_stress"].append((en, ipa))
    if any(c in ipa for c in "ɚɝɹʧʤɐ"):
        issues["us_or_odd_chars"].append((en, ipa))
    if "͡" in ipa or "\u200d" in ipa:
        issues["tie"].append((en, ipa))
    if " " in ipa or "/" in ipa or "[" in ipa:
        issues["fmt"].append((en, ipa))
    if ":" in ipa:
        issues["ascii_colon"].append((en, ipa))
    if re.search(r"[A-Z0-9]", ipa):
        issues["upper_digit"].append((en, ipa))
    if "ˈˈ" in ipa or "ˌˌ" in ipa or "ˈˌ" in ipa or "ˌˈ" in ipa:
        issues["adj_stress"].append((en, ipa))
    if ipa.startswith("ː"):
        issues["lead_length"].append((en, ipa))
    if "ˈː" in ipa or "ˌː" in ipa:
        issues["stress_then_length"].append((en, ipa))
    bare = re.sub(r"[ˈˌː]", "", ipa)
    if len(bare) < 1:
        issues["too_short"].append((en, ipa))
    if re.search(r"ɔːˈeɪ|əˈeɪʃ", ipa):
        issues["possible_missing_onset"].append((en, ipa))
    # secondary only, no primary
    if "ˌ" in ipa and "ˈ" not in ipa:
        issues["secondary_only"].append((en, ipa))

EXPECT: dict[str, str | list[str]] = {
    "bleed": "ˈbliːd",
    "care": "ˈkeə",
    "nurse": "ˈnɜːs",
    "patient": "ˈpeɪʃənt",
    "cheek": "ˈtʃiːk",
    "jaw": "ˈdʒɔː",
    "blood": "ˈblʌd",
    "pain": "ˈpeɪn",
    "fever": "ˈfiːvə",
    "cough": "ˈkɒf",
    "heart": "ˈhɑːt",
    "mask": "ˈmɑːsk",
    "bone": "ˈbəʊn",
    "skin": "ˈskɪn",
    "eye": "ˈaɪ",
    "ear": "ˈɪə",
    "nose": "ˈnəʊz",
    "mouth": "ˈmaʊθ",
    "tooth": "ˈtuːθ",
    "tongue": "ˈtʌŋ",
    "breath": "ˈbreθ",
    "breathe": "ˈbriːð",
    "wound": ["ˈwuːnd", "ˈwaʊnd"],
    "muscle": ["ˈmʌsl", "ˈmʌsəl"],
    "virus": ["ˈvaɪərəs", "ˈvaɪrəs"],
    "cancer": "ˈkænsə",
    "doctor": "ˈdɒktə",
    "surgery": ["ˈsɜːdʒəri", "ˈsɜːdʒərɪ"],
    "oxygen": ["ˈɒksɪdʒən", "ˈɒksɪdʒɪn"],
    "asthma": ["ˈæsmə", "ˈæsmə"],
    "diabetes": ["ˌdaɪəˈbiːtiːz", "ˌdaɪəˈbiːtiːs"],
    "pneumonia": ["njuːˈməʊniə", "njuːˈməʊnjə"],
    "vaccine": ["ˈvæksiːn", "vækˈsiːn"],
    "infection": ["ɪnˈfekʃən", "ɪnˈfekʃn"],
    "symptom": "ˈsɪmptəm",
    "shuffling": "ˈʃʌflɪŋ",
    "duration": ["dʒʊˈreɪʃən", "djʊˈreɪʃən", "dʒəˈreɪʃən", "djɔːˈreɪʃən"],
    "AIDS": "ˈeɪdz",
    "pulse": "ˈpʌls",
    "liver": "ˈlɪvə",
    "kidney": "ˈkɪdni",
    "stomach": "ˈstʌmək",
    "fracture": "ˈfræktʃə",
    "bruise": "ˈbruːz",
    "syringe": ["sɪˈrɪndʒ", "səˈrɪndʒ"],
    "scalpel": "ˈskælpəl",
    "clinic": "ˈklɪnɪk",
    "ward": "ˈwɔːd",
    "hygiene": ["ˈhaɪdʒiːn", "ˈhaɪdʒiːn"],
    "sane": "ˈseɪn",
    "insane": ["ɪnˈseɪn", "ˌɪnˈseɪn"],
    "acute": "əˈkjuːt",
    "chronic": "ˈkrɒnɪk",
    "benign": ["bɪˈnaɪn", "bəˈnaɪn"],
    "malignant": "məˈlɪɡnənt",
    "emergency": "ɪˈmɜːdʒənsi",
    "aspirin": ["ˈæsprɪn", "ˈæspərɪn"],
    "insulin": ["ˈɪnsjʊlɪn", "ˈɪnsəlɪn"],
    "glucose": ["ˈɡluːkəʊs", "ˈgluːkəʊs"],
    "protein": "ˈprəʊtiːn",
    "gene": "ˈdʒiːn",
    "coma": "ˈkəʊmə",
    "seizure": "ˈsiːʒə",
    "arthritis": ["ɑːˈθraɪtɪs", "ɑːˈθraɪtəs"],
    "hepatitis": ["ˌhepəˈtaɪtɪs", "ˌhepəˈtaɪtəs"],
    "bronchitis": ["brɒŋˈkaɪtɪs", "brɒŋˈkaɪtəs"],
    "otitis": ["əʊˈtaɪtɪs", "əʊˈtaɪtəs", "oʊˈtaɪtəs"],
    "pathology": "pəˈθɒlədʒi",
    "anatomy": "əˈnætəmi",
    "psychology": "saɪˈkɒlədʒi",
    "sterile": ["ˈsteraɪl", "ˈsterɪl", "ˈstɛraɪl"],
    "aseptic": ["eɪˈseptɪk", "əˈseptɪk", "eɪˈsɛptɪk"],
    "migraine": ["ˈmiːɡreɪn", "ˈmaɪɡreɪn"],
    "subcutaneous": ["ˌsʌbkjuːˈteɪniəs", "sʌbkjuːˈteɪniəs"],
    "intravenous": ["ˌɪntrəˈviːnəs", "ˌɪntrəˈviːnəs"],
    "antibiotic": ["ˌæntibaɪˈɒtɪk", "ˌæntɪbaɪˈɒtɪk"],
    "chemotherapy": ["ˌkiːməʊˈθerəpi", "ˌkeməʊˈθerəpi"],
    "diarrhea": ["ˌdaɪəˈrɪə", "ˌdaɪəˈriːə"],
    "diarrhoea": ["ˌdaɪəˈrɪə", "ˌdaɪəˈriːə"],
    "nausea": ["ˈnɔːziə", "ˈnɔːsiə"],
    "vomit": "ˈvɒmɪt",
    "abdomen": ["ˈæbdəmən", "æbˈdəʊmən"],
    "catheter": ["ˈkæθɪtə", "ˈkæθətə"],
    "ambulance": ["ˈæmbjʊləns", "ˈæmbjələns"],
    "pharmacy": "ˈfɑːməsi",
    "midwife": ["ˈmɪdwaɪf", "ˈmɪdˌwaɪf"],
    "quarantine": ["ˈkwɒrəntiːn", "ˈkwɒrəntiːn"],
    "allergy": ["ˈælədʒi", "ˈælədʒɪ"],
    "anemia": ["əˈniːmiə"],
    "anaemia": ["əˈniːmiə"],
    "leukemia": ["luːˈkiːmiə", "ljuːˈkiːmiə"],
    "diagnosis": ["ˌdaɪəɡˈnəʊsɪs", "ˌdaɪəgˈnəʊsɪs"],
    "prognosis": ["prɒɡˈnəʊsɪs", "prɒgˈnəʊsɪs"],
    "biopsy": ["ˈbaɪɒpsi"],
    "autopsy": ["ˈɔːtɒpsi"],
    "metastasis": ["məˈtæstəsɪs"],
    "carcinoma": ["ˌkɑːsɪˈnəʊmə"],
    "morphine": ["ˈmɔːfiːn"],
    "vitamin": ["ˈvɪtəmɪn"],
    "obesity": ["əʊˈbiːsɪti"],
    "dehydration": ["ˌdiːhaɪˈdreɪʃən"],
    "hypertension": ["ˌhaɪpəˈtenʃən"],
    "hypotension": ["ˌhaɪpəʊˈtenʃən"],
    "tachycardia": ["ˌtækɪˈkɑːdiə"],
    "epilepsy": ["ˈepɪlepsi"],
    "paralysis": ["pəˈræləsɪs"],
    "dementia": ["dɪˈmenʃə"],
    "delirium": ["dɪˈlɪriəm"],
    "concussion": ["kənˈkʌʃən"],
    "amputation": ["ˌæmpjʊˈteɪʃən"],
    "physiotherapy": ["ˌfɪziəʊˈθerəpi"],
    "palliative": ["ˈpæliətɪv"],
    "isolation": ["ˌaɪsəˈleɪʃən"],
    "chromosome": ["ˈkrəʊməsəʊm"],
    "mutation": ["mjuːˈteɪʃən"],
    "genetic": ["dʒɪˈnetɪk", "dʒəˈnetɪk"],
    "congenital": ["kənˈdʒenɪtl", "kənˈdʒenɪtəl"],
    "radiology": ["ˌreɪdiˈɒlədʒi"],
    "oncology": ["ɒŋˈkɒlədʒi"],
    "cardiology": ["ˌkɑːdiˈɒlədʒi"],
    "neurology": ["njʊəˈrɒlədʒi", "njʊˈrɒlədʒi"],
    "psychiatry": ["saɪˈkaɪətri"],
    "anatomy": ["əˈnætəmi"],
}

by = {e["en"]: e for e in entries}
by_low = {e["en"].lower().split("(")[0].strip(): e for e in entries}


def norm(s: str) -> str:
    return s.replace("ɡ", "g")


miss = []
ok = []
nf = []
for en, exp in EXPECT.items():
    e = by.get(en) or by_low.get(en.lower())
    if not e:
        nf.append(en)
        continue
    got = (e.get("ipa") or "").strip()
    accepts = exp if isinstance(exp, list) else [exp]
    if norm(got) in [norm(a) for a in accepts]:
        ok.append(en)
    else:
        miss.append((en, got, accepts))

print("=== STRUCTURE ===")
for k, v in sorted(issues.items(), key=lambda x: -len(x[1])):
    print(f"{k}: {len(v)}")
    for row in v[:12]:
        print(f"  {row}")

print(
    f"\n=== ACCURACY expect={len(EXPECT)} ok={len(ok)} miss={len(miss)} not_in_db={len(nf)} ==="
)
for en, got, acc in miss:
    print(f"  FAIL {en}: got=/{got}/ want≈{' | '.join(acc)}")

cc = collections.Counter()
for e in entries:
    for c in e.get("ipa") or "":
        cc[c] += 1
odd = [
    (c, n)
    for c, n in cc.items()
    if c
    not in set("abcdefghijklmnopqrstuvwxyzɑɒæʌəɜɪɛɔʊθðʃʒŋˈˌːɡʲʷ()-")
]
print("\n=== ODD CHARS ===", odd)

bad_phrase = []
for e in entries:
    en = e["en"]
    ipa = (e.get("ipa") or "").strip()
    base = re.sub(r"\s*\([^)]*\)\s*", "", en).strip()
    if ipa and (" " in base or "=" in base):
        bad_phrase.append((en, ipa))
print("phrases_with_ipa", len(bad_phrase), bad_phrase[:8])

cat = json.loads(
    Path("临时_METS二级备考/05_背词网页/dist/data/catalog.json").read_text(
        encoding="utf-8"
    )
)
cm = {e["en"]: e.get("ipa") or "" for e in cat["entries"]}
diff = sum(
    1 for e in entries if cm.get(e["en"], "") != (e.get("ipa") or "")
)
print("catalog_mismatch", diff)

# empty single words
empty_single = []
for e in entries:
    if (e.get("ipa") or "").strip():
        continue
    base = re.sub(r"\s*\([^)]*\)\s*", "", e["en"]).strip()
    if " " not in base and "=" not in base:
        empty_single.append(e["en"])
print("empty_single", empty_single)

report = {
    "structure_counts": {k: len(v) for k, v in issues.items()},
    "structure": {k: v[:80] for k, v in issues.items()},
    "accuracy_ok_n": len(ok),
    "accuracy_miss": [{"en": a[0], "got": a[1], "want": a[2]} for a in miss],
    "not_in_db": nf,
    "odd_chars": odd,
    "phrases_with_ipa": bad_phrase,
    "catalog_mismatch": diff,
    "empty_single": empty_single,
}
(OUT / "british_recheck.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("wrote", OUT / "british_recheck.json")
