"""Springer Publishing House Style Sheet preset (Update July 2026).

Default settings used when a Springer project has no stylesheet yet, and to fill
rules that an uploaded Springer style sheet does not resolve. Option numbers refer
to the option forms in ce_rules_extensions.FORMS (the order the engine applies).

``get_springer_preset(book_type, list_style)`` merges the book-type overlays:
  standard  - base house style
  pa        - PA/APRN/NP books: "mm Hg" spaced; ECG allowed
  demos     - Demos Medical: Greek spelled out in text (symbols kept in tables/figures)
  qa        - Q&A / certification books: MCQ style rules on
  list_style "narrative" | "outline" - list punctuation (APA 7 6.52 vs outline books)
"""
from __future__ import annotations

import copy
from typing import Any, Dict, List

PRESET_NAME = "Springer Publishing House Style (July 2026)"


def _on(option: int, severity: str = "Major") -> Dict[str, Any]:
    return {"enabled": True, "option": option, "severity": severity}


def _off() -> Dict[str, Any]:
    return {"enabled": False}


# ── 1. CE checklist selections ────────────────────────────────────────────────
SPRINGER_CE_RULES: Dict[int, Dict[str, Any]] = {
    # SYMBOLS AND MEASUREMENTS
    1: _off(),          # sec/hr are the house abbreviations (tables, dosages): no SI renaming
    2: _on(1),          # L, mL, g, cm; mmHg
    3: _on(1),          # space between number and unit
    4: _on(1),          # style-profile set: time units written out in text, sec/min/d/wk/y/hr elsewhere
    5: _on(2),          # 15°C, 93°F closed
    6: _on(1),          # 25%; "percentage" without a number
    7: _on(4),          # clinical: >5, <10 closed; spaces around + − =
    8: _on(2),          # spell out Greek letters (beta-blockers)
    9: _on(2),          # mcg, not μg
    10: _on(1),         # vitamin B12 subscript
    11: _on(1),         # 1,234; leading zero only when the statistic can exceed 1
    13: _on(1),         # spell out numbers below 10
    14: _on(2),         # 10 to 20 in text; 10–20 in parentheses and illustrations
    15: _on(1, "Minor"),
    17: _on(2),         # US dates
    19: _on(1),         # 10 a.m.
    21: _on(1),         # $5 (not $5 U.S. dollars)
    24: _on(1),
    25: _on(1),         # p = .05 (lowercase italic, no leading zero); t test
    30: _on(1),
    31: _on(1),         # define at first mention in each chapter (never-spell-out list exempt)
    34: _on(1),
    35: _on(3),         # that is / for example / and so forth in text; e.g., i.e., etc. in parentheses; versus
    36: _on(4),         # Staphylococcus aureus, then S aureus
    40: _on(1),         # -ic preferred (dermatologic)
    43: _on(1),         # omit ® ™ © except registered terms at first mention (style_profile.registered_terms)
    44: _on(1),
    45: _on(1),
    46: _on(2),         # iPad → tablet, iPhone → smartphone, Amazon → online retailer
    47: _on(1),         # publisher word list
    68: _on(1),         # no super heads, no skipped levels
    69: _on(2, "Minor"),
    70: _on(4),         # capitalise words of 4+ letters and all verbs; Self-Report
    71: _on(5),         # Table 5.4 (period, not hyphen)
    72: _on(5),         # Figure 1.2
    73: _on(1),
    74: _on(1),
    75: _on(4),
    76: _on(4),
    78: _on(1),
    79: _on(1, "Minor"),
    81: _on(1),         # abbreviations defined in table/figure footnote, alphabetical, semicolons
    84: _on(1),
    88: _on(1, "Informational"),
    89: _on(1),
    # House-style rules (92+)
    92: _on(1),         # … ellipsis character
    93: _on(1),         # Parkinson disease; Dejerine–Sottas
    94: _on(1),         # singular they; themselves
    95: _on(1),         # person-first; older adults
    96: _on(1),         # whilst, amidst, firstly, towards, learnt, amongst
    97: _on(1),         # no "above"/"below"
    98: _on(1),         # "and", not "&"
    99: _on(1),         # serial comma
    100: _on(1),        # (Beck Depression Inventory [BDI]; ...)
    101: _on(1),        # post–World War II
    102: _on(1),        # widely used; better written; Type II error
    103: _on(1),        # capital after colon only for a complete sentence
    104: _on(1),        # No. not #
    105: _on(1),        # 1950s
    106: _on(1),        # Step 1, Phase 1
    107: _on(1),        # John Smith III
    108: _on(1),        # PO, BID, TID, QID, q12h
    109: _on(1),        # www.cnn.com
    110: _on(1),        # an MRI; a NATO member
    111: _on(1),        # We discuss (not We will discuss)
    112: _on(1),        # chapter, not article/paper
    113: _on(1),        # Rogers's
    114: _on(1),        # figure parts (A), (B)
    115: _on(1),        # Source: From / Adapted from; no Wikipedia/Shutterstock
    116: _on(1),        # (continued)
    117: _on(1),        # (a), (b) in run-in lists
    118: _on(1),        # narrative-style list punctuation (outline overlay → 2)
    119: _on(1),        # headings: no ?, :, parentheticals; 3+ H1s
    120: _on(1),        # bullets: max two levels, capital after stub colon
    121: _off(),        # MCQ rules: Q&A overlay
    124: _on(1),        # Seventh Edition
    125: _on(1),        # Editorial Red Flags (DSM quotes, Campinha-Bacote, Wikipedia)
}

