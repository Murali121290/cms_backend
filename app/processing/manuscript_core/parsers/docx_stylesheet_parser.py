"""
Editorial Style Sheet (.docx) Automated Parser & Rules Mapping Engine.

Extracts project metadata (Table 0), style specification rows (Table 1),
and project word lists (Table 2) from publisher editorial style sheets
(e.g., LWW / Wolters Kluwer, Springer, Elsevier, Wiley).

Maps parsed specifications directly to:
1. Base House Style Presets (AMA 11e, APA 7e, Chicago 17th, Oxford UK, Nature).
2. The 72 CE Checklist Rules with specific option numbers (1-6).
3. IA (Information Architecture) Template Rows.
4. Custom Project Word List / Spelling Whitelist.
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
from typing import Any, BinaryIO, Dict, List, Optional, Tuple, Union

import docx

logger = logging.getLogger(__name__)

# Default catalog path
DEFAULT_CATALOG_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "rules",
        "ce_rules_catalog.json",
    )
)


class DocxStylesheetParser:
    """Parses editorial style sheets in Microsoft Word (.docx) format."""

    def __init__(self, catalog_path: Optional[str] = None):
        self.catalog_path = catalog_path or DEFAULT_CATALOG_PATH
        self.catalog_rules: Dict[int, Dict[str, Any]] = {}
        self._load_catalog()

    def _load_catalog(self) -> None:
        if os.path.exists(self.catalog_path):
            try:
                with open(self.catalog_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for rule in data.get("rules", []):
                        self.catalog_rules[rule["sno"]] = rule
            except Exception as e:
                logger.warning(f"Could not load CE catalog from {self.catalog_path}: {e}")

    def parse(self, file_source: Union[str, bytes, BinaryIO]) -> Dict[str, Any]:
        """
        Parses a .docx style sheet and returns structured findings.

        Args:
            file_source: File path, bytes, or file-like object.

        Returns:
            Dictionary containing:
                - metadata: dict of extracted Table 0 fields
                - suggested_name: generated stylesheet title
                - suggested_description: summary description
                - detected_preset_id: 'ama' | 'apa' | 'chicago' | 'oxford' | 'nature'
                - matched_ce_rules: dict of rule_sno -> rule config & explanation
                - matched_ia_rows: list of matched IA elements
                - word_list: list of extracted custom terms
                - total_specs_scanned: number of Table 1 rows processed
                - matched_rules_count: number of CE rules resolved
        """
        if isinstance(file_source, bytes):
            doc = docx.Document(io.BytesIO(file_source))
        elif hasattr(file_source, "read"):
            doc = docx.Document(file_source)
        else:
            doc = docx.Document(file_source)

        metadata = self._extract_metadata(doc)
        specs = self._extract_specifications(doc)
        word_list = self._extract_word_list(doc)

        preset_id = self._detect_preset(metadata, specs, doc)
        matched_ce_rules = self._match_ce_rules(specs, preset_id)
        matched_ia_rows = self._match_ia_rows(specs, preset_id)

        if preset_id == "springer":
            from app.processing.manuscript_core.rules.presets.springer import (
                SPRINGER_CE_RULES,
                SPRINGER_SELECTED_IA_ROWS,
                SPRINGER_WORD_LIST,
            )
            for sno, cfg in SPRINGER_CE_RULES.items():
                sno_str = str(sno)
                if sno_str not in matched_ce_rules:
                    rule_info = self.catalog_rules.get(sno, {})
                    matched_ce_rules[sno_str] = {
                        "sno": sno,
                        "rule_name": rule_info.get("name", f"Rule {sno}"),
                        "option": cfg["option"],
                        "enabled": cfg["enabled"],
                        "severity": cfg.get("severity", rule_info.get("severity", "Major")),
                        "confidence": 1.0,
                        "source_label": "Springer House Style Preset",
                        "source_value": "Springer Publishing House Style Sheet (July 2026)",
                        "explanation": f"Default Springer House Style specification (Option {cfg['option']})",
                        "notes": f"Default Springer House Style specification (Option {cfg['option']})",
                    }
            existing_ia = {(r.get("element"), r.get("pattern")) for r in matched_ia_rows}
            for spr_ia in SPRINGER_SELECTED_IA_ROWS:
                if (spr_ia["element"], spr_ia["pattern"]) not in existing_ia:
                    matched_ia_rows.append(spr_ia)
            seen_words = set(word_list)
            for w in SPRINGER_WORD_LIST:
                if w not in seen_words:
                    seen_words.add(w)
                    word_list.append(w)

        # Generate suggested name & description
        book_title = metadata.get("Book Title") or metadata.get("Project") or "Editorial Stylesheet"
        edition = metadata.get("Edition", "")
        preset_labels = {
            "ama": "AMA 11th Edition",
            "apa": "APA 7th Edition",
            "chicago": "Chicago (CMOS 17th)",
            "oxford": "Oxford / Cambridge (UK)",
            "nature": "Nature",
            "springer": "Springer Publishing House Style (July 2026)",
        }
        preset_label = preset_labels.get(preset_id, "Standard Style")

        if edition:
            suggested_name = f"{book_title} ({edition}) — {preset_label}"
        else:
            suggested_name = f"{book_title} — {preset_label}"

        desc_parts = []
        if metadata.get("Customer"):
            desc_parts.append(f"Customer: {metadata['Customer']}")
        if metadata.get("Author(s)"):
            desc_parts.append(f"Author: {metadata['Author(s)']}")
        if metadata.get("Book category"):
            desc_parts.append(f"Category: {metadata['Book category']}")
        if metadata.get("CE Sample Chapter"):
            desc_parts.append(f"Sample: {metadata['CE Sample Chapter']}")

        suggested_description = " | ".join(desc_parts)

        return {
            "metadata": metadata,
            "suggested_name": suggested_name,
            "suggested_description": suggested_description,
            "detected_preset_id": preset_id,
            "matched_ce_rules": matched_ce_rules,
            "matched_ia_rows": matched_ia_rows,
            "word_list": word_list,
            "total_specs_scanned": len(specs),
            "matched_rules_count": len(matched_ce_rules),
        }

    def _extract_metadata(self, doc: docx.Document) -> Dict[str, str]:
        """Extracts key/value pairs from Table 0 (Project Metadata)."""
        meta: Dict[str, str] = {}
        if not doc.tables:
            return meta

        table0 = doc.tables[0]
        for row in table0.rows:
            cells = [c.text.strip().replace("\u00a0", " ") for c in row.cells]
            if len(cells) >= 2 and cells[0]:
                key = cells[0].replace(":", "").strip()
                val = cells[1].strip()
                if key and val:
                    meta[key] = val

        # Check top paragraphs for Date or Project if missing in Table 0
        for para in doc.paragraphs[:10]:
            text = para.text.strip().replace("\u00a0", " ")
            if text.startswith("Project:"):
                meta.setdefault("Project", text.split(":", 1)[1].strip())
            elif text.startswith("Date:"):
                meta.setdefault("Date", text.split(":", 1)[1].strip())

        return meta

    def _extract_specifications(self, doc: docx.Document) -> Dict[str, str]:
        """Extracts specification rows from Table 1, deduplicating merged cells."""
        specs: Dict[str, str] = {}
        if len(doc.tables) < 2:
            return specs

        table1 = doc.tables[1]
        for row in table1.rows:
            cells = [c.text.strip().replace("\n", " ").replace("\u00a0", " ") for c in row.cells]
            # Deduplicate consecutive cells caused by horizontal merging
            unique: List[str] = []
            for c in cells:
                if not unique or c != unique[-1]:
                    unique.append(c)
            if unique and unique[0]:
                label = unique[0].strip()
                val = " | ".join(unique[1:]).strip() if len(unique) > 1 else ""
                if val:
                    specs[label] = val

        return specs

    def _extract_word_list(self, doc: docx.Document) -> List[str]:
        """Extracts unique terms from Table 2 (Word List / Spelling Whitelist)."""
        words: List[str] = []
        seen = set()

        if len(doc.tables) >= 3:
            table2 = doc.tables[2]
            for row in table2.rows:
                for cell in row.cells:
                    for line in cell.text.splitlines():
                        line = line.strip().replace("\u00a0", " ")
                        # Exclude empty lines and single alphabetical headers ('A', 'B', 'C'...)
                        if line and len(line) > 1 and not (len(line) == 1 and line.isupper()):
                            clean = line.strip("•- \t")
                            if clean and clean not in seen:
                                seen.add(clean)
                                words.append(clean)

        return words

    def _detect_preset(self, meta: Dict[str, str], specs: Dict[str, str], doc: Optional[docx.Document] = None) -> str:
        """Detects the base house style preset based on metadata and manual references."""
        text_snippets = [
            meta.get("Manual/Previous edition to be followed", ""),
            meta.get("Customer", ""),
            meta.get("Project", ""),
            meta.get("Book Title", ""),
            specs.get("Reference books, dictionaries followed, websites (CMS/AMA)", ""),
            specs.get("Reference books, dictionaries followed, websites", ""),
            specs.get("Level of editing", ""),
        ]
        if doc:
            for p in doc.paragraphs[:15]:
                text_snippets.append(p.text)
            for k in list(specs.keys())[:25]:
                text_snippets.append(k)

        combined = " ".join(text_snippets)

        if re.search(r"\b(?:Springer|Springer\s+Publishing|Demos\s+Medical)\b", combined, re.IGNORECASE):
            return "springer"
        if re.search(r"\bAMA\b", combined, re.IGNORECASE):
            return "ama"
        if re.search(r"\bAPA\b", combined, re.IGNORECASE):
            return "apa"
        if re.search(r"\b(?:Oxford|Cambridge|UK)\b", combined, re.IGNORECASE):
            return "oxford"
        if re.search(r"\bNature\b", combined, re.IGNORECASE):
            return "nature"
        if re.search(r"\b(?:Chicago|CMOS)\b", combined, re.IGNORECASE):
            return "chicago"

        return "chicago"

    def _match_ce_rules(self, specs: Dict[str, str], preset_id: str) -> Dict[str, Dict[str, Any]]:
        """Matches extracted specifications from Table 1 to the 72 CE Checklist Rules."""
        matched: Dict[str, Dict[str, Any]] = {}

        def record(sno: int, option: int, confidence: float, source_label: str, source_val: str, notes: str):
            rule_info = self.catalog_rules.get(sno, {})
            rule_name = rule_info.get("name", f"Rule {sno}")
            matched[str(sno)] = {
                "sno": sno,
                "rule_name": rule_name,
                "option": option,
                "enabled": True,
                "severity": rule_info.get("severity", "Major"),
                "confidence": confidence,
                "source_label": source_label,
                "source_value": source_val,
                "explanation": notes,
                "notes": notes,
            }

        for lbl, val in specs.items():
            lbl_lower = lbl.lower()
            val_lower = val.lower()

            # Rule 4: Unit Abbreviation Consistency
            if lbl_lower in ("hour", "minute", "second", "day", "week", "month", "year") or "time units" in lbl_lower or lbl_lower == "specific preferences in tables":
                if val in ("h", "min", "s", "d", "wk", "mo", "y") or "min" in val_lower or "wk" in val_lower:
                    record(4, 1, 0.95, lbl, val, f"Matched standard unit abbreviation (opt 1) from '{val}'")

            # Rule 5: Temperature Formatting
            if any(k in lbl_lower for k in ["temperature", "style for c", "c and ratio"]):
                if "dual" in val_lower or (("°f" in val_lower or "fahrenheit" in val_lower) and ("°c" in val_lower or "celsius" in val_lower or "c and" in lbl_lower)):
                    opt = 5  # Dual °C and °F
                elif "spaced" in val_lower or "5 °c" in val_lower:
                    opt = 1  # Spaced (standard scientific)
                elif "closed" in val_lower or "closed-up" in val_lower or "38.3°c" in val_lower or "5°c" in val_lower:
                    opt = 2  # Closed AMA style
                elif "deg c" in val_lower:
                    opt = 3  # Abbreviated without symbol
                elif "degrees celsius" in val_lower or "spelled" in val_lower:
                    opt = 4  # Spelled out
                else:
                    opt = 2 if preset_id in ("ama", "springer") else 1
                record(5, opt, 0.95, lbl, val, f"Matched temperature format (opt {opt}) from '{val}'")

            # Rule 6: Percentage Formatting
            elif "percent" in lbl_lower:
                if "%" in val:
                    if re.search(r"\s+%", val) or "spaced" in val_lower:
                        opt = 2  # Spaced symbol
                    else:
                        opt = 1  # Closed symbol 10%
                elif "per cent" in val_lower:
                    opt = 4  # UK two words
                elif "percent" in val_lower:
                    opt = 3  # US single word
                elif "percentage points" in val_lower or "delta" in val_lower:
                    opt = 5
                else:
                    opt = 1
                record(6, opt, 0.95, lbl, val, f"Matched percentage format (opt {opt}) from '{val}'")

            # Rule 8: Greek Letter Consistency
            elif "greek" in lbl_lower:
                if "spell" in val_lower and ("spell out greek" in val_lower or preset_id == "apa"):
                    record(8, 2, 0.95, lbl, val, f"Matched Greek spelled-out rule (opt 2) from '{val}'")
                elif "symbol" in val_lower or "unicode" in val_lower or "roman" in val_lower or "α" in val or "upright" in val_lower:
                    record(8, 1, 0.95, lbl, val, f"Matched Unicode Greek symbol standard (opt 1) from '{val}'")

            # Rule 9: Micro Prefix Standardisation
            elif any(k in lbl_lower for k in ["microgram", "microliter", "micron", "micrometer"]):
                if any(k in val_lower for k in ["mcg", "mcl", "mcm"]):
                    opt = 2  # Spelled e.g. mcg, mcl
                else:
                    opt = 1  # Symbol e.g. μg, μL
                record(9, opt, 0.95, lbl, val, f"Matched micro symbol convention (opt {opt}) from '{val}'")

            # Rule 11: Number Formatting / Thousand separator
            elif "thousand separator" in lbl_lower or "comma in number" in lbl_lower:
                opt = 1 if ("1,000" in val or "comma" in val_lower or "use" in val_lower) else 2
                record(11, opt, 0.90, lbl, val, f"Matched thousand separator rule from '{val}'")

            # Rule 13: Number Style (Spelled vs Numerals)
            elif "number usage" in lbl_lower or "0-9" in lbl_lower or "0–9" in lbl_lower or "ordinal" in lbl_lower:
                if "spell out" in val_lower or "0 to 9" in val_lower or "one to nine" in val_lower or "first to ninth" in val_lower:
                    opt = 1  # 0 to 9 spelled
                elif "all measurements" in val_lower or "always numerals" in val_lower:
                    opt = 2
                else:
                    opt = 1
                record(13, opt, 0.95, lbl, val, f"Matched numeral style (opt {opt}) from '{val}'")

            # Rule 14: Number Range Formatting
            elif "range" in lbl_lower:
                if "use “to”" in val_lower or 'use "to"' in val_lower or "use to in text" in val_lower or "word to" in val_lower:
                    opt = 2  # Spelled "to"
                elif "endash" in val_lower or "en-dash" in val_lower or "en dash" in val_lower:
                    opt = 1  # En dash closed
                elif "spaced" in val_lower and ("dash" in val_lower or "en" in val_lower):
                    opt = 4  # Spaced en dash
                elif "hyphen" in val_lower:
                    opt = 5  # Hyphen
                else:
                    opt = 1 if preset_id == "ama" else 2
                record(14, opt, 0.95, lbl, val, f"Matched range formatting (opt {opt}) from '{val}'")

            # Rule 16: Fractions and Ratios
            elif "fraction" in lbl_lower:
                if "spell" in val_lower or "spelled" in val_lower:
                    opt = 2  # Spell out common fractions (one-half)
                else:
                    opt = 1  # Use style's form (1/2 or ½; 3:1)
                record(16, opt, 0.95, lbl, val, f"Matched fractions rule (opt {opt}) from '{val}'")

            # Rule 17: Date Format Standardisation
            elif "date" in lbl_lower and ("format" in lbl_lower or "sample" in lbl_lower or "year" in lbl_lower or "time" in lbl_lower):
                if any(m in val_lower for m in ["january 1", "october 10", "month dd", "june 5"]):
                    opt = 2  # US Month DD, YYYY
                elif any(m in val_lower for m in ["1 january", "10 october", "dd month"]):
                    opt = 1  # UK DD Month YYYY
                else:
                    opt = 2 if preset_id in ("ama", "apa", "chicago") else 1
                record(17, opt, 0.85, lbl, val, f"Matched date style from '{val}'")

            # Rule 19: Time Format Standardisation
            elif any(k in lbl_lower for k in ["time", "hours", "am/pm"]) and any(k in val_lower for k in ["am", "pm", "clock"]):
                if "a.m." in val_lower or "p.m." in val_lower:
                    opt = 1  # 12-hour dotted lowercase (3:30 p.m.)
                elif "small caps" in val_lower or "uppercase" in val_lower or "pm" in val:
                    opt = 4  # 12-hour uppercase / small caps (3:30 PM)
                elif "24" in val_lower or "military" in val_lower:
                    opt = 2  # 24-hour military (15:30)
                else:
                    opt = 3  # 12-hour undotted lowercase (3:30 pm)
                record(19, opt, 0.90, lbl, val, f"Matched time notation (opt {opt}) from '{val}'")

            # Rule 21: Currency Formatting
            elif "currency" in lbl_lower:
                opt = 1  # Symbol before amount, no space ($5 million)
                record(21, opt, 0.90, lbl, val, f"Matched currency formatting (opt 1) from '{val}'")

            # Rule 25: Statistical Notation Formatting
            elif any(k in lbl_lower for k in ["statistical", "p value", "p-value", "probability", "p/p"]):
                if "uppercase “p”" in val_lower or "uppercase" in val_lower:
                    opt = 1  # Uppercase P
                elif "lowercase “p”" in val_lower or "lowercase" in val_lower:
                    opt = 2  # Lowercase p
                elif "italic" in val_lower:
                    opt = 1  # Italic
                else:
                    opt = 2  # Roman
                record(25, opt, 0.95, lbl, val, f"Matched statistical notation (opt {opt}) from '{val}'")

            # Rule 30: Degree Symbol Formatting
            elif "angle" in lbl_lower or "degree" in lbl_lower:
                if "90-degree" in val_lower or "spelled" in val_lower:
                    opt = 2  # Spelled hyphenated
                else:
                    opt = 1  # Symbol 45° angle
                record(30, opt, 0.90, lbl, val, f"Matched degree symbol format from '{val}'")

            # Rule 34: Acronym Capitalisation / Honorifics
            elif any(k in lbl_lower for k in ["dr., phd", "dr, phd", "gas abbreviations", "acronym"]):
                opt = 1  # Capitalise acronyms (WHO, MRI, Dr, PhD)
                record(34, opt, 0.90, lbl, val, f"Matched acronym / honorific rule (opt 1) from '{val}'")

            # Rule 35: Latin Abbreviations Formatting
            elif "e.g. and i.e." in lbl_lower or "latin abbreviations" in lbl_lower:
                if "eg," in val_lower or ("eg" in val_lower and "." not in val):
                    opt = 2  # eg and ie undotted
                elif "spell out" in val_lower and preset_id != "ama":
                    opt = 3
                else:
                    opt = 1  # e.g., and i.e. dotted
                record(35, opt, 0.95, lbl, val, f"Matched Latin abbreviation style (opt {opt}) from '{val}'")

            # Rule 36: Scientific Name Formatting (Genus & species)
            elif "genus" in lbl_lower or "species" in lbl_lower:
                if "not full point" in val_lower or "e coli" in val_lower or preset_id in ("ama", "springer"):
                    opt = 1  # Italics without full point after initial e.g., E coli
                else:
                    opt = 2  # Italics with full point e.g., E. coli
                record(36, opt, 0.95, lbl, val, f"Matched scientific name format (opt {opt}) from '{val}'")

            # Rule 37: Gene and Protein Symbol Formatting
            elif "gene" in lbl_lower or "protein" in lbl_lower:
                if "italic" in val_lower:
                    opt = 1  # Gene italic, protein roman
                    record(37, opt, 0.95, lbl, val, f"Matched gene/protein symbol format (opt {opt}) from '{val}'")

            # Rule 39: Medical Eponyms / Drug Names
            elif "eponym" in lbl_lower or "drug" in lbl_lower:
                if "stedman" in val_lower or "no ’s" in val_lower or "no 's" in val_lower or "nonpossessive" in val_lower:
                    opt = 1  # Nonpossessive eponyms (e.g. Alzheimer disease)
                    record(39, opt, 0.95, lbl, val, f"Matched medical eponyms nonpossessive format (opt {opt}) from '{val}'")

            # Rule 40: Medical Terminology (-al endings)
            elif "(-al)" in lbl_lower or "-al" in lbl_lower or "physiologic" in val_lower or "medical terminology" in lbl_lower:
                opt = 2  # Use preferred term from publisher's terminology reference (e.g. physiologic, histologic)
                record(40, opt, 0.95, lbl, val, f"Matched medical terminology preferred form (opt {opt}) from '{val}'")

            # Rule 42: Ellipsis Formatting
            elif "ellipsis" in lbl_lower or "dots" in lbl_lower:
                if "spaced" in val_lower or ". . ." in val:
                    opt = 3  # Three spaced dots
                elif "unicode" in val_lower or "…" in val:
                    opt = 2  # Unicode ellipsis
                else:
                    opt = 1  # Closed ASCII dots
                record(42, opt, 0.90, lbl, val, f"Matched ellipsis convention (opt {opt}) from '{val}'")

            # Rule 43: Trademark and Registered Symbols
            elif any(k in lbl_lower for k in ["trademark, copyright", "registered symbol", "trademark"]):
                if "delete" in val_lower or "omit" in val_lower:
                    opt = 1  # Delete
                elif "first mention" in val_lower:
                    opt = 2  # Retain on first mention
                else:
                    opt = 3  # Retain throughout
                record(43, opt, 0.95, lbl, val, f"Matched trademark symbol treatment (opt {opt}) from '{val}'")

            # Rule 44: Copyright Symbols
            elif "copyright" in lbl_lower:
                if "delete" in val_lower or "omit" in val_lower:
                    record(44, 1, 0.95, lbl, val, f"Matched copyright symbol removal (opt 1) from '{val}'")

            # Rule 70: Heading Capitalisation
            elif any(k in lbl_lower for k in ["preposition casing in head", "casing in head", "head1", "head 1", "heading capitalization", "heading capitalisation"]):
                if "sentence" in val_lower:
                    opt = 1  # Sentence case
                elif "title case" in val_lower or "uppercase for words of 4" in val_lower:
                    opt = 2  # Title case
                elif "all caps" in val_lower:
                    opt = 1  # Default heading level
                else:
                    opt = 2  # Title case default for headings
                record(70, opt, 0.95, lbl, val, f"Matched heading case (opt {opt}) from '{val}'")

            # Rule 75: Table Caption Consistency
            elif "table title" in lbl_lower or "table caption" in lbl_lower:
                record(75, 1, 0.95, lbl, val, f"Matched table caption format (opt 1) from '{val}'")

            # Rule 76: Figure Caption Consistency
            elif "figure caption" in lbl_lower or "abbreviation in figure" in lbl_lower:
                record(76, 1, 0.95, lbl, val, f"Matched figure caption format (opt 1) from '{val}'")

            # Rule 78: Table Footnotes
            elif any(k in lbl_lower for k in ["table footnote", "footnote designator"]):
                opt = 1 if ("a, b" in val_lower or "letter" in val_lower or "alphabet" in val_lower) else 2
                record(78, opt, 0.95, lbl, val, f"Matched table footnote designator sequence (opt {opt}) from '{val}'")

            # Rule 81: Table Abbreviation Definitions
            elif any(k in lbl_lower for k in ["tables and figures", "abbreviation in figure", "abbreviation style"]) or ("table footnote" in lbl_lower and "abbreviation" in val_lower):
                if "footnotes in tables" in val_lower or "alpha order" in val_lower:
                    record(81, 1, 0.95, lbl, val, f"Matched table abbreviation definitions in footnote (opt 1) from '{val}'")

        return matched

    def _match_ia_rows(self, specs: Dict[str, str], preset_id: str) -> List[Dict[str, Any]]:
        """Matches specifications from Table 1 to exact IA Template Rows."""
        from app.data.ia_template_rows import IA_TEMPLATE_ROWS

        ia_rows: List[Dict[str, Any]] = []

        def add(element: str, subtype: str, pattern: str, source_label: str, source_val: str):
            # Verify the exact element, subtype, and pattern exist in IA_TEMPLATE_ROWS
            exists = any(r[0] == element and r[1] == subtype and r[2] == pattern for r in IA_TEMPLATE_ROWS)
            if exists:
                if not any(r["element"] == element and r.get("subtype") == subtype and r["pattern"] == pattern for r in ia_rows):
                    ia_rows.append({
                        "element": element,
                        "subtype": subtype,
                        "pattern": pattern,
                        "confidence": 0.95,
                        "source_label": source_label,
                        "source_value": source_val,
                    })

        for lbl, val in specs.items():
            lbl_lower = lbl.lower()
            val_lower = val.lower()

            # WK Standard Terms
            if any(k in lbl_lower for k in ["standard instructions", "special instructions", "nursing"]) or "concepts in action" in val_lower:
                add("WK terms", "General", "transsexual", lbl, val)
                add("WK terms", "General", "Concepts in Action", lbl, val)
                add("WK terms", "General", "Watch & Learn", lbl, val)
                add("WK terms", "General", "Practice & Learn", lbl, val)
                add("WK terms", "General", "Interactive Tutorial", lbl, val)
                add("WK terms", "General", "Mongolian spot(s)", lbl, val)

            # (-al) endings
            if "(-al)" in lbl_lower or "-al" in lbl_lower or "physiologic" in val_lower:
                add("(-al) endings", "General", "(-al) endings", lbl, val)

            # Latin terms in italics
            if "latinism" in lbl_lower or "in vitro" in val_lower or "in vivo" in val_lower or "foreign words" in lbl_lower:
                add("Latin terms in italics", "General", "a priori, in vivo, in vitro, in situ, per diem…", lbl, val)

            # Leading zero
            if "leading zero" in lbl_lower:
                if "yes" in val_lower:
                    add("Leading zero", "General", "0.^#", lbl, val)
                elif "no" in val_lower:
                    add("Leading zero (NO)", "General", ".^#", lbl, val)

            # Ordinals
            if "ordinal" in lbl_lower:
                if "10th" in val_lower or "numerals" in val_lower:
                    add("Ordinals - numerals", "General", "^#th", lbl, val)
                    add("Ordinals - numerals", "General", "^#st", lbl, val)
                    add("Ordinals - numerals", "General", "^#nd", lbl, val)
                    add("Ordinals - numerals", "General", "^#rd", lbl, val)
                if "first to ninth" in val_lower or "spell" in val_lower:
                    add("Ordinals - spelled out", "General", "first, second, … hundredth, thousandth", lbl, val)

            # Fractions
            if "fraction" in lbl_lower:
                if "1/3" in val_lower or "slash" in val_lower or "/" in val:
                    add("Fractions", "General", "^#/^# [slash]", lbl, val)
                if "spell" in val_lower or "three-fourths" in val_lower or "one fifth" in val_lower:
                    add("Fractions", "General", "spelled fraction", lbl, val)
                if "symbol" in val_lower or "½" in val:
                    add("Fractions", "General", "½ [symbol]", lbl, val)

            # Times
            if lbl_lower in ("times", "times style") or "times" in lbl_lower:
                if "numerals" in val_lower or "3 times" in val_lower or "15 times" in val_lower:
                    add("Times", "General", "^# times", lbl, val)

            # x for times symbol (magnification)
            if "magnification" in lbl_lower or "×" in val:
                add("x for times symbol", "General", "× (times symbol)", lbl, val)

            # Positional reference (cross-references)
            if "cross-reference" in lbl_lower or "see above" in lbl_lower or "see below" in lbl_lower or "see chapter" in val_lower:
                add("Positional ref", "General", "see above", lbl, val)
                add("Positional ref", "General", "see below", lbl, val)

            # Versus
            if "versus" in lbl_lower:
                add("Versus", "General", "versus", lbl, val)
                if "vs." in val_lower or preset_id == "apa":
                    add("Versus", "General", "vs.", lbl, val)
                if "vs" in val_lower or preset_id == "ama":
                    add("Versus", "General", "vs", lbl, val)

            # Spelling (American / British)
            if "dictionary" in lbl_lower or "spelling" in lbl_lower or "reference books" in lbl_lower:
                if "merriam" in val_lower or "webster" in val_lower or "american" in val_lower or "us" in val_lower:
                    add("Spelling", "style", "American", lbl, val)
                elif "oxford" in val_lower or "british" in val_lower or "uk" in val_lower:
                    add("Spelling", "style", "British", lbl, val)

            # US date
            if "dates, year, time" in lbl_lower or ("date" in lbl_lower and "format" in lbl_lower):
                if "june 5" in val_lower or preset_id in ("ama", "apa"):
                    add("US date", "General", "Month D, YYYY (long form)", lbl, val)

            # Inline lists
            if "in line list" in lbl_lower or "inline list" in lbl_lower:
                if "(a), (b)" in val_lower:
                    add("Inline lists", "General", "(a), (b)…", lbl, val)
                if "(1), (2)" in val_lower:
                    add("Inline lists", "General", "(1), (2)…", lbl, val)

            # Gas abbreviations
            if "gas abbreviations" in lbl_lower or "pao2" in lbl_lower:
                add("Gas abbreviations", "General", "PaCO2 inline", lbl, val)
                add("Gas abbreviations", "General", "PaO2 inline", lbl, val)

            # Abbreviations
            if "text – allowed in heads" in lbl_lower or "allowed in heads" in lbl_lower or "abbreviations in head" in lbl_lower:
                add("Abbreviations", "General", "Abbreviations in heading", lbl, val)
            if "tables and figures" in lbl_lower or "abbreviation in figure" in lbl_lower or "expanded as footnotes in tables" in val_lower:
                add("Abbreviations", "General", "Abbreviations in FC/TC", lbl, val)

            # Per (virgule / per)
            if "virgule construction" in lbl_lower or "per or “/”" in lbl_lower:
                add("Per", "General", "per (word)", lbl, val)

            # Figure Citation
            if "figure citation" in lbl_lower:
                # Direct
                if re.search(r"\bfigure\s+\d+-\d+", val_lower) or "4-1" in val or "1-1" in val:
                    add("Figure", "Citation", "Figure ^#-^#", lbl, val)
                elif re.search(r"\bfigure\s+\d+\.\d+", val_lower) or "4.1" in val or "1.1" in val or "figure" in val_lower:
                    add("Figure", "Citation", "Figure ^#.^#", lbl, val)
                elif re.search(r"\bfigure\s+\d+\b", val_lower):
                    add("Figure", "Citation", "Figure ^#", lbl, val)

                # Abbreviated Fig (direct or indirect)
                if re.search(r"\b(?:e-)?fig\.?\s+\d+-\d+", val_lower):
                    add("Figure", "Citation", "Fig ^#-^#", lbl, val)
                elif (
                    re.search(r"\b(?:e-)?fig\.?\s+\d+\.\d+", val_lower)
                    or "fig. 4.1" in val_lower
                    or "e-fig. 4.1" in val_lower
                    or "fig." in val_lower
                    or "fig " in val_lower
                ):
                    add("Figure", "Citation", "Fig ^#.^#", lbl, val)
                elif re.search(r"\b(?:e-)?fig\.?\s+\d+\b", val_lower):
                    add("Figure", "Citation", "Fig ^#", lbl, val)

                # Group Figs
                if "figs" in val_lower:
                    if re.search(r"figs\.?\s+\d+\.\d+\s*[\u2013\u2014]\s*\d+\.\d+", val) or ("\u2013" in val and "figs" in val_lower):
                        add("Figure", "Citation", "Figs ^#.^#\u2013^#.^#", lbl, val)
                    elif re.search(r"figs\.?\s+\d+\.\d+\s*-\s*\d+\.\d+", val):
                        add("Figure", "Citation", "Figs ^#.^#-^#.^#", lbl, val)
                    elif re.search(r"figs\.?\s+\d+\.\d+\s+to\s+\d+\.\d+", val_lower) or ("to" in val_lower and "figs" in val_lower):
                        add("Figure", "Citation", "Figs ^#.^# to ^#.^#", lbl, val)
                    elif re.search(r"figs\.?\s+\d+\.\d+\s+and\s+\d+\.\d+", val_lower) or ("and" in val_lower and "figs" in val_lower):
                        add("Figure", "Citation", "Figs ^#.^# and ^#.^#", lbl, val)
                    elif re.search(r"figs\.?\s+\d+\.\d+\s*&\s*\d+\.\d+", val):
                        add("Figure", "Citation", "Figs ^#.^# & ^#.^#", lbl, val)
                    elif re.search(r"figs\.?\s+\d+\.\d+\s+through\s+\d+\.\d+", val_lower):
                        add("Figure", "Citation", "Figs ^#.^# through ^#.^#", lbl, val)

                # Group Figures
                if "figures" in val_lower:
                    if re.search(r"figures\s+\d+\.\d+\s*[\u2013\u2014]\s*\d+\.\d+", val) or ("\u2013" in val and "figures" in val_lower):
                        add("Figure", "Citation", "Figures ^#.^#\u2013^#.^#", lbl, val)
                    elif re.search(r"figures\s+\d+\.\d+\s*-\s*\d+\.\d+", val):
                        add("Figure", "Citation", "Figures ^#.^#-^#.^#", lbl, val)
                    elif re.search(r"figures\s+\d+\.\d+\s+to\s+\d+\.\d+", val_lower) or ("to" in val_lower and "figures" in val_lower):
                        add("Figure", "Citation", "Figures ^#.^# to ^#.^#", lbl, val)
                    elif re.search(r"figures\s+\d+\.\d+\s+and\s+\d+\.\d+", val_lower) or ("and" in val_lower and "figures" in val_lower):
                        add("Figure", "Citation", "Figures ^#.^# and ^#.^#", lbl, val)
                    elif re.search(r"figures\s+\d+\.\d+\s*&\s*\d+\.\d+", val):
                        add("Figure", "Citation", "Figures ^#.^# & ^#.^#", lbl, val)
                    elif re.search(r"figures\s+\d+\.\d+\s+through\s+\d+\.\d+", val_lower):
                        add("Figure", "Citation", "Figures ^#.^# through ^#.^#", lbl, val)

            # Figure Caption
            if "figure caption" in lbl_lower:
                if re.search(r"\bfigure\s+\d+-\d+", val_lower):
                    add("Figure", "Caption", "Figure ^#-^#", lbl, val)
                elif re.search(r"\bfigure\s+\d+\.\d+", val_lower):
                    add("Figure", "Caption", "Figure ^#.^#", lbl, val)
                elif re.search(r"\bfigure\s+\d+\b", val_lower):
                    add("Figure", "Caption", "Figure ^#", lbl, val)

            # Table Citation
            if "table citation" in lbl_lower:
                if re.search(r"\btable\s+\d+-\d+", val_lower) or "1-1" in val or "11-1" in val:
                    add("Table", "Citation", "Table ^#-^#", lbl, val)
                elif re.search(r"\btable\s+\d+\.\d+", val_lower) or "1.1" in val or "2.1" in val or "table" in val_lower:
                    add("Table", "Citation", "Table ^#.^#", lbl, val)
                elif re.search(r"\btable\s+\d+\b", val_lower):
                    add("Table", "Citation", "Table ^#", lbl, val)

                # Group Tables
                if "tables" in val_lower:
                    if "to" in val_lower:
                        add("Table", "Citation", "Tables ^#.^# to ^#.^#", lbl, val)
                    elif "\u2013" in val:
                        add("Table", "Citation", "Tables ^#.^#\u2013^#.^#", lbl, val)
                    elif "and" in val_lower:
                        add("Table", "Citation", "Tables ^#.^# and ^#.^#", lbl, val)

            # Table Title / Caption
            if "table title" in lbl_lower or "table caption" in lbl_lower:
                if re.search(r"\btable\s+\d+-\d+", val_lower):
                    add("Table", "Caption", "Table ^#-^#", lbl, val)
                elif re.search(r"\btable\s+\d+\.\d+", val_lower):
                    add("Table", "Caption", "Table ^#.^#", lbl, val)
                elif re.search(r"\btable\s+\d+\b", val_lower):
                    add("Table", "Caption", "Table ^#", lbl, val)

            # Box Citation
            if "box citation" in lbl_lower:
                if re.search(r"\bbox\s+\d+-\d+", val_lower) or "1-1" in val:
                    add("Box", "Citation", "Box ^#-^#", lbl, val)
                elif re.search(r"\bbox\s+\d+\.\d+", val_lower) or "1.1" in val or "3.1" in val or "box" in val_lower:
                    add("Box", "Citation", "Box ^#.^#", lbl, val)

            # Box Title / Caption
            if "box title" in lbl_lower or "box caption" in lbl_lower:
                if re.search(r"\bbox\s+\d+-\d+", val_lower):
                    add("Box", "Caption", "Box ^#-^#", lbl, val)
                elif re.search(r"\bbox\s+\d+\.\d+", val_lower):
                    add("Box", "Caption", "Box ^#.^#", lbl, val)

            # Fold
            if "fold" in lbl_lower:
                if any(k in val_lower for k in ["-fold", "7-fold", "20-fold", "numerals"]):
                    add("Fold", "General", "^#-fold", lbl, val)
                if any(k in val_lower for k in ["twofold", "wordfold", "spelled"]):
                    add("Fold", "General", "[word]fold", lbl, val)

            # Century
            if "centur" in lbl_lower:
                if re.search(r"\b\d+(?:st|nd|rd|th)\s+century", val_lower):
                    add("Century", "General", "^#st/nd/rd/th century (numeric)", lbl, val)
                if re.search(r"\b(?:ninth|twentieth|first|second)\s+century", val_lower):
                    add("Century", "General", "[first to hundredth] century (spelled)", lbl, val)

            # Era (AD, BC)
            if "ad, bc" in lbl_lower or "era" in lbl_lower:
                if "a.d." in val_lower:
                    add("Era", "General", "A.D.", lbl, val)
                elif "ad" in val_lower and "na" not in val_lower:
                    add("Era", "General", "AD", lbl, val)
                if "b.c." in val_lower:
                    add("Era", "General", "B.C.", lbl, val)
                elif "bc" in val_lower and "na" not in val_lower:
                    add("Era", "General", "BC", lbl, val)

            # Virgule construction
            if "virgule" in lbl_lower or "slash" in lbl_lower:
                if "/" in val:
                    add("Virgule", "General", "/ (slash)", lbl, val)

            # Greek letters
            if "greek" in lbl_lower:
                if "symbol" in val_lower or "roman" in val_lower or "α" in val or "upright" in val_lower:
                    add("Greek letters", "General", "Lowercase Greek", lbl, val)
                if "spell" in val_lower:
                    add("Greek letters", "General", "Greek letter spelled out", lbl, val)

            # Genus and species
            if "genus" in lbl_lower or "species" in lbl_lower:
                if "italic" in val_lower:
                    add("Genus species", "General", "[Genus species]", lbl, val)
                    if "not full point" in val_lower or "e coli" in val_lower or preset_id in ("ama", "springer"):
                        add("Genus species", "General", "[G species] (no dot)", lbl, val)
                    else:
                        add("Genus species", "General", "[G. species] (abbreviated)", lbl, val)

            # Time units
            if lbl_lower in ("hour", "minute", "second", "day", "week", "month", "year") or "time units" in lbl_lower:
                if val in ("h", "min", "s", "d", "wk", "mo", "y"):
                    if lbl_lower == "hour": add("Time units", "General", "h / hr", lbl, val)
                    elif lbl_lower == "minute": add("Time units", "General", "min", lbl, val)
                    elif lbl_lower == "second": add("Time units", "General", "s / sec", lbl, val)
                elif val in ("hour", "minute", "second", "day", "week", "month", "year"):
                    if lbl_lower == "hour": add("Time units", "General", "hour(s) (spelled)", lbl, val)
                    elif lbl_lower == "minute": add("Time units", "General", "minute(s) (spelled)", lbl, val)
                    elif lbl_lower == "second": add("Time units", "General", "second(s) (spelled)", lbl, val)

            # Percent
            if "percent style" in lbl_lower or "percent" in lbl_lower:
                if "per cent" in val_lower:
                    add("Percent", "General", "per cent", lbl, val)
                elif "percent" in val_lower and "%" not in val:
                    add("Percent", "General", "percent", lbl, val)
                else:
                    add("Percent", "General", "%", lbl, val)

            # Degree Celsius & Fahrenheit
            if any(k in lbl_lower for k in ["c and ratio", "temperature", "degree", "celsius"]):
                add("Degree Celsius", "General", "°C", lbl, val)
                if "°f" in val_lower or "fahrenheit" in val_lower:
                    add("Degree Fahrenheit", "General", "°F", lbl, val)

            # Number usage
            if "number usage" in lbl_lower and ("0-9" in lbl or "0–9" in lbl):
                if "0 to 9 spell" in val_lower or "spell out" in val_lower:
                    add("Numbers", "General", "0 to 9 spelled out", lbl, val)
                elif "0 to 99" in val_lower:
                    add("Numbers", "General", "0 to 99 numerals", lbl, val)
                else:
                    add("Numbers", "General", "0 to 9 numerals", lbl, val)

            # Ranges
            if "ranges" == lbl_lower or lbl_lower.startswith("ranges"):
                if "use “to”" in val_lower or 'use "to"' in val_lower or "use to" in val_lower:
                    add("Ranges", "General", "X to Y", lbl, val)
                elif "endash" in val_lower or "en-dash" in val_lower:
                    add("Ranges", "General", "X–Y (en dash)", lbl, val)
                elif "hyphen" in val_lower:
                    add("Ranges", "General", "X-Y (hyphen)", lbl, val)

            # Versus
            if "versus" in lbl_lower:
                add("Versus", "General", "versus", lbl, val)
                if "vs." in val_lower or preset_id == "apa":
                    add("Versus", "General", "vs.", lbl, val)
                if "vs" in val_lower or preset_id == "ama":
                    add("Versus", "General", "vs", lbl, val)

            # Latin abbreviations
            if "e.g. and i.e." in lbl_lower:
                if "eg," in val_lower or "eg" in val_lower:
                    add("Latin abbreviations", "General", "eg", lbl, val)
                    add("Latin abbreviations", "General", "ie", lbl, val)
                else:
                    add("Latin abbreviations", "General", "e.g.", lbl, val)
                    add("Latin abbreviations", "General", "i.e.", lbl, val)

            # Symbols (trademarks, registered, copyright)
            if "trademark, copyright" in lbl_lower or "registered symbol" in lbl_lower:
                add("Symbols", "General", "™ trademark symbol", lbl, val)
                add("Symbols", "General", "® registered symbol", lbl, val)
                add("Symbols", "General", "© copyright symbol", lbl, val)

            # Thousand separator
            if "thousand separator" in lbl_lower:
                if "1,000" in val or "comma" in val_lower:
                    add("Thousand separator (use/non-use)", "General", "1,000 (comma)", lbl, val)

            # Quote marks
            if "quote marks" in lbl_lower:
                if "single" in val_lower:
                    add("Quote marks", "General", "Single quote marks (curly pairs)", lbl, val)
                else:
                    add("Quote marks", "General", "Double quote marks (curly pairs)", lbl, val)

            # Periods (am / pm)
            if "time" in lbl_lower and ("am/pm" in lbl_lower or "dates, year, time" in lbl_lower):
                if "a.m." in val_lower:
                    add("Periods", "General", "a.m.", lbl, val)
                    add("Periods", "General", "p.m.", lbl, val)
                elif "am, pm" in val_lower or "am, pm" in val:
                    add("Periods", "General", "am", lbl, val)
                    add("Periods", "General", "pm", lbl, val)

            # Caps / Lowercase after colon
            if "caps after colon" in lbl_lower or "colon" in lbl_lower:
                if "yes" in val_lower or "caps" in val_lower:
                    add("Caps after colon (:)", "General", "Caps after colon (:)", lbl, val)
                elif "no" in val_lower or "lowercase" in val_lower:
                    add("Lowercase after colon (:)", "General", "Lowercase after colon (:)", lbl, val)

        return ia_rows
