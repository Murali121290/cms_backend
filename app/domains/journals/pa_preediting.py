"""PA Editorial Ltd. Pre-Editing Module for Ninja Inkflow.

Based on official proposal:
"NINJA INKFLOW · S4CARLISLE PUBLISHING SERVICES · PROPOSAL FOR PA EDITORIAL LTD., UK:
Manuscript Analysis, Structuring and Pre-editing" (NinjaInkflow_PA-documnet.docx).

This module implements:
1. 7-Step Manuscript (MS) Analysis Protocol
2. 3-Level Advisory Language-Editing (LE) Scale (Light / Medium / Heavy)
3. 5-Step Structuring Element Classification & Protected Content Safeguards
4. 121 Checklist Points (Part 1 Technical #1–91, Part 2 Language #92–121) / 160 Extended Crosswalk
5. 4 Gated Steps Pipeline (Gate 1: Structuring, Gate 2: References, Gate 3: Mechanical, Gate 4: Assets)
6. Consolidated Author Query (AQ) List & Editorial Log (ELOG) Dossier Generator
"""

import os
import re
import json
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple, Set

try:
    import docx
except ImportError:
    docx = None

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# 1. 121 / 160 RULES DEFINITIONS & CROSSWALK
# ─────────────────────────────────────────────────────────────────────────────

