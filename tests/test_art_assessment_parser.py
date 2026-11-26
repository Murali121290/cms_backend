"""Unit tests for the Art Assessment Excel parser.

Covers the Phase 1 acceptance assertions in
docs/art-assessment/ART_ASSESSMENT_IMPLEMENTATION_PLAN.md §10.1-10.4:

* Three real client workbooks (Lancaster, Pathak, Murphy) parse correctly.
* The legacy system-generated 15-column workbook also parses.
* Color strings round-trip verbatim (no RGB/CMYK coercion).
* Unknown columns are preserved verbatim per row and at the sheet level.
* Blank cells become ``None`` — no invented defaults.
* Duplicate ``(chapter_label, figure_no)`` is allowed (no silent dedup).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook

from app.domains.post_prod.figure_pdf.assessment_parser import (
    ALIAS_REGISTRY,
    AssessmentParseError,
    ParsedAssessment,
    parse_assessment_workbook,
)


FIXTURES = Path(__file__).parent / "fixtures" / "art_assessment"


# ---------------------------------------------------------------------------
# Lancaster
# ---------------------------------------------------------------------------


def test_lancaster_project_info_detected():
    result = parse_assessment_workbook(FIXTURES / "lancaster_190294.xlsx")
    assert result.project_info_sheet == "PROJECT INFO"
    assert result.project_info["Book Title"] == "Optical Document Security, Fourth Edition"
    assert result.project_info["Projects & Authors"] == "Lancaster_190294"
    # Leading whitespace in the raw cell value is trimmed; internal content kept.
    assert result.project_info["ISBN-13"] == "978-1-68569-081-6"
    assert "Previous Edition " in result.project_info  # trailing space preserved


def test_lancaster_data_sheet_and_mapping():
    result = parse_assessment_workbook(FIXTURES / "lancaster_190294.xlsx")
    assert result.data_sheet_name == "Sheet2"
    assert result.header_row_index == 1

    expected = {
        "chapter_label": "Chapter NO.",
        "figure_no": "Figure No.",
        "source_status": "Source",
        "output_color": "Output color",
        "classification": "Re-lable (or) Re-Key Category",
        "queries": "Queries",
        "queries_detail": "Queries Details",
        "remarks": "Remarks",
    }
    assert result.canonical_columns == expected
    assert result.unmapped_columns == []


def test_lancaster_row_count_after_blank_trim():
    result = parse_assessment_workbook(FIXTURES / "lancaster_190294.xlsx")
    # Workbook pads to 432 rows with blanks; real data is 201 rows.
    assert len(result.rows) == 201


def test_lancaster_output_color_values_preserved_verbatim():
    result = parse_assessment_workbook(FIXTURES / "lancaster_190294.xlsx")
    seen = {r.canonical.get("output_color") for r in result.rows}
    seen.discard(None)
    assert seen == {
        "1 Color Halftone",
        "1 Color Lineart",
        "4 Color Halftone",
        "4 Color Lineart",
    }


# ---------------------------------------------------------------------------
# Pathak
# ---------------------------------------------------------------------------


def test_pathak_project_info_detected():
    result = parse_assessment_workbook(FIXTURES / "pathak_190442.xlsx")
    assert result.project_info_sheet == "Project Info"
    assert result.project_info["Projects & Authors"] == "de Bruin_190366"


def test_pathak_data_sheet_detected_despite_unusual_name():
    result = parse_assessment_workbook(FIXTURES / "pathak_190442.xlsx")
    assert result.data_sheet_name == "de Bruin_190366"
    # 3 real rows; the sheet is padded to 136.
    assert len(result.rows) == 3


def test_pathak_preserves_lowercase_and_slash_color_variants():
    result = parse_assessment_workbook(FIXTURES / "pathak_190442.xlsx")
    seen = {r.canonical.get("output_color") for r in result.rows}
    seen.discard(None)
    # Lowercase "1 color Lineart" and slash-bearing "b/w halftone" must survive.
    assert "1 color Lineart" in seen
    assert "b/w halftone" in seen


# ---------------------------------------------------------------------------
# Murphy
# ---------------------------------------------------------------------------


def test_murphy_no_project_info_sheet():
    result = parse_assessment_workbook(FIXTURES / "murphy_7e_189382.xlsx")
    assert result.project_info_sheet is None
    assert result.project_info == {}


def test_murphy_data_sheet_and_mapping_including_typo_alias():
    result = parse_assessment_workbook(FIXTURES / "murphy_7e_189382.xlsx")
    assert result.data_sheet_name == "_Art assessment"

    expected = {
        "chapter_label": "Chapter Name",
        "figure_no": "Output Figure no.",
        "output_color": "Output color",
        "art_name": "Original File Name",
        "editorial_instructions": "Comments/Instructions from Editorial",
        "source_status": "Source Status",
        "suggested_sizing": "Suggested Sizing",
        "billing_status": "S4 Billing status",
        "queries": "Queries",
        "queries_detail": "Queries Details",
        "query_replies": "Querie replies",  # client typo, resolved via alias
        "batch_no": "Batch No",
        "remarks": "Remarks",
    }
    assert result.canonical_columns == expected
    # 22 trailing blank-header columns in Murphy must be dropped, not kept
    # as unmapped.
    assert result.unmapped_columns == []


def test_murphy_row_count_after_blank_trim():
    result = parse_assessment_workbook(FIXTURES / "murphy_7e_189382.xlsx")
    # 312 non-blank data rows (one figure number appears twice, so only 311
    # distinct Output Figure no. values). The workbook is padded to 1040
    # rows — those must be trimmed.
    assert len(result.rows) == 312


def test_murphy_preserves_free_text_variants():
    result = parse_assessment_workbook(FIXTURES / "murphy_7e_189382.xlsx")
    output_colors = {r.canonical.get("output_color") for r in result.rows}
    output_colors.discard(None)
    # The "1 Color Linetone" spelling (apparent client typo) must survive untouched.
    assert "1 Color Linetone" in output_colors
    assert "4 Color Halftone" in output_colors
    assert "1 Color Halftone" in output_colors

    billing = {r.canonical.get("billing_status") for r in result.rows}
    billing.discard(None)
    for expected_value in (
        "Pickup",
        "Pickup Modify",
        "Redraw Simple",
        "Redraw Medium",
        "Redraw complex",
        "Redraw more complex",
    ):
        assert expected_value in billing


def test_murphy_batch_and_editorial_round_trip():
    result = parse_assessment_workbook(FIXTURES / "murphy_7e_189382.xlsx")
    first = result.rows[0]
    assert first.canonical["chapter_label"] == "Chapter 01"
    assert first.canonical["figure_no"] == "Murphy_F01-01"
    assert first.canonical["art_name"] == "Figure 1.1.png"
    assert first.canonical["batch_no"] == "Batch 1"
    assert first.canonical["output_color"] == "4 Color Halftone"


# ---------------------------------------------------------------------------
# Legacy system-generated format
# ---------------------------------------------------------------------------


def test_legacy_generated_format_maps_known_columns():
    result = parse_assessment_workbook(FIXTURES / "legacy_generated.xlsx")

    # The 10 human-managed columns map cleanly to canonical fields.
    expected_fields = {
        "art_name",             # "ART NAME"
        "figure_no",            # "FIGURE NO."
        "part_no",              # "PART NO."
        "type",                 # "TYPE"
        "classification",       # "ART CLASSIFICATION"
        "output_color",         # "FINAL ART COLOR"
        "editorial_instructions",  # "SPECIAL INSTRUCTION " (trailing space)
        "suggested_sizing",     # "FINAL SIZE"
        "complexity",           # "COMPLEXITY"
        "status",               # "STATUS"
    }
    for fname in expected_fields:
        assert fname in result.canonical_columns, fname

    # The 5 image-derived columns are intentionally NOT in the alias registry
    # (they come from PIL metadata, not from the client). They must be
    # preserved verbatim as unmapped columns — never silently discarded.
    assert result.unmapped_columns == [
        "SUPPLIED IMAGE COLOR",
        "SUPPLIED IMAGE MODE",
        "SUPPLIED IMAGE TYPE",
        "SUPPLIED SIZE",
        "RESOLUTION (HALFTONE ONLY)",
    ]
    # And the per-row extras dict should carry those values from each row.
    first = result.rows[0]
    assert first.unmapped["SUPPLIED IMAGE COLOR"] == "RGB"
    assert first.unmapped["SUPPLIED IMAGE MODE"] == "RGB"


# ---------------------------------------------------------------------------
# Unknown column / unmapped preservation
# ---------------------------------------------------------------------------


def test_unknown_columns_are_preserved(tmp_path: Path):
    src = FIXTURES / "lancaster_190294.xlsx"
    mutated = tmp_path / "lancaster_with_extra.xlsx"

    wb = load_workbook(src)
    ws = wb["Sheet2"]
    # Append a new header + value at the end of each existing data row.
    new_col = ws.max_column + 1
    ws.cell(row=1, column=new_col, value="Vendor Comments")
    ws.cell(row=2, column=new_col, value="deliver by Friday")
    wb.save(mutated)
    wb.close()

    result = parse_assessment_workbook(mutated)
    assert "Vendor Comments" in result.unmapped_columns
    assert all("Vendor Comments" not in cols for cols in [result.canonical_columns])
    # The row-level extras dict must carry the raw header exactly.
    first = result.rows[0]
    assert first.unmapped.get("Vendor Comments") == "deliver by Friday"
    # Warnings should mention the unmapped column.
    assert any("Vendor Comments" in w for w in result.warnings)


def test_duplicate_alias_match_keeps_first_and_preserves_second(tmp_path: Path):
    """If two headers map to the same canonical field, first wins; second is retained as unmapped."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet2"
    # "Final Size" and "Suggested Sizing" both map to ``suggested_sizing``.
    headers = [
        "Chapter NO.",
        "Figure No.",
        "Source",
        "Output color",
        "Final Size",
        "Suggested Sizing",
        "Remarks",
    ]
    for idx, h in enumerate(headers, start=1):
        ws.cell(row=1, column=idx, value=h)
    ws.append(["Chapter 1", "Fig 1.1", "New", "4 Color Halftone", "A", "B", ""])

    out = tmp_path / "dup_alias.xlsx"
    wb.save(out)
    wb.close()

    result = parse_assessment_workbook(out)
    assert result.canonical_columns["suggested_sizing"] == "Final Size"
    assert "Suggested Sizing" in result.unmapped_columns
    assert result.rows[0].canonical["suggested_sizing"] == "A"
    assert result.rows[0].unmapped["Suggested Sizing"] == "B"
    assert any("both map" in w for w in result.warnings)


