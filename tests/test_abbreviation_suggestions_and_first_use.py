import pytest
from manuscript_core.extractor import Segment
from app.processing.manuscript_core.rules.te_points import detect_abbreviations
from app.processing.manuscript_core.rules.house_style import document_pass
from app.processing.language_editing.abbreviations import get_abbreviation_expansion, resolve_abbreviation_meaning
from app.processing.manuscript_core.ia_selection import apply_ce_settings

def test_who_detected_in_body_prose():
    text = "Most health care programs are well intended and are WHO designed in what appears plausible."
    seg = Segment(
        text=text,
        para_index=0,
        chapter_index=1,
        chapter_name="Ch01",
        style="Para-FL",
        source="body",
        page=1,
        region="body",
        mask=[False] * len(text),
    )
    findings = list(detect_abbreviations(seg))
    surfaces = [f.surface for f in findings]
    assert "WHO" in surfaces
    who_f = next(f for f in findings if f.surface == "WHO")
    assert who_f.option_replacements.get("1") == "World Health Organization (WHO)"
    assert who_f.option_replacements.get("3") == "World Health Organization"


def test_aacn_context_cue_expansion():
    text_nursing = "The AACN Essentials (AACN 2021) identify program evaluation as a core competency."
    exp_nursing = get_abbreviation_expansion("AACN", text_nursing, text_nursing.find("AACN"))
    assert exp_nursing == "American Association of Colleges of Nursing"

    text_icu = "The AACN certification for critical care nurses in the ICU is required."
    exp_icu = get_abbreviation_expansion("AACN", text_icu, text_icu.find("AACN"))
    assert exp_icu == "American Association of Critical-Care Nurses"


def test_dnp_first_use_and_subsequent_uses():
    p1 = "This chapter discusses evaluation through the lens of a DNP student project."
    p2 = "Doctor of Nursing Practice (DNP) prepared nurses play a key role."
    p3 = "DNPs use evaluation findings to inform decision-making."

    segs = [
        Segment(text=p1, para_index=0, chapter_index=1, chapter_name="Ch01", style="Body", source="body", page=1, region="body", mask=[False]*len(p1)),
        Segment(text=p2, para_index=1, chapter_index=1, chapter_name="Ch01", style="Body", source="body", page=1, region="body", mask=[False]*len(p2)),
        Segment(text=p3, para_index=2, chapter_index=1, chapter_name="Ch01", style="Body", source="body", page=1, region="body", mask=[False]*len(p3)),
    ]

    raw_findings = []
    for s in segs:
        raw_findings.extend(list(detect_abbreviations(s)))

    # Run document pass
    document_pass(raw_findings, segs)

    # Apply CE settings (Option 1: expand at first use)
    findings_dict = [f.to_dict() if hasattr(f, "to_dict") else vars(f) for f in raw_findings]
    apply_ce_settings(findings_dict, ce_rules={31: {"enabled": True, "option": 1, "severity": "Minor"}})

    dnp_hits = [f for f in findings_dict if f.get("surface") == "DNP"]
    assert len(dnp_hits) >= 2

    # First occurrence at P0 should be an error with the expansion suggestion
    first = dnp_hits[0]
    assert first["para_index"] == 0
    assert first["ce_status"] == "error"
    assert first["suggestion"] == "Doctor of Nursing Practice (DNP)"
    assert first["option_replacements"]["1"] == "Doctor of Nursing Practice (DNP)"
    assert first["option_replacements"]["3"] == "Doctor of Nursing Practice"

    # Subsequent occurrences should be compliant under Option 1 (keep abbreviation)
    subsequent = dnp_hits[1]
    assert subsequent["para_index"] >= 1
    assert subsequent["ce_status"] == "compliant"
    assert subsequent["suggestion"] is None
    assert subsequent["option_replacements"]["1"] is None


def test_year_and_citation_not_flagged_as_inline_list_marker():
    from app.processing.manuscript_core.rules.te_points import detect_list_marker

    text = 'As Stufflebeam and colleagues (1971) emphasized, the purpose of evaluation is "not to prove but to improve."'
    seg = Segment(
        text=text,
        para_index=0,
        chapter_index=1,
        chapter_name="Ch01",
        style="Para-FL",
        source="body",
        page=1,
        region="body",
        mask=[False] * len(text),
    )
    findings = list(detect_list_marker(seg))
    assert len(findings) == 0, f"Citation year (1971) was erroneously flagged as inline list marker! {findings}"

    # Also test plural suffix like question(s) and table citation Table 2.5)
    for sample in ["Evaluation Question(s) to address", "Table 2.5) indicates"]:
        s = Segment(text=sample, para_index=0, chapter_index=1, chapter_name="Ch01", style="Body", source="body", page=1, region="body", mask=[False]*len(sample))
        assert len(list(detect_list_marker(s))) == 0
