import base64
import io

import pytest
from docx import Document
from docx.enum.style import WD_STYLE_TYPE

from app.domains.journals.checks import references as references_check

# 1x1 transparent PNG
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")


def build_manuscript(path):
    doc = Document()
    doc.styles.add_style("Italics", WD_STYLE_TYPE.CHARACTER)
    doc.add_paragraph("A Benchmark for Causal Reasoning", style="Title")
    doc.add_paragraph("Abstract We release CAUSE-MM, a benchmark of image–text items.")
    doc.add_paragraph("1 Introduction", style="Heading 1")
    p = doc.add_paragraph("Causal questions ask what would happen [1]. Models describe scenes [2, 3] and use the ")
    p.add_run("do").style = "Italics"
    p.add_run("-operator [12].")
    doc.add_paragraph("2.1 Scene generation")  # numbered heading left as Normal
    doc.add_paragraph("Scenes were rendered with a physics engine [5].", style="Heading 3")  # skips level 2
    doc.add_paragraph("Table 1. Accuracy by level.")
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Model"
    doc.add_paragraph().add_run().add_picture(io.BytesIO(PNG))
    doc.add_paragraph("Figure 1. Example items.")
    doc.add_paragraph("References", style="Heading 1")
    doc.add_paragraph("1. Pearl J, Mackenzie D. The Book of Why. New York: Basic Books; 2018.")
    doc.add_paragraph("2. Alayrac JB, Donahue J. Flamingo: a visual language model. Adv Neural Inf Process Syst. 2022;35:23716–36.")
    doc.add_paragraph("3. Liu H, Li C. Visual instruction tuning. Adv Neural Inf Process Syst. 2023;36:34892–916. doi:10.5555/nips.2023.44")
    doc.add_paragraph("4. Johnson J, Hariharan B. CLEVR: a diagnostic dataset. In: Proc IEEE Conf Comput Vis Pattern Recognit. p. 2901–10.")
    doc.add_paragraph("5. Moreau C. Chain-of-thought prompting and causal generalization. J Mach Learn Res. 2025;26:1–31.")
    doc.add_paragraph("6. Haddad N. Spurious correlations in image classifiers. Mach Learn. 2024;113:77–109.")
    doc.save(path)
    return path


@pytest.fixture()
def fake_crossref(monkeypatch):
    def lookup(title, year):
        if "Visual instruction tuning" in title:
            return [{"title": "Visual instruction tuning", "doi": "10.5555/nips.2023.442"}]
        if "Spurious correlations" in title:
            return [{"title": "Spurious correlations in image classifiers", "doi": "10.5555/ml.2024.0098"}]
        return []
    monkeypatch.setattr(references_check, "crossref_lookup", lookup)


@pytest.fixture()
def api(auth_cookie_client, admin_user, tmp_path, monkeypatch):
    # Journal uploads are written under ./uploads; keep them out of the repo.
    monkeypatch.chdir(tmp_path)
    return auth_cookie_client(admin_user)


@pytest.fixture()
def article_with_manuscript(api, tmp_path):
    client = api.post("/api/v2/journals/clients", json={"client_code": "ELSA-01", "publisher_name": "Elsevier"}).json()
    journal = api.post("/api/v2/journals", json={"client_id": client["id"], "journal_code": "JAIS", "journal_title": "JAIS"}).json()
    article = api.post("/api/v2/journals/articles", json={"journal_id": journal["id"], "article_title": "Causal"}).json()
    path = build_manuscript(tmp_path / "manuscript.docx")
    with open(path, "rb") as fh:
        up = api.post(f"/api/v2/journals/articles/{article['id']}/upload-files",
                      files=[("files", ("manuscript.docx", fh, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))])
    assert up.status_code == 200, up.text
    return article


def open_issues(api, article_id, module):
    return [i for i in api.get(f"/api/v2/journals/articles/{article_id}/issues", params={"module": module}).json() if i["status"] == "open"]


def test_pre_editing_converts_and_runs_stage1_checks(api, article_with_manuscript, fake_crossref):
    aid = article_with_manuscript["id"]
    res = api.post(f"/api/v2/journals/articles/{aid}/process-pre-editing")
    assert res.status_code == 200, res.text
    body = res.json()
    assert 'data-para-idx="' in body["xhtml_content"]
    assert body["xhtml_version"] == 1
    assert body["check_runs"]["structuring"]["status"] == "Completed"
    assert body["pre_editing"]["current_step"] == "structuring"
    assert body["open_issues"]["structuring"]["error"] >= 1

    files = api.get(f"/api/v2/journals/articles/{aid}/files").json()
    assert any(f["category"] == "XHTML" and f["version"] == 1 for f in files)

    # Open errors from Stage 1 block leaving Stage 1.
    assert api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={}).status_code == 409