# ---------------------------------------------------------------------------
# Missing values + duplicate figures
# ---------------------------------------------------------------------------


def test_blank_cells_become_none_not_defaults():
    result = parse_assessment_workbook(FIXTURES / "pathak_190442.xlsx")
    # In the Pathak workbook, "Remarks" is empty for every data row.
    assert all(row.canonical.get("remarks") is None for row in result.rows)
    # No row should contain the string "RGB" in output_color — the uploaded
    # file never says RGB, and the parser must not have invented it.
    for row in result.rows:
        assert row.canonical.get("output_color") not in {"RGB", "CMYK", "B&W"}


def test_duplicate_figures_are_preserved_not_deduped(tmp_path: Path):
    wb = Workbook()
    ws = wb.active
    ws.title = "data"
    ws.append(["Chapter NO.", "Figure No.", "Source", "Output color", "Remarks"])
    ws.append(["Chapter 1", "Fig 1.1", "New", "1 Color Halftone", "a"])
    ws.append(["Chapter 1", "Fig 1.1", "New", "4 Color Halftone", "b"])

    out = tmp_path / "dups.xlsx"
    wb.save(out)
    wb.close()

    result = parse_assessment_workbook(out)
    assert len(result.rows) == 2
    assert result.rows[0].canonical["output_color"] == "1 Color Halftone"
    assert result.rows[1].canonical["output_color"] == "4 Color Halftone"


