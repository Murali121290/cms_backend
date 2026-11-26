"""Phase 6 hardening tests.

Covers edge cases that did not surface in Phases 1–5 but will matter in
real-world usage:

* Datetime cells rendered as plain ISO dates (no dangling ``00:00:00``).
* Numeric cells (ints / floats) preserved as text.
* Empty data region → non-fatal warning (not an exception).
* Output xlsx has the header row frozen and sensible column widths.
"""

from __future__ import annotations

import datetime
import shutil
from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook

from app import models
from app.models import ArtAssessment
from app.domains.post_prod.figure_pdf.assessment_parser import (
    parse_assessment_workbook,
)


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "art_assessment"


# ---------------------------------------------------------------------------
# Datetime + numeric cell rendering (parser)
# ---------------------------------------------------------------------------


def test_midnight_datetime_renders_as_date_only():
    """The Pathak fixture carries a midnight datetime in project-info."""
    parsed = parse_assessment_workbook(FIXTURE_DIR / "pathak_190442.xlsx")
    # Pathak's "Projected Printer Date" is 2027-01-29 (midnight). After Phase 6
    # it must render as a plain date, not ``2027-01-29 00:00:00``.
    assert parsed.project_info.get("Projected Printer Date") == "2027-01-29"


def test_datetime_with_time_preserves_time(tmp_path: Path):
    wb = Workbook()
    info = wb.active
    info.title = "Project Info"
    info.append(["Incoming Art Assessment", ":", "Test"])
    info.append(["Deadline", ":", datetime.datetime(2027, 1, 29, 14, 30, 0)])
    info.append(["Projects & Authors", ":", "Test_123"])
    info.append(["Book Title", ":", "Smoke"])
    data = wb.create_sheet("Data")
    data.append(["Chapter NO.", "Figure No.", "Source", "Output color", "Remarks"])
    data.append(["Chapter 1", "Fig 1.1", "New", "4 Color Halftone", ""])
    out = tmp_path / "dt_test.xlsx"
    wb.save(out)
    wb.close()

    parsed = parse_assessment_workbook(out)
    assert parsed.project_info["Deadline"] == "2027-01-29 14:30:00"


def test_date_only_cell_renders_as_date(tmp_path: Path):
    wb = Workbook()
    info = wb.active
    info.title = "Project Info"
    info.append(["Incoming Art Assessment", ":", "Test"])
    info.append(["Deadline", ":", datetime.date(2027, 1, 29)])
    info.append(["Projects & Authors", ":", "Test_123"])
    info.append(["Book Title", ":", "Smoke"])
    data = wb.create_sheet("Data")
    data.append(["Chapter NO.", "Figure No.", "Source", "Output color", "Remarks"])
    data.append(["Chapter 1", "Fig 1.1", "New", "4 Color Halftone", ""])
    out = tmp_path / "date_test.xlsx"
    wb.save(out)
    wb.close()

    parsed = parse_assessment_workbook(out)
    assert parsed.project_info["Deadline"] == "2027-01-29"


def test_numeric_cell_preserved_as_text(tmp_path: Path):
    """Murphy-style numeric Original File Name entries (``1``, ``2A``, …)
    round-trip as text, not as numeric. Ints stay ``"1"``, not ``"1.0"``."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Data"
    ws.append([
        "Chapter Name",
        "Output Figure no.",
        "Original File Name",
        "Output color",
    ])
    ws.append(["Chapter 1", "Murphy_F01-01", 1, "4 Color Halftone"])
    ws.append(["Chapter 1", "Murphy_F01-02", 1.5, "4 Color Halftone"])
    out = tmp_path / "numeric_test.xlsx"
    wb.save(out)
    wb.close()

    parsed = parse_assessment_workbook(out)
    assert len(parsed.rows) == 2
    assert parsed.rows[0].canonical["art_name"] == "1"
    assert parsed.rows[1].canonical["art_name"] == "1.5"


# ---------------------------------------------------------------------------
# Empty data region
# ---------------------------------------------------------------------------


def test_recognizable_headers_but_no_rows_emits_warning(tmp_path: Path):
    """Not an error — the parser should still return a valid result with a
    user-friendly warning so the UI can surface it before Generate runs."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Data"
    ws.append(["Chapter NO.", "Figure No.", "Source", "Output color", "Remarks"])
    out = tmp_path / "no_rows.xlsx"
    wb.save(out)
    wb.close()

    parsed = parse_assessment_workbook(out)
    assert len(parsed.rows) == 0
    assert any(
        "zero figure rows" in w for w in parsed.warnings
    ), f"expected zero-rows warning, got {parsed.warnings!r}"


# ---------------------------------------------------------------------------
# Output xlsx polish (Excel-path generator)
# ---------------------------------------------------------------------------


def _register_uploaded_xlsx(
    db_session, project, chapter, temp_upload_root: Path, fixture_name: str
):
    src = FIXTURE_DIR / fixture_name
    target_dir = temp_upload_root / project.code / chapter.number / "Art"
    target_dir.mkdir(parents=True, exist_ok=True)
    dst = target_dir / fixture_name
    shutil.copy(src, dst)
    rec = models.File(
        project_id=project.id,
        chapter_id=chapter.id,
        filename=fixture_name,
        file_type="xlsx",
        category="Art",
        path=str(dst),
        version=1,
        is_original=True,
    )
    db_session.add(rec)
    db_session.commit()
    db_session.refresh(rec)
    return rec


def test_output_xlsx_has_frozen_header_and_column_widths(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_record,
    temp_upload_root,
):
    _register_uploaded_xlsx(
        db_session, project_record, chapter_record, temp_upload_root, "lancaster_190294.xlsx"
    )
    client = auth_cookie_client(admin_user)
    resp = client.post(
        f"/api/v2/projects/{project_record.id}/chapters/{chapter_record.id}"
        f"/generate-figure-assessment"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    out_file = (
        db_session.query(models.File).filter_by(id=body["file"]["id"]).one()
    )

    wb = load_workbook(out_file.path)
    try:
        # Data sheet
        ws = wb["Sheet2"]
        # Freeze panes locked at A2 → first row is pinned.
        assert ws.freeze_panes == "A2"

        # Header row cells are bold.
        first_row = next(ws.iter_rows(min_row=1, max_row=1))
        assert all(c.font.bold for c in first_row), (
            "header cells should be bold"
        )

        # Every used column has a width set (openpyxl exposes column_dimensions
        # for columns we assigned a width to).
        used_cols = ws.max_column
        for col_idx in range(1, used_cols + 1):
            from openpyxl.utils import get_column_letter

            letter = get_column_letter(col_idx)
            width = ws.column_dimensions[letter].width
            assert width is not None, f"column {letter} has no width"
            # Clamp bounds: Phase 6 enforces [10, 60].
            assert 10 <= width <= 60, f"column {letter} width {width} out of [10,60]"
    finally:
        wb.close()
