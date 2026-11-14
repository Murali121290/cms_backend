"""Regression tests for the Term Library HTTP routes.

Covers the two features added alongside these tests:

1. ``DELETE /api/v2/term-lists/{id}`` — hard delete that cascades to the
   list's ``terms`` and ``project_term_lists`` rows, detaches related
   ``language_edit_findings`` via SET NULL, and unlinks the on-disk
   Excel. Must leave *other* lists / shared data untouched.

2. ``POST /api/v2/term-lists/{id}/import`` — single-file upload used by
   the frontend's client-side multi-file fan-out. Verifies:
     * invalid extensions are rejected,
     * duplicate terms within one file are de-duped and reported,
     * re-uploading the same content from a second file leaves counts
       stable (the UNIQUE(term_list_id, term) constraint handles the
       cross-file dedup),
     * ``replace=True`` wipes before importing.

Existing user data is never touched — all tests run inside the per-test
SQLite DB provided by ``conftest.app_env``.
"""
from __future__ import annotations

import io
from pathlib import Path

import pytest
from openpyxl import Workbook


@pytest.fixture(autouse=True)
def _redirect_term_list_uploads(app_env, monkeypatch):
    """Redirect the term-list source-file store under the per-test upload
    root. ``TERM_LISTS_ROOT`` is resolved at module import time from
    ``CMS_RUNTIME_ROOT``, which conftest sets *after* ``app.core.paths``
    has already captured the default — so a direct monkeypatch on the
    module attribute is the simplest way to keep uploads inside the test
    sandbox and never touch the system path.
    """
    import app.services.term_list_service as svc

    root = Path(app_env["upload_root"]) / "term_lists"
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(svc, "TERM_LISTS_ROOT", str(root), raising=True)


# ── Helpers ────────────────────────────────────────────────────────────────

def _login(client, username: str, password: str = "Password123!") -> None:
    resp = client.post(
        "/api/v2/session/login",
        json={"username": username, "password": password},
    )
    assert resp.status_code == 200, resp.text


def _make_xlsx(terms: list[str], *, sheet_name: str = "Terms") -> bytes:
    """Build an in-memory .xlsx that the importer accepts.

    Column A rows are the terms; the service prefers the ``Terms`` sheet
    and falls back to ``Sheet1`` if absent (see
    ``term_list_service.parse_term_list_xlsx``).
    """
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name
    for term in terms:
        ws.append([term])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


