"""Integration tests for POST /parse-assessment-excel.

Each client fixture is mounted via ``file_record_factory`` into a per-test
chapter and parsed through the HTTP layer. The response must match the
parser's direct output byte-for-byte so this endpoint stays a thin wrapper.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "art_assessment"


@pytest.fixture()
def xlsx_file_factory(
    db_session,
    temp_upload_root: Path,
    project_record,
    chapter_record,
):
    """Copy an xlsx fixture into the test upload root and register a File row.

    Returns ``(project, chapter, file_record)``. The file lives under the
    chapter's Art folder so it mirrors what the production upload path writes.
    """
    from app import models

    def _create(fixture_name: str) -> tuple:
        source = FIXTURE_DIR / fixture_name
        assert source.exists(), f"missing fixture {source}"
        target_dir = (
            temp_upload_root
            / project_record.code
            / chapter_record.number
            / "Art"
        )
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / fixture_name
        shutil.copy(source, target)

        record = models.File(
            project_id=project_record.id,
            chapter_id=chapter_record.id,
            filename=fixture_name,
            file_type="xlsx",
            category="Art",
            path=str(target),
            version=1,
            is_original=True,
        )
        db_session.add(record)
        db_session.commit()
        db_session.refresh(record)
        return project_record, chapter_record, record

    return _create


def _parse_url(project_id: int, chapter_id: int) -> str:
    return (
        f"/api/v2/projects/{project_id}/chapters/{chapter_id}/parse-assessment-excel"
    )


# ---------------------------------------------------------------------------
# Lancaster
# ---------------------------------------------------------------------------


def test_parse_lancaster(auth_cookie_client, admin_user, xlsx_file_factory):
    project, chapter, file_rec = xlsx_file_factory("lancaster_190294.xlsx")
    client = auth_cookie_client(admin_user)

    resp = client.post(
        _parse_url(project.id, chapter.id),
        params={"file_id": file_rec.id},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ok"
    assert body["file_id"] == file_rec.id
    assert body["filename"] == "lancaster_190294.xlsx"
    assert body["project_info_sheet"] == "PROJECT INFO"
    assert body["data_sheet_name"] == "Sheet2"
    assert body["header_row_index"] == 1
    assert body["unmapped_columns"] == []
    assert len(body["rows"]) == 201

    # Verbatim color preservation — the real requirement.
    colors = {
        r["canonical"].get("output_color")
        for r in body["rows"]
        if r["canonical"].get("output_color")
    }
    assert colors == {
        "1 Color Halftone",
        "1 Color Lineart",
        "4 Color Halftone",
        "4 Color Lineart",
    }

    # Project info preserves client labels including ones with trailing spaces.
    assert body["project_info"]["Book Title"] == "Optical Document Security, Fourth Edition"
    assert "Previous Edition " in body["project_info"]


# ---------------------------------------------------------------------------
# Pathak
# ---------------------------------------------------------------------------


def test_parse_pathak(auth_cookie_client, admin_user, xlsx_file_factory):
    project, chapter, file_rec = xlsx_file_factory("pathak_190442.xlsx")
    client = auth_cookie_client(admin_user)

    resp = client.post(
        _parse_url(project.id, chapter.id),
        params={"file_id": file_rec.id},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["data_sheet_name"] == "de Bruin_190366"
    assert len(body["rows"]) == 3

    colors = {
        r["canonical"].get("output_color")
        for r in body["rows"]
        if r["canonical"].get("output_color")
    }
    # Lowercase + slash spellings must survive the HTTP round-trip.
    assert "1 color Lineart" in colors
    assert "b/w halftone" in colors


# ---------------------------------------------------------------------------
# Murphy (richest format)
# ---------------------------------------------------------------------------


def test_parse_murphy(auth_cookie_client, admin_user, xlsx_file_factory):
    project, chapter, file_rec = xlsx_file_factory("murphy_7e_189382.xlsx")
    client = auth_cookie_client(admin_user)

    resp = client.post(
        _parse_url(project.id, chapter.id),
        params={"file_id": file_rec.id},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Murphy has no project-info sheet.
    assert body["project_info_sheet"] is None
    assert body["project_info"] == {}
    assert body["data_sheet_name"] == "_Art assessment"
    # 22 trailing blank-header columns must be dropped, not kept as unmapped.
    assert body["unmapped_columns"] == []
    assert len(body["rows"]) == 312

    # Client-typo column alias resolved.
    assert body["canonical_columns"]["query_replies"] == "Querie replies"

    first = body["rows"][0]
    assert first["canonical"]["chapter_label"] == "Chapter 01"
    assert first["canonical"]["figure_no"] == "Murphy_F01-01"
    assert first["canonical"]["art_name"] == "Figure 1.1.png"
    assert first["canonical"]["output_color"] == "4 Color Halftone"
    assert first["canonical"]["batch_no"] == "Batch 1"

    # Typo value preserved verbatim.
    assert any(
        r["canonical"].get("output_color") == "1 Color Linetone"
        for r in body["rows"]
    )


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


def test_auth_required(client, xlsx_file_factory):
    project, chapter, file_rec = xlsx_file_factory("lancaster_190294.xlsx")
    resp = client.post(
        _parse_url(project.id, chapter.id),
        params={"file_id": file_rec.id},
    )
    assert resp.status_code == 401
    assert resp.json()["code"] == "AUTH_REQUIRED"


def test_file_not_in_chapter(auth_cookie_client, admin_user, xlsx_file_factory):
    project, chapter, _ = xlsx_file_factory("lancaster_190294.xlsx")
    client = auth_cookie_client(admin_user)
    resp = client.post(
        _parse_url(project.id, chapter.id),
        params={"file_id": 99999},
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "FILE_NOT_FOUND"


def test_rejects_non_xlsx(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
    project_record,
    chapter_record,
):
    from app import models

    # Register a non-xlsx file in the chapter.
    target_dir = (
        temp_upload_root / project_record.code / chapter_record.number / "Art"
    )
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / "notes.txt"
    target.write_text("not a workbook")
    record = models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename="notes.txt",
        file_type="txt",
        category="Art",
        path=str(target),
        version=1,
        is_original=True,
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    client = auth_cookie_client(admin_user)
    resp = client.post(
        _parse_url(project_record.id, chapter_record.id),
        params={"file_id": record.id},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "ASSESSMENT_PARSE_INVALID_FORMAT"


def test_rejects_workbook_without_recognizable_headers(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
    project_record,
    chapter_record,
):
    from app import models
    from openpyxl import Workbook

    target_dir = (
        temp_upload_root / project_record.code / chapter_record.number / "Art"
    )
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / "garbage.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.append(["random", "stuff", "here"])
    ws.append(["a", "b", "c"])
    wb.save(target)
    wb.close()

    record = models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename="garbage.xlsx",
        file_type="xlsx",
        category="Art",
        path=str(target),
        version=1,
        is_original=True,
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    client = auth_cookie_client(admin_user)
    resp = client.post(
        _parse_url(project_record.id, chapter_record.id),
        params={"file_id": record.id},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "ASSESSMENT_PARSE_FAILED"
    assert "No recognizable" in resp.json()["message"]


def test_missing_file_on_disk(
    auth_cookie_client,
    admin_user,
    xlsx_file_factory,
):
    """DB row exists but the backing file has been deleted."""
    project, chapter, file_rec = xlsx_file_factory("lancaster_190294.xlsx")
    Path(file_rec.path).unlink()

    client = auth_cookie_client(admin_user)
    resp = client.post(
        _parse_url(project.id, chapter.id),
        params={"file_id": file_rec.id},
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "FILE_NOT_ON_DISK"


def test_file_id_query_param_required(
    auth_cookie_client, admin_user, xlsx_file_factory
):
    project, chapter, _ = xlsx_file_factory("lancaster_190294.xlsx")
    client = auth_cookie_client(admin_user)
    # No file_id query parameter.
    resp = client.post(_parse_url(project.id, chapter.id))
    # FastAPI's validation returns 422 for missing required query params.
    assert resp.status_code == 422
