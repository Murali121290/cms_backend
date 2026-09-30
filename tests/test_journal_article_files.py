"""The article file manager: folders, history, restore, delete rules, zips and the delivery package."""
import io
import zipfile

from tests.test_journal_workflows import api, client_row, docx_bytes  # noqa: F401  (fixtures)


def _article(api, client_row):  # noqa: F811
    j = api.post("/api/v2/journals", json={"client_id": client_row["id"], "journal_code": "JF", "journal_title": "JF"}).json()
    files = [("files", ("m.docx", docx_bytes("Files page", "10.1/files.1"), "application/octet-stream"))]
    return api.post(f"/api/v2/journals/{j['id']}/articles/upload", files=files).json()["created"][0]["id"]


def _folders(api, aid):  # noqa: F811
    return {f["key"]: f for f in api.get(f"/api/v2/journals/articles/{aid}/folders").json()["folders"]}


def test_folders_group_latest_versions_and_backup(api, client_row, db_session):  # noqa: F811
    from app.domains.journals.files import save_version
    from app.domains.journals.models import JournalArticle
    aid = _article(api, client_row)
    api.post(f"/api/v2/journals/articles/{aid}/process-pre-editing")
    api.post(f"/api/v2/journals/articles/{aid}/process-pre-editing")  # XHTML v2
    api.post(f"/api/v2/journals/articles/{aid}/upload-files", files=[
        ("files", ("fig1.tif", b"II*\x00fake", "image/tiff")), ("files", ("cover.png", b"\x89PNGfake", "image/png"))])
    db_session.expire_all()
    art = db_session.get(JournalArticle, aid)
    for _ in range(2):
        row = save_version(db_session, art, "JATS_XML", "10.1_files.1.xml", b"<article/>", "xml")
        art.jats_xml_path = row.path
    db_session.commit()

    body = api.get(f"/api/v2/journals/articles/{aid}/folders").json()
    folders = {f["key"]: f for f in body["folders"]}
    assert [f["key"] for f in body["folders"]] == ["manuscript", "art", "xml", "indesign", "proof", "delivery", "backup"]
    ms = folders["manuscript"]["files"]
    assert ms[0]["id"] == "working" and ms[0]["status"]["label"] == "Working copy"
    original = next(f for f in ms if f["status"]["label"] == "Original")
    assert original["protected"] and original["uploaded_by"] == "admin"
    xhtml = next(f for f in ms if f["category"] == "XHTML")
    assert xhtml["version"] == 2 and xhtml["versions"] == 2
    arts = {f["filename"]: f for f in folders["art"]["files"]}
    assert arts["fig1_v1.tif"]["status"]["label"] == "Figure 1" and arts["cover_v1.png"]["status"]["kind"] == "warn"
    assert folders["art"]["attention"]
    assert [f["version"] for f in folders["xml"]["files"]] == [2]
    backup = {(f["category"], f["version"]) for f in folders["backup"]["files"]}
    assert ("XHTML", 1) in backup and ("JATS_XML", 1) in backup
    assert {r["key"]: r["ok"] for r in body["delivery_readiness"]}["art"] is False

    # History and restore: v1 of the XML comes back as v3 and becomes current.
    xml_v1 = next(f for f in folders["backup"]["files"] if f["category"] == "JATS_XML")
    hist = api.get(f"/api/v2/journals/articles/{aid}/files/{xml_v1['id']}/versions").json()
    assert [h["version"] for h in hist] == [1, 2] and hist[-1]["current"]
    restored = api.post(f"/api/v2/journals/articles/{aid}/files/{xml_v1['id']}/restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["file"]["version"] == 3
    assert _folders(api, aid)["xml"]["files"][0]["version"] == 3


def test_delete_rules_and_zips(api, client_row):  # noqa: F811
    aid = _article(api, client_row)
    api.post(f"/api/v2/journals/articles/{aid}/process-pre-editing")
    api.post(f"/api/v2/journals/articles/{aid}/upload-files", files=[("files", ("fig2.eps", b"%!PS fake", "application/postscript"))])
    folders = _folders(api, aid)
    original = next(f for f in folders["manuscript"]["files"] if f["status"]["label"] == "Original")
    assert api.delete(f"/api/v2/journals/articles/{aid}/files/{original['id']}").status_code == 409
    fig = folders["art"]["files"][0]

    zipped = api.post(f"/api/v2/journals/articles/{aid}/files/bulk-download", json={"file_ids": [str(fig["id"]), "working"]})
    assert zipped.status_code == 200 and zipped.headers["content-type"] == "application/zip"
    names = zipfile.ZipFile(io.BytesIO(zipped.content)).namelist()
    assert "fig2_v1.eps" in names and any(n.endswith("_structured.docx") for n in names)
    assert api.post(f"/api/v2/journals/articles/{aid}/files/bulk-download", json={"file_ids": []}).status_code == 400

    archive = zipfile.ZipFile(io.BytesIO(api.get(f"/api/v2/journals/articles/{aid}/archive").content)).namelist()
    assert any(n.startswith("Manuscript/") for n in archive) and "Art/fig2_v1.eps" in archive

    assert api.delete(f"/api/v2/journals/articles/{aid}/files/{fig['id']}").status_code == 200
    assert _folders(api, aid)["art"]["count"] == 0


def test_delivery_package_needs_xml_and_completes_final_delivery(api, client_row, db_session):  # noqa: F811
    from app.domains.journals.files import save_version
    from app.domains.journals.models import JournalArticle
    from app.domains.journals.service import STAGE_PIPELINE
    aid = _article(api, client_row)
    assert api.post(f"/api/v2/journals/articles/{aid}/delivery", json={}).status_code == 409  # no JATS XML yet

    db_session.expire_all()
    art = db_session.get(JournalArticle, aid)
    art.jats_xml_path = save_version(db_session, art, "JATS_XML", "a.xml", b"<article/>", "xml").path
    art.proof_pdf_path = save_version(db_session, art, "Proof_PDF", "a_proof.pdf", b"%PDF fake", "proof").path
    art.current_stage = STAGE_PIPELINE[-1]  # 7. Final Delivery
    db_session.commit()

    res = api.post(f"/api/v2/journals/articles/{aid}/delivery", json={"include_indesign": False})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["completed"] and body["file"]["filename"].endswith("_delivery_v1.zip")
    delivery = _folders(api, aid)["delivery"]["files"]
    assert len(delivery) == 1 and delivery[0]["status"]["label"] == "Packaged" and delivery[0]["protected"]
    content = api.get(f"/api/v2/journals/articles/{aid}/files/{delivery[0]['id']}/download").content
    assert sorted(zipfile.ZipFile(io.BytesIO(content)).namelist()) == ["a_proof_v1.pdf", "a_v1.xml"]
    db_session.expire_all()
    assert db_session.get(JournalArticle, aid).status == "Completed"
