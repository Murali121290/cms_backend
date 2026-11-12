"""Springer Publishing House Style Sheet Preset (Update July 2026).

Encapsulates all specifications, rule selections, word lists, acronyms, and
special findings from the official Springer Publishing House Style Sheet.
"""

from __future__ import annotations

from typing import Any, Dict, List

# ── 1. The 72 CE Checklist Rules Configuration for Springer ──────────────────
# Mapped to exact Option numbers (1-6) and Severities per Springer House Style.
SPRINGER_CE_RULES: Dict[int, Dict[str, Any]] = {
    # Rule 1: SI Unit Standardisation — replace cc -> mL, sec -> s, hr -> h
    1: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 2: Unit Symbol Formatting — case & form (kg, mol, L)
    2: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 3: Space Between Numbers and Units — space between number and unit (25 kg); closed for < and >
    3: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 4: Unit Abbreviation Consistency — standard abbreviations (h, min, s, d, wk, y)
    4: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 5: Temperature Formatting — closed up: 15°C, 93°F (Option 2)
    5: {"enabled": True, "option": 2, "severity": "Major"},
    # Rule 6: Percentage Formatting — closed symbol with digits: 25% (Option 1)
    6: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 7: Mathematical Symbol Consistency — space before/after +, -, =; closed for < and >
    7: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 8: Greek Letter Consistency — Unicode Greek symbol (alpha -> α)
    8: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 9: Micro Prefix Standardisation — use mcg for medication dosages (Option 2)
    9: {"enabled": True, "option": 2, "severity": "Major"},
    # Rule 10: Superscript and Subscript Formatting — vitamin B12 subscript (Option 1)
    10: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 11: Number Formatting — 1,000 comma separator; no leading zero for p-values (Option 1)
    11: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 12: Decimal Precision — keep as reported
    12: {"enabled": True, "option": 2, "severity": "Minor"},
    # Rule 13: Number Style — spell out 0 to 9, numerals for 10 and above (Option 1)
    13: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 14: Number Range Formatting — use 'to' in text (10 to 20); en dash parenthetically (Option 2)
    14: {"enabled": True, "option": 2, "severity": "Major"},
    # Rule 15: Negative Number Formatting — true minus sign (−5)
    15: {"enabled": True, "option": 1, "severity": "Minor"},
    # Rule 16: Fractions and Ratios — spell out in text: one-half (Option 2)
    16: {"enabled": True, "option": 2, "severity": "Major"},
    # Rule 17: Date Format Standardisation — US date: Month D, YYYY (Option 2)
    17: {"enabled": True, "option": 2, "severity": "Major"},
    # Rule 18: Date Consistency — apply required date format everywhere (Option 1)
    18: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 19: Time Format Standardisation — 12-hour with a.m./p.m.: 10 a.m. (Option 1)
    19: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 20: Time Zone Formatting — standard abbreviation defined at first use
    20: {"enabled": True, "option": 1, "severity": "Minor"},
    # Rule 21: Currency Formatting — symbol before amount, no space: $5 million (Option 1)
    21: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 22: Mathematical Equation Formatting
    22: {"enabled": True, "option": 1, "severity": "Minor"},
    # Rule 23: Chemical Formula Formatting — subscripts and element case (H₂O, NaCl)
    23: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 24: Scientific Notation — 3.2 × 10⁵
    24: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 25: Statistical Notation — italic lowercase p, no zero before decimal (p = .05)
    25: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 26: Statistical Value Consistency
    26: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 27: Measurement Consistency — one unit consistently (mg throughout)
    27: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 28: Unit Conversion Verification
    28: {"enabled": True, "option": 1, "severity": "Minor"},
    # Rule 30: Degree Symbol Formatting — 45° angle
    30: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 34: Acronym Capitalisation & First Mention — spell out on first mention in each chapter
    34: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 35: Latin Abbreviations Formatting — spell out in running text: that is, for example (Option 3)
    35: {"enabled": True, "option": 3, "severity": "Major"},
    # Rule 36: Scientific Name Formatting — italics without dot after initial: S aureus (Option 1)
    36: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 37: Gene and Protein Symbol Formatting — gene italic, protein roman
    37: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 39: Medical Eponyms — nonpossessive: Parkinson disease, Alzheimer disease (Option 1)
    39: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 40: Medical Terminology (-al endings) — preferred -ic form: dermatologic, histologic (Option 2)
    40: {"enabled": True, "option": 2, "severity": "Major"},
    # Rule 42: Ellipsis Formatting — Unicode ellipsis … (Option 2)
    42: {"enabled": True, "option": 2, "severity": "Major"},
    # Rule 43: Trademark & Registered Symbols — remove ™ and ® in text except NCLEX/CNE (Option 1)
    43: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 44: Copyright Symbols — omit in body text (Option 1)
    44: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 45: Special Character Validation — replace corrupted chars
    45: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 46: Trademarked Product Names — use generic terms: tablet for iPad, smartphone for iPhone (Option 2)
    46: {"enabled": True, "option": 2, "severity": "Major"},
    # Rule 47: Terminology Database Validation
    47: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 64: Footnote and Endnote References — callout after punctuation
    64: {"enabled": True, "option": 2, "severity": "Major"},
    # Rule 68: Heading Hierarchy — logical heading-level order (no skipped levels, no super heads)
    68: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 69: Heading Numbering — remove numbering if style does not number
    69: {"enabled": True, "option": 2, "severity": "Minor"},
    # Rule 70: Heading Capitalisation — Title case: capitalize words >= 4 letters and all verbs (Option 2)
    70: {"enabled": True, "option": 2, "severity": "Major"},
    # Rule 71: Table Numbering — Table 5.4 with period, no hyphen (Option 1)
    71: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 72: Figure Numbering — Figure 1.2 with period, no hyphen (Option 1)
    72: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 73: Table Callout Validation — text callouts
    73: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 74: Figure Callout Validation — text callouts
    74: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 75: Table Caption Consistency — label, number, title: Table 5.4 Title (Option 1)
    75: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 76: Figure Caption Consistency — Figure 1.2 Caption (Option 1)
    76: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 77: Caption–Asset Matching
    77: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 78: Table Footnotes — markers in order, define abbreviations in footnote
    78: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 79: Figure Legend Validation
    79: {"enabled": True, "option": 1, "severity": "Minor"},
    # Rule 80: Table Structure
    80: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 81: Table Abbreviation Definitions — all acronyms in tables defined in footnote (Option 1)
    81: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 82: Table Unit Consistency
    82: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 83: Missing Content Detection
    83: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 84: Duplicate Content Detection
    84: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 85: Contradictory Statements
    85: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 86: Terminology Conflicts
    86: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 87: Internal Consistency Check
    87: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 88: Author Query Identification
    88: {"enabled": True, "option": 1, "severity": "Informational"},
    # Rule 89: Placeholder Detection — TK, TBD
    89: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 90: Content Completeness
    90: {"enabled": True, "option": 1, "severity": "Major"},
    # Rule 91: Editorial Readiness Assessment
    91: {"enabled": True, "option": 1, "severity": "Informational"},
}