# ── 2. IA rows (kept for the IA report and the Stylesheet card) ────────────────
SPRINGER_SELECTED_IA_ROWS: List[Dict[str, Any]] = [
    {"element": "Percent", "subtype": "General", "pattern": "%"},
    {"element": "Ranges", "subtype": "General", "pattern": "X to Y"},
    {"element": "Numbers", "subtype": "General", "pattern": "0 to 9 spelled out"},
    {"element": "Degree Celsius", "subtype": "General", "pattern": "°C"},
    {"element": "Degree Fahrenheit", "subtype": "General", "pattern": "°F"},
    {"element": "Thousand separator (use/non-use)", "subtype": "General", "pattern": "1,000 (comma)"},
    {"element": "US date", "subtype": "General", "pattern": "Month D, YYYY (long form)"},
    {"element": "Periods", "subtype": "General", "pattern": "a.m."},
    {"element": "Periods", "subtype": "General", "pattern": "p.m."},
    {"element": "Greek letters", "subtype": "General", "pattern": "Greek letter spelled out"},
    {"element": "Genus species", "subtype": "General", "pattern": "[G species] (no dot)"},
    {"element": "(-al) endings", "subtype": "General", "pattern": "(-al) endings"},
    {"element": "Table", "subtype": "Citation", "pattern": "Table ^#.^#"},
    {"element": "Table", "subtype": "Caption", "pattern": "Table ^#.^#"},
    {"element": "Figure", "subtype": "Citation", "pattern": "Figure ^#.^#"},
    {"element": "Figure", "subtype": "Caption", "pattern": "Figure ^#.^#"},
    {"element": "Versus", "subtype": "General", "pattern": "versus"},
    {"element": "Latin abbreviations", "subtype": "General", "pattern": "e.g."},
    {"element": "Latin abbreviations", "subtype": "General", "pattern": "i.e."},
    {"element": "Latin abbreviations", "subtype": "General", "pattern": "etc."},
    {"element": "Ellipse", "subtype": "General", "pattern": "… three dots without spaces"},
    {"element": "Positional ref", "subtype": "General", "pattern": "discussed below"},
]

