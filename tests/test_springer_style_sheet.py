"""Springer Publishing House Style Sheet (July 2026): docx import, preset and end-to-end TE."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import docx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "processing"))

from app import schemas_v2  # noqa: E402
from app.processing.manuscript_core.parsers.docx_stylesheet_parser import DocxStylesheetParser  # noqa: E402
from app.processing.manuscript_core.rules.presets.springer import get_springer_preset  # noqa: E402
from app.services import stylesheet_service  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "springer_style_sheet_july2026.docx"


@pytest.fixture(scope="module")
def parsed():
    return DocxStylesheetParser().parse(str(FIXTURE))


def test_sheet_is_read_from_the_document(parsed):
    assert parsed["layout"] == "springer_sectioned"
    assert parsed["detected_preset_id"] == "springer"
    assert parsed["total_specs_scanned"] >= 60
    schemas_v2.DocxStylesheetParseResponse(**parsed)  # endpoint response validates (no 422)
    from_sheet = {k: v["option"] for k, v in parsed["matched_ce_rules"].items()
                  if not v["source_label"].startswith("Springer default")}
    expected = {"5": 2, "6": 1, "7": 4, "8": 2, "9": 2, "11": 1, "13": 1, "14": 2, "19": 1, "25": 1, "35": 3,
                "36": 4, "40": 1, "43": 1, "46": 2, "70": 4, "71": 5, "72": 5, "92": 1, "93": 1, "98": 1,
                "99": 1, "104": 1, "108": 1, "111": 1}
    for sno, option in expected.items():
        assert from_sheet.get(sno) == option, (sno, from_sheet.get(sno))
    assert parsed["matched_ce_rules"]["7"]["source_label"].startswith("Symbols And Measurements")


def test_profile_lists_come_from_the_sheet(parsed):
    p = parsed["style_profile"]
    words = p["word_list"]
    assert len(words) >= 150 and "healthcare" in words and "x-ray" in words
    assert not any(w.startswith(("EXAMPLES", "<H1>", "sufferer")) for w in words)
    pairs = {(e["find"], e["replace"]) for e in p["word_replacements"]}
    assert ("co-morbidity", "comorbidity") in pairs
    assert ("ECG", "EKG") in pairs
    assert ("emergency room", "emergency department") in pairs
    assert {"NCLEX-RN", "Magnet", "CCRN"} <= set(p["registered_terms"])
    assert {"PhD", "NCLEX", "pH", "OB/GYN"} <= set(p["acronyms_no_spellout"])
    assert p["ic_preferred"]["dermatological"] == "dermatologic"
    assert p["unit_style"]["abbreviations"]["hour"] == "hr"
    assert any(o["replace"] == "Johns Hopkins" for o in p["org_names"])


def test_preset_book_type_overlays():
    std, pa, qa = get_springer_preset(), get_springer_preset("pa"), get_springer_preset("qa", "outline")
    finds = {e["find"] for e in std["style_profile"]["word_replacements"]}
    assert "ECG" in finds and "ECG" not in {e["find"] for e in pa["style_profile"]["word_replacements"]}
    assert std["ce_rules"]["121"]["enabled"] is False and qa["ce_rules"]["121"]["enabled"] is True
    assert qa["ce_rules"]["118"]["option"] == 2
    assert std["ce_rules"]["8"]["option"] == 2 and std["ce_rules"]["1"]["enabled"] is False


@pytest.mark.parametrize("client,expected", [
    ("Springer Publishing Company", "springer"), ("Demos Medical", "springer"),
    ("Express Books", None), ("Springfield Press", None), ("", None),
])
def test_publisher_detection_is_whole_word(client, expected):
    assert stylesheet_service.resolve_publisher_key(SimpleNamespace(client_name=client, client=None)) == expected


def test_publisher_detection_uses_linked_client_company():
    project = SimpleNamespace(client_name="", client=SimpleNamespace(company="Springer Publishing", name_company=None))
    assert stylesheet_service.resolve_publisher_key(project) == "springer"


MANUSCRIPT = [
    "Store vials at 15 °C and give 10 μg of drug with β-blockers.",
    "Mortality fell by 25 percent and 30 per cent (p = 0.05); see Fig. 2-1.",
    "Whilst on the ward, patients with co-morbidity went to the emergency room.",
    "We will discuss Parkinson's disease, falls and delirium.",
    "Candidates sit the NCLEX-RN® exam; later the NCLEX-RN® exam is repeated.",
    "Visit http://www.nih.gov/ for the 1950's data on item #4.",
]


def test_end_to_end_springer_technical_edit(tmp_path):
    path = tmp_path / "chapter.docx"
    d = docx.Document()
    for para in MANUSCRIPT:
        d.add_paragraph(para)
    d.save(path)

    from manuscript_core.analyzer import analyze_manuscript
    scan = analyze_manuscript([{"index": 1, "filename": "chapter.docx", "path": str(path), "role": "PM",
                               "client_name": "Springer Publishing", "project_name": "Test", "ia_mapping_path": ""}])
    preset = get_springer_preset()
    ss = SimpleNamespace(selected_ia_rows=json.dumps(preset["selected_ia_rows"]),
                         ce_rules=json.dumps(preset["ce_rules"]), style_profile=json.dumps(preset["style_profile"]))
    findings = stylesheet_service.apply_stylesheet_to_findings(
        scan["findings"], ss, rule_id_to_ia=scan.get("ia_report", {}).get("rule_id_to_ia"), file_path=str(path))

    errors = {(f["surface"], f.get("suggestion")) for f in findings if f.get("ce_status") == "error"}
    for pair in [
        ("15 °C", "15°C"), ("10 μg", "10 mcg"), ("β", "beta"), ("25 percent", "25%"), ("30 per cent", "30%"),
        ("p = 0.05", "p = .05"), ("Fig. 2-1", "Figure 2.1"), ("Whilst", "While"), ("co-morbidity", "comorbidity"),
        ("emergency room", "emergency department"), ("We will discuss", "We discuss"),
        ("Parkinson's disease", "Parkinson disease"), ("http://www.nih.gov/", "www.nih.gov"),
        ("1950's", "1950s"), ("#4", "No. 4"),
    ]:
        assert pair in errors, (pair, sorted(errors))

    marks = sorted((f for f in findings if f["rule_id"] == "sym_registered_char"), key=lambda f: f["match_start"])
    assert [m["ce_status"] for m in marks] == ["compliant", "error"]  # ® kept at first mention only


def test_springer_july_2026_red_flags_and_sensitive_terms(tmp_path, parsed):
    profile = parsed["style_profile"]
    flags = profile.get("red_flags", [])
    flag_patterns = [f["pattern"] for f in flags]
    assert any("Campinha" in p for p in flag_patterns)
    assert any("ASKED" in p for p in flag_patterns)
    assert any("Wikipedia" in p for p in flag_patterns)
    assert any("Diagnostic and Statistical Manual" in p for p in flag_patterns)

    # Test manuscript with red flags and sensitive language
    test_paras = [
        "According to the ASKED model developed by J. Campinha-Bacote, cultural competence is vital.",
        "As quoted from the Diagnostic and Statistical Manual of Mental Disorders, criteria are met.",
        "Refer to the Wikipedia article for additional details.",
        "The sufferer had an epileptic seizure, while the diabetic attended clinic.",
        "The elderly patient used an iPad and ordered supplies from Amazon.",
        "Inject 5 cc of saline; this article summarizes the findings.",
    ]
    path = tmp_path / "chapter_redflags.docx"
    d = docx.Document()
    for p in test_paras:
        d.add_paragraph(p)
    d.save(path)

    from manuscript_core.analyzer import analyze_manuscript
    scan = analyze_manuscript([{"index": 1, "filename": "chapter_redflags.docx", "path": str(path), "role": "PM",
                               "client_name": "Springer Publishing", "project_name": "TestRedFlags", "ia_mapping_path": ""}])
    preset = get_springer_preset()
    ss = SimpleNamespace(selected_ia_rows=json.dumps(preset["selected_ia_rows"]),
                         ce_rules=json.dumps(preset["ce_rules"]), style_profile=json.dumps(preset["style_profile"]))
    findings = stylesheet_service.apply_stylesheet_to_findings(
        scan["findings"], ss, rule_id_to_ia=scan.get("ia_report", {}).get("rule_id_to_ia"), file_path=str(path))

    # Red flags should be identified as queries/flags
    red_flag_hits = [f for f in findings if f.get("rule_id") == "red_flag"]
    assert len(red_flag_hits) >= 3
    surfaces = {f["surface"] for f in red_flag_hits}
    assert any("Campinha-Bacote" in s for s in surfaces)
    assert any("ASKED" in s for s in surfaces)
    assert any("Wikipedia" in s for s in surfaces)

    # Sensitive language and avoid words suggestions
    suggestions = {(f["surface"], f.get("suggestion")) for f in findings}
    assert ("sufferer", "patient") in suggestions
    assert ("an epileptic", "a person with epilepsy") in suggestions
    assert ("the elderly", "older adults") in suggestions or ("The elderly", "Older adults") in suggestions
    assert ("iPad", "tablet") in suggestions
    assert ("Amazon", "online retailer") in suggestions
    assert ("5 cc", "5 mL") in suggestions or ("cc", "mL") in suggestions


def test_springer_july_2026_eponyms_and_structural_guidelines(parsed):
    profile = parsed["style_profile"]
    replacements = {(e["find"], e["replace"]) for e in profile.get("word_replacements", [])}
    assert ("Alzheimer's disease", "Alzheimer disease") in replacements
    assert ("Down's syndrome", "Down syndrome") in replacements
    assert ("Hodgkin's lymphoma", "Hodgkin lymphoma") in replacements
    assert ("Crohn's disease", "Crohn disease") in replacements
    assert ("Graves' disease", "Graves disease") in replacements
    assert ("Hashimoto's thyroiditis", "Hashimoto thyroiditis") in replacements

    # Structural guidelines
    struct = profile.get("structural_guidelines", {})
    assert len(struct.get("index", [])) > 0
    assert len(struct.get("headings_examples", [])) >= 1
    assert len(struct.get("bullet_examples", [])) >= 1

    # Check rule 125 in matched rules
    matched = parsed.get("matched_ce_rules", {})
    assert "125" in matched
    assert matched["125"]["enabled"] is True



def test_enabled_rule_findings_are_in_stylesheet(tmp_path):
    """Every finding of a rule the stylesheet enables is listed in the Review page's Stylesheet tab,
    including suggest-only rules (R47 word list, R99 serial comma) and house-style rules 92+."""
    path = tmp_path / "chapter.docx"
    d = docx.Document()
    d.add_paragraph("Whilst on the ward, patients with co-morbidity went to the emergency room.")
    d.add_paragraph("We tested three groups: low scorers, moderate scorers and high scorers.")
    d.add_paragraph("Mortality was 25 percent and 25% in the trial.")
    d.save(path)

    from manuscript_core.analyzer import analyze_manuscript
    scan = analyze_manuscript([{"index": 1, "filename": "chapter.docx", "path": str(path), "role": "PM",
                                "client_name": "Springer Publishing", "project_name": "Test", "ia_mapping_path": ""}])
    preset = get_springer_preset()
    ss = SimpleNamespace(selected_ia_rows=json.dumps(preset["selected_ia_rows"]),
                         ce_rules=json.dumps(preset["ce_rules"]), style_profile=json.dumps(preset["style_profile"]))
    findings = stylesheet_service.apply_stylesheet_to_findings(
        scan["findings"], ss, rule_id_to_ia=scan.get("ia_report", {}).get("rule_id_to_ia"), file_path=str(path))

    by_rule = {}
    for f in findings:
        if f.get("ce_rule_no") and f.get("ce_status") in ("error", "query", "flag"):
            by_rule.setdefault(f["ce_rule_no"], []).append(f)
    for sno in (47, 96, 99, 6):
        assert by_rule.get(sno), f"R{sno} produced no finding"
        assert all(f["in_stylesheet"] for f in by_rule[sno]), f"R{sno} hidden from the Stylesheet tab"
    # Compliant forms ("25%") and disabled rules are not part of the list
    assert not any(f["in_stylesheet"] for f in findings if f.get("ce_status") in ("compliant", "off"))