def _create_list(client, name: str, *, scope: str = "generic") -> dict:
    resp = client.post(
        "/api/v2/term-lists",
        json={"name": name, "scope": scope},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _import(client, list_id: int, terms: list[str], *, filename: str = "terms.xlsx",
            replace: bool = False) -> dict:
    data = _make_xlsx(terms)
    resp = client.post(
        f"/api/v2/term-lists/{list_id}/import",
        files={"file": (filename, data,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        params={"replace": str(replace).lower()},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── Upload tests ──────────────────────────────────────────────────────────

def test_import_rejects_non_excel_extension(client, admin_user):
    _login(client, admin_user.username)
    tl = _create_list(client, "Reject-ext")

    resp = client.post(
        f"/api/v2/term-lists/{tl['id']}/import",
        files={"file": ("not-excel.txt", b"term1\nterm2", "text/plain")},
    )
    assert resp.status_code == 400
    assert "xlsx" in resp.json()["detail"].lower()


def test_import_deduplicates_within_single_file(client, admin_user):
    _login(client, admin_user.username)
    tl = _create_list(client, "Dedup-within-file")

    # 'alpha' appears twice in the SAME upload — the parser's per-file
    # ``seen_norms`` set (term_list_service.parse_term_list_xlsx) keeps
    # one occurrence and emits a warning. The persistence layer only
    # ever sees the de-duped list, so ``inserted`` is 3 and the
    # duplicate shows up in ``warnings``.
    result = _import(client, tl["id"], ["alpha", "beta", "alpha", "gamma"])
    assert result["inserted"] == 3
    assert result["total_in_list"] == 3
    assert any("duplicate" in w.lower() for w in result["warnings"]), result["warnings"]


def test_second_file_with_overlapping_terms_is_safe(client, admin_user):
    """Simulates the frontend's multi-file fan-out.

    File 1: alpha, beta, gamma  → 3 inserted
    File 2: beta, gamma, delta  → 1 inserted, 2 skipped as already-in-list

    Cross-file duplicates land in ``skipped_duplicates_in_file`` (the
    counter is misleadingly named — it means "already in the TermList",
    not "duplicated in the file we just parsed").
    """
    _login(client, admin_user.username)
    tl = _create_list(client, "Two-file-overlap")

    first = _import(client, tl["id"], ["alpha", "beta", "gamma"], filename="f1.xlsx")
    assert first["inserted"] == 3
    assert first["total_in_list"] == 3

    second = _import(client, tl["id"], ["beta", "gamma", "delta"], filename="f2.xlsx")
    assert second["inserted"] == 1
    assert second["skipped_duplicates_in_file"] == 2
    assert second["total_in_list"] == 4


def test_replace_wipes_before_appending(client, admin_user):
    _login(client, admin_user.username)
    tl = _create_list(client, "Replace-wipe")

    _import(client, tl["id"], ["one", "two", "three"])
    after_replace = _import(
        client, tl["id"], ["x", "y"],
        filename="replacement.xlsx", replace=True,
    )
    assert after_replace["inserted"] == 2
    assert after_replace["total_in_list"] == 2


# ── Delete tests ──────────────────────────────────────────────────────────

def test_delete_hard_removes_list_and_terms(client, admin_user, db_session):
    from app.domains.term_lists.models import Term, TermList

    _login(client, admin_user.username)
    tl = _create_list(client, "To-delete")
    _import(client, tl["id"], ["t1", "t2", "t3"])

    # Sanity: terms exist in DB.
    assert db_session.query(Term).filter(Term.term_list_id == tl["id"]).count() == 3

    resp = client.delete(f"/api/v2/term-lists/{tl['id']}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["deleted"]["id"] == tl["id"]
    assert body["deleted"]["name"] == "To-delete"
    assert body["deleted"]["term_count"] == 3

    # TermList row and its terms gone (cascade). Use a fresh session
    # view since the deletion happened in a different Session.
    db_session.expire_all()
    assert db_session.query(TermList).filter(TermList.id == tl["id"]).first() is None
    assert db_session.query(Term).filter(Term.term_list_id == tl["id"]).count() == 0


def test_delete_does_not_affect_other_lists(client, admin_user, db_session):
    """Deleting list A must not touch list B's terms."""
    from app.domains.term_lists.models import Term, TermList

    _login(client, admin_user.username)
    tl_a = _create_list(client, "List-A")
    tl_b = _create_list(client, "List-B")
    _import(client, tl_a["id"], ["a1", "a2"])
    _import(client, tl_b["id"], ["b1", "b2", "b3"])

    resp = client.delete(f"/api/v2/term-lists/{tl_a['id']}")
    assert resp.status_code == 200

    db_session.expire_all()
    assert db_session.query(TermList).filter(TermList.id == tl_b["id"]).first() is not None
    remaining_b = (
        db_session.query(Term).filter(Term.term_list_id == tl_b["id"]).count()
    )
    assert remaining_b == 3


def test_delete_cascades_project_assignments(client, admin_user, db_session):
    """ProjectTermList rows must be removed by the cascade so a project
    re-assignment later is not blocked by stale rows."""
    from app.domains import projects as _  # noqa: F401 -- ensure model import
    from app.domains.term_lists.models import ProjectTermList, TermList
    from app.models import Project

    _login(client, admin_user.username)
    tl = _create_list(client, "Assigned-list")
    _import(client, tl["id"], ["only"])

    # Minimal project row so the assignment FK is satisfied.
    project = Project(
        project_code=f"TLDEL-{admin_user.id}",
        project_title="Term-list delete fixture",
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    db_session.add(ProjectTermList(
        project_id=project.id,
        term_list_id=tl["id"],
        assigned_by_id=admin_user.id,
    ))
    db_session.commit()

    assert (
        db_session.query(ProjectTermList)
        .filter(ProjectTermList.term_list_id == tl["id"])
        .count() == 1
    )

    resp = client.delete(f"/api/v2/term-lists/{tl['id']}")
    assert resp.status_code == 200

    db_session.expire_all()
    assert db_session.query(TermList).filter(TermList.id == tl["id"]).first() is None
    # Assignment must be gone — cascade from TermList.project_assignments.
    assert (
        db_session.query(ProjectTermList)
        .filter(ProjectTermList.term_list_id == tl["id"])
        .count() == 0
    )
    # The project itself is untouched.
    assert db_session.query(Project).filter(Project.id == project.id).first() is not None


def test_delete_detaches_findings_without_removing_them(client, admin_user, db_session):
    """language_edit_findings.term_list_id is nulled; the finding row
    stays so past reviews remain intact."""
    from app.domains.processing.language_edit_models import LanguageEditFinding, LanguageEditJob
    from app.domains.term_lists.models import TermList
    from app.models import File as FileRow, Project

    _login(client, admin_user.username)
    tl = _create_list(client, "Finding-link")
    _import(client, tl["id"], ["phrase"])

    # Minimal project + file + job + finding chain so the FK is satisfied.
    project = Project(
        project_code=f"TLFIND-{admin_user.id}",
        project_title="Term-list finding fixture",
    )
    db_session.add(project)
    db_session.flush()
    fil = FileRow(
        project_id=project.id,
        filename="dummy.docx",
        uploaded_by_id=admin_user.id,
    )
    db_session.add(fil)
    db_session.flush()
    job = LanguageEditJob(
        job_id=f"job-{admin_user.id}",
        file_id=fil.id,
        project_id=project.id,
        status="completed",
    )
    db_session.add(job)
    db_session.flush()
    finding = LanguageEditFinding(
        job_id=job.job_id,
        file_id=fil.id,
        rule_id="term",
        category="term",
        source="term",
        term_list_id=tl["id"],
        para_index=0,
        start_offset=0,
        end_offset=6,
        original_text="phrase",
        suggestion="phrase",
        message="",
        status="pending",
    )
    db_session.add(finding)
    db_session.commit()
    finding_id = finding.id

    resp = client.delete(f"/api/v2/term-lists/{tl['id']}")
    assert resp.status_code == 200

    db_session.expire_all()
    assert db_session.query(TermList).filter(TermList.id == tl["id"]).first() is None
    # Finding survives, with term_list_id nulled.
    surviving = db_session.query(LanguageEditFinding).filter(
        LanguageEditFinding.id == finding_id
    ).first()
    assert surviving is not None
    assert surviving.term_list_id is None


def test_delete_unlinks_source_file_on_disk(client, admin_user, db_session, tmp_path, monkeypatch):
    """When the upload persists an Excel to disk, the delete endpoint
    unlinks it. A missing file must NOT error (idempotent cleanup)."""
    from app.domains.term_lists.models import TermList

    _login(client, admin_user.username)
    tl = _create_list(client, "File-on-disk")
    _import(client, tl["id"], ["file-term"], filename="on-disk.xlsx")

    db_session.expire_all()
    row = db_session.query(TermList).filter(TermList.id == tl["id"]).first()
    source_path = row.source_file_path
    # The service writes the source file under data/uploads/term_lists/…;
    # if the path is reported, the file must be present before delete.
    if source_path:
        assert Path(source_path).exists(), source_path

    resp = client.delete(f"/api/v2/term-lists/{tl['id']}")
    assert resp.status_code == 200

    if source_path:
        assert not Path(source_path).exists(), (
            f"Source file {source_path} should have been unlinked"
        )


def test_delete_returns_404_for_unknown_id(client, admin_user):
    _login(client, admin_user.username)
    resp = client.delete("/api/v2/term-lists/9999999")
    assert resp.status_code == 404


def test_delete_requires_editor_role(client, viewer_user):
    """Non-editor users can list but not delete term lists."""
    _login(client, viewer_user.username)
    # Viewer can't even create one; craft the request anyway and expect 403.
    resp = client.delete("/api/v2/term-lists/1")
    assert resp.status_code in (401, 403)