def test_structuring_findings(api, article_with_manuscript):
    aid = article_with_manuscript["id"]
    assert api.post(f"/api/v2/journals/articles/{aid}/checks/structuring/run").status_code == 200
    by_rule = {}
    for i in open_issues(api, aid, "structuring"):
        by_rule.setdefault(i["rule_id"], []).append(i)

    h02 = by_rule["STR-H02"][0]
    assert h02["severity"] == "error"
    assert h02["context_snippet"] == "2.1 Scene generation"
    assert h02["suggestion"] == {"type": "retag", "to": "Heading 2"}
    assert h02["location"]["block_id"].startswith("p")

    assert by_rule["STR-CS-09"][0]["title"] == "Unmapped character style “Italics”"
    # "2.1" counts as level 2, so the Heading 3 after it is a valid step; the check only flags skipped levels.
    assert "STR-HSEQ" not in by_rule
    assert by_rule["STR-CAP-03"][0]["suggestion"]["to"] == "Table Title"
    assert by_rule["STR-CAP-04"][0]["suggestion"]["to"] == "Figure Caption"
    assert "STR-ABS" not in by_rule  # "Abstract ..." paragraph is detected


def test_heading_level_skip_is_an_error(api, tmp_path, auth_cookie_client, admin_user, db_session):
    from app.domains.journals.checks.structuring import StructuringCheck
    from app.domains.journals.models import JournalArticle
    doc = Document()
    doc.add_paragraph("Abstract Short.")
    doc.add_paragraph("Intro", style="Heading 1")
    doc.add_paragraph("Deep", style="Heading 3")
    path = tmp_path / "skip.docx"
    doc.save(path)
    article = JournalArticle(journal_id=1, article_title="x", original_docx_path=str(path))
    result = StructuringCheck().run(article, db_session)
    errors = [i for i in result.issues if i.severity == "error"]
    assert [i.rule_id for i in errors] == ["STR-HSEQ"]
    assert errors[0].suggestion == {"type": "retag", "to": "Heading 2"}


def test_reference_findings(api, article_with_manuscript, fake_crossref):
    aid = article_with_manuscript["id"]
    run = api.post(f"/api/v2/journals/articles/{aid}/checks/references/run")
    assert run.status_code == 200, run.text
    issues = open_issues(api, aid, "references")
    titles = {i["rule_id"]: [] for i in issues}
    for i in issues:
        titles[i["rule_id"]].append(i["title"])

    assert titles["REF-X01"] == ["Citation [12] has no matching reference"]
    assert titles["REF-C01"] == ["Reference 4 is never cited", "Reference 6 is never cited"]
    assert titles["REF-O01"] == ["Reference 5 is cited before reference 4"]
    assert titles["REF-F03"] == ["Reference 4 has no publication year"]
    assert titles["REF-D02"] == ["Reference 3: DOI does not match Crossref"]
    assert titles["REF-D03"] == ["Reference 6: DOI available from Crossref"]

    d02 = next(i for i in issues if i["rule_id"] == "REF-D02")
    assert d02["suggestion"] == {"type": "replace", "from": "10.5555/nips.2023.44", "to": "10.5555/nips.2023.442"}
    x01 = next(i for i in issues if i["rule_id"] == "REF-X01")
    assert "[12]" in x01["context_snippet"]
    assert x01["location"]["end"] - x01["location"]["start"] == len("[12]")


def test_crossref_outage_is_reported_not_fatal(api, article_with_manuscript, monkeypatch):
    def down(title, year):
        raise ConnectionError("crossref unreachable")
    monkeypatch.setattr(references_check, "crossref_lookup", down)
    aid = article_with_manuscript["id"]
    assert api.post(f"/api/v2/journals/articles/{aid}/checks/references/run").status_code == 200
    rules = {i["rule_id"]: i for i in open_issues(api, aid, "references")}
    assert rules["REF-D00"]["severity"] == "info"
    assert "REF-D02" not in rules


def test_pre_editing_without_manuscript_is_rejected(api):
    client = api.post("/api/v2/journals/clients", json={"client_code": "C2", "publisher_name": "P"}).json()
    journal = api.post("/api/v2/journals", json={"client_id": client["id"], "journal_code": "J2", "journal_title": "J"}).json()
    article = api.post("/api/v2/journals/articles", json={"journal_id": journal["id"], "article_title": "No file"}).json()
    res = api.post(f"/api/v2/journals/articles/{article['id']}/process-pre-editing")
    assert res.status_code == 400
