"""Reading edits made to the S4C Editorial Style Sheet (.docx) back into the stylesheet."""
from __future__ import annotations

import io
import json
import os

import docx
import pytest

from app.domains.projects.models import Project
from app.processing.manuscript_core.rules.presets.springer import get_springer_preset
from app.services import stylesheet_docx_export as exp
from app.services import stylesheet_docx_import as imp
from app.services import stylesheet_service as svc


def _springer_data(**over) -> dict:
    preset = get_springer_preset()
    data = {"id": 7, "name": preset["name"], "content_hash": "base-hash",
            "ce_rules": preset["ce_rules"], "style_profile": preset["style_profile"]}
    data.update(over)
    return data


def _tables(d, key):
    return [t for t in d.tables if imp._table_key(t) == key]


def _rule_row(d, rid):
    for t in _tables(d, exp.CAP_RULES):
        for row in t.rows[1:]:
            if row.cells[0].text == rid:
                return t, row
    raise AssertionError(f"{rid} not in the .docx")


def _save(d) -> bytes:
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def _set_cell(cell, *lines):
    for p in list(cell.paragraphs)[1:]:
        p._p.getparent().remove(p._p)
    cell.paragraphs[0].text = lines[0]
    for line in lines[1:]:
        cell.add_paragraph(line)


@pytest.fixture(scope="module")
def exported():
    data = _springer_data()
    return data, exp.build_style_sheet_docx(data, {})


def test_export_carries_markers(exported):
    _data, content = exported
    d = docx.Document(io.BytesIO(content))
    assert d.core_properties.identifier == "s4c-stylesheet:7"
    assert d.core_properties.version == "base-hash"
    assert _tables(d, exp.CAP_RULES) and _tables(d, exp.CAP_WORDS) and _tables(d, exp.CAP_ACRONYMS)
    parsed = imp.parse_style_sheet_docx(content)
    assert parsed.is_s4c and parsed.snapshot["content_hash"] == "base-hash"


def test_unedited_docx_has_no_changes(exported):
    data, content = exported
    result = imp.preview_docx_changes(content, data)
    assert result["changes"] == [] and result["warnings"] == [] and not result["stale"]


def test_rule_option_change_delete_and_lists(exported):
    data, content = exported
    d = docx.Document(io.BytesIO(content))
    _, r6 = _rule_row(d, "R6")
    _set_cell(r6.cells[2], "25 percent", r6.cells[2].paragraphs[1].text)  # only the example edited
    t2, r2 = _rule_row(d, "R2")
    t2._tbl.remove(r2._tr)
    words = _tables(d, exp.CAP_WORDS)[0].add_row()
    words.cells[0].text, words.cells[1].text = "health care", "healthcare"
    acr = _tables(d, exp.CAP_ACRONYMS)[0].rows[0].cells[0].paragraphs[0]
    acr.runs[0].text = acr.runs[0].text.replace("NCLEX", "").strip() + "   ZZQ"

    result = imp.preview_docx_changes(_save(d), data)
    by_id = {c["id"]: c for c in result["changes"]}
    assert by_id["rule:6"]["kind"] == "changed" and by_id["rule:6"]["after"] == "25 percent"
    assert by_id["rule:2"]["kind"] == "disabled" and by_id["rule:2"]["default_selected"] is False
    assert by_id["word_replacements:add:healthcare"]["kind"] == "added"
    assert by_id["acronyms_no_spellout:add:zzq"]["kind"] == "added"
    assert by_id["acronyms_no_spellout:remove:nclex"]["kind"] == "removed"

    ce, profile, applied = imp.apply_docx_changes(data, result["changes"], list(by_id))
    assert ce["6"]["option"] != data["ce_rules"].get("6", {}).get("option", 1) and ce["6"]["enabled"]
    assert ce["2"]["enabled"] is False
    assert {"find": "healthcare", "replace": "health care"} in profile["word_replacements"]
    assert "ZZQ" in profile["acronyms_no_spellout"] and "NCLEX" not in profile["acronyms_no_spellout"]
    assert len(applied) == len(by_id)