# ── 3. Word list: preferred forms, and author variants that must be changed ────
SPRINGER_WORD_LIST: List[str] = [
    "21st century", "25 weeks' gestation", "acknowledgment", "advance directive", "advanced practice nurse",
    "African American", "app", "APRN", "attention-deficit/hyperactivity disorder", "audiotape", "BCE", "CE",
    "best-practice", "bloodstream", "BOTOX", "BoNT", "brainstem", "breastfeeding", "breastfed", "bulimia",
    "bylaw", "by-product", "casework", "caseworker", "CCRN® exam", "CNE® exam", "cesarean", "checkup",
    "cognitive behavioral therapy", "comorbidity", "cost-effective", "cost-effectiveness", "critical-thinking",
    "database", "data set", "day care", "decision-making", "disk", "disc", "dos and don'ts", "DSM-IV", "DSM-5",
    "e-book", "e-Notifysm", "EKG", "Elisabeth Kübler-Ross", "email", "emergency department", "Emeritus", "Emeriti",
    "Emerita", "Emeritae", "ereader", "evidence-based", "farmwork", "farmworker", "firsthand", "framework",
    "full time", "full-time", "Gram stain", "gram-positive", "gram-negative", "gray literature", "groundbreaking",
    "handwashing", "healthcare", "HMB-45", "internet", "intranet", "Latinx", "lawsuit", "life span", "lifelong",
    "lifestyle", "life-threatening", "lineup", "long-standing", "long-term", "Lyme disease", "MACE®", "Magnet®",
    "makeup", "medical-surgical", "meta-analysis", "middle-aged", "middle range theories", "mind-set",
    "Mini-Mental State Examination", "mucus", "mucous", "NASW Code of Ethics", "NCLEX®", "NCLEX-PN®", "NCLEX-RN®",
    "NCSBN®", "NeuroBloc", "NNAAP®", "nonneoplastic", "non-small cell lung cancer", "Nursys®", "Nursys e-Notify®",
    "OB/GYN", "obsessive-compulsive", "okay", "ongoing", "pack-years", "Pap smear", "Pap test", "parkinsonian",
    "parkinsonism", "passive-aggressive", "periodic acid-Schiff stain", "policy maker", "post-master's",
    "posttraumatic stress disorder", "practicums", "preeclampsia", "problem-solve", "problem-solving",
    "Question Dissection®", "radiation therapy", "road map", "role-play", "S-100", "school-age", "schoolwork",
    "self-esteem", "setback", "setup", "short-term", "Silver Spring, MD", "smartphone", "so-called", "teamwork",
    "TERCAP®", "time-consuming", "time frame", "timeline", "timetable", "trade-off", "Transition to Practice®",
    "type 2 diabetes", "United States", "U.S.", "vitamin B12", "voice mail", "warm-up", "webpage", "website",
    "well-being", "whistle-blower", "workday", "workup", "workforce", "worldview", "worldwide", "x-ray",
]

