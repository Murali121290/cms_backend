import pytest

from app.domains.journals.checks import REGISTRY, CheckResult, IssueDraft, JournalCheck
from app.domains.journals.service import STAGE_PIPELINE


@pytest.fixture()
def api(auth_cookie_client, admin_user):
    return auth_cookie_client(admin_user)


@pytest.fixture()
def article(api, db_session):
    client = api.post("/api/v2/journals/clients", json={"client_code": "ELSA-01", "publisher_name": "Elsevier"})
    assert client.status_code == 201, client.text
    journal = api.post("/api/v2/journals", json={
        "client_id": client.json()["id"], "journal_code": "JAIS",
        "journal_title": "Journal of AI & Neural Systems", "volume": "42", "issue": "3",
    })
    assert journal.status_code == 201, journal.text
    art = api.post("/api/v2/journals/articles", json={
        "journal_id": journal.json()["id"], "article_title": "A Benchmark for Causal Reasoning",
        "article_doi": "10.1016/j.jais.2026.04.003",
    })
    assert art.status_code == 201, art.text
    # These tests exercise the issue gate, so mark Stage 1's XHTML output as produced.
    from app.domains.journals.models import JournalArticle
    db_session.get(JournalArticle, art.json()["id"]).xhtml_path = "preedited.xhtml"
    db_session.commit()
    return art.json()


def test_stage1_requires_xhtml_before_advancing(api, db_session):
    client = api.post("/api/v2/journals/clients", json={"client_code": "C9", "publisher_name": "P"}).json()
    journal = api.post("/api/v2/journals", json={"client_id": client["id"], "journal_code": "J9", "journal_title": "J"}).json()
    art = api.post("/api/v2/journals/articles", json={"journal_id": journal["id"], "article_title": "Raw"}).json()
    res = api.post(f"/api/v2/journals/articles/{art['id']}/advance-stage", json={})
    assert res.status_code == 409
    assert res.json()["detail"]["message"].startswith("Run pre-editing")


class FakeReferencesCheck(JournalCheck):
    key = "references"
    name = "Reference validation"
    issues = []

    def run(self, article, db):
        return CheckResult(issues=list(self.issues), rules_total=14, rule_set_version="Vancouver")


@pytest.fixture()
def fake_references(monkeypatch):
    check = FakeReferencesCheck()
    check.issues = [
        IssueDraft(rule_id="REF-X01", severity="error", title="Citation has no matching reference",
                   location={"block_id": "p7", "start": 212}, suggestion={"type": "replace", "to": "[10]"}),
        IssueDraft(rule_id="REF-C01", severity="warning", title="Reference 8 is never cited",
                   location={"block_id": "ref8"}),
    ]
    monkeypatch.setitem(REGISTRY, "references", check)
    return check


def test_journal_routes_require_login(client):
    assert client.get("/api/v2/journals/clients").status_code == 401
    assert client.get("/api/v2/journals/checks").status_code == 401


def test_router_is_mounted_only_under_api_v2(api):
    assert api.get("/api/v2/journals/clients").status_code == 200
    assert api.get("/api/journals/clients").status_code == 404
    assert api.get("/api/v2/api/journals/clients").status_code == 404


def test_creating_article_initializes_eight_stages(api, article, db_session):
    from app.domains.journals.models import JournalStageDetail
    stages = db_session.query(JournalStageDetail).filter_by(article_id=article["id"]).order_by(JournalStageDetail.stage_number).all()
    assert [s.stage_name for s in stages] == STAGE_PIPELINE
    assert [s.stage_status for s in stages][:2] == ["In-progress", "Pending"]


def test_stylesheet_and_grammarsheet_crud(api, article):
    journal_id = article["journal_id"]
    created = api.post(f"/api/v2/journals/{journal_id}/stylesheets", json={"name": "JAIS_Style_v2", "style_rules": {"figure_callout": "Figure"}})
    assert created.status_code == 201, created.text
    assert api.get(f"/api/v2/journals/{journal_id}/stylesheets").json()[0]["name"] == "JAIS_Style_v2"

    created = api.post(f"/api/v2/journals/{journal_id}/grammarsheets", json={"name": "JAIS_US_Grammar", "grammar_rules": {"serial_comma": True}})
    assert created.status_code == 201, created.text
    assert api.get(f"/api/v2/journals/{journal_id}/grammarsheets").json()[0]["language_variant"] == "US_English"

    assert api.get("/api/v2/journals/99999/stylesheets").status_code == 404


def test_unimplemented_check_returns_501(api, article, monkeypatch):
    class Pending(JournalCheck):
        key, name, implemented = "technical", "Technical editing", False
    monkeypatch.setitem(REGISTRY, "technical", Pending())
    res = api.post(f"/api/v2/journals/articles/{article['id']}/checks/technical/run")
    assert res.status_code == 501
    assert api.post(f"/api/v2/journals/articles/{article['id']}/checks/nope/run").status_code == 404


