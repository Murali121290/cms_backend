"""Build rules/ce_rules_catalog.json from the CE checklist workbook.

Usage:
    python scripts/build_ce_rules_catalog.py path/to/CE_rules_tool_input.xlsx

Reads the "Rules" sheet with the standard library only (openpyxl is not a
dependency). The link from each checklist rule to the TE engine rule_ids is
kept below in TE_RULE_IDS so it survives regeneration when the workbook changes.
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "app" / "processing" / "manuscript_core" / "rules" / "ce_rules_catalog.json"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

# Checklist S.No. -> TE rule_ids (exact ids, or prefixes ending in "*").
TE_RULE_IDS: dict[int, list[str]] = {
    1: ["si_nonsi_rename", "si_nonsi_convert", "si_ambiguous_symbol"],
    2: ["unit_case_wrong", "unit_symbol_period"],
    3: ["unit_space_missing"],
    4: ["unit_*"],
    5: ["degree_celsius", "degree_fahrenheit", "degree_deg_c", "degree_deg_f",
        "degree_celsius_spelled", "degree_fahrenheit_spelled"],
    6: ["percent_symbol", "percent_word", "per_cent_word", "percent_percentage"],
    7: ["cmp_*", "times_letter", "times_symbol"],
    8: ["greek_lowercase", "greek_uppercase", "greek_spelled"],
    9: ["micro_lookalike"],
    10: ["gas_*", "unit_exp_plain"],
    11: ["thousands_*"],
    13: ["num_*"],
    14: ["range_to", "range_endash", "range_hyphen"],
    15: ["negative_hyphen"],
    16: ["fraction_*"],
    17: ["date_*"],
    19: ["ampm_*"],
    20: ["timezone_abbr"],
    21: ["currency_symbols", "currency_spelled"],
    22: ["equation_ref"],
    23: ["chem_formula_plain"],
    24: ["sci_notation_x", "sci_notation_e"],
    25: ["stat_p_value", "stat_symbol"],
    28: ["si_nonsi_convert"],
    29: ["plusminus_spacing", "plusminus_text"],
    30: ["degree_symbol_alone", "degree_spelled", "degree_lookalike"],
    31: ["abbrev_body"],
    34: ["abbrev_heading"],
    35: ["latin_*", "versus_*"],
    36: ["genus_species_*"],
    43: ["sym_trademark_char", "sym_trademark_text", "sym_registered_char", "sym_registered_text"],
    44: ["sym_copyright_char", "sym_copyright_text"],
    45: ["special_char_corrupt"],
    47: ["wk_*"],
    71: ["ref_table_*", "ref_tab_*", "ref_tables_*", "ref_tabs_*"],
    72: ["ref_figure_*", "ref_fig_*", "ref_figures_*", "ref_figs_*"],
    75: ["cap_table_*", "cap_tab_*", "cap_tables_*", "cap_tabs_*"],
    76: ["cap_figure_*", "cap_fig_*", "cap_figures_*", "cap_figs_*", "citation_bracket_numeric"],
    81: ["abbrev_table", "abbrev_caption"],
    84: ["duplicate_paragraph"],
    89: ["placeholder_text"],
}

# Rules that never change a scientific value automatically.
NEVER_AUTOFIX = {12, 26, 28}


def _shared_strings(z: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    return ["".join(t.text or "" for t in si.iter(NS + "t")) for si in root.findall(NS + "si")]


def _sheet_path(z: zipfile.ZipFile, name: str) -> str:
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    targets = {r.get("Id"): r.get("Target") for r in rels}
    for s in wb.find(NS + "sheets"):
        if s.get("name") == name:
            target = targets[s.get(REL_NS + "id")].lstrip("/")
            return target if target.startswith("xl/") else "xl/" + target
    raise SystemExit(f"Sheet {name!r} not found")


def read_rows(xlsx: Path, sheet: str = "Rules") -> list[dict[str, str]]:
    with zipfile.ZipFile(xlsx) as z:
        strings = _shared_strings(z)
        root = ET.fromstring(z.read(_sheet_path(z, sheet)))
    rows = []
    for row in root.iter(NS + "row"):
        cells = {}
        for c in row.findall(NS + "c"):
            col = re.match(r"[A-Z]+", c.get("r")).group()
            v = c.find(NS + "v")
            if c.get("t") == "inlineStr":
                cells[col] = "".join(t.text or "" for t in c.iter(NS + "t"))
            elif v is not None:
                cells[col] = strings[int(v.text)] if c.get("t") == "s" else v.text
        rows.append(cells)
    return rows


def build(xlsx: Path) -> list[dict]:
    rows = read_rows(xlsx)
    catalog = []
    for r in rows[1:]:
        if not r.get("E"):
            continue
        sno = int(float(r["E"]))
        behaviour = r.get("J", "")
        te_ids = TE_RULE_IDS.get(sno, [])
        if not te_ids:
            detectable = "manual"
        elif behaviour == "Flag and suggest" or sno in NEVER_AUTOFIX:
            detectable = "flag"
        else:
            detectable = "auto"
        catalog.append({
            "sno": sno,
            "name": r.get("A", ""),
            "group": r.get("G", ""),
            "editing_type": r.get("F", ""),
            "description": r.get("H", ""),
            "options": [r.get("B", ""), r.get("C", ""), r.get("D", "")],
            "handling": r.get("I", ""),
            "behaviour": behaviour,
            "severity": r.get("K", ""),
            "needs": r.get("L", ""),
            "confirm": r.get("M", "") == "Confirm",
            "notes": r.get("N", ""),
            "source_point": int(float(r["O"])) if r.get("O") else None,
            "te_rule_ids": te_ids,
            "detectable": detectable,
        })
    catalog.sort(key=lambda e: e["sno"])
    return catalog


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    catalog = build(Path(sys.argv[1]))
    OUT.write_text(json.dumps({"source": Path(sys.argv[1]).name, "rules": catalog}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {len(catalog)} rules to {OUT}")


if __name__ == "__main__":
    main()
