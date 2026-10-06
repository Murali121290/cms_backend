import html
import json

import pytest

from app.domains.journals.jats import servers
from app.domains.journals.jats.converter import ArticleMeta, convert_xhtml_to_jats
from app.domains.journals.jats.validator import validate_jats
from app.domains.journals.service import STAGE_PIPELINE
from tests.test_journal_stage1_checks import build_manuscript, fake_crossref  # noqa: F401  (fixture)

META = ArticleMeta(journal_code="JAIS", journal_title="Journal of AI & Neural Systems", publisher_name="Elsevier",
                   issn_print="1532-4435", doi="10.1016/j.jais.2026.04.003", authors=["Priya Iyer"])


def rules(findings):
    return sorted(f.rule_id for f in findings)


def test_converter_output_is_dtd_valid_except_manuscript_errors(tmp_path):
    from app.domains.journals.manuscript import load_blocks
    from app.processing.docx_to_xhtml_runs import DocxToXhtmlRunsEngine
    path = build_manuscript(tmp_path / "m.docx")
    xml = convert_xhtml_to_jats(DocxToXhtmlRunsEngine().convert(str(path)), META, blocks=load_blocks(str(path)), art_files=["fig1_hires.tif"])
    findings = validate_jats(xml, assets=["fig1_hires.tif"])
    # The manuscript cites [12], which has no reference: the only DTD error.
    assert [(f.rule_id, f.detail) for f in findings] == [("DTD-IDREF", "bib12")]
    text = xml.decode("utf-8")
    assert '<pub-id pub-id-type="doi">10.5555/nips.2023.44</pub-id>' in text
    assert '<named-content content-type="Italics">do</named-content>' in text
    assert '<graphic xlink:href="fig1_hires.tif"/>' in text


def test_converter_maps_equations_lists_and_mapped_char_styles():
    mathml = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>=</mo><mn>1</mn></math>'
    attr = html.escape(mathml, quote=True)
    xhtml = f"""<html><body>
      <h1 data-para-idx="0">1 Method</h1>
      <p class="Normal" data-style-label="Normal" data-para-idx="1">Let <span class="math-node" data-mathml="{attr}" data-display="inline">{mathml}</span> hold, see <span class="Italics">ibid</span>.</p>
      <p class="Normal" data-style-label="Normal" data-para-idx="2"><span class="math-node" data-mathml="{attr}" data-display="block">{mathml}</span> (1)</p>
      <ul><li><p data-para-idx="3">First</p></li><li><p data-para-idx="4">Second</p></li></ul>
    </body></html>"""
    xml = convert_xhtml_to_jats(xhtml, META, char_styles={"Italics": "italic"})
    text = xml.decode("utf-8")
    assert "<inline-formula><mml:math><mml:mi>x</mml:mi>" in text
    assert '<disp-formula id="eq1">' in text and "<label>(1)</label>" in text
    assert "<italic>ibid</italic>" in text
    assert '<list list-type="bullet">' in text
    assert validate_jats(xml) == []


def test_validator_reports_dtd_and_publisher_rules():
    xml = b"""<?xml version="1.0"?>
<article xmlns:xlink="http://www.w3.org/1999/xlink" dtd-version="1.3">
<front><journal-meta><journal-id>J</journal-id></journal-meta>
<article-meta><title-group><article-title>T</article-title></title-group></article-meta></front>
<body><p id="a">x <italics>y</italics></p><p id="a">z</p>
<table-wrap id="t1"><table><tbody><tr><td>1</td></tr></tbody></table></table-wrap>
<fig id="f1"><caption><p>c</p></caption><graphic xlink:href="missing.tif"/></fig></body></article>"""
    findings = validate_jats(xml, assets=["other.tif"])
    got = rules(findings)
    for rule in ("DTD-CONTENT", "DTD-ELEM", "DTD-ID", "JATS-X03", "JATS-M01", "PKG-A01"):
        assert rule in got, (rule, got)
    issn = next(f for f in findings if f.rule_id == "DTD-CONTENT" and f.detail == "journal-meta")
    assert "ISSN" in issn.message
    assert next(f for f in findings if f.rule_id == "DTD-ID").line == 5


def test_validator_rejects_malformed_xml_and_external_entities():
    assert rules(validate_jats(b"<article><front>")) == ["XML-WF"]
    xxe = b'<?xml version="1.0"?><!DOCTYPE article [<!ENTITY x SYSTEM "file:///etc/passwd">]><article>&x;</article>'
    assert all("root:" not in f.message for f in validate_jats(xxe))


# --- API flow -------------------------------------------------------------