# find -> replace (the "not X" / "change X to Y" entries of the word list)
SPRINGER_WORD_REPLACEMENTS: List[Dict[str, str]] = [
    {"find": "co-morbidity", "replace": "comorbidity", "note": "Word list"},
    {"find": "co-morbidities", "replace": "comorbidities", "note": "Word list"},
    {"find": "evidenced-based", "replace": "evidence-based", "note": "not evidenced-based"},
    {"find": "emergency room", "replace": "emergency department", "note": "change emergency room to emergency department"},
    {"find": "ECG", "replace": "EKG", "note": "EKG, not ECG (except PA, APRN, NP books)"},
    {"find": "post-traumatic stress disorder", "replace": "posttraumatic stress disorder", "note": "not post-traumatic"},
    {"find": "APN", "replace": "APRN", "note": "do not use APN"},
    {"find": "advanced directive", "replace": "advance directive", "note": "not advanced directive"},
    {"find": "advance practice nurse", "replace": "advanced practice nurse", "note": "never advance practice nurse"},
    {"find": "ob-gyn", "replace": "OB/GYN", "note": "not ob-gyn"},
    {"find": "radiotherapy", "replace": "radiation therapy", "note": "not radiotherapy"},
    {"find": "Silver Springs, MD", "replace": "Silver Spring, MD", "note": "not Springs"},
    {"find": "Elizabeth Kubler-Ross", "replace": "Elisabeth Kübler-Ross", "note": "Word list"},
    {"find": "Elizabeth Kübler-Ross", "replace": "Elisabeth Kübler-Ross", "note": "Word list"},
    {"find": "Mini-Mental Status Examination", "replace": "Mini-Mental State Examination", "note": "not Status"},
    {"find": "health care", "replace": "healthcare", "note": "one word (industry usage)"},
    {"find": "health-care", "replace": "healthcare", "note": "one word (industry usage)"},
    {"find": "e-mail", "replace": "email", "note": "Word list"},
    {"find": "web site", "replace": "website", "note": "Word list"},
    {"find": "web page", "replace": "webpage", "note": "APA 6.11"},
    {"find": "dataset", "replace": "data set", "note": "APA 6.11"},
    {"find": "decision making", "replace": "decision-making", "note": "n, adj"},
    {"find": "breast-feeding", "replace": "breastfeeding", "note": "Word list"},
    {"find": "breast feeding", "replace": "breastfeeding", "note": "Word list"},
    {"find": "hand washing", "replace": "handwashing", "note": "Word list"},
    {"find": "hand-washing", "replace": "handwashing", "note": "Word list"},
    {"find": "work-up", "replace": "workup", "note": "Word list"},
    {"find": "check-up", "replace": "checkup", "note": "n"},
    {"find": "type II diabetes", "replace": "type 2 diabetes", "note": "Word list"},
    {"find": "Type II diabetes", "replace": "type 2 diabetes", "note": "Word list"},
    {"find": "Caesarean", "replace": "cesarean", "note": "AMA 11.1"},
    {"find": "caesarean", "replace": "cesarean", "note": "AMA 11.1"},
    {"find": "practica", "replace": "practicums", "note": "plural of practicum"},
    {"find": "postmaster's", "replace": "post-master's", "note": "not postmaster's"},
    {"find": "Pap-smear", "replace": "Pap smear", "note": "Word list"},
    {"find": "cognitive-behavioral therapy", "replace": "cognitive behavioral therapy", "note": "no hyphen"},
    {"find": "cognitive behavior therapy", "replace": "cognitive behavioral therapy", "note": "behavioral, not behavior"},
    {"find": "obsessive–compulsive", "replace": "obsessive-compulsive", "note": "hyphen, not en dash"},
    {"find": "passive–aggressive", "replace": "passive-aggressive", "note": "hyphen, not en dash"},
    {"find": "medical–surgical", "replace": "medical-surgical", "note": "hyphen, not en dash"},
    {"find": "middle-range theories", "replace": "middle range theories", "note": "no hyphen"},
    {"find": "lifespan", "replace": "life span", "note": "n"},
    {"find": "timeframe", "replace": "time frame", "note": "Word list"},
    {"find": "roadmap", "replace": "road map", "note": "Word list"},
    {"find": "policymaker", "replace": "policy maker", "note": "2 words"},
    {"find": "voicemail", "replace": "voice mail", "note": "n"},
    {"find": "whistleblower", "replace": "whistle-blower", "note": "Word list"},
    {"find": "mindset", "replace": "mind-set", "note": "n"},
    {"find": "ebook", "replace": "e-book", "note": "Word list"},
    {"find": "e-reader", "replace": "ereader", "note": "APA 6.11"},
    {"find": "Latino/Latina", "replace": "Latinx", "note": "Special words"},
    {"find": "BT", "replace": "BoNT", "note": "BoNT, not BT"},
    {"find": "CCRN exam", "replace": "CCRN® exam", "note": "CCRN® exam (registration mark needed when followed by exam)"},
    {"find": "CNE exam", "replace": "CNE® exam", "note": "CNE® exam (registration mark needed when followed by exam)"},
    {"find": "in the last year", "replace": "in the past year", "note": "past instead of last"},
    {"find": "in the last month", "replace": "in the past month", "note": "past instead of last"},
    {"find": "in the last week", "replace": "in the past week", "note": "past instead of last"},
    {"find": "in the last few", "replace": "in the past few", "note": "past instead of last"},
    {"find": "We will discuss", "replace": "We discuss", "note": "Change future to present tense"},
    {"find": "we will discuss", "replace": "we discuss", "note": "Change future to present tense"},
    {"find": "We will describe", "replace": "We describe", "note": "Change future to present tense"},
    {"find": "we will describe", "replace": "we describe", "note": "Change future to present tense"},
    {"find": "This chapter will discuss", "replace": "This chapter discusses", "note": "Change future to present tense"},
    {"find": "this chapter will discuss", "replace": "this chapter discusses", "note": "Change future to present tense"},
    {"find": "this article", "replace": "this chapter", "note": "chapter, not article/paper"},
    {"find": "this paper", "replace": "this chapter", "note": "chapter, not article/paper"},
    {"find": "the present article", "replace": "this chapter", "note": "chapter, not article/paper"},
    {"find": "the present paper", "replace": "this chapter", "note": "chapter, not article/paper"},
    {"find": "this submission", "replace": "this chapter", "note": "chapter, not article/paper"},
    # Nonpossessive eponymous terms (Row 125)
    {"find": "Parkinson's disease", "replace": "Parkinson disease", "note": "Nonpossessive eponym"},
    {"find": "Alzheimer's disease", "replace": "Alzheimer disease", "note": "Nonpossessive eponym"},
    {"find": "Down's syndrome", "replace": "Down syndrome", "note": "Nonpossessive eponym"},
    {"find": "Down's", "replace": "Down syndrome", "note": "Nonpossessive eponym"},
    {"find": "Hodgkin's disease", "replace": "Hodgkin disease", "note": "Nonpossessive eponym"},
    {"find": "Hodgkin's lymphoma", "replace": "Hodgkin lymphoma", "note": "Nonpossessive eponym"},
    {"find": "Non-Hodgkin's lymphoma", "replace": "Non-Hodgkin lymphoma", "note": "Nonpossessive eponym"},
    {"find": "Crohn's disease", "replace": "Crohn disease", "note": "Nonpossessive eponym"},
    {"find": "Graves' disease", "replace": "Graves disease", "note": "Nonpossessive eponym"},
    {"find": "Grave's disease", "replace": "Graves disease", "note": "Nonpossessive eponym"},
    {"find": "Hashimoto's thyroiditis", "replace": "Hashimoto thyroiditis", "note": "Nonpossessive eponym"},
    {"find": "Hashimoto's disease", "replace": "Hashimoto disease", "note": "Nonpossessive eponym"},
    {"find": "Huntington's chorea", "replace": "Huntington disease", "note": "Nonpossessive eponym"},
    {"find": "Huntington's disease", "replace": "Huntington disease", "note": "Nonpossessive eponym"},
    {"find": "Ménière's disease", "replace": "Ménière disease", "note": "Nonpossessive eponym"},
    {"find": "Meniere's disease", "replace": "Meniere disease", "note": "Nonpossessive eponym"},
    {"find": "Lou Gehrig's disease", "replace": "Lou Gehrig disease", "note": "Nonpossessive eponym"},
    {"find": "Cushing's syndrome", "replace": "Cushing syndrome", "note": "Nonpossessive eponym"},
    {"find": "Cushing's disease", "replace": "Cushing disease", "note": "Nonpossessive eponym"},
    {"find": "Addison's disease", "replace": "Addison disease", "note": "Nonpossessive eponym"},
    {"find": "Tourette's syndrome", "replace": "Tourette syndrome", "note": "Nonpossessive eponym"},
    {"find": "Tourette's disorder", "replace": "Tourette disorder", "note": "Nonpossessive eponym"},
    {"find": "Asperger's syndrome", "replace": "Asperger syndrome", "note": "Nonpossessive eponym"},
    {"find": "Bell's palsy", "replace": "Bell palsy", "note": "Nonpossessive eponym"},
    {"find": "Paget's disease", "replace": "Paget disease", "note": "Nonpossessive eponym"},
    {"find": "Raynaud's phenomenon", "replace": "Raynaud phenomenon", "note": "Nonpossessive eponym"},
    {"find": "Raynaud's disease", "replace": "Raynaud disease", "note": "Nonpossessive eponym"},
    {"find": "Reiter's syndrome", "replace": "Reiter syndrome", "note": "Nonpossessive eponym"},
    {"find": "Sjögren's syndrome", "replace": "Sjögren syndrome", "note": "Nonpossessive eponym"},
    {"find": "Sjogren's syndrome", "replace": "Sjogren syndrome", "note": "Nonpossessive eponym"},
    {"find": "Wilms' tumor", "replace": "Wilms tumor", "note": "Nonpossessive eponym"},
    {"find": "Wilms's tumor", "replace": "Wilms tumor", "note": "Nonpossessive eponym"},
    {"find": "Ehlers-Danlos syndrome", "replace": "Ehlers–Danlos syndrome", "note": "Eponym en dash"},
    {"find": "Dejerine-Sottas dystrophy", "replace": "Dejerine–Sottas dystrophy", "note": "Eponym en dash"},
    # Preferred -ic terms (Row 120)
    {"find": "dermatological", "replace": "dermatologic", "note": "-ic preferred form"},
    {"find": "endocrinological", "replace": "endocrinologic", "note": "-ic preferred form"},
    {"find": "epidemiological", "replace": "epidemiologic", "note": "-ic preferred form"},
    {"find": "etiological", "replace": "etiologic", "note": "-ic preferred form"},
    {"find": "hematological", "replace": "hematologic", "note": "-ic preferred form"},
    {"find": "histological", "replace": "histologic", "note": "-ic preferred form"},
    {"find": "immunological", "replace": "immunologic", "note": "-ic preferred form"},
    {"find": "neurological", "replace": "neurologic", "note": "-ic preferred form"},
    {"find": "neurophysiological", "replace": "neurophysiologic", "note": "-ic preferred form"},
    {"find": "oncological", "replace": "oncologic", "note": "-ic preferred form"},
    {"find": "ophthalmological", "replace": "ophthalmologic", "note": "-ic preferred form"},
    {"find": "pathological", "replace": "pathologic", "note": "-ic preferred form"},
    {"find": "pharmacological", "replace": "pharmacologic", "note": "-ic preferred form"},
    {"find": "physiological", "replace": "physiologic", "note": "-ic preferred form"},
    {"find": "psychological", "replace": "psychologic", "note": "-ic preferred form"},
    {"find": "rheumatological", "replace": "rheumatologic", "note": "-ic preferred form"},
    {"find": "serological", "replace": "serologic", "note": "-ic preferred form"},
    {"find": "urological", "replace": "urologic", "note": "-ic preferred form"},
]

