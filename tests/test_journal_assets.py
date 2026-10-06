import io
import os

import pytest
from PIL import Image


@pytest.fixture()
def api(auth_cookie_client, admin_user):
    return auth_cookie_client(admin_user)


@pytest.fixture()
def journal(api):
    c = api.post("/api/v2/journals/clients", json={"client_code": "ELSA-01", "publisher_name": "Elsevier"}).json()
    return api.post("/api/v2/journals", json={"client_id": c["id"], "journal_code": "JAIS", "journal_title": "JAIS", "issn_print": "1532-4435"}).json()


def png(width, height, dpi=300):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(buf, "PNG", dpi=(dpi, dpi))
    return buf.getvalue()


def test_template_versions_and_activation(api, journal):
    jid = journal["id"]
    v1 = api.post(f"/api/v2/journals/{jid}/assets", data={"kind": "template"}, files=[("files", ("JAIS_2025.indt", b"a"))]).json()[0]
    v2 = api.post(f"/api/v2/journals/{jid}/assets", data={"kind": "template", "note": "New heads"}, files=[("files", ("JAIS_2026.indt", b"b"))]).json()[0]
    assert (v1["version"], v1["is_active"]) == (1, True)
    assert (v2["version"], v2["is_active"]) == (2, False)  # a new version waits until it is activated
    assert api.get(f"/api/v2/journals/{jid}").json()["setup"]["template"] == "JAIS_2025.indt"

    api.post(f"/api/v2/journals/{jid}/assets/{v2['id']}/activate")
    setup = api.get(f"/api/v2/journals/{jid}").json()["setup"]
    assert (setup["template"], setup["template_version"]) == ("JAIS_2026.indt", 2)
    active = [a["filename"] for a in api.get(f"/api/v2/journals/{jid}/assets", params={"kind": "template"}).json() if a["is_active"]]
    assert active == ["JAIS_2026.indt"]
    assert api.get(f"/api/v2/journals/{jid}/assets/{v1['id']}/download").content == b"a"  # old versions are kept


def test_asset_storage_layout_and_validation(api, journal, tmp_path):
    jid = journal["id"]
    assert api.post(f"/api/v2/journals/{jid}/assets", data={"kind": "template"}, files=[("files", ("x.docx", b"x"))]).status_code == 400
    assert api.post(f"/api/v2/journals/{jid}/assets", data={"kind": "nope"}, files=[("files", ("x.indt", b"x"))]).status_code == 400
    f1 = api.post(f"/api/v2/journals/{jid}/assets", data={"kind": "font"}, files=[("files", ("Minion.otf", b"1"))]).json()[0]
    f2 = api.post(f"/api/v2/journals/{jid}/assets", data={"kind": "font"}, files=[("files", ("Minion.otf", b"2"))]).json()[0]
    assert (f2["version"], f2["is_active"]) == (2, True)
    fonts = api.get(f"/api/v2/journals/{jid}/assets", params={"kind": "font"}).json()
    assert [(a["version"], a["is_active"]) for a in fonts] == [(2, True), (1, False)]
    root = tmp_path / "journal_storage"
    assert (root / "ELSA-01" / "JAIS" / "design" / "font" / "Minion_v1" / "Minion.otf").read_bytes() == b"1"
    assert api.get(f"/api/v2/journals/{jid}").json()["setup"]["fonts"] == 1


def test_stylesheet_saves_are_versions(api, journal):
    jid = journal["id"]
    s1 = api.post(f"/api/v2/journals/{jid}/stylesheets", json={"name": "JAIS_Style", "style_rules": {"abstract_word_limit": 250}}).json()
    s2 = api.post(f"/api/v2/journals/{jid}/stylesheets", json={"name": "JAIS_Style", "style_rules": {"abstract_word_limit": 200}}).json()
    sheets = {s["id"]: s["is_active"] for s in api.get(f"/api/v2/journals/{jid}/stylesheets").json()}
    assert sheets == {s1["id"]: False, s2["id"]: True}
    api.post(f"/api/v2/journals/{jid}/stylesheets/{s1['id']}/activate")
    sheets = {s["id"]: s["is_active"] for s in api.get(f"/api/v2/journals/{jid}/stylesheets").json()}
    assert sheets == {s1["id"]: True, s2["id"]: False}


def test_art_upload_checks_link_rename_and_versions(api, journal, db_session):
    jid = journal["id"]
    api.post(f"/api/v2/journals/{jid}/stylesheets", json={"name": "S", "style_rules": {
        "art": {"formats": ["TIFF", "PNG"], "min_ppi": 300, "naming": "fig{n}.tif", "placed_width_mm": 84}}})
    aid = api.post("/api/v2/journals/articles", json={"journal_id": jid, "article_title": "A"}).json()["id"]

    res = api.post(f"/api/v2/journals/articles/{aid}/art", files=[
        ("files", ("Figure 1 final.png", png(1200, 800), "image/png")),   # 363 ppi at 84 mm, wrong name
        ("files", ("fig2.png", png(600, 400), "image/png")),              # 181 ppi: too low
        ("files", ("chart.jpg", png(2000, 1000), "image/jpeg")),          # unlinked, JPG not accepted
    ])
    assert res.status_code == 201, res.text
    assert [(r["figure_number"], r["version"]) for r in res.json()] == [(1, 1), (2, 1), (None, 1)]

    art = api.get(f"/api/v2/journals/articles/{aid}/art").json()
    by_name = {f["filename"]: f for f in art["files"]}
    f1 = by_name["Figure_1_final_v1.png"]
    assert (f1["width"], f1["ppi"], f1["status"]) == (1200, 363, "warning")
    assert "Rename to fig1" in [c["text"] for c in f1["checks"]]
    assert by_name["fig2_v1.png"]["status"] == "error" and "181 ppi" in by_name["fig2_v1.png"]["checks"][1]["text"]
    assert by_name["chart_v1.jpg"]["checks"][0]["status"] == "error"
    assert [(f["number"], f["status"]) for f in art["figures"]] == [(1, "warning"), (2, "error")]

    renamed = api.post(f"/api/v2/journals/articles/{aid}/art/{f1['id']}/rename").json()
    assert (renamed["filename"], renamed["version"]) == ("fig1_v2.png", 2)
    art = api.get(f"/api/v2/journals/articles/{aid}/art").json()
    assert next(f for f in art["figures"] if f["number"] == 1)["filename"] == "fig1_v2.png"
    assert next(f for f in art["files"] if f["figure_number"] == 1)["versions"] == 2

    chart = by_name["chart_v1.jpg"]
    assert api.patch(f"/api/v2/journals/articles/{aid}/art/{chart['id']}", json={"figure_number": 3}).json()["figure_number"] == 3
    assert [f["number"] for f in api.get(f"/api/v2/journals/articles/{aid}/art").json()["figures"]] == [1, 2, 3]
    assert api.get(f"/api/v2/journals/articles/{aid}/art/{chart['id']}/download").status_code == 200


def test_upload_rejects_path_traversal_names(api, journal):
    aid = api.post("/api/v2/journals/articles", json={"journal_id": journal["id"], "article_title": "A"}).json()["id"]
    res = api.post(f"/api/v2/journals/articles/{aid}/upload-files", files=[("files", ("../../evil.pdf", b"%PDF"))])
    assert res.status_code == 200
    paths = [f["path"] for f in api.get(f"/api/v2/journals/articles/{aid}/files").json()]
    assert all(os.path.basename(p) == "evil.pdf" and ".." not in p for p in paths)
