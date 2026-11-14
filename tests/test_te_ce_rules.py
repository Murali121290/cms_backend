"""CE checklist rules (CE_rules_tool_input.xlsx) on the technical editing engine."""
import pytest

from app.processing.manuscript_core.ia_selection import annotate_with_stylesheet, apply_ce_settings
from app.processing.manuscript_core.rules import ce_rules
from manuscript_core.analyzer import _run_all_rules
from manuscript_core.extractor import Segment

SAMPLE = (
    "Patients (n=24) were split into 3 groups and received 5mg of Advil® every 8 hours. "
    "Samples were stored at 37°C and diluted to 200 ML. About 25 percent responded (p<0.05). "
    "Doses of 10-15 mg were tested, and readings of -5 were excluded. The probe was set at an "
    "angle of 45º. A 2 x 3 design was used, and cell counts reached 1.2E5 per well. "
    "Follow-up data: TBD."
)

UK_HOUSE_STYLE_ROWS = [
    {"element": "Percent", "subtype": "General", "pattern": "percent"},
    {"element": "Ranges", "subtype": "General", "pattern": "X to Y"},
    {"element": "Numbers", "subtype": "General", "pattern": "0 to 9 numerals"},
    {"element": "Symbols", "subtype": "General", "pattern": "® registered symbol"},
]


def _findings(text: str = SAMPLE) -> dict[str, dict]:
    seg = Segment(chapter_index=1, chapter_name="ch", source="body", para_index=0,
                  text=text, mask=[False] * len(text))
    return {f.surface: f.to_dict() for f in _run_all_rules(seg) if f.category == "te_point"}


def test_catalog_has_all_72_rules():
    rules = ce_rules.load_catalog()
    workbook = [r for r in rules if r["sno"] < 92]
    house_style = [r for r in rules if r["sno"] >= 92]
    assert len(workbook) == 72
    assert len(house_style) == 34  # ce_rules_extensions.NEW_RULES (92-125), off by default
    assert all(not r["default_enabled"] for r in house_style)
    assert all(len(r["options"]) >= 3 for r in rules)
    assert all(len(r["forms"]) == len(r["options"]) for r in rules)
    assert {r["detectable"] for r in rules} <= {"auto", "flag", "manual"}


def test_default_config_applies_option_1():
    f = _findings()
    expected = {
        "5mg": "5 mg", "hours": "h", "37°C": "37 °C", "200 ML": "200 mL",
        "25 percent": "25%", "10-15": "10–15", "-5": "−5", "º": "°",
        "2 x 3": "2 × 3", "3": "three", "®": "",
    }
    for surface, replacement in expected.items():
        assert f[surface]["replacement"] == replacement, surface


def test_review_rules_are_highlighted_and_queries_marked():
    f = _findings()
    assert f["p<0.05"]["replacement"] is None and f["p<0.05"]["ce_rule_no"] == 25
    assert f["1.2E5"]["replacement"] is None
    assert f["1.2E5"]["option_replacements"]["1"] == "1.2 × 10⁵"
    assert f["TBD"]["ce_query"] is True and f["TBD"]["replacement"] is None


def test_uk_house_style_stylesheet():
    findings = list(_findings().values())
    annotate_with_stylesheet(findings, UK_HOUSE_STYLE_ROWS, ce_rules={"7": {"enabled": False}})
    by_surface = {f["surface"]: f for f in findings}
    assert by_surface["25 percent"]["replacement"] is None          # R6 Option 3 keeps "25 percent"
    assert by_surface["10-15"]["replacement"] == "10 to 15"          # R14 Option 2
    assert by_surface["3"]["replacement"] is None                    # R13 Option 2 keeps numerals
    assert by_surface["®"]["replacement"] is None               # R43 Option 3 keeps the symbol
    assert by_surface["2 x 3"]["replacement"] is None                # R7 switched off
    assert by_surface["2 x 3"]["in_stylesheet"] is False


def test_explicit_setting_beats_ia_row():
    cfg = ce_rules.resolve_ce_config(UK_HOUSE_STYLE_ROWS, {"6": {"option": 2, "severity": "Major"}})
    assert cfg[6]["option"] == 2 and cfg[6]["source"]["option"] == "stylesheet"
    assert cfg[6]["severity"] == "Major"
    assert cfg[14]["option"] == 2 and cfg[14]["source"]["option"] == "ia_row"


def test_conflicting_ia_rows_first_wins():
    rows = [{"element": "Percent", "pattern": "%"}, {"element": "Percent", "pattern": "percent"}]
    derived, conflicts = ce_rules.derive_from_ia_rows(rows)
    assert derived[6]["option"] == 1
    assert conflicts == [6]


