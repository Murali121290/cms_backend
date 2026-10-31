"""Shared unit registry and matcher (CE rules 1, 2, 3, 9, 10, 28)."""
import pytest

from app.processing.manuscript_core.ia_selection import apply_ce_settings
from manuscript_core.extractor import Segment
from manuscript_core.rules.units import detect_units, registry


def _units(text: str) -> list[dict]:
    seg = Segment(chapter_index=1, chapter_name="ch", source="body", para_index=0,
                  text=text, mask=[False] * len(text))
    return [f.to_dict() for f in detect_units(seg)]


@pytest.mark.parametrize("text, surface, replacement, rules", [
    ("Give 25KGS daily", "25KGS", "25 kg", [2, 3]),
    ("about 5mg of drug", "5mg", "5 mg", [3]),
    ("10 sec later", "10 sec", "10 s", [1]),
    ("a 3 hrs wait", "3 hrs", "3 h", [1]),
    ("5 microns wide", "5 microns", "5 μm", [1]),
    ("dose of 200 ML", "200 ML", "200 mL", [2]),
    ("3 Mol solution", "3 Mol", "3 mol", [2]),
    ("10 KHz signal", "10 KHz", "10 kHz", [2]),
    ("use 40 Kms", "40 Kms", "40 km", [2]),
    ("12 l of water", "12 l", "12 L", [2]),
    ("a 5 kg. weight was", "5 kg.", "5 kg", [2]),
    ("15 ug daily", "15 ug", "15 μg", [9]),
    ("20 mcg daily", "20 mcg", "20 μg", [9]),
    ("area 5 m2 here", "5 m2", "5 m²", [10]),
    ("area 3 m^2 here", "3 m^2", "3 m²", [10]),
    ("rate 2 s-1 here", "2 s-1", "2 s⁻¹", [10]),
])
def test_unit_fixes(text, surface, replacement, rules):
    found = _units(text)
    assert len(found) == 1, found
    assert found[0]["surface"] == surface
    assert found[0]["replacement"] == replacement
    assert found[0]["ce_rule_nos"] == rules


@pytest.mark.parametrize("text", [
    "5 mg", "5 mg/kg", "120 mmHg", "at 5 PM", "5 in 10 patients", "Grade 3 groups", "with 4 days", "3 mm Hg",
    "in the 1970s", "the 4Ps of marketing", "the 4 Ps of marketing", "a 3D model", "run 5K", "costs $5m",
])
def test_correct_or_non_units_are_left_alone(text):
    assert _units(text) == []


@pytest.mark.parametrize("text, rule_id", [
    ("the 25 C reading", "si_ambiguous_symbol"),
    ("it was 98 F", "si_ambiguous_symbol"),
    ("an angle of 2 rad", "si_ambiguous_symbol"),
    ("wait 10 MS", "unit_case_wrong"),
    ("weighs 5 lb", "si_nonsi_convert"),
])
def test_ambiguous_or_conversion_units_are_flagged_not_fixed(text, rule_id):
    found = _units(text)
    assert len(found) == 1 and found[0]["rule_id"] == rule_id
    assert found[0]["replacement"] is None


def test_conversion_is_linked_to_rule_28():
    assert _units("weighs 5 lb")[0]["ce_rule_nos"] == [1, 28]


def test_switching_off_one_rule_keeps_the_other_step():
    finding = _units("Give 25KGS daily")[0]
    apply_ce_settings([finding], [], {"3": {"enabled": False}})
    assert finding["replacement"] == "25kg"        # R2 case/plural fixed, R3 spacing skipped
    apply_ce_settings([finding], [], {"3": {"option": 2}})
    assert finding["replacement"] == "25 kg"  # R3 Option 2: non-breaking space


def test_registry_covers_si_base_and_derived_units():
    symbols = registry()["symbols"]
    for sym in ["m", "kg", "s", "A", "K", "mol", "cd", "N", "Pa", "J", "W", "C", "V", "F", "Ω", "S",
                "Wb", "T", "H", "Hz", "rad", "sr", "lm", "lx", "Bq", "Gy", "Sv", "kat", "min", "h", "d",
                "L", "t", "eV", "bar"]:
        assert sym in symbols, sym
