"""Stylesheet-specific (style_profile) rules, applied when a stylesheet is applied.

The cached technical scan is stylesheet-free. Lists that differ per client or per
book (a publisher word list, organisation names, registered marks that must appear
at first mention, acronyms that are never spelled out, the unit abbreviation set)
live in the stylesheet's ``style_profile`` and are applied here:

* ``profile_findings`` scans the document text against the lists and returns new
  findings (R47 publisher word list, R96 extra words to avoid, R43 missing ® at
  first mention, R46 extra product names).
* ``adjust_findings`` re-decides existing findings with the profile (R31 acronyms
  on the never-spell-out list, R4 time units written out in text but abbreviated
  in tables, figures and dosages).

style_profile keys used (all optional):
  word_replacements:  [{"find": "co-morbidity", "replace": "comorbidity", "note": "..."}]
  org_names:          [{"find": "American Nurses' Association", "replace": "American Nurses Association"}]
  avoid_words:        {"whilst": "while"}
  registered_terms:   ["NCLEX-RN", "Magnet"]  (® at first mention in each chapter)
  acronyms_no_spellout: ["AIDS", "MRI", ...]
  unit_style:         {"time_in_text": "spelled", "abbreviations": {"hour": "hr", "minute": "min", "second": "sec",
                        "day": "d", "week": "wk", "year": "y"}}
  product_terms:      {"kindle": ["Kindle", "e-reader"]}
"""
from __future__ import annotations

import re
from typing import Iterable

from manuscript_core.extractor import Segment
from manuscript_core.rules.base import Finding, iter_unmasked_matches
from manuscript_core.rules.finding_builder import build_finding

QUERY = "QUERY"


def _term_pattern(term: str) -> re.Pattern:
    prefix = r"\b" if term[:1].isalnum() else ""
    suffix = r"\b" if term[-1:].isalnum() else ""
    flags = 0 if any(c.isupper() for c in term) else re.IGNORECASE
    return re.compile(prefix + re.escape(term).replace(r"\ ", r"\s+") + suffix, flags)


def _match_case(src: str, target: str) -> str:
    if src[:1].isupper() and target[:1].islower():
        return target[:1].upper() + target[1:]
    return target


def _pairs(entries) -> list[tuple[str, str]]:
    out = []
    for e in entries or []:
        if isinstance(e, dict):
            find, rep = (e.get("find") or "").strip(), (e.get("replace") or "").strip()
        elif isinstance(e, (list, tuple)) and len(e) >= 2:
            find, rep = str(e[0]).strip(), str(e[1]).strip()
        else:
            continue
        if find and rep and find != rep:
            out.append((find, rep))
    # Longest first so "emergency room" wins over "room"
    return sorted(out, key=lambda p: -len(p[0]))


def profile_findings(segments: Iterable[Segment], profile: dict) -> list[Finding]:
    if not profile:
        return []
    words = _pairs(profile.get("word_replacements"))
    orgs = _pairs(profile.get("org_names"))
    avoid = _pairs((profile.get("avoid_words") or {}).items())
    registered = [t for t in (profile.get("registered_terms") or []) if t]
    products = {k.lower(): v for k, v in (profile.get("product_terms") or {}).items() if isinstance(v, (list, tuple))}
    compiled = ([(_term_pattern(f), r, "wordlist_variant", "Publisher word list") for f, r in words]
                + [(_term_pattern(f), r, "org_name_variant", "Organization name") for f, r in orgs]
                + [(_term_pattern(f), r, "avoid_word", "Word to avoid") for f, r in avoid])
    reg_patterns = [(t, re.compile(r"\b" + re.escape(t) + r"(?![-\w])(\s*[®™])?")) for t in registered]
    prod_patterns = [(re.compile(r"\b" + re.escape(k) + r"\b", re.IGNORECASE), v) for k, v in products.items()]

    red_flags = profile.get("red_flags") or []
    compiled_red_flags: list[tuple[re.Pattern, str]] = []
    for rf in red_flags:
        if isinstance(rf, dict) and rf.get("pattern"):
            try:
                cpat = re.compile(rf["pattern"], re.IGNORECASE)
                compiled_red_flags.append((cpat, rf.get("message") or "Editorial Red Flag"))
            except Exception:
                pass

    out: list[Finding] = []
    seen_reg: set[tuple[int, str]] = set()
    for seg in segments:
        if seg.excluded:
            continue
        taken: list[tuple[int, int]] = []

        # Red flags run across both running text and reference sections
        for pat, msg in compiled_red_flags:
            for m in iter_unmasked_matches(pat, seg.text, seg.mask):
                taken.append((m.start(), m.end()))
                out.append(build_finding(seg, m.start(), m.end(), "red_flag",
                                         f"Red Flag: {msg}", "red_flag",
                                         option_replacements={"1": "QUERY", "2": None}))

        if seg.region in ("front", "references"):
            continue

        for pat, rep, rule_id, label in compiled:
            for m in iter_unmasked_matches(pat, seg.text, seg.mask):
                if any(a < m.end() and m.start() < b for a, b in taken):
                    continue
                if m.group(0) == rep:
                    continue
                taken.append((m.start(), m.end()))
                target = _match_case(m.group(0), rep)
                opts = {"1": target, "2": QUERY, "3": None} if rule_id == "avoid_word" else {"1": target, "2": None, "3": QUERY}
                out.append(build_finding(seg, m.start(), m.end(), rule_id, f"{label}: {rep}", rule_id,
                                         option_replacements=opts))
        for term, pat in reg_patterns:
            for m in pat.finditer(seg.text):
                key = (seg.chapter_index, term)
                first = key not in seen_reg
                seen_reg.add(key)
                if first and not m.group(1):
                    end = m.start() + len(term)
                    out.append(build_finding(seg, m.start(), end, "sym_registered_missing",
                                             f"{term}: registration mark at first mention", "trademark_style",
                                             option_replacements={"1": None, "2": term + "®", "3": None}))
        for pat, (correct, generic) in prod_patterns:
            for m in iter_unmasked_matches(pat, seg.text, seg.mask):
                opts = {"1": correct if m.group(0) != correct else None, "2": generic, "3": QUERY}
                out.append(build_finding(seg, m.start(), m.end(), "product_name", "Trademarked product name",
                                         "product_name_style", option_replacements=opts))
    return out


