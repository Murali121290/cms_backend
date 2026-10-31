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
    assert len(rules) == 72
    assert all(len(r["options"]) >= 3 for r in rules)
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
    assert opts["6"] == "percentage"

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