# ── 2. Information Architecture (IA) Template Rows for Springer ─────────────
SPRINGER_SELECTED_IA_ROWS: List[Dict[str, Any]] = [
    {"element": "Percent", "subtype": "General", "pattern": "%", "example": "25%"},
    {"element": "Ranges", "subtype": "General", "pattern": "X to Y", "example": "10 to 20"},
    {"element": "Ranges", "subtype": "Parenthetical", "pattern": "X–Y (en dash)", "example": "10–20"},
    {"element": "Numbers", "subtype": "General", "pattern": "0 to 9 spelled out", "example": "five"},
    {"element": "Degree Celsius", "subtype": "General", "pattern": "°C", "example": "15°C"},
    {"element": "Degree Fahrenheit", "subtype": "General", "pattern": "°F", "example": "93°F"},
    {"element": "Units (abbreviated)", "subtype": "General", "pattern": "mL / ml", "example": "10 mL"},
    {"element": "Units (abbreviated)", "subtype": "General", "pattern": "mg", "example": "50 mg"},
    {"element": "Units (abbreviated)", "subtype": "General", "pattern": "g", "example": "5 g"},
    {"element": "Units (abbreviated)", "subtype": "General", "pattern": "cm", "example": "10 cm"},
    {"element": "Time units", "subtype": "General", "pattern": "h / hr", "example": "6 mg/hr"},
    {"element": "Time units", "subtype": "General", "pattern": "min", "example": "15 min"},
    {"element": "Time units", "subtype": "General", "pattern": "s / sec", "example": "30 sec"},
    {"element": "US date", "subtype": "General", "pattern": "Month D, YYYY (long form)", "example": "October 10, 2026"},
    {"element": "Periods", "subtype": "General", "pattern": "a.m.", "example": "10 a.m."},
    {"element": "Periods", "subtype": "General", "pattern": "p.m.", "example": "2 p.m."},
    {"element": "Table", "subtype": "Citation", "pattern": "Table ^#.^#", "example": "Table 5.4"},
    {"element": "Figure", "subtype": "Citation", "pattern": "Figure ^#.^#", "example": "Figure 1.2"},
    {"element": "Latin abbreviations", "subtype": "General", "pattern": "e.g.", "example": "e.g."},
    {"element": "Latin abbreviations", "subtype": "General", "pattern": "i.e.", "example": "i.e."},
    {"element": "(-al) endings", "subtype": "General", "pattern": "(-al) endings", "example": "dermatologic"},
    {"element": "Genus species", "subtype": "General", "pattern": "[G species] (no dot)", "example": "S aureus"},
]