def test_new_row_enables_rule_and_gibberish_needs_a_choice(exported):
    data, content = exported
    off = next(s for s, o in imp._rule_state(data).items()
               if o is None and len(imp.option_candidates(s)) >= 2 and imp.option_candidates(s)[1]["preview"])
    cand = imp.option_candidates(off)[1]
    d = docx.Document(io.BytesIO(content))
    t, r6 = _rule_row(d, "R6")
    row = t.add_row()
    row.cells[0].text = f"R{off}"
    row.cells[2].text = cand["preview"]
    _set_cell(r6.cells[2], "zz qq xx")

    result = imp.preview_docx_changes(_save(d), data)
    by_id = {c["id"]: c for c in result["changes"]}
    assert by_id[f"rule:{off}"]["kind"] == "enabled" and by_id[f"rule:{off}"]["option"] == cand["option"]
    unresolved = by_id["rule:6"]
    assert unresolved["kind"] == "unresolved" and unresolved["candidates"]

    with pytest.raises(imp.DocxImportError):
        imp.apply_docx_changes(data, result["changes"], ["rule:6"])
    ce, _, _ = imp.apply_docx_changes(data, result["changes"], ["rule:6"], {"6": 2})
    assert ce["6"]["option"] == 2


def test_stale_docx_keeps_app_changes(exported):
    data, content = exported
    # After the export, R9 and R6 are changed in the app; the .docx changes R6 too
    r9_opts = imp.option_candidates(9)
    current = dict(data, content_hash="newer", ce_rules={**data["ce_rules"],
                                                          "9": {"enabled": True, "option": len(r9_opts)},
                                                          "6": {"enabled": True, "option": 2}})
    d = docx.Document(io.BytesIO(content))
    _, r6 = _rule_row(d, "R6")
    _set_cell(r6.cells[2], "25 percent", r6.cells[2].paragraphs[1].text)
    result = imp.preview_docx_changes(_save(d), current)
    assert result["stale"] and result["snapshot"]
    ids = {c["id"]: c for c in result["changes"]}
    assert "rule:9" not in ids  # the app change to R9 is not reverted
    assert ids["rule:6"]["kind"] == "conflict" and ids["rule:6"]["default_selected"] is False


def test_handling_edit_is_a_warning_only(exported):
    data, content = exported
    d = docx.Document(io.BytesIO(content))
    _, r6 = _rule_row(d, "R6")
    r6.cells[3].paragraphs[0].runs[0].text = "Query"
    result = imp.preview_docx_changes(_save(d), data)
    assert result["changes"] == []
    assert any("R6" in w and "Handling" in w for w in result["warnings"])


def test_without_captions_or_snapshot_headers_still_work(exported):
    data, content = exported
    d = docx.Document(io.BytesIO(content))
    for t in d.tables:
        cap = t._tbl.tblPr.find(imp.qn("w:tblCaption"))
        if cap is not None:
            t._tbl.tblPr.remove(cap)
    d.core_properties.identifier = ""
    _, r6 = _rule_row(d, "R6")
    _set_cell(r6.cells[2], "25 percent", r6.cells[2].paragraphs[1].text)
    for rel in list(d.part.rels.values()):
        if rel.reltype.endswith("/customXml") and imp.exp.SNAPSHOT_NS.encode() in rel.target_part.blob:
            d.part.drop_rel(rel.rId)
    result = imp.preview_docx_changes(_save(d), data)
    assert result["format"] == "s4c" and not result["snapshot"]
    assert [c["id"] for c in result["changes"]] == ["rule:6"]


def test_customer_docx_uses_existing_parser():
    fixture = os.path.join(os.path.dirname(__file__), "fixtures", "springer_style_sheet_july2026.docx")
    with open(fixture, "rb") as f:
        content = f.read()
    data = {"id": 3, "name": "Plain", "content_hash": "x", "ce_rules": {}, "style_profile": {}}
    result = imp.preview_docx_changes(content, data)
    assert result["format"] == "customer"
    assert any(c["section"] == "rules" for c in result["changes"])
    assert any(c["section"] == "words" for c in result["changes"])


# --------------------------------------------------------------------------- service + API
@pytest.fixture()
def project(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "UPLOADS_DIR", tmp_path / "uploads")
    p = Project(project_title="Import Book", project_code="IM-01", client_name="Springer Publishing Company")
    db_session.add(p)
    db_session.commit()
    return p


def _folder(tmp_path):
    return tmp_path / "uploads" / "Springer Publishing Company" / "IM-01" / "CE support" / "Style sheet template"