# ---------------------------------------------------------------------------
# Negative cases
# ---------------------------------------------------------------------------


def test_rejects_non_xlsx(tmp_path: Path):
    bogus = tmp_path / "not-a-spreadsheet.csv"
    bogus.write_text("hello")
    with pytest.raises(AssessmentParseError):
        parse_assessment_workbook(bogus)


def test_rejects_workbook_without_recognizable_headers(tmp_path: Path):
    wb = Workbook()
    ws = wb.active
    ws.append(["random", "unrelated", "columns"])
    ws.append(["a", "b", "c"])
    out = tmp_path / "nope.xlsx"
    wb.save(out)
    wb.close()
    with pytest.raises(AssessmentParseError):
        parse_assessment_workbook(out)


# ---------------------------------------------------------------------------
# Alias registry sanity
# ---------------------------------------------------------------------------


def test_alias_registry_has_no_cross_field_collisions():
    """Each canonicalized alias should map to exactly one canonical field."""
    from app.domains.post_prod.figure_pdf.assessment_parser import _CANON_INDEX, _canon

    for field, aliases in ALIAS_REGISTRY.items():
        for alias in aliases:
            assert _CANON_INDEX[_canon(alias)] == field, (
                f"alias {alias!r} should map to {field!r}, "
                f"but maps to {_CANON_INDEX[_canon(alias)]!r}"
            )