_TIME_UNITS = {
    "hour": ("unit_hour_h", "unit_hour_hr", "unit_hour_spelled"),
    "minute": ("unit_min_abbr", "unit_min_spelled"),
    "second": ("unit_sec_s", "unit_sec_abbr", "unit_sec_spelled"),
}
_TIME_RULE_TO_UNIT = {rid: unit for unit, rids in _TIME_UNITS.items() for rid in rids}
_TABLE_LIKE = ("table", "caption")


def _ctx_before(context: str | None) -> str:
    """Text before the match in a context snippet ("… before ⟪match⟫ after …")."""
    ctx = context or ""
    return ctx.split("⟪")[0] if "⟪" in ctx else ""


def _spelled(unit: str, surface: str, before: str) -> str:
    plural = not re.search(r"\b(?:1|one|a|an)\s*$", before.strip().lower() + " ")
    word = unit + ("s" if plural else "")
    return word[0].upper() + word[1:] if surface[:1].isupper() else word


def adjust_findings(findings: list[dict], profile: dict) -> list[dict]:
    """Re-decide scan findings using the stylesheet's lists (findings are dicts from the scan)."""
    if not profile:
        return findings
    registered = sorted({t for t in (profile.get("registered_terms") or []) if t}, key=len, reverse=True)
    if registered:
        seen: set[tuple] = set()
        marks = [f for f in findings if f.get("rule_id") in ("sym_registered_char", "sym_trademark_char")]
        marks.sort(key=lambda f: (f.get("chapter_index") or 0, f.get("para_index") or 0, f.get("match_start") or 0))
        for f in marks:
            before = _ctx_before(f.get("context"))
            term = next((t for t in registered if before.rstrip().endswith(t)), None)
            if not term:
                continue
            key = (f.get("chapter_index"), term)
            keep = key not in seen
            seen.add(key)
            # Option 1 (omit marks) keeps a listed term's mark at its first mention per chapter.
            f["option_replacements"] = {**(f.get("option_replacements") or {}),
                                        "1": f.get("surface") if keep else ""}
    no_spell = {a.strip() for a in (profile.get("acronyms_no_spellout") or []) if a and a.strip()}
    unit_style = profile.get("unit_style") or {}
    abbrevs = unit_style.get("abbreviations") or {}
    spelled_in_text = unit_style.get("time_in_text") == "spelled"
    for f in findings:
        rid = f.get("rule_id") or ""
        if no_spell and f.get("ce_rule_no") in (31, 34, 81) and f.get("surface") in no_spell:
            f["option_replacements"] = {"1": f.get("surface"), "2": f.get("surface"), "3": f.get("surface")}
        unit = _TIME_RULE_TO_UNIT.get(rid)
        if unit and (spelled_in_text or abbrevs):
            in_table = f.get("region") == "table" or f.get("source") == "table" or f.get("region") in _TABLE_LIKE
            before = _ctx_before(f.get("context"))
            dosage = bool(re.search(r"(?:mg|mcg|mL|g|units?)\s*/\s*$", before))
            # Springer: write units out in main text AND in "text-like" tables (prose cells);
            # a compound adjective ("180-minute benchmark") keeps the word.
            compound = before.endswith("-")
            prose_cell = in_table and len((f.get("context") or "").split()) >= 12
            if rid.endswith("_spelled") and (compound or prose_cell):
                target = f.get("surface")
            elif (in_table and not prose_cell) or dosage or not spelled_in_text:
                target = abbrevs.get(unit)
            elif rid.endswith("_spelled"):
                target = f.get("surface")  # already written out in running text
            else:
                target = _spelled(unit, f.get("surface") or "", before)
            if target:
                f["option_replacements"] = {**(f.get("option_replacements") or {}),
                                            "1": None if target == f.get("surface") else target}
    return findings


def apply_style_profile(findings: list[dict], profile: dict, file_path: str | None = None,
                        chapter_name: str = "chapter") -> list[dict]:
    """Add profile-list findings for ``file_path`` and re-decide existing ones. Returns the new list."""
    if not profile:
        return findings
    adjust_findings(findings, profile)
    if file_path:
        try:
            from manuscript_core.extractor import extract_segments
            segments = extract_segments(file_path, chapter_index=1, chapter_name=chapter_name)
        except Exception:
            segments = []
        extra = [f.to_dict() for f in profile_findings(segments, profile)]
        if extra:
            taken = {(f.get("para_index"), f.get("match_start"), f.get("rule_id")) for f in findings}
            findings = findings + [f for f in extra if (f["para_index"], f["match_start"], f["rule_id"]) not in taken]
    return findings