@pytest.fixture()
def api(auth_cookie_client, admin_user, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return auth_cookie_client(admin_user)


@pytest.fixture()
def article(api, tmp_path, fake_crossref):  # noqa: F811
    client = api.post("/api/v2/journals/clients", json={"client_code": "ELSA-01", "publisher_name": "Elsevier"}).json()
    journal = api.post("/api/v2/journals", json={"client_id": client["id"], "journal_code": "JAIS", "journal_title": "JAIS",
                                                  "issn_print": "1532-4435", "volume": "42", "issue": "3"}).json()
    art = api.post("/api/v2/journals/articles", json={"journal_id": journal["id"], "article_title": "Causal",
                                                      "article_doi": "10.1016/j.jais.2026.04.003"}).json()
    path = build_manuscript(tmp_path / "manuscript.docx")
    with open(path, "rb") as fh:
        api.post(f"/api/v2/journals/articles/{art['id']}/upload-files", files=[("files", ("manuscript.docx", fh))])
    assert api.post(f"/api/v2/journals/articles/{art['id']}/process-pre-editing").status_code == 200
    assert api.post(f"/api/v2/journals/articles/{art['id']}/checks/references/run").status_code == 200
    return art


def _set_stage(db_session, article_id, number):
    from app.domains.journals.models import JournalArticle
    db_session.expire_all()
    a = db_session.get(JournalArticle, article_id)
    a.current_stage = STAGE_PIPELINE[number - 1]
    db_session.commit()


def test_convert_links_dtd_error_to_reference_issue(api, article):
    aid = article["id"]
    res = api.post(f"/api/v2/journals/articles/{aid}/xml/convert")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["converter"] == "local" and body["fallback_reason"] is None
    assert body["file"]["version"] == 1
    assert body["open_issues"]["xml"]["error"] == 1

    xml_issues = [i for i in api.get(f"/api/v2/journals/articles/{aid}/issues", params={"module": "xml"}).json() if i["status"] == "open"]
    idref = next(i for i in xml_issues if i["rule_id"] == "DTD-IDREF")
    ref_issue = next(i for i in api.get(f"/api/v2/journals/articles/{aid}/issues", params={"module": "references"}).json()
                     if i["rule_id"] == "REF-X01")
    assert idref["source_issue_id"] == ref_issue["id"]
    assert 'rid="bib12"' in idref["context_snippet"]
    assert idref["location"]["xml_line"] > 0

    got = api.get(f"/api/v2/journals/articles/{aid}/xml").json()
    assert got["is_current"] and got["content"].startswith("<?xml")
    assert api.post(f"/api/v2/journals/articles/{aid}/xml/convert").json()["file"]["version"] == 2


def test_xml_editor_lint_and_save_new_version(api, article):
    """The XML editor: findings with line numbers, lint without saving, save as the next version."""
    aid = article["id"]
    api.post(f"/api/v2/journals/articles/{aid}/xml/convert")
    got = api.get(f"/api/v2/journals/articles/{aid}/xml").json()
    idref = next(f for f in got["findings"] if f["rule_id"] == "DTD-IDREF")
    assert idref["line"] > 0 and idref["severity"] == "error"
    assert api.get(f"/api/v2/journals/articles/{aid}/workspace").json()["jats"]["version"] == 1

    # Fix the dangling bib12 citation by hand: lint shows it clean, nothing is saved yet.
    fixed = got["content"].replace('<xref ref-type="bibr" rid="bib12">', '<xref ref-type="bibr" rid="bib1">')
    lint = api.post(f"/api/v2/journals/articles/{aid}/xml/lint", json={"content": fixed}).json()
    assert not [f for f in lint["findings"] if f["rule_id"] == "DTD-IDREF"]
    assert api.get(f"/api/v2/journals/articles/{aid}/xml").json()["file"]["version"] == 1

    saved = api.put(f"/api/v2/journals/articles/{aid}/xml", json={"content": fixed})
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["file"]["version"] == 2 and body["open_issues"]["xml"]["error"] == 0
    latest = api.get(f"/api/v2/journals/articles/{aid}/xml").json()
    assert latest["is_current"] and latest["content"] == fixed

    # XML that is not well-formed is refused and no version is stored.
    bad = api.put(f"/api/v2/journals/articles/{aid}/xml", json={"content": fixed.replace("</article>", "")})
    assert bad.status_code == 422 and "not well-formed" in bad.json()["detail"]
    assert api.get(f"/api/v2/journals/articles/{aid}/xml").json()["file"]["version"] == 2


def test_xslt_server_used_when_configured_and_falls_back_on_failure(api, article, monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "JATS_XSLT_URL", "http://xslt.test")
    aid = article["id"]

    monkeypatch.setattr(servers.JatsXsltClient, "convert", lambda self, path: (_ for _ in ()).throw(servers.JournalServerError("XSLT server unreachable")))
    res = api.post(f"/api/v2/journals/articles/{aid}/xml/convert").json()
    assert res["converter"] == "local" and "unreachable" in res["fallback_reason"]

    valid = convert_xhtml_to_jats("<html><body><p data-para-idx='0'>Hello</p></body></html>", META)
    monkeypatch.setattr(servers.JatsXsltClient, "convert", lambda self, path: valid)
    res = api.post(f"/api/v2/journals/articles/{aid}/xml/convert").json()
    assert res["converter"] == "xslt-server"
    assert res["open_issues"] == {}


def test_stage4_requires_jats_before_advancing(api, article, db_session):
    _set_stage(db_session, article["id"], 3)
    res = api.post(f"/api/v2/journals/articles/{article['id']}/advance-stage", json={})
    assert res.status_code == 409
    assert res.json()["detail"]["message"].startswith("Convert the article to JATS XML")


def test_indesign_qc_and_proof_signoffs_gate_stages_5_to_8(api, article, db_session, tmp_path, monkeypatch):
    aid = article["id"]
    assert api.post(f"/api/v2/journals/articles/{aid}/indesign/generate").status_code == 409  # still at stage 1

    api.post(f"/api/v2/journals/articles/{aid}/xml/convert")
    template = tmp_path / "JAIS.indt"
    template.write_bytes(b"indt")
    jid = article["journal_id"]
    up = api.post(f"/api/v2/journals/{jid}/assets", data={"kind": "template"}, files=[("files", ("JAIS.indt", b"indt v1"))])
    assert up.status_code == 201 and up.json()[0]["is_active"]  # first template becomes active
    api.post(f"/api/v2/journals/{jid}/assets", data={"kind": "font"}, files=[("files", ("Minion.otf", b"font"))])
    _set_stage(db_session, aid, 4)

    sent = {}

    def fake_generate(self, xml_path, template_path, art_paths, client_code, wait_seconds=1800, design_files=None):
        sent.update(xml=xml_path, template=template_path, client=client_code, design=list(design_files or []))
        return {"article.indd": b"INDD", "article.idml": b"PK-idml", "article.pdf": b"%PDF-1.7 proof",
                "preflight.json": json.dumps({"overset_frames": 2, "missing_fonts": [], "low_res_images": [{"name": "fig1.tif", "ppi": 150}]}).encode()}
    monkeypatch.setattr(servers.JournalInDesignClient, "generate", fake_generate)

    assert api.post(f"/api/v2/journals/articles/{aid}/indesign/generate").status_code == 202
    assert sent["client"] == "ELSA-01"
    assert sent["template"].replace("\\", "/").endswith("ELSA-01/JAIS/design/template/v1/JAIS.indt")
    assert [p.rsplit("/", 1)[-1].rsplit("\\", 1)[-1] for p in sent["design"]] == ["Minion.otf"]
    status = api.get(f"/api/v2/journals/articles/{aid}/indesign").json()
    assert status["status"].startswith("InDesign generated:")
    assert status["indd"]["version"] == 1 and status["proof_pdf"]["filename"].endswith("_proof_v1.pdf")
    assert status["open_issues"]["indesign_qc"] == {"error": 9, "warning": 1, "info": 0}  # 8 checklist + overset
    assert status["open_issues"]["proof"]["error"] == 1

    assert api.post(f"/api/v2/journals/articles/{aid}/checks/indesign_qc/run").status_code == 409
    pdf = api.get(f"/api/v2/journals/articles/{aid}/proof")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")

    def signoff(module):
        for i in api.get(f"/api/v2/journals/articles/{aid}/issues", params={"module": module, "issue_status": "open", "severity": "error"}).json():
            r = api.patch(f"/api/v2/journals/articles/{aid}/issues/{i['id']}", json={"action": "accept"})
            assert r.status_code == 200
            if i["rule_id"].startswith("QC-") or i["rule_id"].startswith("PROOF"):
                assert r.json()["resolution"] == "signed_off"

    # The sample manuscript's deliberate Stage 1-4 errors still block Stage 5; clear them to test 5-8 alone.
    assert api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={}).status_code == 409
    for module in ("structuring", "references", "xml"):
        signoff(module)
    assert api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={}).status_code == 200  # 4 -> 5
    assert api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={}).status_code == 409  # QC not signed off

    signoff("indesign_qc")
    assert api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={}).status_code == 200  # 5 -> 6
    assert api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={}).status_code == 409  # proof not approved
    signoff("proof")
    res = api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={})
    assert res.status_code == 200 and res.json()["new_stage"] == "7. Final Delivery"


def test_indesign_failure_is_recorded(api, article, db_session, tmp_path, monkeypatch):
    aid = article["id"]
    api.post(f"/api/v2/journals/articles/{aid}/xml/convert")
    template = tmp_path / "JAIS.indt"
    template.write_bytes(b"indt")
    api.post(f"/api/v2/journals/{article['journal_id']}/stylesheets", json={"name": "S", "style_rules": {"indesign_template": str(template)}})
    _set_stage(db_session, aid, 4)

    def boom(self, *a, **k):
        raise servers.JournalServerError("InDesign server returned HTTP 500: font missing")
    monkeypatch.setattr(servers.JournalInDesignClient, "generate", boom)
    api.post(f"/api/v2/journals/articles/{aid}/indesign/generate")
    status = api.get(f"/api/v2/journals/articles/{aid}/indesign").json()
    assert status["status"] == "InDesign generation failed: InDesign server returned HTTP 500: font missing"
    assert status["indd"] is None
    # Without a layout the article cannot leave Stage 5.
    assert api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={}).json()["detail"]["message"].startswith("Generate the InDesign layout")