# ── 3. Official Springer Word List & Spelling Whitelist ──────────────────────
SPRINGER_WORD_LIST: List[str] = [
    "21st century",
    "acknowledgment",
    "acknowledgments",
    "advance directive",
    "advanced practice nurse",
    "African American",
    "app",
    "APRN",
    "attention-deficit/hyperactivity disorder",
    "audiotape",
    "BCE",
    "CE",
    "best-practice",
    "bloodstream",
    "BOTOX",
    "BoNT",
    "brainstem",
    "breastfeeding",
    "breastfed",
    "bulimia",
    "bylaw",
    "by-product",
    "casework",
    "caseworker",
    "CCRN® exam",
    "cesarean",
    "checkup",
    "cognitive behavioral therapy",
    "comorbidity",
    "cost-effective",
    "cost-effectiveness",
    "critical-thinking questions",
    "critical-thinking exercises",
    "database",
    "data set",
    "day care",
    "day-care",
    "decision-making",
    "disk",
    "disc",
    "dos and don'ts",
    "DSM-5",
    "e-Notifysm",
    "e-book",
    "Emeritus",
    "Emeriti",
    "Emerita",
    "Emeritae",
    "EKG",
    "Elisabeth Kübler-Ross",
    "email",
    "emergency department",
    "ereader",
    "evidence-based",
    "farmwork",
    "farmworker",
    "firsthand",
    "framework",
    "full time",
    "full-time",
    "Gram stain",
    "gram-positive",
    "gram-negative",
    "gray literature",
    "groundbreaking",
    "handwashing",
    "healthcare",
    "HMB-45",
    "internet",
    "intranet",
    "lawsuit",
    "life span",
    "life-span",
    "lifelong",
    "lifestyle",
    "life-threatening",
    "lineup",
    "long-standing",
    "long-term",
    "Lyme disease",
    "MACE®",
    "Magnet®",
    "makeup",
    "medical-surgical",
    "meta-analysis",
    "middle-aged",
    "middle range theories",
    "mind-set",
    "Mini-Mental State Examination",
    "mucus",
    "mucous",
    "NASW Code of Ethics",
    "NCLEX®",
    "NCLEX-PN®",
    "NCLEX-RN®",
    "NCSBN®",
    "NeuroBloc",
    "NNAAP®",
    "nonneoplastic",
    "non-small cell lung cancer",
    "Nursys®",
    "Nursys e-Notify®",
    "OB/GYN",
    "obsessive-compulsive",
    "okay",
    "ongoing",
    "pack-years",
    "Pap smear",
    "Pap test",
    "parkinsonian",
    "parkinsonism",
    "passive-aggressive",
    "periodic acid-Schiff stain",
    "PAS stain",
    "policy maker",
    "post-master's",
    "posttraumatic stress disorder",
    "practicums",
    "preeclampsia",
    "problem-solve",
    "problem-solving",
    "Question Dissection®",
    "radiation therapy",
    "road map",
    "role-play",
    "S-100",
    "school-age",
    "schoolwork",
    "self-esteem",
    "setback",
    "setup",
    "set up",
    "short-term",
    "Silver Spring, MD",
    "smartphone",
    "so-called",
    "teamwork",
    "TERCAP®",
    "time-consuming",
    "time frame",
    "timeline",
    "timetable",
    "trade-off",
    "Transition to Practice®",
    "type 2 diabetes",
    "United States",
    "U.S.",
    "vitamin B12",
    "voice mail",
    "warm-up",
    "webpage",
    "website",
    "web",
    "World Wide Web",
    "well-being",
    "whistle-blower",
    "workday",
    "workup",
    "workforce",
    "worldview",
    "worldwide",
    "x-ray",
]

