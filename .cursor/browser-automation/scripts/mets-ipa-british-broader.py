# -*- coding: utf-8 -*-
"""Broader IPA QA beyond prior gate."""
from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

db = json.loads(
    Path("临时_METS二级备考/02_词汇/vocab_db_sorted.json").read_text(encoding="utf-8")
)
cat = json.loads(
    Path("临时_METS二级备考/05_背词网页/dist/data/catalog.json").read_text(
        encoding="utf-8"
    )
)
ov = json.loads(
    Path("临时_METS二级备考/02_词汇/_build/ipa_overrides.json").read_text(
        encoding="utf-8"
    )
)
entries = db["entries"]
ce = {e["en"]: e for e in cat["entries"]}
issues: dict[str, list] = collections.defaultdict(list)


def is_phrase_like(en: str) -> bool:
    base = re.sub(r"\s*\([^)]*\)\s*", "", en).strip()
    return (" " in base) or ("=" in base)


for e in entries:
    en = e["en"]
    ipa = (e.get("ipa") or "").strip()
    c = ce.get(en)
    if not c:
        issues["missing_in_catalog"].append(en)
    elif (c.get("ipa") or "") != (e.get("ipa") or ""):
        issues["catalog_diff"].append((en, e.get("ipa"), c.get("ipa")))

    if not ipa:
        if not is_phrase_like(en):
            bare = re.sub(r"[^A-Za-z]", "", en.split("(")[0])
            if bare.isupper() and len(bare) >= 2:
                issues["empty_acronym_ok"].append(en)
            else:
                issues["empty_unexpected"].append(en)
        continue

    if ipa.count("ˈ") >= 2:
        issues["dual_primary"].append((en, ipa))
    if "ˈ" not in ipa and "ˌ" in ipa:
        issues["secondary_only"].append((en, ipa))
    if any(ch in ipa for ch in "ɚɝɹʧʤɐ͡ɡ"):
        issues["legacy_chars"].append((en, ipa))
    if " " in ipa or "/" in ipa or "[" in ipa or "]" in ipa or "\\" in ipa:
        issues["bad_fmt"].append((en, ipa))
    if re.search(r"[A-Z0-9]", ipa):
        issues["upper_digit"].append((en, ipa))
    if ":" in ipa:
        issues["ascii_colon"].append((en, ipa))
    if ipa.startswith("ː") or "ˈː" in ipa or "ˌː" in ipa:
        issues["length_pos"].append((en, ipa))
    if "ˈˈ" in ipa or "ˌˌ" in ipa or "ˈˌ" in ipa or "ˌˈ" in ipa:
        issues["adj_stress"].append((en, ipa))
    if ipa.endswith("ˈ") or ipa.endswith("ˌ"):
        issues["stress_tail"].append((en, ipa))
    if len(re.sub(r"[ˈˌː]", "", ipa)) < 1:
        issues["too_short"].append((en, ipa))
    if "-" in ipa:
        issues["hyphen_in_ipa"].append((en, ipa))
    if re.search(r"(tion|sion|ough|augh|ight|eous)", ipa):
        issues["english_residue"].append((en, ipa))
    if re.search(r"(?<![æɑɒɔ])aˈɪ|eˈɪ|oˈʊ|ɑˈʊ|ɔˈɪ", ipa):
        issues["split_diphthong"].append((en, ipa))
    if re.match(r"ɪˈn[a-zʃʒθð]", ipa):
        issues["suspect_in_prefix"].append((en, ipa))
    # espeak leftover: stress inside onset like gˈr (should be rare now)
    if re.search(r"(?:^|[^ˈˌaeiouɑɒæʌəɜɪɛɔʊː])[bcdfghklmnpstvwz]ˈ[bcdfghklmnpstvwzlrjw]", ipa):
        issues["stress_inside_onset"].append((en, ipa))

ov_miss = []
by = {e["en"]: e for e in entries}
by_low = {e["en"].lower().split("(")[0].strip(): e for e in entries}
for k, want in ov.items():
    e = by.get(k) or by_low.get(k.lower())
    if not e:
        continue
    got = (e.get("ipa") or "").strip()
    if got != want.replace("ɡ", "g"):
        ov_miss.append((k, want, got))