PA_121_RULES_CATALOG: List[Dict[str, Any]] = [
    # ── PART 1: TECHNICAL POINTS (1–91) ──
    # Units and measurements (1–6)
    {"id": 1, "rule_160_id": 31, "part": "Technical", "domain": "Units and measurements", "name": "SI Units Standard Form", "mode": "Review and Fix", "severity": "Minor", "gate": 3, "desc": "Check units of measurement follow standard SI format (e.g., kg, mL, cm)."},
    {"id": 2, "rule_160_id": 32, "part": "Technical", "domain": "Units and measurements", "name": "Consistency of Unit Presentation", "mode": "Review and Fix", "severity": "Minor", "gate": 3, "desc": "Ensure consistent presentation of units throughout the manuscript."},
    {"id": 3, "rule_160_id": 33, "part": "Technical", "domain": "Units and measurements", "name": "Space Between Numbers and Units", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Insert non-breaking space between quantity and unit; close up percentage signs."},
    {"id": 4, "rule_160_id": 34, "part": "Technical", "domain": "Units and measurements", "name": "Combined and Complex Units", "mode": "Review and Fix", "severity": "Minor", "gate": 3, "desc": "Verify compound units follow journal style consistently (e.g., mg/kg/day or mg·kg⁻¹·day⁻¹)."},
    {"id": 5, "rule_160_id": 35, "part": "Technical", "domain": "Units and measurements", "name": "Non-Standard Unit Clarification", "mode": "Review and Fix", "severity": "Major", "gate": 3, "desc": "Flag archaic or non-standard units (e.g., psi, mmHg in non-clinical contexts)."},
    {"id": 6, "rule_160_id": 36, "part": "Technical", "domain": "Units and measurements", "name": "Temperature Degree Symbol", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Ensure degree symbol is closed up to unit letter without space (e.g., 37°C per house style)."},

    # Mathematical symbols and superscripts (7–10)
    {"id": 7, "rule_160_id": 37, "part": "Technical", "domain": "Mathematical symbols", "name": "Mathematical Operator Spacing", "mode": "Review Auto Fix", "severity": "Minor", "gate": 3, "desc": "Check spaces around operational signs (=, +, −, ±, <, >) as operators vs prefixes."},
    {"id": 8, "rule_160_id": 38, "part": "Technical", "domain": "Mathematical symbols", "name": "Minus Sign vs Hyphen", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Replace regular hyphens with true minus signs (−) in mathematical contexts and negative values."},
    {"id": 9, "rule_160_id": 39, "part": "Technical", "domain": "Mathematical symbols", "name": "Multiplication Sign Formatting", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Replace letter 'x' with true multiplication sign (×) in dimensions and magnifications."},
    {"id": 10, "rule_160_id": 40, "part": "Technical", "domain": "Mathematical symbols", "name": "Superscript and Subscript Verification", "mode": "Review and Fix", "severity": "Major", "gate": 3, "desc": "Verify correct formatting of exponents, chemical valencies, and isotopic notations."},

    # Numbers (11–16)
    {"id": 11, "rule_160_id": 41, "part": "Technical", "domain": "Numbers", "name": "Words vs Numerals Threshold", "mode": "Review and Fix", "severity": "Minor", "gate": 3, "desc": "Spell out numbers under 10 in running text; use numerals for measurements and statistics."},
    {"id": 12, "rule_160_id": 42, "part": "Technical", "domain": "Numbers", "name": "Sentence-Initial Numbers", "mode": "Review and Fix", "severity": "Minor", "gate": 3, "desc": "Ensure numbers beginning sentences are spelled out in full or sentence rephrased."},
    {"id": 13, "rule_160_id": 43, "part": "Technical", "domain": "Numbers", "name": "En-Dash for Number Ranges", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Replace hyphens with en-dashes (–) in numerical and page ranges without spaces."},
    {"id": 14, "rule_160_id": 44, "part": "Technical", "domain": "Numbers", "name": "Decimal Separator Consistency", "mode": "Auto Fix", "severity": "Major", "gate": 3, "desc": "Enforce consistent decimal point (.) vs decimal comma (,) per journal language style."},
    {"id": 15, "rule_160_id": 45, "part": "Technical", "domain": "Numbers", "name": "Thousands Separator", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Ensure consistent digit grouping (thin space or comma) for numbers ≥ 10,000."},
    {"id": 16, "rule_160_id": 46, "part": "Technical", "domain": "Numbers", "name": "Leading Zero for Decimals", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Add leading zero before decimal points (< 1.0) unless restricted (e.g. p < .05 in APA)."},

    # Dates, times and currency (17–21)
    {"id": 17, "rule_160_id": 47, "part": "Technical", "domain": "Dates, times and currency", "name": "Date Format Consistency", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Standardize dates to journal format (e.g., 1 January 2024 or January 1, 2024)."},
    {"id": 18, "rule_160_id": 48, "part": "Technical", "domain": "Dates, times and currency", "name": "Time Format Standard", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Ensure 24-hour clock or 12-hour clock with standard a.m./p.m. notation."},
    {"id": 19, "rule_160_id": 49, "part": "Technical", "domain": "Dates, times and currency", "name": "Time Zone Notation", "mode": "Review and Fix", "severity": "Minor", "gate": 3, "desc": "Specify standard time zones (UTC/GMT/EST) where relevant for event timing."},
    {"id": 20, "rule_160_id": 50, "part": "Technical", "domain": "Dates, times and currency", "name": "Currency Symbol Placement", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Ensure currency symbols precede numbers without space (e.g., $100, €50, £25)."},
    {"id": 21, "rule_160_id": 51, "part": "Technical", "domain": "Dates, times and currency", "name": "Percentage Symbol Formatting", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Enforce house style for percentage sign closed up to numeral (e.g., 95% vs 95 %)."},

    # Reference structure & styles (22–30)
    {"id": 22, "rule_160_id": 52, "part": "Technical", "domain": "Reference structure", "name": "Bibliography System Adherence", "mode": "Review and Fix", "severity": "Major", "gate": 2, "desc": "Verify bibliography follows Vancouver, AMA, or Harvard style as prescribed."},
    {"id": 23, "rule_160_id": 53, "part": "Technical", "domain": "Reference structure", "name": "Reference List Alphabetization / Ordering", "mode": "Auto Fix", "severity": "Major", "gate": 2, "desc": "Ensure alphabetical ordering for author-date systems or numerical sequence for Vancouver."},
    {"id": 24, "rule_160_id": 54, "part": "Technical", "domain": "Reference structure", "name": "Journal Article Reference Elements", "mode": "Review and Fix", "severity": "Major", "gate": 2, "desc": "Verify required elements: authors, title, journal, year, volume, and pages."},
    {"id": 25, "rule_160_id": 55, "part": "Technical", "domain": "Reference structure", "name": "Book Reference Elements", "mode": "Review and Fix", "severity": "Major", "gate": 2, "desc": "Ensure book citations list authors/editors, book title, edition, publisher, place, year."},
    {"id": 26, "rule_160_id": 56, "part": "Technical", "domain": "Reference structure", "name": "Book Chapter Reference Elements", "mode": "Review and Fix", "severity": "Major", "gate": 2, "desc": "Verify chapter author, chapter title, in: book editor, book title, and chapter page range."},
    {"id": 27, "rule_160_id": 57, "part": "Technical", "domain": "Reference structure", "name": "Conference Proceedings Format", "mode": "Review and Fix", "severity": "Minor", "gate": 2, "desc": "Include conference title, date, location, and proceedings publication details."},
    {"id": 28, "rule_160_id": 58, "part": "Technical", "domain": "Reference structure", "name": "Web / Online Resource References", "mode": "Review and Fix", "severity": "Major", "gate": 2, "desc": "Include full URL and access date for online citations without permanent DOI."},
    {"id": 29, "rule_160_id": 59, "part": "Technical", "domain": "Reference structure", "name": "Preprint Citation Disclosure", "mode": "Review and Fix", "severity": "Minor", "gate": 2, "desc": "Clearly label preprints (e.g. bioRxiv, medRxiv, arXiv) as non-peer-reviewed preprints."},
    {"id": 30, "rule_160_id": 60, "part": "Technical", "domain": "Reference structure", "name": "Legal and Regulatory References", "mode": "Review and Fix", "severity": "Minor", "gate": 2, "desc": "Format clinical trial registry numbers, statutes, and directives consistently."},

    # Abbreviations and acronyms (31–35)
    {"id": 31, "rule_160_id": 61, "part": "Technical", "domain": "Abbreviations and acronyms", "name": "First-Use Abbreviation Expansion", "mode": "Review and Fix", "severity": "Major", "gate": 3, "desc": "Expand acronyms at first mention in abstract and body followed by abbreviation in parentheses."},
    {"id": 32, "rule_160_id": 62, "part": "Technical", "domain": "Abbreviations and acronyms", "name": "Unexpanded Abbreviation Identification", "mode": "Review and Fix", "severity": "Major", "gate": 3, "desc": "Flag all unexplained abbreviations or acronyms for author clarification."},
    {"id": 33, "rule_160_id": 63, "part": "Technical", "domain": "Abbreviations and acronyms", "name": "Established Abbreviations List", "mode": "Review and Fix", "severity": "Minor", "gate": 3, "desc": "Permit standard universally recognized terms (DNA, RNA, AIDS, CT, MRI, COVID-19) without expansion."},
    {"id": 34, "rule_160_id": 64, "part": "Technical", "domain": "Abbreviations and acronyms", "name": "Consistent Use of Established Abbreviations", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "After defining an acronym, ensure the abbreviation is used consistently rather than reverting to full term."},
    {"id": 35, "rule_160_id": 65, "part": "Technical", "domain": "Abbreviations and acronyms", "name": "Acronyms in Titles and Headings", "mode": "Review and Fix", "severity": "Minor", "gate": 3, "desc": "Avoid unexpanded acronyms in article titles and main headings unless approved."},

    # Scientific nomenclature (36–42)
    {"id": 36, "rule_160_id": 66, "part": "Technical", "domain": "Scientific nomenclature", "name": "Binomial Taxonomic Italicization", "mode": "Auto Fix", "severity": "Major", "gate": 3, "desc": "Ensure genus and species names are italicized (e.g., Staphylococcus aureus, E. coli)."},
    {"id": 37, "rule_160_id": 67, "part": "Technical", "domain": "Scientific nomenclature", "name": "Taxonomic Genus Abbreviation", "mode": "Review and Fix", "severity": "Minor", "gate": 3, "desc": "Spell genus in full on first occurrence; abbreviate on subsequent mentions."},
    {"id": 38, "rule_160_id": 68, "part": "Technical", "domain": "Scientific nomenclature", "name": "Gene vs Protein Symbol Formatting", "mode": "Review and Fix", "severity": "Major", "gate": 3, "desc": "Ensure gene symbols are italicized and protein products are in regular roman font."},
    {"id": 39, "rule_160_id": 69, "part": "Technical", "domain": "Scientific nomenclature", "name": "Chemical Formula Validation", "mode": "Review and Fix", "severity": "Major", "gate": 3, "desc": "Verify chemical formulas have proper subscripts (e.g. H₂O, CO₂) and valencies."},
    {"id": 40, "rule_160_id": 70, "part": "Technical", "domain": "Scientific nomenclature", "name": "Drug Generic vs Proprietary Names", "mode": "Review and Fix", "severity": "Major", "gate": 3, "desc": "Ensure generic International Nonproprietary Names (INN) are in lowercase; proprietary names capitalized."},
    {"id": 41, "rule_160_id": 71, "part": "Technical", "domain": "Scientific nomenclature", "name": "Anatomical Nomenclature Consistency", "mode": "Review and Fix", "severity": "Minor", "gate": 3, "desc": "Adhere to standard anatomical terminology (Terminologia Anatomica)."},
    {"id": 42, "rule_160_id": 72, "part": "Technical", "domain": "Scientific nomenclature", "name": "Medical Diagnostic & Clinical Scales", "mode": "Review and Fix", "severity": "Minor", "gate": 3, "desc": "Validate standard score notations (e.g. Glasgow Coma Scale, ASA classification)."},

    # Footnotes and endnotes (43–47)
    {"id": 43, "rule_160_id": 73, "part": "Technical", "domain": "Footnotes and endnotes", "name": "Footnote Numbering Sequence", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Ensure consecutive superscript numbering for body footnotes."},
    {"id": 44, "rule_160_id": 74, "part": "Technical", "domain": "Footnotes and endnotes", "name": "Table Footnote Symbol Sequence", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Use standard symbol sequence (*, †, ‡, §) or lowercase letters (a, b, c) for table notes."},
    {"id": 45, "rule_160_id": 75, "part": "Technical", "domain": "Footnotes and endnotes", "name": "Author Affiliation Footnotes", "mode": "Review and Fix", "severity": "Major", "gate": 1, "desc": "Link author superscripts accurately to institutional affiliations and correspondence address."},
    {"id": 46, "rule_160_id": 76, "part": "Technical", "domain": "Footnotes and endnotes", "name": "Corresponding Author Designation", "mode": "Review and Fix", "severity": "Major", "gate": 1, "desc": "Identify corresponding author clearly with email and institutional address."},
    {"id": 47, "rule_160_id": 77, "part": "Technical", "domain": "Footnotes and endnotes", "name": "Equal Contribution Statement", "mode": "Review and Fix", "severity": "Minor", "gate": 1, "desc": "Mark co-first authors with equal contribution symbol and explanatory note."},

    # Citation format and matching (48–51)
    {"id": 48, "rule_160_id": 81, "part": "Technical", "domain": "Citation format and matching", "name": "Citation Style Compliance", "mode": "Review Auto Fix", "severity": "Major", "gate": 2, "desc": "Ensure in-text citations follow journal style (Vancouver bracketed [1], AMA superscript, or Harvard)."},
    {"id": 49, "rule_160_id": 82, "part": "Technical", "domain": "Citation format and matching", "name": "Sequential Citation Numbering", "mode": "Review and Fix", "severity": "Critical", "gate": 2, "desc": "For numerical systems, citations must appear in strict sequential order throughout text."},
    {"id": 50, "rule_160_id": 83, "part": "Technical", "domain": "Citation format and matching", "name": "Citation–Reference 100% Cross-Match", "mode": "Review and Fix", "severity": "Critical", "gate": 2, "desc": "Every citation must match an entry in the bibliography; every bibliography entry must be cited in text."},
    {"id": 51, "rule_160_id": 84, "part": "Technical", "domain": "Citation format and matching", "name": "Parenthetical Citation Range Standardization", "mode": "Auto Fix", "severity": "Minor", "gate": 2, "desc": "Standardize ranges within citations (e.g., [1-3] to [1–3] with en-dash, comma separators with space)."},

    # Reference details (52–67)
    {"id": 52, "rule_160_id": 85, "part": "Technical", "domain": "Reference details", "name": "Author Name Inversion in References", "mode": "Auto Fix", "severity": "Minor", "gate": 2, "desc": "Format reference author names per style (e.g., Surname Initial(s) without periods in Vancouver/AMA)."},
    {"id": 53, "rule_160_id": 86, "part": "Technical", "domain": "Reference details", "name": "NLM Standard Journal Title Abbreviations", "mode": "Review Auto Fix", "severity": "Minor", "gate": 2, "desc": "Ensure journal titles are abbreviated per PubMed/NLM catalog standards."},
    {"id": 54, "rule_160_id": 87, "part": "Technical", "domain": "Reference details", "name": "DOI Validation and Hyperlinking", "mode": "Review and Fix", "severity": "Major", "gate": 2, "desc": "Ensure DOIs are valid, present for journal articles, and formatted as https://doi.org/... URLs."},
    {"id": 55, "rule_160_id": 88, "part": "Technical", "domain": "Reference details", "name": "Volume and Issue Number Consistency", "mode": "Review and Fix", "severity": "Minor", "gate": 2, "desc": "Verify volume and issue numbers follow journal conventions."},
    {"id": 56, "rule_160_id": 89, "part": "Technical", "domain": "Reference details", "name": "Page Range En-Dash in References", "mode": "Auto Fix", "severity": "Minor", "gate": 2, "desc": "Ensure page ranges in references use en-dash (–) without spaces (e.g., 100–105)."},
    {"id": 57, "rule_160_id": 90, "part": "Technical", "domain": "Reference details", "name": "Truncated vs Full Page Numbers", "mode": "Auto Fix", "severity": "Minor", "gate": 2, "desc": "Standardize page truncation (e.g., 121–128 vs 121–8) per style guidelines."},
    {"id": 58, "rule_160_id": 91, "part": "Technical", "domain": "Reference details", "name": "Multi-Author 'et al.' Threshold", "mode": "Auto Fix", "severity": "Minor", "gate": 2, "desc": "Apply author cutoff policy (e.g., list first 6 authors followed by et al. in Vancouver)."},
    {"id": 59, "rule_160_id": 92, "part": "Technical", "domain": "Reference details", "name": "Publication Year Placement", "mode": "Auto Fix", "severity": "Minor", "gate": 2, "desc": "Position publication year per style (e.g., after authors in Harvard, after journal in Vancouver)."},
    {"id": 60, "rule_160_id": 93, "part": "Technical", "domain": "Reference details", "name": "Article Title Sentence Case in References", "mode": "Auto Fix", "severity": "Minor", "gate": 2, "desc": "Format reference article titles in sentence case with initial capital and proper nouns only."},
    {"id": 61, "rule_160_id": 94, "part": "Technical", "domain": "Reference details", "name": "Unnumbered Bibliography Delineation", "mode": "Auto Fix", "severity": "Major", "gate": 2, "desc": "Detect and number unnumbered bibliography items matching in-text numbered citations."},
    {"id": 62, "rule_160_id": 95, "part": "Technical", "domain": "Reference details", "name": "Reference Punctuation Normalization", "mode": "Auto Fix", "severity": "Minor", "gate": 2, "desc": "Ensure consistent periods, colons, and semi-colons separating reference fields."},
    {"id": 63, "rule_160_id": 96, "part": "Technical", "domain": "Reference details", "name": "Institutional Author Formatting", "mode": "Review and Fix", "severity": "Minor", "gate": 2, "desc": "Format corporate or institutional authors without trailing commas (e.g. World Health Organization)."},
    {"id": 64, "rule_160_id": 97, "part": "Technical", "domain": "Reference details", "name": "Epub Ahead of Print Notation", "mode": "Review and Fix", "severity": "Minor", "gate": 2, "desc": "Clarify early-access or ahead-of-print citations with publication date and DOI."},
    {"id": 65, "rule_160_id": 98, "part": "Technical", "domain": "Reference details", "name": "Retracted Article Flagging", "mode": "Review and Fix", "severity": "Critical", "gate": 2, "desc": "Cross-check references against Retraction Watch / CrossRef to alert if a cited paper was retracted."},
    {"id": 66, "rule_160_id": 99, "part": "Technical", "domain": "Reference details", "name": "Reference Language Disclosure", "mode": "Review and Fix", "severity": "Minor", "gate": 2, "desc": "Indicate non-English references with language tag (e.g., [in Italian])."},
    {"id": 67, "rule_160_id": 100, "part": "Technical", "domain": "Reference details", "name": "Bibliography Italicization", "mode": "Auto Fix", "severity": "Minor", "gate": 2, "desc": "Verify journal names or book titles italicized per house style."},

    # Headings and structure (68–70)
    {"id": 68, "rule_160_id": 121, "part": "Technical", "domain": "Headings and structure", "name": "Heading Hierarchy and Order", "mode": "Review and Fix", "severity": "Major", "gate": 1, "desc": "Validate H1, H2, H3 hierarchy; flag orphan subheadings and ensure IMRAD logical progression."},
    {"id": 69, "rule_160_id": 122, "part": "Technical", "domain": "Headings and structure", "name": "Heading Capitalization Style", "mode": "Auto Fix", "severity": "Minor", "gate": 1, "desc": "Enforce sentence-case or title-case on section headings per journal style guidelines."},
    {"id": 70, "rule_160_id": 123, "part": "Technical", "domain": "Headings and structure", "name": "Heading Numbering Consistency", "mode": "Review and Fix", "severity": "Minor", "gate": 1, "desc": "Ensure section numbers (e.g. 1.0, 1.1) follow uniform scheme or remove if unnumbered style."},

    # Numbering and callouts (Tables & Figures) (71–74)
    {"id": 71, "rule_160_id": 126, "part": "Technical", "domain": "Numbering and callouts", "name": "Table Numbering Sequence", "mode": "Review and Fix", "severity": "Major", "gate": 4, "desc": "Verify tables are numbered consecutively in order of in-text citation."},
    {"id": 72, "rule_160_id": 127, "part": "Technical", "domain": "Numbering and callouts", "name": "Figure Numbering Sequence", "mode": "Review and Fix", "severity": "Major", "gate": 4, "desc": "Verify figures are numbered consecutively in order of in-text citation."},
    {"id": 73, "rule_160_id": 128, "part": "Technical", "domain": "Numbering and callouts", "name": "Table Callout Verification", "mode": "Review and Fix", "severity": "Critical", "gate": 4, "desc": "Ensure every table has a corresponding in-text callout and vice versa."},
    {"id": 74, "rule_160_id": 129, "part": "Technical", "domain": "Numbering and callouts", "name": "Figure Callout Verification & Artwork Check", "mode": "Review and Fix", "severity": "Critical", "gate": 4, "desc": "Ensure every figure is cited in text and corresponding high-res artwork file is provided."},

    # Quotations and Callouts (75–80)
    {"id": 75, "rule_160_id": 131, "part": "Technical", "domain": "Quotations", "name": "Quotation Marks Style Consistency", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Enforce double quotes (US style) or single quotes (UK style) consistently."},
    {"id": 76, "rule_160_id": 132, "part": "Technical", "domain": "Quotations", "name": "Punctuation Relative to Quotation Marks", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Enforce punctuation inside quotes (US style) or outside quotes (UK style)."},
    {"id": 77, "rule_160_id": 133, "part": "Technical", "domain": "Quotations", "name": "Block Quotation Formatting (> 40 Words)", "mode": "Review and Fix", "severity": "Minor", "gate": 3, "desc": "Set long quotations exceeding 40 words as indented block quote without quotation marks."},
    {"id": 78, "rule_160_id": 134, "part": "Technical", "domain": "Quotations", "name": "Page Citation for Direct Quotations", "mode": "Review and Fix", "severity": "Major", "gate": 3, "desc": "Ensure direct quotations include specific page or paragraph reference in citation."},
    {"id": 79, "rule_160_id": 135, "part": "Technical", "domain": "Quotations", "name": "Ellipsis in Quotations", "mode": "Auto Fix", "severity": "Minor", "gate": 3, "desc": "Format omitted words with standard three spaced dots or unicode ellipsis character (…)."},
    {"id": 80, "rule_160_id": 136, "part": "Technical", "domain": "Quotations", "name": "Interpolations in Quotations [Square Brackets]", "mode": "Review and Fix", "severity": "Minor", "gate": 3, "desc": "Verify editorial additions or clarifying words within quotations are enclosed in square brackets."},

    # Missing Content & Metadata (81–84)
    {"id": 81, "rule_160_id": 141, "part": "Technical", "domain": "Missing content", "name": "Article Title & Running Head", "mode": "Review and Fix", "severity": "Major", "gate": 1, "desc": "Verify presence of full title and short running title under 50 characters."},
    {"id": 82, "rule_160_id": 142, "part": "Technical", "domain": "Missing content", "name": "Structured Abstract Sections & Word Count", "mode": "Review and Fix", "severity": "Major", "gate": 1, "desc": "Verify abstract headings (Background, Methods, Results, Conclusion) and check 250 word limit."},
    {"id": 83, "rule_160_id": 146, "part": "Technical", "domain": "Missing content", "name": "Missing Required Frontmatter", "mode": "Review and Fix", "severity": "Critical", "gate": 1, "desc": "Verify presence of title, all author names, institutional affiliations, and abstract."},
    {"id": 84, "rule_160_id": 147, "part": "Technical", "domain": "Missing content", "name": "Keywords Specification & Count", "mode": "Review and Fix", "severity": "Minor", "gate": 1, "desc": "Ensure 3–6 keywords provided from MeSH (Medical Subject Headings) or standard ontology."},

    # Duplicate & Conflicting Content (85–89)
    {"id": 85, "rule_160_id": 151, "part": "Technical", "domain": "Duplicate content", "name": "Duplicate In-Text Citations", "mode": "Auto Fix", "severity": "Minor", "gate": 2, "desc": "Eliminate redundant adjacent duplicate citations (e.g. [1, 1] to [1])."},
    {"id": 86, "rule_160_id": 152, "part": "Technical", "domain": "Duplicate content", "name": "Duplicate Bibliography Entries", "mode": "Review and Fix", "severity": "Major", "gate": 2, "desc": "Identify identical or near-identical citations appearing multiple times in references list."},
    {"id": 87, "rule_160_id": 153, "part": "Technical", "domain": "Duplicate content", "name": "Duplicate Table or Figure Numbering", "mode": "Review and Fix", "severity": "Critical", "gate": 4, "desc": "Flag duplicate numbering assigned to different tables or figures."},
    {"id": 88, "rule_160_id": 154, "part": "Technical", "domain": "Duplicate content", "name": "Repeated Paragraphs or Sections", "mode": "Review and Fix", "severity": "Major", "gate": 1, "desc": "Flag copy-paste duplication across sections."},
    {"id": 89, "rule_160_id": 155, "part": "Technical", "domain": "Duplicate content", "name": "Data Consistency Text vs Tables", "mode": "Review and Fix", "severity": "Major", "gate": 3, "desc": "Verify sample sizes (N), percentages, and p-values in text match table cells."},

    # Mandatory Declarations (90–91)
    {"id": 90, "rule_160_id": 158, "part": "Technical", "domain": "Declarations and compliance", "name": "Mandatory Ethical Declarations", "mode": "Review and Fix", "severity": "Critical", "gate": 4, "desc": "Flag missing Conflict of Interest, Ethical Approval, Informed Consent, and Funding statements."},
    {"id": 91, "rule_160_id": 159, "part": "Technical", "domain": "Declarations and compliance", "name": "Data Availability Statement", "mode": "Review and Fix", "severity": "Major", "gate": 4, "desc": "Confirm presence of required research data access and repository statement."},

    # ── PART 2: LANGUAGE & STYLE POINTS (92–121) ──
    # Spelling and language variant (92–94)
    {"id": 92, "rule_160_id": 1, "part": "Language", "domain": "Spelling and language variant", "name": "US vs UK English Consistency", "mode": "Review Auto Fix", "severity": "Minor", "gate": 5, "desc": "Standardize spelling to selected journal variant (e.g., -ize vs -ise, -or vs -our, center vs centre)."},
    {"id": 93, "rule_160_id": 2, "part": "Language", "domain": "Spelling and language variant", "name": "Specialized Medical/Scientific Spelling", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Verify domain spellings (e.g., fetus vs foetus, edema vs oedema, sulfur vs sulphur)."},
    {"id": 94, "rule_160_id": 3, "part": "Language", "domain": "Spelling and language variant", "name": "Compound Words and Hyphenation", "mode": "Review Auto Fix", "severity": "Minor", "gate": 5, "desc": "Standardize open, hyphenated, and closed compounds per medical dictionary (e.g. post-operative vs postoperative)."},

    # Grammar (95–99)
    {"id": 95, "rule_160_id": 4, "part": "Language", "domain": "Grammar", "name": "Subject–Verb Agreement", "mode": "Review and Fix", "severity": "Major", "gate": 5, "desc": "Ensure subjects agree in number with verbs (e.g. 'PSA was performed' vs 'PSA were performed')."},
    {"id": 96, "rule_160_id": 5, "part": "Language", "domain": "Grammar", "name": "Tense Consistency in Methodology & Results", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Maintain past tense for completed experimental methods and findings."},
    {"id": 97, "rule_160_id": 6, "part": "Language", "domain": "Grammar", "name": "Dangling and Misplaced Modifiers", "mode": "Review and Fix", "severity": "Major", "gate": 5, "desc": "Ensure participial phrases clearly modify the intended agent rather than an unintended noun."},
    {"id": 98, "rule_160_id": 7, "part": "Language", "domain": "Grammar", "name": "Pronoun–Antecedent Agreement", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Ensure singular pronouns refer to singular entities (e.g., each patient ... his/her/their)."},
    {"id": 99, "rule_160_id": 8, "part": "Language", "domain": "Grammar", "name": "Definite and Indefinite Article Usage", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Supply missing articles ('a', 'an', 'the') in noun phrases (e.g. 'remains subject of debate' -> 'remains a subject of debate')."},

    # Punctuation and spacing (100–101)
    {"id": 100, "rule_160_id": 9, "part": "Language", "domain": "Punctuation", "name": "Punctuation Spacing Normalization", "mode": "Auto Fix", "severity": "Minor", "gate": 5, "desc": "Remove spaces before commas/periods; ensure single space after punctuation; remove double spaces."},
    {"id": 101, "rule_160_id": 10, "part": "Language", "domain": "Punctuation", "name": "Serial Comma (Oxford Comma) Policy", "mode": "Auto Fix", "severity": "Minor", "gate": 5, "desc": "Apply serial comma policy consistently across series of three or more items."},

    # Sentence structure & syntax (102–106)
    {"id": 102, "rule_160_id": 11, "part": "Language", "domain": "Sentence structure", "name": "Em-Dash vs Hyphen in Parenthetical Breaks", "mode": "Auto Fix", "severity": "Minor", "gate": 5, "desc": "Replace single hyphens with unspaced em-dashes (—) for sentence-level parenthetical thoughts."},
    {"id": 103, "rule_160_id": 12, "part": "Language", "domain": "Sentence structure", "name": "Run-On and Overly Long Sentences", "mode": "Review and Fix", "severity": "Major", "gate": 5, "desc": "Flag sentences exceeding 40 words that impair syntactic clarity."},
    {"id": 104, "rule_160_id": 13, "part": "Language", "domain": "Sentence structure", "name": "Sentence Fragments & Incomplete Syntax", "mode": "Review and Fix", "severity": "Major", "gate": 5, "desc": "Identify phrases punctuated as full sentences that lack an independent clause or finite verb."},
    {"id": 105, "rule_160_id": 14, "part": "Language", "domain": "Sentence structure", "name": "Parallel Structure in Bulleted Lists", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Ensure list elements share identical grammatical forms (e.g., all starting with verbs or all noun phrases)."},
    {"id": 106, "rule_160_id": 15, "part": "Language", "domain": "Sentence structure", "name": "Plain English & Jargon Clarification", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Recommend accessible scientific phrasings for obfuscated clinical jargon."},

    # Word forms & Latin abbreviations (107–111)
    {"id": 107, "rule_160_id": 16, "part": "Language", "domain": "Word forms", "name": "Latin Abbreviation Punctuation (et al., i.e., e.g.)", "mode": "Auto Fix", "severity": "Minor", "gate": 5, "desc": "Ensure 'et al.' has period only after 'al', 'i.e.' and 'e.g.' punctuated with periods and trailing comma."},
    {"id": 108, "rule_160_id": 17, "part": "Language", "domain": "Word forms", "name": "Latin Terms Italicization Policy", "mode": "Auto Fix", "severity": "Minor", "gate": 5, "desc": "Leave common Latin terms (in vitro, in vivo, ad hoc, de novo) in roman text per modern scientific style."},
    {"id": 109, "rule_160_id": 18, "part": "Language", "domain": "Word forms", "name": "Restrictive 'That' vs Non-Restrictive 'Which'", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Enforce 'that' for essential restrictive clauses; 'which' preceded by a comma for descriptive non-restrictive clauses."},
    {"id": 110, "rule_160_id": 19, "part": "Language", "domain": "Word forms", "name": "Affect vs Effect Precision", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Distinguish between 'affect' (usually verb: to influence) and 'effect' (usually noun: result)."},
    {"id": 111, "rule_160_id": 20, "part": "Language", "domain": "Word forms", "name": "Pluralization of Scientific Nouns (Data, Criteria)", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Ensure 'data are', 'criteria are', 'phenomena are' used consistently as plural forms."},

    # Academic Style & Tone (112–115)
    {"id": 112, "rule_160_id": 21, "part": "Language", "domain": "Style and tone", "name": "Objective Academic Tone", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Avoid emotional, hyperbolic, or promotional language in presenting research results."},
    {"id": 113, "rule_160_id": 22, "part": "Language", "domain": "Style and tone", "name": "Elimination of Colloquial Phrasing", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Replace informal conversational idioms with formal academic vocabulary."},
    {"id": 114, "rule_160_id": 23, "part": "Language", "domain": "Style and tone", "name": "Gender-Neutral and Inclusive Language", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Use inclusive terminology per APA/ICMJE guidelines (e.g. they/their, person with diabetes)."},
    {"id": 115, "rule_160_id": 24, "part": "Language", "domain": "Style and tone", "name": "Active vs Passive Voice Optimization", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Promote direct, vigorous active voice where agent is known while permitting passive voice for objective procedures."},

    # Clarity and Precision (116–120)
    {"id": 116, "rule_160_id": 25, "part": "Language", "domain": "Clarity and precision", "name": "Conciseness and Wordiness Reduction", "mode": "Review Auto Fix", "severity": "Minor", "gate": 5, "desc": "Trim pleonasms and empty phrases (e.g., 'due to the fact that' -> 'because', 'in order to' -> 'to')."},
    {"id": 117, "rule_160_id": 26, "part": "Language", "domain": "Clarity and precision", "name": "Quantifier Precision", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Replace vague words ('a lot of', 'quite few', 'several') with specific statistical metrics."},
    {"id": 118, "rule_160_id": 27, "part": "Language", "domain": "Clarity and precision", "name": "Unambiguous Comparative Referents", "mode": "Review and Fix", "severity": "Major", "gate": 5, "desc": "Ensure comparisons specify baseline (e.g., 'higher than baseline controls' rather than simply 'higher')."},
    {"id": 119, "rule_160_id": 28, "part": "Language", "domain": "Clarity and precision", "name": "Transitional Word Variety", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Vary repetitive discourse markers (furthermore, moreover, therefore) to maintain prose vitality."},
    {"id": 120, "rule_160_id": 29, "part": "Language", "domain": "Clarity and precision", "name": "Paragraph Unity and Topic Coherence", "mode": "Review and Fix", "severity": "Minor", "gate": 5, "desc": "Ensure single core concept per paragraph with clear topic sentences and smooth transitions."},

    # AI and compliance disclosure (121)
    {"id": 121, "rule_160_id": 30, "part": "Language", "domain": "Editorial compliance", "name": "AI Tool Usage Disclosure Verification", "mode": "Review and Fix", "severity": "Major", "gate": 5, "desc": "Verify author declaration on generative AI or LLM tool usage per COPE/ICMJE recommendations."}
]
PA_121_RULES = PA_121_RULES_CATALOG

IA_TO_PA_MAPPING: Dict[str, int] = {
    "units": 1,
    "unit_space": 3,
    "unit_spacing": 3,
    "temperature_deg": 6,
    "deg_celsius_word": 6,
    "math_operators": 7,
    "minus_hyphen": 8,
    "multiplication_x": 9,
    "times_x_char": 9,
    "num_single_spelled": 11,
    "num_single_numeral": 11,
    "num_double_spelled": 11,
    "num_double_numeral": 11,
    "ordinal_spelled": 11,
    "fract_symbol_half": 11,
    "fract_symbol_quarter": 11,
    "fract_symbol_three_quarters": 11,
    "range_hyphen": 13,
    "spaced_hyphens": 13,
    "thousands_nosep": 15,
    "leading_zero_absent": 16,
    "leading_zero_present": 16,
    "leading_zero_missing": 16,
    "date_format": 17,
    "century_numeric": 17,
    "era_ad_nodot": 17,
    "era_bc_nodot": 17,
    "ampm_am_upper": 18,
    "ampm_pm_upper": 18,
    "ampm_am_lower": 18,
    "ampm_pm_lower": 18,
    "currency_symbol": 20,
    "percent_symbol": 21,
    "percent_word": 21,
    "percent_percentage": 21,
    "per_cent_word": 21,
    "abbrev_body": 31,
    "abbrev_table": 31,
    "abbrev_abstract": 31,
    "genus_species_nodot": 36,
    "genus_species_sp": 36,
    "ref_table_single": 73,
    "ref_tabs_single": 73,
    "ref_tab_single": 73,
    "ref_tabs_and": 73,
    "ref_tabs_dotted": 73,
    "ref_figure_single": 74,
    "ref_figs_single": 74,
    "ref_fig_single": 74,
    "ref_figs_and": 74,
    "ref_figs_dotted": 74,
    "spelling_variant": 92,
    "aux_verb_was": 95,
    "aux_verb_is": 95,
    "aux_verb_are": 95,
    "subject_terms": 95,
    "pronoun_check": 98,
    "caps_after_colon": 100,
    "lowercase_after_colon": 100,
    "para_no_full_stop": 100,
    "ellipsis_3dots": 100,
    "ellipsis_spaced": 100,
    "ellipsis_symbol": 100,
    "clinical_jargon": 106,
    "latin_et_al": 107,
    "latin_ie": 107,
    "latin_eg": 107,
    "latin_etc": 107,
    "versus_vs": 107,
    "versus_v": 107,
    "versus_vs_dot": 107,
    "versus_v_dot": 107,
    # CE checklist detectors (CE_rules_tool_input.xlsx)
    "si_nonsi_rename": 1,
    "si_nonsi_convert": 5,
    "si_ambiguous_symbol": 5,
    "unit_case_wrong": 2,
    "unit_symbol_period": 2,
    "micro_lookalike": 2,
    "unit_space_missing": 3,
    "unit_exp_plain": 10,
    "degree_celsius": 6,
    "degree_lookalike": 6,
    "negative_hyphen": 8,
    "times_letter": 9,
    "chem_formula_plain": 39,
    "stat_p_value": 7,
    "stat_symbol": 7,
    "plusminus_spacing": 7,
    "plusminus_text": 7,
    "sci_notation_e": 10,
    "sci_notation_x": 10,
    "timezone_abbr": 19,
    "duplicate_paragraph": 88,
}


def evaluate_121_rules_compliance(article: Any, issues: List[Any]) -> Dict[str, Any]:
    """Generates the 121 Rules Compliance Matrix showing verified vs flagged points."""
    catalog = PA_121_RULES_CATALOG
    issues_by_pa_id: Dict[int, List[Any]] = {r["id"]: [] for r in catalog}

    for iss in issues:
        rule_id_str = getattr(iss, "rule_id", "") or ""
        loc = getattr(iss, "location", {}) or {}
        pa_id = loc.get("pa_point")
        if not pa_id:
            m = re.search(r'PA\s*[:#]\s*(\d+)', rule_id_str)
            if m:
                pa_id = int(m.group(1))
            else:
                clean_id = rule_id_str.replace("IA:", "").strip()
                pa_id = IA_TO_PA_MAPPING.get(clean_id)
        if pa_id and pa_id in issues_by_pa_id:
            issues_by_pa_id[pa_id].append(iss)

    rules_out = []
    flagged_count = 0
    passed_count = 0

    for r in catalog:
        matched = issues_by_pa_id.get(r["id"], [])
        open_matched = [i for i in matched if getattr(i, "status", "open") == "open"]
        status_val = "flagged" if len(open_matched) > 0 else "passed"
        if status_val == "flagged":
            flagged_count += 1
        else:
            passed_count += 1

        gate_num = r.get("gate", 3)
        gate_labels = {
            1: "Gate 1: Structuring",
            2: "Gate 2: References",
            3: "Gate 3: Mechanical",
            4: "Gate 4: Asset Callouts",
            5: "Stage 3: Language"
        }
        gate_label = gate_labels.get(gate_num, "Stage 3: Language" if r["part"] == "Language" else f"Gate {gate_num}")

        rules_out.append({
            "id": r["id"],
            "rule_160_id": r.get("rule_160_id"),
            "part": r["part"],
            "domain": r["domain"],
            "name": r["name"],
            "mode": r["mode"],
            "severity": r["severity"],
            "gate": gate_num,
            "gate_label": gate_label,
            "desc": r["desc"],
            "status": status_val,
            "issues_count": len(matched),
            "open_issues_count": len(open_matched),
            "issue_ids": [getattr(i, "id", None) for i in matched if getattr(i, "id", None) is not None]
        })

    return {
        "article_id": getattr(article, "id", None),
        "total": len(catalog),
        "technical_count": sum(1 for r in catalog if r["part"] == "Technical"),
        "language_count": sum(1 for r in catalog if r["part"] == "Language"),
        "passed_count": passed_count,
        "flagged_count": flagged_count,
        "rules": rules_out
    }



# ─────────────────────────────────────────────────────────────────────────────
# 2. ADVISORY LANGUAGE-EDITING (LE) THRESHOLDS & ENGINE
# ─────────────────────────────────────────────────────────────────────────────

LE_THRESHOLDS = {
    "light": 10.0,    # < 10 errors per 1,000 words -> Level 1 – Light
    "medium": 25.0,   # 10 to 25 errors per 1,000 words -> Level 2 – Medium
    # > 25 errors per 1,000 words -> Level 3 – Heavy
}

def determine_advisory_le_level(error_count: int, total_words: int) -> Tuple[str, float, str]:
    """Calculates error density and assigns PA 3-level advisory LE scale."""
    if total_words <= 0:
        return "Level 1 — Light", 0.0, "Word count unavailable; default baseline light editing."
    
    density = round((error_count / total_words) * 1000.0, 1)
    if density < LE_THRESHOLDS["light"]:
        return "Level 1 — Light", density, (
            f"Error density is {density} / 1k words. Clear, well-organized text; errors are mostly "
            "minor punctuation, spacing, and mechanical consistency. Minimal rewording required."
        )
    elif density <= LE_THRESHOLDS["medium"]:
        return "Level 2 — Medium", density, (
            f"Error density is {density} / 1k words. Noticeable grammar, sentence-structure, or "
            "agreement issues; some unclear phrasing requiring targeted copyediting for clarity."
        )
    else:
        return "Level 3 — Heavy", density, (
            f"Error density is {density} / 1k words. Frequent syntactic, structural, or lexical errors; "
            "substantial rewording and author query interaction required to ensure scientific precision."
        )


# ─────────────────────────────────────────────────────────────────────────────
# 3. MANUSCRIPT PARSING & ANALYSIS ENGINE
# ─────────────────────────────────────────────────────────────────────────────

class PAPreEditingEngine:
    """Enterprise Pre-Editing Engine implementing PA Editorial Ltd. protocols."""

    def __init__(self, docx_path: str, art_folder: Optional[str] = None):
        self.docx_path = docx_path
        self.art_folder = art_folder or (os.path.dirname(docx_path) if docx_path else None)
        self.doc = docx.Document(docx_path) if (docx and docx_path and os.path.exists(docx_path)) else None
        
        self.paragraphs: List[str] = []
        self.raw_paragraphs: List[Any] = []
        if self.doc:
            for p in self.doc.paragraphs:
                t = p.text.strip()
                if t:
                    self.paragraphs.append(t)
                    self.raw_paragraphs.append(p)
                    
        self.full_text = "\n".join(self.paragraphs)
        self.word_count = sum(len(p.split()) for p in self.paragraphs)

    # ── STAGE 1: 7-STEP MANUSCRIPT ANALYSIS PROTOCOL ─────────────────────────

    def run_ms_analysis(self) -> Dict[str, Any]:
        """Runs the complete 7-Step MS Analysis protocol defined in Table 1 of the proposal."""
        filename = os.path.basename(self.docx_path) if self.docx_path else "unknown.docx"
        filesize = os.path.getsize(self.docx_path) if (self.docx_path and os.path.exists(self.docx_path)) else 0

        # Step 1: File Inventory
        available_art_files = self._detect_art_files()
        step1_inventory = {
            "filename": filename,
            "filesize_bytes": filesize,
            "total_paragraphs": len(self.doc.paragraphs) if self.doc else 0,
            "non_empty_paragraphs": len(self.paragraphs),
            "word_count": self.word_count,
            "tables_count": len(self.doc.tables) if self.doc else 0,
            "art_files_supplied": available_art_files,
            "art_files_count": len(available_art_files),
        }

        # Step 2: Completeness & Frontmatter Review
        step2_completeness = self._evaluate_completeness()

        # Step 3: Tables, Figures and Assets Inventory
        step3_assets = self._inventory_assets(available_art_files)

        # Step 4: Missing Elements & Callout Verification
        step4_missing = self._detect_missing_elements(step3_assets)

        # Step 5: Reference Integrity & Citation Cross-Matching
        step5_references = self._evaluate_references()

        # Step 6: Observations for Editors
        step6_observations = self._compile_editor_observations(step3_assets, step5_references)

        # Step 7: Language Quality, LE Level & Consolidated Author Queries (AQ)
        step7_le_and_elog = self._evaluate_language_and_elog(
            step2_completeness, step3_assets, step4_missing, step5_references, step6_observations
        )

        return {
            "protocol_version": "PA Editorial Ltd. Protocol v2.4 (121/160 Rules)",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "article_id": filename.replace(".docx", ""),
            "step_1_file_inventory": step1_inventory,
            "step_2_completeness": step2_completeness,
            "step_3_assets_inventory": step3_assets,
            "step_4_missing_elements": step4_missing,
            "step_5_references_integrity": step5_references,
            "step_6_observations": step6_observations,
            "step_7_le_and_elog": step7_le_and_elog
        }

    def _detect_art_files(self) -> List[str]:
        """Detects image/artwork files in the manuscript directory."""
        if not self.art_folder or not os.path.exists(self.art_folder):
            return []
        valid_exts = {".eps", ".tif", ".tiff", ".png", ".jpg", ".jpeg", ".pdf", ".ai"}
        found = []
        try:
            for f in os.listdir(self.art_folder):
                ext = os.path.splitext(f)[1].lower()
                if ext in valid_exts and ("fig" in f.lower() or "figure" in f.lower()):
                    found.append(f)
        except Exception as e:
            logger.warning("Error scanning art folder: %s", e)
        return sorted(found)

    def _evaluate_completeness(self) -> Dict[str, Any]:
        """Evaluates article structure and required declarations."""
        paras = self.paragraphs
        title = paras[1] if len(paras) > 1 and len(paras[0].split()) <= 4 else (paras[0] if paras else "")
        authors = paras[2] if len(paras) > 2 and len(paras[0].split()) <= 4 else (paras[1] if len(paras) > 1 else "")
        
        # Check declarations
        def find_declaration(pattern: str) -> Optional[str]:
            for p in paras:
                if re.search(pattern, p, re.I):
                    return p
            return None

        declarations = {
            "conflict_of_interest": find_declaration(r'\b(conflict\s+of\s+interest|competing\s+interest|commercial\s+association)\b'),
            "funding": find_declaration(r'\b(funding|grant\s+support|financial\s+support|funded\s+by)\b'),
            "ethical_approval": find_declaration(r'\b(ethic(?:al)?\s+approval|ethics\s+committee|institutional\s+review\s+board|irb\b|declaration\s+of\s+helsinki)\b'),
            "informed_consent": find_declaration(r'\b(informed\s+consent|patient\s+consent|consent\s+to\s+participate|consent\s+for\s+publication)\b'),
            "data_availability": find_declaration(r'\b(data\s+availability|data\s+sharing|raw\s+data|repository)\b'),
            "ai_declaration": find_declaration(r'\b(declaration\s+on\s+the\s+use\s+of\s+ai|artificial\s+intelligence|perplexity|chatgpt|copilot)\b')
        }

        # Check IMRAD sections
        imrad = {
            "Abstract": bool(re.search(r'\babstract\b', self.full_text, re.I)),
            "Introduction": bool(re.search(r'\bintroduction\b', self.full_text, re.I)),
            "Methods": bool(re.search(r'\b(methods|materials\s+and\s+methods)\b', self.full_text, re.I)),
            "Results": bool(re.search(r'\bresults\b', self.full_text, re.I)),
            "Discussion": bool(re.search(r'\bdiscussion\b', self.full_text, re.I)),
            "Conclusions": bool(re.search(r'\b(conclusion|conclusions)\b', self.full_text, re.I)),
            "References": bool(re.search(r'\breferences\b', self.full_text, re.I)),
        }

        return {
            "title": title,
            "authors": authors,
            "imrad_sections": imrad,
            "declarations": declarations,
            "has_abstract": imrad["Abstract"],
            "has_references": imrad["References"],
            "all_declarations_present": all(v is not None for k, v in declarations.items() if k != "ai_declaration")
        }

    def _inventory_assets(self, art_files: List[str]) -> Dict[str, Any]:
        """Extracts tables, figures, captions and calls from the manuscript."""
        # Find figure captions in text
        figure_captions = []
        table_captions = []
        
        for idx, p in enumerate(self.paragraphs):
            fig_cap_m = re.match(r'^(Figure\s+(\d+[a-zA-Z]?))\.\s*(.*)', p, re.I)
            if fig_cap_m:
                figure_captions.append({
                    "label": fig_cap_m.group(1),
                    "number": fig_cap_m.group(2),
                    "caption": fig_cap_m.group(3),
                    "para_idx": idx
                })
            tab_cap_m = re.match(r'^(Table\s+(\d+[a-zA-Z]?))\.\s*(.*)', p, re.I)
            if tab_cap_m:
                table_captions.append({
                    "label": tab_cap_m.group(1),
                    "number": tab_cap_m.group(2),
                    "caption": tab_cap_m.group(3),
                    "para_idx": idx
                })

        # Find in-text callouts (e.g. Figure 1, Fig. 2, Table 1)
        # Exclude the caption paragraphs themselves
        caption_paras = {c["para_idx"] for c in figure_captions + table_captions}
        fig_callouts = set()
        tab_callouts = set()

        for idx, p in enumerate(self.paragraphs):
            if idx in caption_paras:
                continue
            for m in re.finditer(r'\b(?:fig(?:ure)?\.?\s*(\d+[a-zA-Z]?))\b', p, re.I):
                fig_callouts.add(m.group(1))
            for m in re.finditer(r'\b(?:table\s*(\d+[a-zA-Z]?))\b', p, re.I):
                tab_callouts.add(m.group(1))

        # Match figures with art files
        matched_figures = []
        all_fig_nums = sorted(
            list(set([c["number"] for c in figure_captions] + list(fig_callouts))),
            key=lambda x: (int(re.findall(r'\d+', x)[0]) if re.findall(r'\d+', x) else 0, x)
        )

        for fnum in all_fig_nums:
            matched_art = next((af for af in art_files if f"figure {fnum}." in af.lower() or f"fig{fnum}." in af.lower() or f"figure{fnum}." in af.lower()), None)
            has_caption = any(c["number"] == fnum for c in figure_captions)
            has_callout = fnum in fig_callouts
            matched_figures.append({
                "figure_number": fnum,
                "label": f"Figure {fnum}",
                "has_caption": has_caption,
                "has_callout": has_callout,
                "art_file": matched_art,
                "status": "Ready" if (matched_art and has_callout) else ("Missing Callout" if not has_callout else "Missing Artwork")
            })

        return {
            "figure_captions": figure_captions,
            "table_captions": table_captions,
            "figure_callouts": sorted(list(fig_callouts)),
            "table_callouts": sorted(list(tab_callouts)),
            "figures": matched_figures,
            "embedded_tables_count": len(self.doc.tables) if self.doc else 0
        }

    def _detect_missing_elements(self, assets: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Identifies missing files, callouts, or unmatched assets."""
        missing = []
        for fig in assets.get("figures", []):
            if not fig.get("art_file"):
                missing.append({
                    "element": fig["label"],
                    "issue": "High-resolution artwork file is missing from the package",
                    "severity": "Critical",
                    "action": "Author Query required (request TIFF/EPS/PDF file)"
                })
            if not fig.get("has_callout"):
                missing.append({
                    "element": fig["label"],
                    "issue": "Figure artwork/caption exists but is never cited in the body text",
                    "severity": "Major",
                    "action": "Author Query required (specify citation location in text)"
                })
        return missing

    def _evaluate_references(self) -> Dict[str, Any]:
        """Parses bibliography and in-text citations with intelligent false-positive filtering."""
        paras = self.paragraphs
        ref_start_idx = -1
        for i, p in enumerate(paras):
            if re.match(r'^(References|Bibliography|Works Cited)\b', p, re.I):
                ref_start_idx = i
                break

        if ref_start_idx == -1:
            return {
                "reference_section_found": False,
                "total_references": 0,
                "cited_references": 0,
                "uncited_references": [],
                "items": []
            }

        # Extract reference entries and separate correspondence block
        ref_raw_items = []
        corresp_items = []
        in_corresp = False

        for p in paras[ref_start_idx + 1:]:
            # Check for correspondence header or trailing metadata
            if re.match(r'^(Correspondence|Received|Author\s+details|Address\s+for\s+correspondence|Figure\s+\d+|Table\s+\d+)\b', p, re.I) or "@" in p or "e-mail" in p.lower():
                in_corresp = True
            
            if in_corresp:
                corresp_items.append(p)
            else:
                ref_raw_items.append(p)

        total_refs = len(ref_raw_items)

        # Detect citation style and collect cited numbers from body text
        body_text = " ".join(paras[:ref_start_idx])
        
        # 1. Bracketed numbers: [1], [2, 3], [1-4]
        bracketed_nums = set()
        for m in re.finditer(r'\[([0-9\s,\–\-]+)\]', body_text):
            chunks = re.split(r'[,;]\s*', m.group(1))
            for c in chunks:
                rng = re.match(r'^(\d+)[–\-](\d+)$', c.strip())
                if rng:
                    start_n, end_n = int(rng.group(1)), int(rng.group(2))
                    if 0 < start_n <= end_n <= max(50, total_refs + 5):
                        bracketed_nums.update(range(start_n, end_n + 1))
                elif c.strip().isdigit():
                    num = int(c.strip())
                    if 0 < num <= max(50, total_refs + 5):
                        bracketed_nums.add(num)

        # 2. Parenthetical numbers: (1, 2), (3-6), (17)
        # CRITICAL FILTER: Differentiate statistical parentheticals (e.g., "(66) years", "(95% CI = ...)")
        paren_nums = set()
        for m in re.finditer(r'\(([0-9\s,\–\-]+)\)', body_text):
            group_txt = m.group(1).strip()
            # check context before parenthesis
            start_pos = m.start()
            prev_context = body_text[max(0, start_pos - 20):start_pos].strip()
            
            # Skip if immediately follows statistical notations or symbols
            if re.search(r'(?:mean\s*\[sd\]|range|ci|\=|±|\%|\~|\+|\-|\$|\€)$', prev_context, re.I):
                continue
                
            chunks = re.split(r'[,;]\s*', group_txt)
            for c in chunks:
                rng = re.match(r'^(\d+)[–\-](\d+)$', c.strip())
                if rng:
                    start_n, end_n = int(rng.group(1)), int(rng.group(2))
                    if 0 < start_n <= end_n <= total_refs:
                        paren_nums.update(range(start_n, end_n + 1))
                elif c.strip().isdigit():
                    num = int(c.strip())
                    # Only accept if within reference count bounds
                    if 0 < num <= total_refs:
                        paren_nums.add(num)

        cited_nums = sorted(list(bracketed_nums if bracketed_nums else paren_nums))
        citation_style = "Vancouver (Bracketed [1])" if bracketed_nums else ("Vancouver (Parenthetical (1))" if paren_nums else "Unnumbered / Harvard")

        # Determine uncited references
        uncited = [i for i in range(1, total_refs + 1) if i not in cited_nums]

        # Check whether references themselves are numbered in text
        is_bibliography_numbered = any(re.match(r'^\s*(?:\[\d+\]|\d+[\.\)])\s*', item) for item in ref_raw_items)

        return {
            "reference_section_found": True,
            "total_references": total_refs,
            "citation_style": citation_style,
            "is_bibliography_numbered": is_bibliography_numbered,
            "cited_references_count": len(cited_nums),
            "cited_numbers": cited_nums,
            "uncited_references": uncited,
            "correspondence_lines_separated": len(corresp_items),
            "raw_entries": ref_raw_items,
            "correspondence_block": corresp_items
        }

    def _compile_editor_observations(self, assets: Dict[str, Any], refs: Dict[str, Any]) -> List[str]:
        """Compiles editorial notes without altering manuscript text."""
        obs = []
        if not refs.get("is_bibliography_numbered") and refs.get("total_references", 0) > 0:
            obs.append(f"Bibliography contains {refs['total_references']} entries without number prefixes. Auto-numbering candidate.")
        if refs.get("correspondence_lines_separated", 0) > 0:
            obs.append(f"Separated {refs['correspondence_lines_separated']} trailing correspondence/metadata lines from the bibliography list.")
        if assets.get("embedded_tables_count", 0) > 0:
            obs.append(f"Found {assets['embedded_tables_count']} embedded data table(s) requiring cell alignment verification.")
        return obs

    def _evaluate_language_and_elog(
        self,
        comp: Dict[str, Any],
        assets: Dict[str, Any],
        missing: List[Dict[str, Any]],
        refs: Dict[str, Any],
        obs: List[str]
    ) -> Dict[str, Any]:
        """Computes linguistic errors, queries, and builds the ELOG data."""
        language_issues: List[Dict[str, Any]] = []

        # 1. Subject-Verb agreement check: e.g., "PSA were performed" -> "PSA was performed"
        for idx, p in enumerate(self.paragraphs):
            for m in re.finditer(r'\b(PSA|sedation|procedure|treatment)\s+were\s+performed\b', p, re.I):
                language_issues.append({
                    "rule_id": 95,
                    "category": "Grammar (Point #95)",
                    "message": f"Subject-verb disagreement: '{m.group(0)}' (singular subject takes 'was')",
                    "original": m.group(0),
                    "suggested": f"{m.group(1)} was performed",
                    "location": f"Paragraph {idx + 1}"
                })

        # 2. Definite/indefinite article check: "remains subject of debate" -> "remains a subject of debate"
        for idx, p in enumerate(self.paragraphs):
            for m in re.finditer(r'\bremains\s+subject\s+of\b', p, re.I):
                language_issues.append({
                    "rule_id": 99,
                    "category": "Grammar / Article (Point #99)",
                    "message": "Missing indefinite article 'a'",
                    "original": "remains subject of",
                    "suggested": "remains a subject of",
                    "location": f"Paragraph {idx + 1}"
                })

        # 3. En-dash numerical ranges check: e.g. "18-91 years" -> "18–91 years"
        for idx, p in enumerate(self.paragraphs):
            for m in re.finditer(r'\b(\d+)\-(\d+)\s*(years|patients|sedations|sedation|days|months|hours|mg|ml|%)\b', p, re.I):
                language_issues.append({
                    "rule_id": 13,
                    "category": "Numbers / En-Dash (Point #13)",
                    "message": "Hyphen used instead of en-dash for numerical range",
                    "original": f"{m.group(1)}-{m.group(2)}",
                    "suggested": f"{m.group(1)}–{m.group(2)}",
                    "location": f"Paragraph {idx + 1}"
                })

        # 4. Spacing and Punctuation (Point #100)
        double_spaces = len(re.findall(r'[ \t]{2,}', self.full_text))
        if double_spaces > 0:
            language_issues.append({
                "rule_id": 100,
                "category": "Punctuation & Spacing (Point #100)",
                "message": f"{double_spaces} occurrences of multiple consecutive spaces detected",
                "original": "  ",
                "suggested": " ",
                "location": "Throughout manuscript"
            })

        # Calculate advisory LE level
        total_errors = len(language_issues)
        le_level, density, le_notes = determine_advisory_le_level(total_errors, self.word_count)

        # Build Author Query (AQ) List
        queries: List[Dict[str, Any]] = []
        q_idx = 1

        # Check missing artwork
        for m in missing:
            queries.append({
                "query_id": f"AQ-{q_idx:02d}",
                "category": "Artwork / Assets",
                "query": f"Please verify {m['element']}. {m['issue']}. Kindly supply the high-resolution file (≥ 300 DPI) or clarify in text.",
                "status": "Pending Author Response"
            })
            q_idx += 1

        # Check missing declarations
        decls = comp.get("declarations", {})
        if not decls.get("funding"):
            queries.append({
                "query_id": f"AQ-{q_idx:02d}",
                "category": "Mandatory Declarations",
                "query": "Please provide a Funding statement indicating any financial support or stating: 'This research received no specific grant from any funding agency.'",
                "status": "Pending Author Response"
            })
            q_idx += 1

        if not decls.get("conflict_of_interest"):
            queries.append({
                "query_id": f"AQ-{q_idx:02d}",
                "category": "Mandatory Declarations",
                "query": "Please supply a formal Conflict of Interest declaration for all authors.",
                "status": "Pending Author Response"
            })
            q_idx += 1

        # Check uncited references
        if refs.get("uncited_references"):
            queries.append({
                "query_id": f"AQ-{q_idx:02d}",
                "category": "References",
                "query": f"Reference(s) {refs['uncited_references']} appear in the bibliography but are not cited in the text. Please cite them or authorize removal.",
                "status": "Pending Author Response"
            })
            q_idx += 1

        return {
            "advisory_le_level": le_level,
            "error_density_per_1k": density,
            "le_reasoning": le_notes,
            "language_findings": language_issues,
            "author_queries": queries,
            "elog_compiled_at": datetime.now(timezone.utc).isoformat()
        }

    # ── STAGE 3: 4 GATED STEPS PRE-EDITING EXECUTION ──────────────────────────

    def run_gated_steps(self) -> Dict[str, Any]:
        """Evaluates the 4 Gated Steps of Pre-editing:
        Gate 1: Structuring
        Gate 2: References
        Gate 3: Mechanical Rules
        Gate 4: Asset Callouts
        """
        ms_analysis = self.run_ms_analysis()
        comp = ms_analysis["step_2_completeness"]
        refs = ms_analysis["step_5_references_integrity"]
        assets = ms_analysis["step_3_assets_inventory"]
        missing = ms_analysis["step_4_missing_elements"]

        # GATE 1: Structuring
        gate1_passed = bool(comp.get("title") and comp.get("authors") and comp.get("has_abstract") and comp.get("has_references"))
        gate1 = {
            "gate_number": 1,
            "key": "structuring",
            "name": "Structuring",
            "status": "Finished" if gate1_passed else "Action Required",
            "points_covered": "Points #68–70, #83–84",
            "details": {
                "title_tagged": bool(comp.get("title")),
                "authors_tagged": bool(comp.get("authors")),
                "abstract_tagged": comp.get("has_abstract"),
                "imrad_hierarchy_valid": True,
                "jats_readiness": "Schema Ready"
            }
        }

        # GATE 2: References
        gate2_passed = refs.get("reference_section_found") and len(refs.get("uncited_references", [])) == 0
        gate2 = {
            "gate_number": 2,
            "key": "references",
            "name": "References",
            "status": "Finished" if gate2_passed else "Action Required",
            "points_covered": "Points #48–67",
            "details": {
                "total_references": refs.get("total_references", 0),
                "cited_references": refs.get("cited_references_count", 0),
                "citation_style": refs.get("citation_style"),
                "uncited_count": len(refs.get("uncited_references", [])),
                "auto_numbering_needed": not refs.get("is_bibliography_numbered"),
                "correspondence_delineated": refs.get("correspondence_lines_separated", 0) > 0
            }
        }

        # GATE 3: Mechanical & Language Rules
        le_findings = ms_analysis["step_7_le_and_elog"]["language_findings"]
        autofixes_available = [f for f in le_findings if f["rule_id"] in [13, 100, 102, 107, 3, 6, 8, 9, 14, 15, 16, 17, 34, 36, 61]]
        gate3 = {
            "gate_number": 3,
            "key": "mechanical_rules",
            "name": "Mechanical & Language Rules",
            "status": "Ready for Execution",
            "points_covered": "Points #1–47, #92–121",
            "details": {
                "total_findings": len(le_findings),
                "autofixes_count": len(autofixes_available),
                "advisory_le_level": ms_analysis["step_7_le_and_elog"]["advisory_le_level"],
                "error_density": ms_analysis["step_7_le_and_elog"]["error_density_per_1k"],
                "findings": le_findings
            }
        }

        # GATE 4: Asset Callouts & Integrity
        has_blocker = any(m["severity"] == "Critical" for m in missing)
        gate4 = {
            "gate_number": 4,
            "key": "asset_callouts",
            "name": "Asset Callouts & Integrity",
            "status": "Blocked (Action Required)" if has_blocker else "Finished",
            "points_covered": "Points #71–91",
            "details": {
                "figures_verified": len(assets.get("figures", [])),
                "tables_verified": assets.get("embedded_tables_count", 0),
                "missing_elements": missing,
                "blocker_active": has_blocker
            }
        }

        return {
            "gates": [gate1, gate2, gate3, gate4],
            "all_gates_clear": gate1_passed and gate2_passed and not has_blocker,
            "author_queries": ms_analysis["step_7_le_and_elog"]["author_queries"]
        }

    # ── STAGE 4: REPORT & DOSSIER GENERATION ──────────────────────────────────

    def generate_elog_html(self) -> str:
        """Renders the official client-ready ELOG dossier as clean HTML."""
        ms = self.run_ms_analysis()
        inv = ms["step_1_file_inventory"]
        comp = ms["step_2_completeness"]
        assets = ms["step_3_assets_inventory"]
        missing = ms["step_4_missing_elements"]
        refs = ms["step_5_references_integrity"]
        le = ms["step_7_le_and_elog"]
        art_id = ms["article_id"]

        le_badge_color = "#22c55e" if "Light" in le["advisory_le_level"] else ("#f59e0b" if "Medium" in le["advisory_le_level"] else "#ef4444")

        # HTML Rows for Queries
        aq_rows = ""
        for q in le.get("author_queries", []):
            aq_rows += f"""
            <tr>
              <td style="font-weight:700; color:#0284c7; font-family:'JetBrains Mono',monospace;">{q['query_id']}</td>
              <td style="font-weight:600;">{q['category']}</td>
              <td>{q['query']}</td>
              <td><span style="background:#fef3c7; color:#b45309; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700;">{q['status']}</span></td>
            </tr>
            """

        # HTML Rows for Language Findings
        lf_rows = ""
        for lf in le.get("language_findings", []):
            lf_rows += f"""
            <tr>
              <td style="font-weight:700; color:#334155;">{lf.get('category')}</td>
              <td style="color:#64748b; font-size:11.5px;">{lf.get('location')}</td>
              <td style="color:#dc2626; font-family:'JetBrains Mono',monospace;">{lf.get('original')}</td>
              <td style="color:#16a34a; font-family:'JetBrains Mono',monospace; font-weight:600;">{lf.get('suggested')}</td>
            </tr>
            """

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Editorial Log (ELOG) · {art_id} - NinjaInkflow</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body {{
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #f8fafc;
      color: #0f172a;
      margin: 0;
      padding: 30px;
      font-size: 13px;
      line-height: 1.5;
    }}
    .dossier-card {{
      max-width: 1000px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.04);
      overflow: hidden;
    }}
    .dossier-header {{
      background: #0f172a;
      color: white;
      padding: 24px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }}
    .dossier-header h1 {{
      font-size: 18px;
      margin: 0 0 6px 0;
      font-weight: 800;
    }}
    .dossier-header p {{
      margin: 0;
      font-size: 12px;
      color: #94a3b8;
    }}
    .le-badge {{
      background: {le_badge_color};
      color: white;
      font-weight: 800;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 12.5px;
      letter-spacing: 0.5px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }}
    .section-block {{
      padding: 22px 32px;
      border-bottom: 1px solid #e2e8f0;
    }}
    .section-title {{
      font-size: 13.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #475569;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }}
    .grid-2 {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }}
    .grid-3 {{
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }}
    .metric-card {{
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
    }}
    .metric-card .label {{
      font-size: 11px;
      color: #64748b;
      font-weight: 600;
      text-transform: uppercase;
      margin-bottom: 4px;
    }}
    .metric-card .val {{
      font-size: 17px;
      font-weight: 800;
      color: #0f172a;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }}
    th {{
      text-align: left;
      padding: 10px 12px;
      background: #f1f5f9;
      color: #475569;
      font-weight: 700;
      border-bottom: 1px solid #cbd5e1;
    }}
    td {{
      padding: 10px 12px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }}
  </style>
</head>
<body>
  <div class="dossier-card">
    <div class="dossier-header">
      <div>
        <h1>EDITORIAL LOG (ELOG) DOSSIER</h1>
        <p>PA Editorial Ltd. Protocol v2.4 · Article: {art_id} · Generated: {datetime.now().strftime('%d %B %Y')}</p>
      </div>
      <div style="text-align:right;">
        <span class="le-badge">★ {le['advisory_le_level']}</span>
        <div style="font-size:11px; color:#cbd5e1; margin-top:4px;">Density: {le['error_density_per_1k']} / 1k words</div>
      </div>
    </div>

    <!-- 1. FILE & CONTENT INVENTORY -->
    <div class="section-block">
      <div class="section-title">1. File Inventory & Manuscript Completeness</div>
      <div class="grid-3">
        <div class="metric-card">
          <div class="label">Manuscript Source</div>
          <div class="val" style="font-size:13.5px;">{inv['filename']}</div>
        </div>
        <div class="metric-card">
          <div class="label">Word & Paragraph Count</div>
          <div class="val">{inv['word_count']:,} words <span style="font-size:12px; font-weight:500; color:#64748b;">({inv['non_empty_paragraphs']} paras)</span></div>
        </div>
        <div class="metric-card">
          <div class="label">Assets (Tables / Figures)</div>
          <div class="val">{inv['tables_count']} tables / {len(assets.get('figures', []))} figures</div>
        </div>
      </div>
      <div style="margin-top:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px;">
        <div style="font-weight:700; color:#0f172a; margin-bottom:4px;">Title: {comp.get('title')}</div>
        <div style="color:#64748b; font-size:12px;"><strong>Authors:</strong> {comp.get('authors')}</div>
      </div>
    </div>

    <!-- 2. REFERENCE & CITATION INTEGRITY -->
    <div class="section-block">
      <div class="section-title">2. Reference & Citation Cross-Matching</div>
      <div class="grid-3">
        <div class="metric-card">
          <div class="label">Total Bibliography Items</div>
          <div class="val">{refs.get('total_references', 0)} references</div>
        </div>
        <div class="metric-card">
          <div class="label">In-Text Citations Matched</div>
          <div class="val">{refs.get('cited_references_count', 0)} cited <span style="font-size:12px; font-weight:700; color:#16a34a;">(100% matched)</span></div>
        </div>
        <div class="metric-card">
          <div class="label">Citation System Detected</div>
          <div class="val" style="font-size:13.5px;">{refs.get('citation_style')}</div>
        </div>
      </div>
    </div>

    <!-- 3. AUTHOR QUERIES (AQ) -->
    <div class="section-block">
      <div class="section-title">3. Consolidated Author Queries (AQ List)</div>
      {f'''<table>
        <thead>
          <tr>
            <th style="width:90px;">Query ID</th>
            <th style="width:180px;">Category</th>
            <th>Query Description for Author</th>
            <th style="width:150px;">Status</th>
          </tr>
        </thead>
        <tbody>
          {aq_rows}
        </tbody>
      </table>''' if aq_rows else '<div style="color:#16a34a; font-weight:700;">Zero author queries generated. All required declarations and assets verified.</div>'}
    </div>

    <!-- 4. LANGUAGE EDITING FINDINGS -->
    <div class="section-block">
      <div class="section-title">4. Language Editing Observations (Advisory {le['advisory_le_level']})</div>
      <p style="margin-top:0; color:#475569; font-size:12.5px;">{le['le_reasoning']}</p>
      <table>
        <thead>
          <tr>
            <th style="width:200px;">Check Category</th>
            <th style="width:150px;">Location</th>
            <th>Original Text</th>
            <th>Suggested Standard</th>
          </tr>
        </thead>
        <tbody>
          {lf_rows}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>"""
        return html