SPRINGER_ORG_NAMES: List[Dict[str, str]] = [
    {"find": "Agency for Health Care Research and Quality", "replace": "Agency for Healthcare Research and Quality"},
    {"find": "American Association of Colleges of Nurses", "replace": "American Association of Colleges of Nursing"},
    {"find": "American Association of Critical Care Nurses", "replace": "American Association of Critical-Care Nurses"},
    {"find": "American Association of Nurse Practitioners", "replace": "American Association of Nurse Practitioners"},
    {"find": "American College of Nurse Midwives", "replace": "American College of Nurse-Midwives"},
    {"find": "American College of Obstetricians and Gynecologists", "replace": "American College of Obstetricians and Gynecologists"},
    {"find": "American Geriatric Society", "replace": "American Geriatrics Society"},
    {"find": "American Nurses' Association", "replace": "American Nurses Association"},
    {"find": "American Nursing Association", "replace": "American Nurses Association"},
    {"find": "American Organization of Nurse Executives", "replace": "American Organization for Nursing Leadership"},
    {"find": "Association of periOperative Registered Nurses", "replace": "Association of periOperative Registered Nurses"},
    {"find": "Association of Women's Health, Obstetric and Neonatal Nursing",
     "replace": "Association of Women's Health, Obstetric and Neonatal Nurses"},
    {"find": "Brigham and Women's Hospital", "replace": "Brigham and Women's Hospital"},
    {"find": "Center for Disease Control and Prevention", "replace": "Centers for Disease Control and Prevention"},
    {"find": "Center for Medicare and Medicaid Services", "replace": "Centers for Medicare & Medicaid Services"},
    {"find": "Centers for Medicare and Medicaid Services", "replace": "Centers for Medicare & Medicaid Services"},
    {"find": "Dana Farber Cancer Institute", "replace": "Dana-Farber Cancer Institute"},
    {"find": "Department of Veteran Affairs", "replace": "Department of Veterans Affairs"},
    {"find": "Department of Veterans' Affairs", "replace": "Department of Veterans Affairs"},
    {"find": "Harper Collins", "replace": "HarperCollins"},
    {"find": "Institute of Medicine", "replace": "Health and Medicine Division"},
    {"find": "John Hopkins", "replace": "Johns Hopkins"},
    {"find": "Kaiser Permanente", "replace": "Kaiser Permanente"},
    {"find": "M.D. Anderson", "replace": "MD Anderson"},
    {"find": "MD Anderson Cancer Center", "replace": "MD Anderson Cancer Center"},
    {"find": "National Academy Press", "replace": "National Academies Press"},
    {"find": "National Institute of Drug Abuse", "replace": "National Institute on Drug Abuse"},
    {"find": "National Institute of Health", "replace": "National Institutes of Health"},
    {"find": "National Institute of Mental Health", "replace": "National Institute of Mental Health"},
    {"find": "National Institute on Aging", "replace": "National Institute on Aging"},
    {"find": "National Institute on Alcohol Abuse and Alcoholism", "replace": "National Institute on Alcohol Abuse and Alcoholism"},
    {"find": "National League of Nursing", "replace": "National League for Nursing"},
    {"find": "National Student Nurses Association", "replace": "National Student Nurses' Association"},
    {"find": "New York-Presbyterian", "replace": "NewYork-Presbyterian"},
    {"find": "PsychINFO", "replace": "PsycINFO"},
    {"find": "RAND Corporation", "replace": "RAND Corporation"},
    {"find": "Springer Publishing", "replace": "Springer Publishing Company"},
    {"find": "The Joint Commission", "replace": "The Joint Commission"},
    {"find": "U.S. Preventative Services Task Force", "replace": "U.S. Preventive Services Task Force"},
]