# ── 4. Acronyms That Do Not Need to Be Spelled Out on First Use ──────────────
SPRINGER_ACRONYMS_WHITELIST: List[str] = [
    "AARP", "ACTH", "AIDS", "APRN", "CD", "CD-ROM", "CEO", "CFO", "CI",
    "CME", "CPR", "CT", "DDT", "DNA", "DVD", "ED", "EDTA", "EEG", "EKG",
    "ESP", "HIV", "HLA", "HTML", "ICU", "IQ", "IV", "LGBT", "LGBTQ",
    "LGBTQIAP+", "LPN", "MRI", "NCLEX", "NICU", "OB/GYN", "PA", "PET",
    "pH", "REM", "Rh", "RN", "RNA", "SAS", "SD", "SE", "SEM", "SPSS",
    "TNM", "UV", "VDRL", "XML", "MS", "MA", "PhD", "MD", "BSN",
]

# ── 5. Deprecated Words & Generic Digital Equivalents ────────────────────────
SPRINGER_AVOID_WORDS: Dict[str, str] = {
    # Prohibited British spellings / archaisms
    "whilst": "while",
    "amidst": "amid",
    "firstly": "first",
    "towards": "toward",
    "learnt": "learned",
    "amongst": "among",
    # Sensitive language
    "sufferer": "patient",
    "victim": "patient",
    # Deprecated brand names (Amazon Kindle e-book compliance)
    "ipad": "tablet",
    "iphone": "smartphone",
    "ipod": "MP3 player",
    "kindle": "e-reader",
    # Unit conversions
    "cc": "mL",
    "μg": "mcg",
    "ug": "mcg",
    # Pronoun sensitivity
    "he/she": "they",
    "s/he": "they",
}

# ── 6. Preferred Medical Terminology (-ic over -ical) ────────────────────────
SPRINGER_PREFERRED_IC_TERMS: Dict[str, str] = {
    "dermatological": "dermatologic",
    "endocrinological": "endocrinologic",
    "epidemiological": "epidemiologic",
    "etiological": "etiologic",
    "hematological": "hematologic",
    "histological": "histologic",
    "immunological": "immunologic",
    "neurological": "neurologic",
    "neurophysiological": "neurophysiologic",
    "oncological": "oncologic",
    "ophthalmological": "ophthalmologic",
    "pathological": "pathologic",
    "pharmacological": "pharmacologic",
    "physiological": "physiologic",
    "psychological": "psychologic",
    "rheumatological": "rheumatologic",
    "serological": "serologic",
    "urological": "urologic",
}

# ── 7. Red Flags & Queries ───────────────────────────────────────────────────
SPRINGER_RED_FLAGS: List[Dict[str, str]] = [
    {
        "pattern": r"\bDSM-(?:IV|IV-TR)\b",
        "category": "red_flag",
        "message": "Flagged DSM-IV / DSM-IV-TR: Query author to update diagnostic criteria to DSM-5.",
    },
    {
        "pattern": r"\bCampinha-Bacote\b|\bASKED\s+model\b",
        "category": "red_flag",
        "message": "Flagged J. Campinha-Bacote / ASKED model: Flag for production editorial review.",
    },
    {
        "pattern": r"\b(?:Wikipedia|Wikimedia)\b",
        "category": "red_flag",
        "message": "Wikipedia cited: Query author to provide a peer-reviewed academic source.",
    },
]


def get_springer_preset() -> Dict[str, Any]:
    """Returns the complete Springer Publishing House Style configuration."""
    return {
        "preset_id": "springer",
        "name": "Springer Publishing House Style Sheet (July 2026)",
        "description": "Official Springer Publishing Company House Style Sheet with July 2026 updates, APA 7e / Modified AMA 11e, closed temperature, mcg medication dosages, and full word list.",
        "ce_rules": {str(k): v for k, v in SPRINGER_CE_RULES.items()},
        "selected_ia_rows": SPRINGER_SELECTED_IA_ROWS,
        "word_list": SPRINGER_WORD_LIST,
        "acronyms_whitelist": SPRINGER_ACRONYMS_WHITELIST,
        "avoid_words": SPRINGER_AVOID_WORDS,
        "preferred_ic_terms": SPRINGER_PREFERRED_IC_TERMS,
        "red_flags": SPRINGER_RED_FLAGS,
    }

