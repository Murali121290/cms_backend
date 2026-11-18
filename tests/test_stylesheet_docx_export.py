"""S4C Editorial Style Sheet (.docx) export built from the stylesheet.json payload."""
from __future__ import annotations

import io
import re

import docx
import pytest

from app.domains.projects.models import Project
from app.processing.manuscript_core.rules.presets.springer import get_springer_preset
from app.services import stylesheet_docx_export as exp
from app.services import stylesheet_service as svc

PROJECT = {"project_code": "RT-01", "project_title": "Evaluation of Quality in Health Care", "client_name":
           "Springer Publishing Company", "edition": "4th", "isbn_no": "9780826100443", "category": "Book",
           "copyediting_level": "Level 2"}


def _springer_payload() -> dict:
    preset = get_springer_preset()
    return {"id": 7, "name": preset["name"], "description": preset["description"], "is_active": True,
            "updated_at": "2026-11-18T10:00:00Z", "format": "cms-stylesheet/1", "content_hash": "abc123def4567890",
            "ce_rules": preset["ce_rules"], "style_profile": preset["style_profile"],
            "selected_ia_rows": preset["selected_ia_rows"]}


def _open(content: bytes):
    return docx.Document(io.BytesIO(content))


def _all_text(d) -> str:
    parts = [p.text for p in d.paragraphs]
    for t in d.tables:
        for row in t.rows:
            parts += [c.text for c in row.cells]
    return "\n".join(parts)


def test_springer_style_sheet_layout():
    d = _open(exp.build_style_sheet_docx(_springer_payload(), PROJECT))
    assert d.core_properties.title == "S4C EDITORIAL STYLESHEET"

    # Logo then title at the top of page 1
    first = d.paragraphs[0]
    assert first._p.xpath(".//pic:pic"), "logo picture missing on page 1"
    assert d.paragraphs[1].text == "S4C EDITORIAL STYLESHEET"

    # Running header (pages 2+) carries the logo, the title and the project code
    header = d.sections[0].header.paragraphs[0]
    assert header._p.xpath(".//pic:pic") and "S4C EDITORIAL STYLESHEET" in header.text and "RT-01" in header.text
    footer = d.sections[0].footer.paragraphs[0].text
    assert "stylesheet #7" in footer and "abc123def456" in footer

    text = _all_text(d)
    assert "Springer Publishing Company" in text and "9780826100443" in text and "4th" in text
    assert "Corrected forms".upper() not in text.upper() and "Rules not applied" not in text

    # Rule tables: four columns; R6 shows 25%
    rule_tables = [t for t in d.tables if t.rows and [c.text for c in t.rows[0].cells] == ["RULE", "TOPIC", "HOUSE STYLE", "HANDLING"]]
    assert rule_tables and all(len(t.columns) == 4 for t in rule_tables)
    r6 = next(r for t in rule_tables for r in t.rows if r.cells[0].text == "R6")
    assert "25%" in r6.cells[2].text
    # R1 is switched off in the Springer preset: it appears nowhere
    assert not any(r.cells[0].text == "R1" for t in rule_tables for r in t.rows)

    # Sections numbered 1, 2, 3 ... without gaps
    nums = [int(m.group(1)) for p in d.paragraphs if (m := re.match(r"^(\d+)\s{2}\S", p.text))]
    assert nums == list(range(1, len(nums) + 1)) and len(nums) >= 6

    assert "comorbidity" in text and "co-morbidity" in text
    assert "PhD" in text and "NCLEX" in text


def test_empty_profile_leaves_out_list_sections():
    payload = {"id": 3, "name": "Plain", "ce_rules": {"6": {"option": 1}}, "style_profile": {}, "selected_ia_rows": []}
    d = _open(exp.build_style_sheet_docx(payload, {}))
    headings = [p.text for p in d.paragraphs if re.match(r"^\d+\s{2}\S", p.text)]
    assert [h.split("  ", 1)[1] for h in headings] == ["House style rules", "Units and conventions", "Notes and sign-off"]


def test_missing_logo_still_exports(monkeypatch, tmp_path):
    monkeypatch.setattr(exp, "LOGO_PATH", tmp_path / "missing.png")
    d = _open(exp.build_style_sheet_docx(_springer_payload(), PROJECT))
    assert not d.paragraphs[0]._p.xpath(".//pic:pic")
    assert any(p.text == "S4C EDITORIAL STYLESHEET" for p in d.paragraphs[:3])


@pytest.fixture()
def project(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "UPLOADS_DIR", tmp_path / "uploads")
    p = Project(project_title="Round-trip Book", project_code="RT-01", client_name="Springer Publishing Company")
    db_session.add(p)
    db_session.commit()
    return p


def _folder(tmp_path):
    return tmp_path / "uploads" / "Springer Publishing Company" / "RT-01" / "CE support" / "Style sheet template"


def test_save_writes_docx_and_delete_removes_it(db_session, project, tmp_path):
    ss = svc.create_stylesheet(db_session, project_id=project.id, name="House A", description=None,
                               selected_ia_rows=[], created_by_id=None, ce_rules={"6": {"option": 3}},
                               style_profile={"publisher": "test"})
    docx_path = _folder(tmp_path) / "House_A_Editorial_Style_Sheet.docx"
    assert docx_path.exists()
    d = docx.Document(str(docx_path))
    r6 = next(r for t in d.tables for r in t.rows if r.cells and r.cells[0].text == "R6")
    assert "25 percent" in r6.cells[2].text

    svc.delete_stylesheet(db_session, stylesheet_id=ss.id, project_id=project.id)
    assert not docx_path.exists()


def test_export_error_does_not_block_save(db_session, project, tmp_path, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("template problem")
    monkeypatch.setattr(exp, "build_style_sheet_docx", boom)
    ss = svc.create_stylesheet(db_session, project_id=project.id, name="House B", description=None,
                               selected_ia_rows=[], created_by_id=None, ce_rules={}, style_profile={})
    assert ss.id and (_folder(tmp_path) / "House_B_stylesheet.json").exists()
    assert not (_folder(tmp_path) / "House_B_Editorial_Style_Sheet.docx").exists()


def test_download_endpoint(client, db_session, project, user_factory):
    ss = svc.create_stylesheet(db_session, project_id=project.id, name="House C", description=None,
                               selected_ia_rows=[], created_by_id=None, ce_rules={"6": {"option": 1}}, style_profile={})
    user_factory("ss_admin", password="Secret123!", role_names=("Admin",))
    client.post("/api/v2/session/login", json={"username": "ss_admin", "password": "Secret123!"})
    res = client.get(f"/api/v2/projects/{project.id}/stylesheets/{ss.id}/style-sheet.docx")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.wordprocessingml")
    assert "RT-01_Editorial_Style_Sheet.docx" in res.headers["content-disposition"]
    assert _open(res.content).core_properties.title == "S4C EDITORIAL STYLESHEET"
    assert client.get(f"/api/v2/projects/{project.id + 999}/stylesheets/{ss.id}/style-sheet.docx").status_code == 404