@pytest.mark.parametrize("sno", sorted(ce_rules.NEVER_AUTOFIX))
def test_scientific_values_never_autofixed(sno):
    for option in (1, 2, 3):
        assert ce_rules.allows_autofix(sno, option) is False


def test_query_option_is_never_applied():
    rename = _findings("Wait 10 sec, then stop.")["10 sec"]
    apply_ce_settings([rename], [], {"1": {"option": 3}})
    assert rename["replacement"] is None and rename["ce_query"] is True


def test_validate_ce_rules_drops_bad_values():
    clean = ce_rules.validate_ce_rules({"6": {"option": 999, "severity": "Major"}, "999": {"option": 1}, "x": {}})
    assert clean == {"6": {"severity": "Major"}}


def test_old_range_preference_still_applies_to_rules_outside_checklist():
    finding = {"rule_id": "range_hyphen", "surface": "1-6", "category": "te_point"}
    annotate_with_stylesheet([finding], [{"element": "Ranges", "subtype": "General", "pattern": "X to Y"}])
    assert finding["replacement"] == "1 to 6"


@pytest.mark.parametrize("text", ["after testing infants at 2, 4, and 6 weeks", "peak between 6 and 10 months of age",
                                  "a distance of about 3 feet"])
def test_numbers_in_measured_series_stay_numerals(text):
    assert not [s for s, f in _findings(text).items() if f["rule_id"].startswith("num_") and f["replacement"]]


def test_chapter_reference_keeps_its_number():
    assert _findings("as described in Chapter 8 above")["Chapter 8"]["replacement"] is None


@pytest.mark.parametrize("text", ["1.\tWith exploration of the environment", "<NL>2.\tIt is embedded", "8",
                                  "(e.g., Bayley-4 [Bayley])", "for children 3- to 4 years of age", "ages < 1 year"])
def test_list_numbers_identifiers_and_comparisons_stay_numerals(text):
    assert not [s for s, f in _findings(text).items() if f["rule_id"].startswith("num_") and f["replacement"]]


def test_percentage_multi_options():
    # Test R6 multi-options: closed, spaced, US word, UK word, delta
    # On "25 percent", Option 1 transforms to "25%", Option 4 to "25 per cent", Option 5 to delta
    f_spelled = _findings("Yield was 25 percent in trial.")["25 percent"]
    opts = f_spelled["option_replacements"]
    assert opts["1"] == "25%"
    assert opts["2"] == "25 %"
    assert opts["3"] is None  # matches surface
    assert opts["4"] == "25 per cent"
    assert opts["5"] == "25 percentage points"
    assert "6" not in opts  # a number never becomes the bare word "percentage"

    # On "25%", Option 3 transforms to "25 percent", Option 4 to "25 per cent"
    f_sym = _findings("Yield was 25% in trial.")["25%"]
    opts_sym = f_sym["option_replacements"]
    assert opts_sym["1"] is None  # matches surface
    assert opts_sym["2"] == "25 %"
    assert opts_sym["3"] == "25 percent"
    assert opts_sym["4"] == "25 per cent"


def test_ranges_multi_options():
    # Test R14 multi-options: en-dash, to, from-to, spaced en-dash, hyphen
    f_range = _findings("Observed 10-15 subjects.")["10-15"]
    opts = f_range["option_replacements"]
    assert opts["1"] == "10–15"
    assert opts["2"] == "10 to 15"
    assert opts["4"] == "10 – 15"
    assert opts["5"] is None  # matches surface "10-15"


