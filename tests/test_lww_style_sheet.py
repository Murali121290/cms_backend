"""LWW editorial style sheets (AMA / APA Word templates) select every rule they state.

Fixtures are the LWW template sheets (no project data): lww_ama_style_sheet.docx and
lww_apa_style_sheet.docx.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

import docx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "processing"))

from app.processing.manuscript_core.parsers import lww_sheet  # noqa: E402
from app.processing.manuscript_core.parsers.docx_stylesheet_parser import DocxStylesheetParser  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def ama():
    return DocxStylesheetParser().parse((FIXTURES / "lww_ama_style_sheet.docx").read_bytes())


@pytest.fixture(scope="module")
def apa():
    return DocxStylesheetParser().parse((FIXTURES / "lww_apa_style_sheet.docx").read_bytes())


def _opts(res) -> dict[int, int]:
    return {int(k): v["option"] for k, v in res["matched_ce_rules"].items()}


def test_matchers_only_emit_catalog_rules_and_options():
    assert lww_sheet.validate_matchers() == []


AMA_EXPECTED = {
    4: 1, 5: 1, 6: 1, 7: 5, 8: 1, 9: 1, 11: 1, 13: 1, 14: 2, 16: 1, 17: 2, 19: 3, 24: 3, 25: 2, 29: 3, 30: 1,
    35: 6, 36: 4, 40: 1, 43: 1, 70: 4, 71: 5, 72: 5, 75: 4, 76: 4, 78: 1, 81: 1, 92: 1, 93: 1, 94: 1, 95: 1,
    99: 1, 100: 1, 101: 2, 102: 1, 103: 1, 114: 1, 115: 1, 117: 1, 126: 1, 128: 1, 129: 2, 130: 1, 131: 1,
    133: 1, 134: 1, 135: 1, 138: 1, 139: 1, 140: 1, 141: 1,
}

APA_EXPECTED = {
    5: 2, 6: 1, 7: 5, 8: 2, 13: 1, 14: 2, 16: 2, 25: 1, 30: 2, 35: 3, 36: 2, 40: 1, 70: 4, 101: 1, 129: 1,
    130: 2, 135: 1, 138: 2, 139: 1,
}


def test_ama_sheet_selects_stated_rules(ama):
    got = _opts(ama)
    assert ama["detected_preset_id"] == "ama"
    wrong = {s: (got.get(s), o) for s, o in AMA_EXPECTED.items() if got.get(s) != o}
    assert not wrong, f"(got, expected) per rule: {wrong}"
    # Stale routing fixed: ellipsis is R92 (not R42), eponyms R93 (not R39)
    assert "42" not in ama["matched_ce_rules"] and "39" not in ama["matched_ce_rules"]
    assert len(got) >= 55


def test_apa_sheet_selects_stated_rules(apa):
    got = _opts(apa)
    assert apa["detected_preset_id"] == "apa"
    wrong = {s: (got.get(s), o) for s, o in APA_EXPECTED.items() if got.get(s) != o}
    assert not wrong, f"(got, expected) per rule: {wrong}"
    assert "4" not in apa["matched_ce_rules"]  # the APA sheet leaves the table time units blank


def test_profile_from_sheet(ama, apa):
    prof = ama["style_profile"]
    assert "attention-deficit/hyperactivity disorder" in prof["word_list"]
    assert "x-ray" in prof["word_list"]  # "Miscellaneous (per AMA)" terms
    assert prof["unit_style"]["pressure"] == "mm Hg"
    assert prof["unit_style"]["abbreviations"]["minute"] == "min"
    assert "Pao2" in prof["acronyms_no_spellout"]
    assert prof["reference_style"]["citation"] == "superscript numbered"
    assert prof["reference_style"]["list_all_authors_up_to"] == 6
    assert prof["reference_style"]["et_al_after_first"] == 3
    assert prof["source_doc"]["layout"] == "lww_3table"
    ref = apa["style_profile"]["reference_style"]
    assert ref["citation"] == "name-year" and ref["list_all_authors_up_to"] == 20 and ref["order"] == "alphabetical"


def test_unresolved_lists_stated_points_only(ama):
    labels = [u["label"] for u in ama["unresolved_specs"]]
    assert any("Display quotations" in lab for lab in labels)
    assert any("Equipment manufacturers" in lab for lab in labels)
    # Blank rows, reference samples and "Author usage" are not reported
    assert not any(lab.startswith(("Head1", "Journal ref sample", "Display list style")) for lab in labels)
    assert len(labels) <= 10


def _sheet(rows: list[tuple[str, str, str]]) -> bytes:
    d = docx.Document()
    t0 = d.add_table(rows=1, cols=2)
    t0.rows[0].cells[0].text, t0.rows[0].cells[1].text = "Manual/Previous edition to be followed", "AMA 11th edition"
    t1 = d.add_table(rows=len(rows), cols=3)
    for i, (label, house, book) in enumerate(rows):
        t1.rows[i].cells[0].text = label
        t1.rows[i].cells[1].text = house
        t1.rows[i].cells[2].text = book
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def test_book_specific_column_overrides_the_manual():
    res = DocxStylesheetParser().parse(_sheet([
        ("Percent style", "AMA: 15%", "Book Specific: 15 percent"),
        ("Serial comma?", "Yes", "Book Specific:"),
        ("Figure parts (in artwork)", "A, B, C (bold the part labels – book specific)", ""),
    ]))
    ce = res["matched_ce_rules"]
    assert ce["6"]["option"] == 3 and ce["6"]["source_label"].endswith("(book specific)")
    assert ce["99"]["option"] == 1  # empty book-specific cell: the manual's column applies
    assert ce["114"]["option"] == 1  # "book specific" inside a value is not the column marker


def test_one_row_can_set_several_rules():
    res = DocxStylesheetParser().parse(_sheet([("Dates, year, time (AM/PM/Hours)", "Small caps am, pm\nJune 5, 2026", "")]))
    assert _opts(res).get(17) == 2 and _opts(res).get(19) == 3


# --------------------------------------------------------------------------- new rule detectors
from manuscript_core.analyzer import _run_all_rules, resolve_finding_overlaps  # noqa: E402
from manuscript_core.extractor import Segment  # noqa: E402
from manuscript_core.rules import ce_rules  # noqa: E402


def _decide(text: str, sno: int, option: int) -> list[tuple[str, str, str | None]]:
    seg = Segment(chapter_index=1, chapter_name="ch", source="body", para_index=0, text=text,
                  mask=[False] * len(text), region="body")
    resolved = ce_rules.resolve_ce_config([], {str(sno): {"option": option, "enabled": True}})
    out = []
    for f in resolve_finding_overlaps(list(_run_all_rules(seg))):
        d = f.to_dict()
        if d.get("ce_rule_no") != sno:
            continue
        c = ce_rules.choose_replacement(d["surface"], sno, d["option_replacements"], resolved=resolved,
                                        ce_steps=d.get("ce_steps"))
        out.append((d["surface"], c["status"], c["suggestion"]))
    return out


@pytest.mark.parametrize("sno,option,text,expect", [
    (138, 1, "A dose of .5 mg; r = .45.", [(".5", "error", "0.5"), (".45", "error", "0.45")]),
    (138, 2, "A dose of .5 mg; r = 0.45.", [(".5", "error", "0.5"), ("0.45", "error", ".45")]),
    (139, 1, "Rates of 25-30% and 10 mg-20 mg.", [("25-30%", "error", "25%-30%"), ("10 mg-20 mg", "error", "10-20 mg")]),
    (139, 2, "Doses of 10–20 mg.", [("10–20 mg", "error", "10 mg–20 mg")]),
    (140, 1, "Built c. 1850 or circa 1900; ca 1700.", [("c. ", "error", "ca "), ("circa ", "error", "ca "), ("ca ", "compliant", None)]),
    (141, 1, "In 300 B.C. and AD 200.", [("B.C.", "error", "BC"), ("AD", "compliant", None)]),
    (141, 2, "In 300 BC.", [("BC", "error", "B.C.")]),
])
def test_new_rule_options(sno, option, text, expect):
    got = _decide(text, sno, option)
    for item in expect:
        assert item in got, (item, got)


def test_r7_option_5_words_in_text_symbols_in_parentheses():
    got = _decide("Patients >65 years had ~10 events (>5 per year) and more than 3 visits (more than 3).", 7, 5)
    assert (">", "error", "greater than ") in got
    assert ("~", "error", "approximately ") in got
    assert (">", "compliant", None) in got  # inside parentheses
    assert ("more than ", "compliant", None) in got and ("more than ", "error", ">") in got


def test_r35_option_6_english_in_text_no_points_in_parentheses():
    got = _decide("Some drugs, e.g., aspirin, work (e.g., ibuprofen); A vs. B (A versus B).", 35, 6)
    assert ("e.g.,", "error", "for example,") in got
    assert ("e.g.,", "error", "eg,") in got
    assert ("vs.", "error", "versus") in got and ("versus", "error", "vs") in got


def test_moved_detectors_keep_default_output():
    """Leading zero and era detectors moved to R138 / R141: on by default with option 1."""
    default = ce_rules.default_config()
    assert default[138]["enabled"] and default[141]["enabled"]
    assert ce_rules.sno_for_rule_id("leading_zero_missing") == 138
    assert ce_rules.sno_for_rule_id("era_bc_dots") == 141
