"""End-to-end tests for the Generate Assessment dispatcher (Phase 4).

Covers both branches of ``generate_figure_assessment``:

* Excel path — an uploaded client workbook drives the output; the generated
  xlsx preserves the client's column order + verbatim values, and the parsed
  rows are persisted to ``art_assessments`` / ``art_assessment_rows``.
* Images-only fallback — chapters with no uploaded xlsx still get the
  15-column "Information Management" template byte-for-byte as before.
* Error paths — multi-xlsx ambiguity, invalid workbook.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook

from app import models
from app.models import ArtAssessment, ArtAssessmentRow


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "art_assessment"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture()
def art_folder(temp_upload_root: Path, project_record, chapter_record) -> Path:
    path = temp_upload_root / project_record.code / chapter_record.number / "Art"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _register_uploaded_xlsx(
    db_session, project, chapter, art_folder: Path, fixture_name: str
) -> models.File:
    src = FIXTURE_DIR / fixture_name
    assert src.exists(), f"missing fixture {src}"
    dst = art_folder / fixture_name
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


def _gen_url(project_id: int, chapter_id: int) -> str:
    return (
        f"/api/v2/projects/{project_id}/chapters/{chapter_id}/generate-figure-assessment"
    )


# ---------------------------------------------------------------------------
# Excel path — Lancaster
# ---------------------------------------------------------------------------


def test_excel_path_lancaster_persists_and_preserves_columns(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_record,
    art_folder,
):
    _register_uploaded_xlsx(
        db_session, project_record, chapter_record, art_folder, "lancaster_190294.xlsx"
    )
    client = auth_cookie_client(admin_user)

    resp = client.post(_gen_url(project_record.id, chapter_record.id))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["source"] == "excel"
    assert body["figures_included"] == 201
    assert body["parsed_row_count"] == 201
    assert body["unmapped_columns"] == []
    assert body["assessment_id"] is not None

    # Persisted art_assessments + art_assessment_rows
    assessment = (
        db_session.query(ArtAssessment).filter_by(id=body["assessment_id"]).one()
    )
    assert assessment.source_mode == "excel"
    assert assessment.data_sheet_name == "Sheet2"
    assert assessment.header_row_index == 1
    assert len(assessment.rows) == 201

    # Verbatim color strings survived DB round-trip.
    colors = {r.output_color for r in assessment.rows if r.output_color}
    assert colors == {
        "1 Color Halftone",
        "1 Color Lineart",
        "4 Color Halftone",
        "4 Color Lineart",
    }
    # No invented default anywhere.
    assert "RGB" not in colors
    assert "CMYK" not in colors

    # The generated xlsx preserves the client's exact header order and spelling.
    out_path = Path(body["file"]["path"]) if "path" in body["file"] else None
    # Path field isn't in FileRecord; look up via ORM instead.
    out_file = db_session.query(models.File).filter_by(id=body["file"]["id"]).one()
    assert out_file.filename.endswith("_ArtAssessment_generated.xlsx")

    wb = load_workbook(out_file.path, read_only=True)
    try:
        # Data sheet name mirrors the client's (truncated/sanitized to 31 chars).
        assert "Sheet2" in wb.sheetnames
        ws = wb["Sheet2"]
        headers = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
        # Client's 8 original headers come first, in order.
        assert headers[:8] == [
            "Chapter NO.",
            "Figure No.",
            "Source",
            "Output color",
            "Re-lable (or) Re-Key Category",
            "Queries",
            "Queries Details",
            "Remarks",
        ]
    finally:
        wb.close()


# ---------------------------------------------------------------------------
# Excel path — Murphy (all the extras round-trip)
# ---------------------------------------------------------------------------


def test_excel_path_murphy_preserves_all_extras(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_record,
    art_folder,
):
    _register_uploaded_xlsx(
        db_session,
        project_record,
        chapter_record,
        art_folder,
        "murphy_7e_189382.xlsx",
    )
    client = auth_cookie_client(admin_user)

    resp = client.post(_gen_url(project_record.id, chapter_record.id))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["source"] == "excel"
    assert body["parsed_row_count"] == 312
    assert body["unmapped_columns"] == []

    assessment = (
        db_session.query(ArtAssessment).filter_by(id=body["assessment_id"]).one()
    )
    # All Murphy-only canonical fields were persisted.
    first = assessment.rows[0]
    assert first.chapter_label == "Chapter 01"
    assert first.figure_no == "Murphy_F01-01"
    assert first.art_name == "Figure 1.1.png"
    assert first.output_color == "4 Color Halftone"
    assert first.billing_status == "Redraw complex"
    assert first.batch_no == "Batch 1"
    assert first.suggested_sizing == "full page width"

    # Murphy's client typo "1 Color Linetone" survives verbatim.
    assert any(r.output_color == "1 Color Linetone" for r in assessment.rows)

    # Rows that were blank in the client cell stay NULL — no "RGB" default.
    blank_remarks = [r for r in assessment.rows if r.remarks is None]
    assert len(blank_remarks) == len(assessment.rows)  # every row is blank in Murphy


# ---------------------------------------------------------------------------
# Excel path — Pathak (lowercase + slash color variants)
# ---------------------------------------------------------------------------


def test_excel_path_pathak_preserves_color_variants(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_record,
    art_folder,
):
    _register_uploaded_xlsx(
        db_session, project_record, chapter_record, art_folder, "pathak_190442.xlsx"
    )
    client = auth_cookie_client(admin_user)

    resp = client.post(_gen_url(project_record.id, chapter_record.id))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["source"] == "excel"
    assert body["parsed_row_count"] == 3

    assessment = (
        db_session.query(ArtAssessment).filter_by(id=body["assessment_id"]).one()
    )
    colors = {r.output_color for r in assessment.rows if r.output_color}
    assert "1 color Lineart" in colors
    assert "b/w halftone" in colors

    # Project-info block survived into the generated workbook on its own sheet.
    out_file = db_session.query(models.File).filter_by(id=body["file"]["id"]).one()
    wb = load_workbook(out_file.path, read_only=True)
    try:
        # One info sheet + one data sheet.
        assert len(wb.sheetnames) == 2
        info_sheet = [n for n in wb.sheetnames if n != "de Bruin_190366"][0]
        info_ws = wb[info_sheet]
        # The "Book Title" label is present somewhere.
        labels = [row[0].value for row in info_ws.iter_rows(min_row=1, max_row=info_ws.max_row)]
        assert "Book Title" in labels
    finally:
        wb.close()


# ---------------------------------------------------------------------------
# Unknown-column preservation on the Excel path
# ---------------------------------------------------------------------------


def test_excel_path_preserves_unmapped_columns_in_output(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_record,
    art_folder,
    tmp_path: Path,
):
    # Inject a "Vendor Comments" column into the Lancaster workbook.
    src = FIXTURE_DIR / "lancaster_190294.xlsx"
    mutated = art_folder / "lancaster_with_extra.xlsx"
    shutil.copy(src, mutated)
    wb = load_workbook(mutated)
    ws = wb["Sheet2"]
    new_col = ws.max_column + 1
    ws.cell(row=1, column=new_col, value="Vendor Comments")
    ws.cell(row=2, column=new_col, value="deliver by Friday")
    wb.save(mutated)
    wb.close()

    rec = models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename="lancaster_with_extra.xlsx",
        file_type="xlsx",
        category="Art",
        path=str(mutated),
        version=1,
        is_original=True,
    )
    db_session.add(rec)
    db_session.commit()

    client = auth_cookie_client(admin_user)
    resp = client.post(_gen_url(project_record.id, chapter_record.id))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "Vendor Comments" in body["unmapped_columns"]
    assert any("Vendor Comments" in w for w in body["warnings"])

    # The row-level extras_json carries the raw header verbatim.
    assessment = (
        db_session.query(ArtAssessment).filter_by(id=body["assessment_id"]).one()
    )
    assert assessment.rows[0].extras_json.get("Vendor Comments") == "deliver by Friday"

    # And the generated output xlsx preserved the extra column at the end.
    out_file = db_session.query(models.File).filter_by(id=body["file"]["id"]).one()
    wb = load_workbook(out_file.path, read_only=True)
    try:
        ws = wb["Sheet2"]
        headers = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
        assert "Vendor Comments" in headers
        row2 = [c.value for c in next(
            ws.iter_rows(min_row=2, max_row=2)
        )]
        idx = headers.index("Vendor Comments")
        assert row2[idx] == "deliver by Friday"
    finally:
        wb.close()


# ---------------------------------------------------------------------------
# Images-only regression — behavior preserved when no xlsx is uploaded
# ---------------------------------------------------------------------------


def test_images_path_still_produces_legacy_15_column_output(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_record,
    art_folder,
):
    # Create a tiny PNG in the Art folder so the images-only path has
    # something to scan. No xlsx is registered, so the dispatcher must fall
    # through to the legacy path.
    from PIL import Image

    img_path = art_folder / "Figure1.1.png"
    Image.new("RGB", (100, 80), color=(255, 0, 0)).save(img_path, dpi=(300, 300))

    rec = models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename="Figure1.1.png",
        file_type="png",
        category="Art",
        path=str(img_path),
        version=1,
        is_original=True,
    )
    db_session.add(rec)
    db_session.commit()

    client = auth_cookie_client(admin_user)
    resp = client.post(_gen_url(project_record.id, chapter_record.id))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Dispatcher chose the images path.
    assert body["source"] == "images"
    assert body["figures_included"] == 1
    assert body["assessment_id"] is None  # Excel-path only
    assert body["parsed_row_count"] == 0

    # Output xlsx has the legacy 15-column header, unchanged.
    out_file = db_session.query(models.File).filter_by(id=body["file"]["id"]).one()
    wb = load_workbook(out_file.path, read_only=True)
    try:
        ws = wb.active
        headers = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
        assert headers == [
            "ART NAME",
            "FIGURE NO.",
            "PART NO.",
            "TYPE",
            "ART CLASSIFICATION",
            "SUPPLIED IMAGE COLOR",
            "SUPPLIED IMAGE MODE",
            "SUPPLIED IMAGE TYPE",
            "SUPPLIED SIZE",
            "FINAL SIZE",
            "SPECIAL INSTRUCTION ",  # trailing space is intentional
            "FINAL ART COLOR",
            "COMPLEXITY",
            "RESOLUTION (HALFTONE ONLY)",
            "STATUS",
        ]
        # Images-only path still coerces color into the 5-bucket set — that's
        # the pre-Phase-4 behavior we're preserving. RGB is correct here.
        first_data_row = [c.value for c in next(ws.iter_rows(min_row=2, max_row=2))]
        assert first_data_row[5] == "RGB"      # SUPPLIED IMAGE COLOR
        assert first_data_row[6] == "RGB"      # SUPPLIED IMAGE MODE
    finally:
        wb.close()

    # No ArtAssessment row was created on the images path.
    assert db_session.query(ArtAssessment).count() == 0


# ---------------------------------------------------------------------------
# Multi-xlsx error path
# ---------------------------------------------------------------------------


def test_multiple_uploaded_xlsx_returns_pick_one_error(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_record,
    art_folder,
):
    _register_uploaded_xlsx(
        db_session, project_record, chapter_record, art_folder, "lancaster_190294.xlsx"
    )
    # Copy under a different filename so both are registered.
    other = art_folder / "pathak_190442.xlsx"
    shutil.copy(FIXTURE_DIR / "pathak_190442.xlsx", other)
    db_session.add(models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename="pathak_190442.xlsx",
        file_type="xlsx",
        category="Art",
        path=str(other),
        version=1,
        is_original=True,
    ))
    db_session.commit()

    client = auth_cookie_client(admin_user)
    resp = client.post(_gen_url(project_record.id, chapter_record.id))
    assert resp.status_code == 400
    assert "Pass file_id" in resp.json()["message"]
    assert resp.json()["code"] == "FIGURE_ASSESSMENT_FAILED"

    # ...but when the user picks one via file_id the Excel path runs cleanly.
    picked = (
        db_session.query(models.File)
        .filter_by(filename="pathak_190442.xlsx")
        .one()
    )
    resp2 = client.post(
        _gen_url(project_record.id, chapter_record.id),
        params={"file_id": picked.id},
    )
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["source"] == "excel"
    assert resp2.json()["parsed_row_count"] == 3


# ---------------------------------------------------------------------------
# System-generated xlsx must not be treated as a client upload
# ---------------------------------------------------------------------------


def test_previously_generated_output_is_not_treated_as_source(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_record,
    art_folder,
):
    """Register a File row that *looks* like a previously generated output
    (is_original=False, filename ending with _ArtAssessment.xlsx). The
    dispatcher must skip it when auto-selecting a client Excel."""
    stale = art_folder / "old_run_ArtAssessment.xlsx"
    wb = Workbook()
    wb.active.append(["ART NAME", "FIGURE NO."])
    wb.save(stale)
    wb.close()

    db_session.add(models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename="old_run_ArtAssessment.xlsx",
        file_type="xlsx",
        category="Art",
        path=str(stale),
        version=1,
        is_original=False,  # generator writes False
    ))
    db_session.commit()

    client = auth_cookie_client(admin_user)
    # Chapter has no real images either → images path should error with the
    # "No Art Assessment source found" message (proving the dispatcher did
    # NOT select the stale output as a client xlsx and fell through to the
    # images-only path, which then had nothing to scan).
    resp = client.post(_gen_url(project_record.id, chapter_record.id))
    assert resp.status_code == 400
    assert resp.json()["code"] == "FIGURE_ASSESSMENT_EMPTY"
    assert "No Art Assessment source found" in resp.json()["message"]


# ---------------------------------------------------------------------------
# source_file_id pointing at an xlsx triggers Excel path
# ---------------------------------------------------------------------------


def test_source_file_id_pointing_at_xlsx_uses_excel_path(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_record,
    art_folder,
):
    rec = _register_uploaded_xlsx(
        db_session, project_record, chapter_record, art_folder, "lancaster_190294.xlsx"
    )
    client = auth_cookie_client(admin_user)
    resp = client.post(
        _gen_url(project_record.id, chapter_record.id),
        params={"file_id": rec.id},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["source"] == "excel"
    assert resp.json()["parsed_row_count"] == 201


# ---------------------------------------------------------------------------
# F1 — Excel wins even when the user clicks an image row
# ---------------------------------------------------------------------------


def test_f1_excel_wins_over_selected_image_row(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_record,
    art_folder,
):
    """User uploads Pathak xlsx + an image, clicks Generate with the image
    selected (file_id = image.id). Backend must still run the Excel path
    and preserve all 3 Pathak rows — not fall back to a single-image output."""
    from PIL import Image

    # Upload the assessment xlsx.
    _register_uploaded_xlsx(
        db_session, project_record, chapter_record, art_folder, "pathak_190442.xlsx"
    )

    # Upload a dummy image whose filename intentionally doesn't match any
    # Pathak figure (so it's "unmatched" — F2 territory, but still should not
    # suppress the Excel source).
    img_path = art_folder / "random_photo.png"
    Image.new("RGB", (50, 50), color=(0, 128, 255)).save(img_path, dpi=(72, 72))
    img_rec = models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename="random_photo.png",
        file_type="png",
        category="Art",
        path=str(img_path),
        version=1,
        is_original=True,
    )
    db_session.add(img_rec)
    db_session.commit()
    db_session.refresh(img_rec)

    client = auth_cookie_client(admin_user)
    # Simulate "user clicked the image row and hit Generate".
    resp = client.post(
        _gen_url(project_record.id, chapter_record.id),
        params={"file_id": img_rec.id},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Excel path ran — NOT the single-image legacy path.
    assert body["source"] == "excel"
    assert body["parsed_row_count"] == 3  # all three Pathak rows preserved
    # Assessment persisted correctly.
    assessment = (
        db_session.query(ArtAssessment).filter_by(id=body["assessment_id"]).one()
    )
    assert assessment.source_mode == "excel"
    figure_nos = {r.figure_no for r in assessment.rows if r.figure_no}
    assert "Figure 2.1" in figure_nos
    assert "Figure 2.2" in figure_nos
    assert "Ankit Pathak Author Photo" in figure_nos


# ---------------------------------------------------------------------------
# F2 — Unmatched images become their own rows
# ---------------------------------------------------------------------------


def test_f2_unmatched_images_appear_as_separate_rows(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_record,
    art_folder,
):
    """Pathak xlsx + 1 image whose name does NOT match any Excel row → output
    must contain 3 Excel rows (match_status NULL) + 1 synthetic row
    (match_status='unmatched') with the image's metadata."""
    from PIL import Image

    _register_uploaded_xlsx(
        db_session, project_record, chapter_record, art_folder, "pathak_190442.xlsx"
    )

    img_path = art_folder / "mystery_photo.png"
    Image.new("RGB", (60, 40), color=(10, 20, 30)).save(img_path, dpi=(150, 150))
    db_session.add(models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename="mystery_photo.png",
        file_type="png",
        category="Art",
        path=str(img_path),
        version=1,
        is_original=True,
    ))
    db_session.commit()

    client = auth_cookie_client(admin_user)
    resp = client.post(_gen_url(project_record.id, chapter_record.id))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["source"] == "excel"
    assert body["parsed_row_count"] == 3  # Excel rows only, as before
    # figures_included now includes the synthetic unmatched image row.
    assert body["figures_included"] == 4

    assessment = (
        db_session.query(ArtAssessment).filter_by(id=body["assessment_id"]).one()
    )
    excel_rows = [r for r in assessment.rows if r.match_status is None]
    unmatched_rows = [r for r in assessment.rows if r.match_status == "unmatched"]
    assert len(excel_rows) == 3
    assert len(unmatched_rows) == 1

    # The synthetic row carries the image's metadata and no canonical values.
    unmatched = unmatched_rows[0]
    assert unmatched.figure_no is None
    assert unmatched.output_color is None
    assert unmatched.image_meta_json is not None
    assert unmatched.image_meta_json["filename"] == "mystery_photo.png"

    # Output xlsx mirrors this: 3 Excel rows then 1 "unmatched" row.
    out_file = db_session.query(models.File).filter_by(id=body["file"]["id"]).one()
    wb = load_workbook(out_file.path, read_only=True)
    try:
        ws = wb["de Bruin_190366"]
        header_row = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
        assert "Match Status" in header_row, header_row
        match_idx = header_row.index("Match Status")
        data_rows = [
            [c.value for c in row]
            for row in ws.iter_rows(min_row=2, max_row=ws.max_row)
        ]
        assert len(data_rows) == 4
        statuses = [r[match_idx] for r in data_rows]
        # Last row is the unmatched one.
        assert statuses[-1] == "unmatched"
        # And client-column cells on the unmatched row are empty.
        chapter_idx = header_row.index("Chapter Name")
        figure_idx = header_row.index("Figure No.")
        assert data_rows[-1][chapter_idx] in (None, "")
        assert data_rows[-1][figure_idx] in (None, "")
    finally:
        wb.close()


def test_f2_no_unmatched_column_when_all_images_match(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_record,
    art_folder,
):
    """If there are no unmatched images, the output must stay unchanged from
    the pre-F2 shape (no spurious empty "unmatched" rows). This protects
    against regressing clean Pathak/Lancaster/Murphy outputs."""
    _register_uploaded_xlsx(
        db_session, project_record, chapter_record, art_folder, "pathak_190442.xlsx"
    )
    # No images uploaded → no enrichment attempted → no "unmatched" rows.
    client = auth_cookie_client(admin_user)
    resp = client.post(_gen_url(project_record.id, chapter_record.id))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["parsed_row_count"] == 3
    assert body["figures_included"] == 3

    assessment = (
        db_session.query(ArtAssessment).filter_by(id=body["assessment_id"]).one()
    )
    assert all(r.match_status is None for r in assessment.rows)
    assert len(assessment.rows) == 3

    out_file = db_session.query(models.File).filter_by(id=body["file"]["id"]).one()
    wb = load_workbook(out_file.path, read_only=True)
    try:
        ws = wb["de Bruin_190366"]
        header_row = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
        # No image enrichment columns either — nothing to enrich from.
        assert "Match Status" not in header_row
        assert "Supplied File" not in header_row
    finally:
        wb.close()