# ® at first mention in each chapter (Patent Style exceptions and word list)
SPRINGER_REGISTERED_TERMS: List[str] = [
    "NCLEX-RN", "NCLEX-PN", "NCLEX", "NCSBN", "NNAAP", "Nursys e-Notify", "Nursys", "MACE", "Magnet", "TERCAP",
    "Transition to Practice", "Question Dissection", "CCRN", "CNE",
]

SPRINGER_ACRONYMS_WHITELIST: List[str] = [
    "AARP", "ACTH", "AIDS", "APRN", "CD", "CD-ROM", "CEO", "CFO", "CI", "CME", "CPR", "CT", "DDT", "DNA", "DVD",
    "ED", "EDTA", "EEG", "EKG", "ESP", "HIV", "HLA", "HTML", "ICU", "IQ", "IV", "LGBT", "LGBTQ", "LGBTQIAP+", "LPN",
    "MRI", "NCLEX", "NICU", "OB/GYN", "PA", "PET", "pH", "REM", "Rh", "RN", "RNA", "SAS", "SD", "SE", "SEM", "SPSS",
    "TNM", "UV", "VDRL", "XML", "MS", "MA", "PhD", "MD", "BSN", "DNP", "MSN", "EdD",
]

SPRINGER_AVOID_WORDS: Dict[str, str] = {
    "whilst": "while", "amidst": "amid", "firstly": "first", "secondly": "second", "thirdly": "third",
    "towards": "toward", "learnt": "learned", "amongst": "among", "upto": "up to",
    "sufferer": "patient", "sufferers": "patients", "victim": "patient", "victims": "patients",
    "he/she": "they", "she/he": "they", "s/he": "they", "his/her": "their", "him/her": "them",
    "themself": "themselves", "elderly": "older adults", "the elderly": "older adults",
    "the poor": "people living in poverty", "an epileptic": "a person with epilepsy",
    "epileptics": "people with epilepsy", "a diabetic": "a person with diabetes",
    "diabetics": "people with diabetes", "wheelchair-bound": "who uses a wheelchair",
    "confined to a wheelchair": "who uses a wheelchair", "cc": "mL", "μg": "mcg",
}