# ---------------------------------------------------------------------------
# F4 — Acceptance assertions per the finalization doc §5
# ---------------------------------------------------------------------------


def test_f4_lancaster_cdr_remarks_preserved():
    """Lancaster finalization check: CDR-related Remarks preserved verbatim.
    28 rows in the workbook have Remarks="Use .cdr file" — assert at least one
    round-trips with the exact spelling."""
    result = parse_assessment_workbook(FIXTURES / "lancaster_190294.xlsx")
    cdr_rows = [r for r in result.rows if r.canonical.get("remarks") == "Use .cdr file"]
    assert len(cdr_rows) >= 1, "Expected at least one row with Remarks='Use .cdr file'"
    # And the first such row must be Fig 1.1.jpg per the source workbook.
    assert cdr_rows[0].canonical.get("figure_no") == "Fig 1.1.jpg"


def test_f4_pathak_author_photo_query_text_verbatim():
    """Pathak finalization check: the author-photo row's long queries_detail
    string survives unchanged — not truncated, not re-punctuated."""
    result = parse_assessment_workbook(FIXTURES / "pathak_190442.xlsx")
    author_rows = [
        r for r in result.rows
        if r.canonical.get("figure_no") == "Ankit Pathak Author Photo"
    ]
    assert len(author_rows) == 1
    row = author_rows[0]
    assert row.canonical["chapter_label"] == "About the Author"
    assert row.canonical["source_status"] == "New"
    assert row.canonical["output_color"] == "b/w halftone"
    assert row.canonical["classification"] == "Simple"
    assert row.canonical["queries"] == "Yes"
    assert row.canonical["queries_detail"] == (
        "The author photo has been received, but it is not mentioned in the "
        "MS (manuscript)."
    )


def test_f4_murphy_pickup_spu_redraw_sizing_editorial_preserved():
    """Murphy finalization check: the full Pickup/SPU/Redraw billing vocabulary
    and the Suggested Sizing spellings round-trip verbatim across all 312 rows."""
    result = parse_assessment_workbook(FIXTURES / "murphy_7e_189382.xlsx")

    # All 7 billing states observed in Murphy are present somewhere.
    billing = {r.canonical.get("billing_status") for r in result.rows}
    billing.discard(None)
    for expected in (
        "Pickup",
        "Pickup Modify",
        "Redraw",
        "Redraw Medium",
        "Redraw Simple",
        "Redraw complex",         # lowercase "complex" is the client's spelling
        "Redraw more complex",
    ):
        assert expected in billing, f"missing billing_status {expected!r}"

    # SPU vs New are both preserved.
    source_states = {r.canonical.get("source_status") for r in result.rows}
    source_states.discard(None)
    assert source_states == {"New", "SPU"}

    # Suggested Sizing spellings survive — representative set.
    sizings = {r.canonical.get("suggested_sizing") for r in result.rows}
    sizings.discard(None)
    for expected in (
        "1 column",
        "1-COLUMN",          # uppercase variant preserved
        "1-column",
        "full page width",
        "full-page width",   # hyphenated variant preserved
        "half page width",
        "two-thirds page width",
    ):
        assert expected in sizings, f"missing suggested_sizing {expected!r}"

    # Editorial instructions carry at least one <Prev Ed …> and one <Note to
    # Production …> bracketed comment verbatim (the Murphy workbook has 91
    # distinct editorial strings — we spot-check the characteristic ones).
    editorial = [
        r.canonical.get("editorial_instructions") for r in result.rows
        if r.canonical.get("editorial_instructions")
    ]
    assert any(e.startswith("<Prev Ed ") for e in editorial), (
        "expected at least one <Prev Ed …> editorial comment"
    )
    assert any("<Note to Production:" in e for e in editorial), (
        "expected at least one <Note to Production: …> editorial comment"
    )
    # Query replies column (Murphy's typo 'Querie replies' → query_replies)
    # carries at least one non-trivial reply.
    replies = [
        r.canonical.get("query_replies") for r in result.rows
        if r.canonical.get("query_replies")
    ]
    assert len(replies) >= 1