def test_ampm_multi_options_and_selection_against_remaining():
    """Verify that when any AM/PM option is selected, all remaining unselected variants
    are suggested for replacement to the selected option, while matching variants have None."""
    # Detection of various AM/PM forms in text
    sample_text = (
        "Starts at 10:00 a.m. and 9:00 a.m and 8:30 am, then 5:00 A.M. and 6:00 A.M, "
        "ending at 4:00 PM and 3:30 pm and 2:00 p.m. and 1:00 p.m and 12:00 p.m."
    )
    findings_map = _findings(sample_text)
    
    # 1. Option 4 selected: 12-hour uppercase (AM / PM)
    for surface, target_clean in [
        ("10:00 a.m.", "10:00 AM"),
        ("9:00 a.m", "9:00 AM"),
        ("8:30 am", "8:30 AM"),
        ("5:00 A.M.", "5:00 AM"),
        ("6:00 A.M", "6:00 AM"),
        ("3:30 pm", "3:30 PM"),
        ("2:00 p.m.", "2:00 PM"),
        ("1:00 p.m", "1:00 PM"),
    ]:
        f = findings_map[surface]
        assert f["option_replacements"]["4"] == target_clean, f"Failed for {surface}"
    # Compliant variant has None under Option 4
    assert findings_map["4:00 PM"]["option_replacements"]["4"] is None

    # 2. Option 3 selected: 12-hour undotted lowercase (am / pm)
    for surface, target_clean in [
        ("10:00 a.m.", "10:00 am"),
        ("5:00 A.M.", "5:00 am"),
        ("4:00 PM", "4:00 pm"),
        ("2:00 p.m.", "2:00 pm"),
    ]:
        f = findings_map[surface]
        assert f["option_replacements"]["3"] == target_clean, f"Failed for {surface}"
    assert findings_map["8:30 am"]["option_replacements"]["3"] is None
    assert findings_map["3:30 pm"]["option_replacements"]["3"] is None

    # 3. Option 1 selected: 12-hour dotted lowercase (a.m. / p.m.)
    for surface, target_clean in [
        ("8:30 am", "8:30 a.m."),
        ("4:00 PM", "4:00 p.m."),
        ("5:00 A.M.", "5:00 a.m."),
    ]:
        f = findings_map[surface]
        assert f["option_replacements"]["1"] == target_clean, f"Failed for {surface}"
    assert findings_map["10:00 a.m."]["option_replacements"]["1"] is None
    assert findings_map["2:00 p.m."]["option_replacements"]["1"] is None

    # 4. Option 2 selected: 24-hour military/scientific
    assert findings_map["10:00 a.m."]["option_replacements"]["2"] == "10:00"
    assert findings_map["4:00 PM"]["option_replacements"]["2"] == "16:00"


def test_figure_table_multi_options():
    """Verify that Figure and Table citations support spelled out, dotted, and undotted abbreviations."""
    sample = "See Fig. 4.1 and Figure 4.2 and Figs 4.1 to 4.4. Also Tab. 1.1 and Table 1.2."
    f_map = _findings(sample)
    
    # Figure 4.1
    f_fig = f_map["Fig. 4.1"]
    assert f_fig["option_replacements"]["1"] == "Figure 4.1"
    assert f_fig["option_replacements"]["2"] is None  # matches surface Fig. 4.1
    assert f_fig["option_replacements"]["3"] == "Fig 4.1"
    
    # Plural figures
    f_figs = f_map["Figs 4.1 to 4.4"]
    assert f_figs["option_replacements"]["1"] == "Figures 4.1 to 4.4"
    assert f_figs["option_replacements"]["2"] == "Figs. 4.1 to 4.4"
    assert f_figs["option_replacements"]["3"] is None  # matches surface Figs 4.1 to 4.4
    
    # Table 1.1
    f_tab = f_map["Tab. 1.1"]
    assert f_tab["option_replacements"]["1"] == "Table 1.1"
    assert f_tab["option_replacements"]["2"] is None
    assert f_tab["option_replacements"]["3"] == "Tab 1.1"


def test_medical_al_endings_options():
    """Verify that -al endings support Option 1 (-ic) and Option 2 (-al)."""
    sample = "Both pathological and physiologic findings were documented."
    f_map = _findings(sample)
    
    f_path = f_map["pathological"]
    assert f_path["option_replacements"]["1"] == "pathologic"
    assert f_path["option_replacements"]["2"] is None  # matches surface
    assert f_path["option_replacements"]["3"] == "QUERY"

    f_phys = f_map["physiologic"]
    assert f_phys["option_replacements"]["1"] is None  # matches surface
    assert f_phys["option_replacements"]["2"] == "physiological"
    assert f_phys["option_replacements"]["3"] == "QUERY"


def test_leading_zero_and_fractions_options():
    """Verify leading zero and fraction options."""
    sample = "A dose of .5 mg or ½ tablet was administered."
    f_map = _findings(sample)
    
    f_zero = f_map[".5"]
    assert f_zero["option_replacements"]["1"] == "0.5"
    assert f_zero["option_replacements"]["2"] is None

    f_fract = f_map["½"]
    assert f_fract["option_replacements"]["1"] == "1/2"
    assert f_fract["option_replacements"]["2"] == "one-half"


