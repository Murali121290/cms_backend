"""HTTP tests for GET /api/v2/files/{file_id}/language-edit/info — the
lightweight metadata lookup that lets the Language Editor header render the
real uploaded filename immediately on mount, without waiting for the heavy
analyze pass to finish.
"""
import pytest


@pytest.fixture()
def admin_authed_client(auth_cookie_client, admin_user):
    return auth_cookie_client(admin_user)


def test_info_endpoint_returns_actual_uploaded_filename(
    admin_authed_client, file_record_factory
):
    """Header must receive the exact filename the manuscript was uploaded as
    (including extension), not a project-number string or a generic label."""
    rec, _ = file_record_factory(filename="MedSpl800.docx")

    resp = admin_authed_client.get(f"/api/v2/files/{rec.id}/language-edit/info")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["file_name"] == "MedSpl800.docx"
    assert body["file_id"] == rec.id
    # Project / chapter ids are returned separately so the UI can still render
    # a breadcrumb — but the title field itself is the real filename.
    assert body["project_id"] == rec.project_id
    assert body["chapter_id"] == rec.chapter_id


def test_info_endpoint_distinguishes_between_files(
    admin_authed_client, file_record_factory
):
    """Switching between documents must return each file's own name — a
    cached / shared value would leak the first file's title onto the second."""
    rec_a, _ = file_record_factory(filename="ChapterA.docx")
    rec_b, _ = file_record_factory(filename="ChapterB.docx")

    body_a = admin_authed_client.get(
        f"/api/v2/files/{rec_a.id}/language-edit/info"
    ).json()
    body_b = admin_authed_client.get(
        f"/api/v2/files/{rec_b.id}/language-edit/info"
    ).json()
    assert body_a["file_name"] == "ChapterA.docx"
    assert body_b["file_name"] == "ChapterB.docx"
    assert body_a["file_id"] != body_b["file_id"]


def test_info_endpoint_404_on_missing_file(admin_authed_client):
    """Missing file metadata is reported cleanly instead of breaking the editor."""
    resp = admin_authed_client.get("/api/v2/files/999999/language-edit/info")
    assert resp.status_code == 404


def test_info_endpoint_requires_auth(client):
    """Unauthenticated callers must not read file metadata."""
    resp = client.get("/api/v2/files/1/language-edit/info")
    # 401 (no cookie) or 403 (cookie but no role) — never 200.
    assert resp.status_code in (401, 403)