SPRINGER_PRODUCT_TERMS: Dict[str, List[str]] = {
    "ipad": ["iPad", "tablet"],
    "ipads": ["iPads", "tablets"],
    "iphone": ["iPhone", "smartphone"],
    "iphones": ["iPhones", "smartphones"],
    "ipod": ["iPod", "MP3 player"],
    "ipods": ["iPods", "MP3 players"],
    "kindle": ["Kindle", "e-reader"],
    "kindles": ["Kindles", "e-readers"],
    "amazon": ["Amazon", "online retailer"],
    "google": ["Google", "search engine"],
}

SPRINGER_PREFERRED_IC_TERMS: Dict[str, str] = {
    "dermatological": "dermatologic", "endocrinological": "endocrinologic", "epidemiological": "epidemiologic",
    "etiological": "etiologic", "hematological": "hematologic", "histological": "histologic",
    "immunological": "immunologic", "neurological": "neurologic", "neurophysiological": "neurophysiologic",
    "oncological": "oncologic", "ophthalmological": "ophthalmologic", "pathological": "pathologic",
    "pharmacological": "pharmacologic", "physiological": "physiologic", "psychological": "psychologic",
    "rheumatological": "rheumatologic", "serological": "serologic", "urological": "urologic",
}

SPRINGER_UNIT_STYLE: Dict[str, Any] = {
    "time_in_text": "spelled",  # In text: day, week, year, hour, month written out
    "abbreviations": {"second": "sec", "minute": "min", "hour": "hr", "day": "d", "week": "wk", "year": "y"},
    "pressure": "mmHg",
}

SPRINGER_RED_FLAGS: List[Dict[str, str]] = [
    {"pattern": r"\bDSM-(?:IV|IV-TR|III)\b", "message": "DSM-IV: query author to update criteria to DSM-5."},
    {"pattern": r"\bDiagnostic and Statistical Manual(?: of Mental Disorders)?\b",
     "message": "DSM: flag all direct quotations from any edition of the DSM for permissions/accuracy."},
    {"pattern": r"\b(?:J\.\s*)?Campinha[- ]Bacote\b",
     "message": "J. Campinha-Bacote: flag all references and mentions of Campinha-Bacote."},
    {"pattern": r"\bASKED\s+model\b",
     "message": "ASKED model: flag all mentions of the ASKED model of Campinha-Bacote."},
    {"pattern": r"\b(?:Wikipedia|Wikimedia(?: Commons)?|Shutterstock|iStock(?:photo)?|Getty Images|Adobe Stock)\b",
     "message": "Wikipedia/Wikimedia/Stock images: do not use Wikipedia as a reference; in credit lines, credit uploader and remove URL."},
    {"pattern": r"\b(?:(?:figure|table|box|section)\s+(?:above|below)|(?:discussed|shown|described)\s+(?:above|below)|on the next page)\b",
     "message": "Physical references (above/below/next page) must be avoided in e-books; cite by element number or heading."},
    {"pattern": r"\b(?:in-text citations address|the text explains|thus,\s*[A-E]\s*is the only correct answer)\b",
     "message": "AI-generated rationale marker: avoid empty/circular AI rationale phrasing; explain why options are correct/incorrect."},
    {"pattern": r"_{3,}",
     "message": "Blank in MCQ stem: avoid fill-in-the-blank MCQ questions; rephrase as direct question or statement."},
    {"pattern": r"\b(?:Option\s+[A-E]\s+is\s+(?:not\s+)?correct|[A-E]\s+is\s+not\s+correct\s+because)\b",
     "message": "MCQ rationale contains option letter: do not include answer option letters in rationales; refer to concepts directly."},
    {"pattern": r"\b(?:Both\s+[A-E]\s+and\s+[A-E]|None\s+of\s+the\s+above|All\s+of\s+the\s+above)\b",
     "message": "Prohibited MCQ option: 'Both A and B', 'None of the above', and 'All of the above' are not permitted."},
    {"pattern": r"\b(?:Which\s+of\s+the\s+following\s+(?:is|are)\s+not|All\s+of\s+the\s+following[^?]*except)\b",
     "message": "Negatively framed MCQ stem: avoid negative stems ('is not', 'except'); frame positively."},
]