def test_te_point_replacement_options_fixes():
    from manuscript_core.rules.te_point_replacements import get_te_replacement, get_te_replacement_options
    import re

    # 1. Comparison operators must not match "cm" unit
    m_more = re.search(r"more than", "infants support more than 70% of weight")
    opts_more = get_te_replacement_options("cmp_more_words", m_more)
    assert "cm" not in opts_more
    assert opts_more == [">", "greater than", "more than"]

    m_less = re.search(r"less than", "less than 5 mg")
    opts_less = get_te_replacement_options("cmp_less_words", m_less)
    assert "cm" not in opts_less
    assert opts_less == ["<", "less than"]

    # 2. Percentage formatting with decimals
    m_pct = re.search(r"0\.88%", "achieve goals (0.88%)")
    opts_pct = get_te_replacement_options("percent_symbol", m_pct)
    assert opts_pct == ["0.88%", "0.88 %", "0.88 percent", "0.88 per cent", "0.88 percentage points"]

    # 3. Leading zero replacement retains decimal digits
    m_lz = re.search(r"\.55", "values (.55)")
    assert get_te_replacement("leading_zero_missing", m_lz) == "0.55"

    m_lz_p = re.search(r"0\.55", "values (0.55)")
    assert get_te_replacement("leading_zero_present", m_lz_p) == ".55"

    # 4. SI unit matches only unit_* rules
    m_cm = re.search(r"\bcm\b", "5 cm")
    assert get_te_replacement_options("unit_cm_abbr", m_cm) == ["cm", "centimetre"]


def test_detect_para_ending_filters():
    from app.processing.manuscript_core.extractor import Segment
    from app.processing.manuscript_core.rules.te_points import detect_para_ending

    def make_seg(text: str, style: str = "", source: str = "body", region: str = "body"):
        return Segment(
            chapter_index=1,
            chapter_name="test",
            source=source,
            para_index=1,
            text=text,
            style=style,
            page=1,
            excluded=False,
        )

    # 1. Genuine narrative paragraph missing full stop -> should be detected
    seg_narrative = make_seg("This is an extensive study examining motor development in children throughout early life")
    findings = list(detect_para_ending(seg_narrative))
    assert len(findings) == 1
    assert findings[0].rule_id == "para_no_full_stop"
    assert findings[0].surface == "e"

    # 2. Short fragments / key terms (< 8 words) -> should NOT be detected
    assert list(detect_para_ending(make_seg("primitive reflexes"))) == []
    assert list(detect_para_ending(make_seg("crawling"))) == []
    assert list(detect_para_ending(make_seg("Infant Reflexes"))) == []

    # 3. Headings / Outlines / Titles by style or prefix -> should NOT be detected
    assert list(detect_para_ending(make_seg("Chapter 9: Motor Behavior During Early Childhood", style="POUT-1"))) == []
    assert list(detect_para_ending(make_seg("Upon completion of this chapter, you should be able to", style="OBJ-TXT"))) == []
    assert list(detect_para_ending(make_seg("primitive reflexes", style="KT-UL-MID"))) == []

    # 4. URLs -> should NOT be detected
    assert list(detect_para_ending(make_seg("https://t.ly/j4ga"))) == []
    assert list(detect_para_ending(make_seg("For more information, please visit https://my.clevelandclinic.org"))) == []

    # 5. Intentional clause endings (:, ;, —, –, ,, .) -> should NOT be detected
    assert list(detect_para_ending(make_seg("The study demonstrates clear development across several key dimensions:"))) == []
    assert list(detect_para_ending(make_seg("Development of motor skills requires affordance and opportunity;"))) == []
    assert list(detect_para_ending(make_seg("Motor development progresses rapidly during early life, in summary,"))) == []
    assert list(detect_para_ending(make_seg("This paragraph ends correctly with a standard full stop."))) == []


def test_annotate_with_stylesheet_non_selected_ia():
    from app.processing.manuscript_core.ia_selection import annotate_with_stylesheet

    findings = [
        {"rule_id": "para_no_full_stop", "surface": "e", "category": "te_point"},
        {"rule_id": "percent_symbol", "surface": "25%", "category": "te_point", "ce_rule_no": 6},
    ]
    # Stylesheet selects percent symbol, but does NOT select "Paras ending without full point"
    selected_rows = [
        {"element": "Percent", "subtype": "General", "pattern": "%"}
    ]

    annotated = annotate_with_stylesheet(findings, selected_rows)
    f_para = next(f for f in annotated if f["rule_id"] == "para_no_full_stop")
    f_pct = next(f for f in annotated if f["rule_id"] == "percent_symbol")

    # Unselected IA rule must have in_stylesheet == False
    assert f_para["in_stylesheet"] is False
    # Selected IA rule must have in_stylesheet == True
    assert f_pct["in_stylesheet"] is True