suffix_bad = []
for e in entries:
    en = e["en"].lower().split("(")[0].strip()
    ipa = e.get("ipa") or ""
    if not ipa:
        continue
    if en.endswith("itis") and "aɪt" not in ipa:
        suffix_bad.append(("itis", e["en"], ipa))
    if en.endswith("ology") and "ɒlə" not in ipa and "ɑlə" not in ipa:
        suffix_bad.append(("ology", e["en"], ipa))
    if en.endswith("ectomy") and "ektəmi" not in ipa and "ɛktəmi" not in ipa:
        suffix_bad.append(("ectomy", e["en"], ipa))

MORE = {
    "procedure": ["prəˈsiːdʒə"],
    "larynx": ["ˈlærɪŋks"],
    "stretcher": ["ˈstretʃə", "ˈstrɛtʃə"],
    "reactivate": ["riˈæktɪveɪt", "ˌriːˈæktɪveɪt", "rɪˈæktɪˌneɪt", "rɪˈæktɪˌveɪt"],
    "eliminate": ["ɪˈlɪmɪneɪt", "ɪˈlɪmɪˌneɪt"],
    "vascular": ["ˈvæskjʊlə", "ˈvæskjələ"],
    "exhale": ["eksˈheɪl", "ɛksˈheɪl"],
    "X-ray": ["ˈeksreɪ", "ˌeksˈreɪ", "ˌɛksˈreɪ"],
    "glossal": ["ˈglɒsəl"],
    "grunt": ["ˈgrʌnt"],
    "growth": ["ˈgrəʊθ"],
    "gland": ["ˈglænd"],
    "glove": ["ˈglʌv"],
    "transfusion": ["trænsˈfjuːʒən"],
    "gravity": ["ˈgrævɪti", "ˈgrævətɪ", "ˈgrævɪtɪ"],
    "graft": ["ˈgrɑːft"],
    "grave": ["ˈgreɪv"],
    "heartburn": ["ˈhɑːtbɜːn"],
    "diabetes": ["ˌdaɪəˈbiːtiːz"],
    "patient": ["ˈpeɪʃənt"],
    "infection": ["ɪnˈfekʃən"],
    "duration": ["dʒʊˈreɪʃən"],
}
more_fail = []
for w, acc in MORE.items():
    e = by.get(w) or by_low.get(w.lower())
    if not e:
        continue
    got = e.get("ipa") or ""
    if got not in acc:
        more_fail.append((w, got, acc))

# long-word stress sanity: more than 4 vowels but only one stress mark at start — soft warn
soft = []
for e in entries:
    ipa = e.get("ipa") or ""
    if not ipa:
        continue
    vowels = len(re.findall(r"[aeiouɑɒæʌəɜɪɛɔʊ]", ipa))
    if vowels >= 5 and ipa.startswith("ˈ") and "ˌ" not in ipa and ipa.count("ˈ") == 1:
        # many long words need secondary — warn only
        soft.append((e["en"], ipa, vowels))

n = len(entries)
with_ipa = sum(1 for e in entries if (e.get("ipa") or "").strip())
print("engine", db.get("ipa_engine"), "regen", db.get("ipa_regenerated_at"))
print("n", n, "with_ipa", with_ipa, "empty", n - with_ipa)
print("overrides", len(ov), "override_mismatch", len(ov_miss))
print("--- ISSUE COUNTS ---")
for k in sorted(issues, key=lambda x: -len(issues[x])):
    tag = " (expected)" if k == "empty_acronym_ok" else ""
    print(f"{k}: {len(issues[k])}{tag}")
    if k == "empty_acronym_ok":
        continue
    for row in issues[k][:15]:
        print("   ", row)
print("suffix_bad", len(suffix_bad))
for row in suffix_bad[:20]:
    print("  ", row)
print("more_fail", more_fail)
print("ov_miss", ov_miss[:20])
print("soft_long_no_secondary", len(soft), "sample", soft[:8])

# real problems = all issues except empty_acronym_ok
real = {k: v for k, v in issues.items() if k != "empty_acronym_ok"}
print(
    "REAL_PROBLEM_TOTAL",
    sum(len(v) for v in real.values()) + len(suffix_bad) + len(more_fail) + len(ov_miss),
)

out = Path(".cursor/browser-automation/runs/mets-ipa-audit/british_broader_check.json")
out.write_text(
    json.dumps(
        {
            "issue_counts": {k: len(v) for k, v in issues.items()},
            "issues": {k: v[:50] for k, v in issues.items()},
            "suffix_bad": suffix_bad,
            "more_fail": [{"en": a[0], "got": a[1], "want": a[2]} for a in more_fail],
            "ov_miss": ov_miss[:50],
            "soft_long_no_secondary_n": len(soft),
        },
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)
print("wrote", out)