BOOK_TYPES = {
    "standard": "Standard",
    "pa": "PA / APRN / NP book",
    "demos": "Demos Medical",
    "qa": "Q&A / certification review",
}
LIST_STYLES = {"narrative": "Narrative-style lists (APA 7 6.52)", "outline": "Outline-style lists"}


def springer_style_profile(book_type: str = "standard", list_style: str = "narrative") -> Dict[str, Any]:
    words = copy.deepcopy(SPRINGER_WORD_REPLACEMENTS)
    unit_style = copy.deepcopy(SPRINGER_UNIT_STYLE)
    if book_type == "pa":
        words = [w for w in words if w["find"] != "ECG"]  # ECG allowed in PA, APRN and NP books
        unit_style["pressure"] = "mm Hg"
        words.append({"find": "mmHg", "replace": "mm Hg", "note": "PA books: mm Hg"})
    else:
        words.append({"find": "mm Hg", "replace": "mmHg", "note": "mmHg (except in PA books)"})
    return {
        "publisher": "springer",
        "book_type": book_type,
        "list_style": list_style,
        "word_list": list(SPRINGER_WORD_LIST),
        "word_replacements": words,
        "org_names": copy.deepcopy(SPRINGER_ORG_NAMES),
        "registered_terms": list(SPRINGER_REGISTERED_TERMS),
        "acronyms_no_spellout": list(SPRINGER_ACRONYMS_WHITELIST),
        "avoid_words": dict(SPRINGER_AVOID_WORDS),
        "product_terms": copy.deepcopy(SPRINGER_PRODUCT_TERMS),
        "ic_preferred": dict(SPRINGER_PREFERRED_IC_TERMS),
        "unit_style": unit_style,
        "red_flags": copy.deepcopy(SPRINGER_RED_FLAGS),
    }


def springer_ce_rules(book_type: str = "standard", list_style: str = "narrative") -> Dict[str, Dict[str, Any]]:
    rules = {str(k): dict(v) for k, v in SPRINGER_CE_RULES.items()}
    if book_type == "qa":
        rules["121"] = _on(1)
    if list_style == "outline":
        rules["118"] = _on(2)
    return rules


def get_springer_preset(book_type: str = "standard", list_style: str = "narrative") -> Dict[str, Any]:
    """Complete Springer configuration: ce_rules, IA rows and style_profile."""
    book_type = book_type if book_type in BOOK_TYPES else "standard"
    list_style = list_style if list_style in LIST_STYLES else "narrative"
    profile = springer_style_profile(book_type, list_style)
    return {
        "preset_id": "springer",
        "name": PRESET_NAME,
        "description": (f"Springer Publishing House Style Sheet (July 2026) — {BOOK_TYPES[book_type]}, "
                        f"{LIST_STYLES[list_style]}. APA 7 / modified AMA 11: 15°C closed, mcg, 25%, "
                        "p = .05, Table 5.4, word list and registered terms."),
        "book_type": book_type,
        "list_style": list_style,
        "book_types": BOOK_TYPES,
        "list_styles": LIST_STYLES,
        "ce_rules": springer_ce_rules(book_type, list_style),
        "selected_ia_rows": copy.deepcopy(SPRINGER_SELECTED_IA_ROWS),
        "style_profile": profile,
        # Kept for older callers
        "word_list": profile["word_list"],
        "acronyms_whitelist": profile["acronyms_no_spellout"],
        "avoid_words": profile["avoid_words"],
        "preferred_ic_terms": profile["ic_preferred"],
        "red_flags": profile["red_flags"],
    }