def test_check_without_manuscript_returns_400(api, article):
    res = api.post(f"/api/v2/journals/articles/{article['id']}/checks/structuring/run")
    assert res.status_code == 400
    assert "No manuscript DOCX" in res.json()["detail"]
    runs = api.get(f"/api/v2/journals/articles/{article['id']}/check-runs").json()
    assert runs[0]["status"] == "Failed"


def test_open_error_blocks_stage_advance_until_fixed(api, article, fake_references):
    aid = article["id"]
    run = api.post(f"/api/v2/journals/articles/{aid}/checks/references/run")
    assert run.status_code == 200, run.text
    assert run.json()["rules_passed"] == 12

    issues = api.get(f"/api/v2/journals/articles/{aid}/issues").json()
    error = next(i for i in issues if i["severity"] == "error")
    warning = next(i for i in issues if i["severity"] == "warning")

    blocked = api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={})
    assert blocked.status_code == 409
    assert [i["id"] for i in blocked.json()["detail"]["blocking_issues"]] == [error["id"]]

    assert api.patch(f"/api/v2/journals/articles/{aid}/issues/{error['id']}", json={"action": "ignore"}).status_code == 422
    ignored = api.patch(f"/api/v2/journals/articles/{aid}/issues/{warning['id']}", json={"action": "ignore"})
    assert ignored.json()["status"] == "ignored"

    fixed = api.patch(f"/api/v2/journals/articles/{aid}/issues/{error['id']}", json={"action": "accept"})
    assert fixed.json()["status"] == "fixed"
    assert fixed.json()["resolution"] == "accepted_fix"

    # With the errors fixed, Pre-Editing still needs its four steps finished.
    gated = api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={"remarks": "Refs clean"})
    assert gated.status_code == 409, gated.text
    assert gated.json()["detail"]["message"] == "Pre-Editing step 1 (Structuring) is not finished"
    assert gated.json()["detail"]["step"] == "structuring"


def test_rerun_supersedes_open_issues_and_keeps_ignored_decisions(api, article, fake_references):
    aid = article["id"]
    api.post(f"/api/v2/journals/articles/{aid}/checks/references/run")
    warning = next(i for i in api.get(f"/api/v2/journals/articles/{aid}/issues").json() if i["severity"] == "warning")
    api.patch(f"/api/v2/journals/articles/{aid}/issues/{warning['id']}", json={"action": "ignore"})

    api.post(f"/api/v2/journals/articles/{aid}/checks/references/run")
    current = api.get(f"/api/v2/journals/articles/{aid}/issues").json()
    statuses = sorted((i["rule_id"], i["status"]) for i in current)
    # The first run's error is superseded (hidden), the rerun raises it again; both warnings stay ignored.
    assert statuses == [("REF-C01", "ignored"), ("REF-C01", "ignored"), ("REF-X01", "open")]

    superseded = api.get(f"/api/v2/journals/articles/{aid}/issues", params={"issue_status": "superseded"}).json()
    assert [i["rule_id"] for i in superseded] == ["REF-X01"]
    stale = api.patch(f"/api/v2/journals/articles/{aid}/issues/{superseded[0]['id']}", json={"action": "accept"})
    assert stale.status_code == 409


def test_later_stage_checks_do_not_block_earlier_stage(api, article, monkeypatch, db_session):
    from app.domains.journals.models import JournalArticle
    class FakeXml(JournalCheck):
        key, name = "xml", "XML & DTD validation"

        def run(self, article, db):
            return CheckResult(issues=[IssueDraft(rule_id="DTD-IDREF", severity="error", title="IDREF has no target", location={"xml_line": 112})], rules_total=9)

    monkeypatch.setitem(REGISTRY, "xml", FakeXml())
    aid = article["id"]
    db_session.expire_all()
    a = db_session.get(JournalArticle, aid)
    a.current_stage = STAGE_PIPELINE[1]  # Language Editing
    db_session.commit()
    api.post(f"/api/v2/journals/articles/{aid}/checks/xml/run")
    # The article is at Language Editing, so an XML Conversion error does not block it yet.
    assert api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={}).status_code == 200


def test_assign_stage_validates_input(api, article, admin_user):
    base = {"article_id": article["id"], "assignee_id": admin_user.id}
    assert api.post("/api/v2/journals/articles/assign-stage", json={**base, "target_stage": "9. Nope"}).status_code == 400
    bad_dates = {**base, "target_stage": STAGE_PIPELINE[0], "planned_start_date": "2026-10-05T00:00:00", "planned_end_date": "2026-10-01T00:00:00"}
    assert api.post("/api/v2/journals/articles/assign-stage", json=bad_dates).status_code == 400
    ok = api.post("/api/v2/journals/articles/assign-stage", json={**base, "target_stage": STAGE_PIPELINE[0], "sla_hours": 16})
    assert ok.status_code == 200, ok.text