def _edit_r6(content: bytes) -> bytes:
    d = docx.Document(io.BytesIO(content))
    _, r6 = _rule_row(d, "R6")
    _set_cell(r6.cells[2], "25 percent", r6.cells[2].paragraphs[1].text)
    return _save(d)


def test_pending_apply_and_dismiss(db_session, project, tmp_path):
    ss = svc.create_stylesheet(db_session, project_id=project.id, name="House A", description=None,
                               selected_ia_rows=[], created_by_id=None, ce_rules={"6": {"enabled": True, "option": 1}},
                               style_profile={})
    folder = _folder(tmp_path)
    docx_path = folder / "House_A_Editorial_Style_Sheet.docx"
    meta = json.loads((folder / "House_A_stylesheet.json").read_text(encoding="utf-8"))
    assert meta["docx_sha256"] == svc._sha256(docx_path.read_bytes())
    assert svc.docx_pending_changes(db_session, project_id=project.id) == []

    # The editor replaces the .docx in CE support with an edited copy
    docx_path.write_bytes(_edit_r6(docx_path.read_bytes()))
    pending = svc.docx_pending_changes(db_session, project_id=project.id)
    assert [(p["stylesheet_id"], p["filename"], p["change_count"]) for p in pending] == \
        [(ss.id, "House_A_Editorial_Style_Sheet.docx", 1)]

    # Dismiss: no longer pending, stylesheet unchanged
    svc.mark_docx_handled(db_session, ss, svc._sha256(docx_path.read_bytes()))
    assert svc.docx_pending_changes(db_session, project_id=project.id) == []
    assert svc.stylesheet_ce_rules(ss)["6"]["option"] == 1

    # Apply from CE support: the stylesheet and regenerated .docx carry the edit
    ss, applied = svc.apply_docx_import(db_session, ss, docx_path.read_bytes(), accepted=["rule:6"], source="ce_support")
    assert [c["id"] for c in applied] == ["rule:6"]
    assert svc.stylesheet_ce_rules(ss)["6"]["option"] == 3
    d = docx.Document(str(docx_path))
    _, r6 = _rule_row(d, "R6")
    assert r6.cells[2].paragraphs[0].text == "25 percent"
    assert svc.docx_pending_changes(db_session, project_id=project.id) == []


def test_api_preview_apply(client, db_session, project, user_factory):
    ss = svc.create_stylesheet(db_session, project_id=project.id, name="House C", description=None,
                               selected_ia_rows=[], created_by_id=None, ce_rules={"6": {"enabled": True, "option": 1}},
                               style_profile={})
    user_factory("imp_admin", password="Secret123!", role_names=("Admin",))
    client.post("/api/v2/session/login", json={"username": "imp_admin", "password": "Secret123!"})
    base = f"/api/v2/projects/{project.id}/stylesheets/{ss.id}/docx-import"
    original = client.get(f"/api/v2/projects/{project.id}/stylesheets/{ss.id}/style-sheet.docx").content
    edited = _edit_r6(original)

    res = client.post(f"{base}/preview", data={"source": "upload"},
                      files={"file": ("edited.docx", edited, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["format"] == "s4c" and [c["id"] for c in body["changes"]] == ["rule:6"] and body["upload_token"]

    assert client.post(f"{base}/apply", json={"source": "upload", "upload_token": body["upload_token"],
                                              "accepted": []}).status_code == 400
    res = client.post(f"{base}/apply", json={"source": "upload", "upload_token": body["upload_token"],
                                             "accepted": ["rule:6"]})
    assert res.status_code == 200, res.text
    assert res.json()["stylesheet"]["ce_rules"]["6"]["option"] == 3 and res.json()["applied"] == ["rule:6"]

    assert client.post(f"{base}/apply", json={"source": "upload", "upload_token": "0" * 32,
                                              "accepted": ["rule:6"]}).status_code == 410
    other = f"/api/v2/projects/{project.id + 999}/stylesheets/{ss.id}/docx-import/preview"
    assert client.post(other, data={"source": "upload"}, files={"file": ("e.docx", edited)}).status_code == 404
    assert client.get(f"/api/v2/projects/{project.id}/stylesheets/docx-import/pending").json() == {"items": []}
