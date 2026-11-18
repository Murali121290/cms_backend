"""Selected option = house style; every other form is an error replaced with the selected form.

Client-agnostic: these run against the catalog only, with no publisher preset.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "processing"))

from manuscript_core.analyzer import _run_all_rules  # noqa: E402
from manuscript_core.extractor import Segment  # noqa: E402
from manuscript_core.rules import ce_rules  # noqa: E402


def _decide(text: str, sno: int, option: int, source: str = "body") -> dict[str, tuple[str, str | None]]:
    seg = Segment(chapter_index=1, chapter_name="ch", source=source, para_index=0, text=text, mask=[False] * len(text),
                  region="table" if source == "table" else "body")
    resolved = ce_rules.resolve_ce_config([], {str(sno): {"option": option, "enabled": True}})
    out = {}
    for f in _run_all_rules(seg):
        d = f.to_dict()
        if d.get("ce_rule_no") != sno:
            continue
        c = ce_rules.choose_replacement(d["surface"], sno, d["option_replacements"], resolved=resolved,
                                        ce_steps=d.get("ce_steps"))
        out[d["surface"]] = (c["status"], c["suggestion"])
    return out


R6_TEXT = "Rates were 25%, 25 %, 25 percent, 25 per cent, 25 percentage and 25 per of them."


@pytest.mark.parametrize("option,target", [(1, "25%"), (2, "25 %"), (3, "25 percent"), (4, "25 per cent"),
                                           (5, "25 percentage points")])
def test_r6_every_variant_becomes_selected_form(option, target):
    got = _decide(R6_TEXT, 6, option)
    for surface in ("25%", "25 %", "25 percent", "25 per cent", "25 percentage", "25 per"):
        status, suggestion = got[surface]
        if surface == target:
            assert status == "compliant", surface
        else:
            assert (status, suggestion) == ("error", target), surface


def test_r6_options_beyond_three_survive_save():
    clean = ce_rules.validate_ce_rules({"6": {"option": 5}, "6x": {"option": 1}, "14": {"option": "4"}})
    assert clean["6"]["option"] == 5
    assert clean["14"]["option"] == 4


@pytest.mark.parametrize("sno,option,text,expect", [
    (5, 2, "Store at 15 °C or 15 degrees C.", {"15 °C": "15°C", "15 degrees C": "15°C"}),
    (5, 1, "Store at 15°C.", {"15°C": "15 °C"}),
    (8, 2, "Give β-blockers.", {"β": "beta"}),
    (8, 1, "Give beta-blockers.", {"beta": "β"}),
    (9, 2, "Give 10 μg or 10 ug.", {"10 μg": "10 mcg", "10 ug": "10 mcg"}),
    (9, 1, "Give 10 mcg.", {"10 mcg": "10 μg"}),
    (14, 1, "Ages 10 to 20 and 10-20.", {"10 to 20": "10–20", "10-20": "10–20"}),
    (17, 2, "On 10 October 2026 and Oct 10, 2026.", {"10 October 2026": "October 10, 2026",
                                                      "Oct 10, 2026": "October 10, 2026"}),
    (19, 1, "At 10 AM and 15:30.", {"10 AM": "10 a.m.", "15:30": "3:30 p.m."}),
    (21, 1, "It cost US$5 million and 5 dollars.", {"US$5 million": "$5 million", "5 dollars": "$5"}),
    (25, 1, "Significant (p = 0.05; P < .05).", {"p = 0.05": "p = .05", "P < .05": "p < .05"}),
    (30, 1, "Turn 45 degrees.", {"45 degrees": "45°"}),
    (35, 3, "Some e.g. this and vs. that.", {"e.g.": "for example,", "vs.": "versus"}),
    (46, 2, "Use an iPad.", {"iPad": "tablet"}),
    (72, 5, "See Fig. 1.2 and Figure 1-2.", {"Fig. 1.2": "Figure 1.2", "Figure 1-2": "Figure 1.2"}),
    (92, 1, "Wait... then . . . now.", {"...": "…", ". . .": "…"}),
    (96, 1, "Whilst walking towards it.", {"Whilst": "While", "towards": "toward"}),
    (104, 1, "See item #5.", {"#5": "No. 5"}),
    (105, 1, "In the 1950's.", {"1950's": "1950s"}),
    (106, 1, "In Phase II.", {"Phase II": "Phase 2"}),
    (108, 1, "Give 500 mg p.o. every q 12 h.", {"p.o.": "PO", "q 12 h": "q12h"}),
    (110, 1, "She had a MRI.", {"a MRI": "an MRI"}),
    (111, 1, "We will discuss pain.", {"We will discuss": "We discuss"}),
])
def test_selected_option_rewrites_other_forms(sno, option, text, expect):
    got = _decide(text, sno, option)
    for surface, target in expect.items():
        assert got.get(surface) == ("error", target), (surface, got)


def test_parenthetical_and_table_context():
    # 'to' in running text, but en dash stays inside parentheses
    got = _decide("Ages 10 to 20 years (range 10–20).", 14, 2)
    assert got["10–20"][0] == "compliant"
    # English in text, abbreviation inside parentheses
    got = _decide("Some things (e.g., this).", 35, 3)
    assert got["e.g.,"][0] == "compliant"
    # Greek spelled out in text but kept in tables
    assert _decide("TNF-α level", 8, 2, source="table").get("α", ("compliant",))[0] == "compliant"


def test_new_house_style_rules_are_off_by_default():
    resolved = ce_rules.default_config()
    assert not resolved[96]["enabled"]
    assert ce_rules.choose_replacement("whilst", 96, {"1": "while"})["status"] == "off"


def test_composite_unit_option_beyond_catalog_does_not_crash():
    resolved = ce_rules.resolve_ce_config([], {"3": {"option": 3}, "9": {"option": 2}})
    steps = {"parts": {"num": "10", "gap": "", "unit": "ug", "tail": ""}, "order": ["num", "gap", "unit", "tail"],
             "steps": [{"sno": 9, "part": "unit", "to": {"1": "μg", "2": "mcg", "3": None}}]}
    c = ce_rules.choose_replacement("10ug", 9, {}, resolved=resolved, ce_steps=steps)
    assert c["suggestion"] == "10mcg"


def test_catalog_forms_match_option_count():
    for rule in ce_rules.load_catalog():
        assert len(rule["forms"]) == len(rule["options"]) == ce_rules.option_count(rule["sno"]) or \
            ce_rules.option_count(rule["sno"]) == 3
