"""Pre-Editing as four gated steps: Structuring -> References -> IA rules -> Technical."""
import importlib.util
import os

import pytest
import sqlalchemy as sa

from app.domains.journals.checks import REGISTRY
from app.domains.journals.checks.base import CheckResult, IssueDraft, JournalCheck
from tests.test_journal_workflows import api, client_row, docx_bytes  # noqa: F401  (fixtures)

STEP_MODULES = ("structuring", "references", "ia_rules", "technical")


@pytest.fixture()
def fake_checks(monkeypatch):
    """Replace the four step checks with ones whose findings each test sets."""
    results = {k: [] for k in STEP_MODULES}

    def make(key):
        class Fake(JournalCheck):
            name = key

            def run(self, article, db):
                return CheckResult(issues=list(results[key]), rules_total=3)
        Fake.key = key
        return Fake()

    for k in STEP_MODULES:
        monkeypatch.setitem(REGISTRY, k, make(k))
    return results


def err(rule="E1"):
    return IssueDraft(rule_id=rule, severity="error", title=f"{rule} error", fingerprint=rule)


def warn(rule="W1"):
    return IssueDraft(rule_id=rule, severity="warning", title=f"{rule} warning", fingerprint=rule)


@pytest.fixture()
def article_id(api, client_row):  # noqa: F811
    j = api.post("/api/v2/journals", json={"client_id": client_row["id"], "journal_code": "JP", "journal_title": "JP"}).json()
    files = [("files", ("m.docx", docx_bytes("Pre-editing steps", "10.1/pe.1"), "application/octet-stream"))]
    return api.post(f"/api/v2/journals/{j['id']}/articles/upload", files=files).json()["created"][0]["id"]


def steps(api, aid):  # noqa: F811
    return {s["key"]: s for s in api.get(f"/api/v2/journals/articles/{aid}/pre-editing").json()["steps"]}


def fix_errors(api, aid, module):  # noqa: F811
    for i in api.get(f"/api/v2/journals/articles/{aid}/issues", params={"module": module, "issue_status": "open"}).json():
        if i["severity"] == "error":
            assert api.patch(f"/api/v2/journals/articles/{aid}/issues/{i['id']}", json={"action": "accept"}).status_code == 200


def test_steps_unlock_in_order_and_gate_the_stage(api, article_id, fake_checks, db_session):  # noqa: F811
    aid = article_id
    st = steps(api, aid)
    assert [st[k]["status"] for k in STEP_MODULES] == ["ready", "locked", "locked", "locked"]
    assert api.post(f"/api/v2/journals/articles/{aid}/pre-editing/references/run").status_code == 409

    fake_checks["structuring"] = [err(), warn()]
    run = api.post(f"/api/v2/journals/articles/{aid}/pre-editing/structuring/run")
    assert run.status_code == 200, run.text
    assert run.json()["xhtml_version"] == 1
    s = steps(api, aid)["structuring"]
    assert s["status"] == "in_progress" and s["open"] == {"error": 1, "warning": 1, "info": 0} and not s["can_finish"]

    # Errors block Finish; then open warnings block it unless accepted in one sign-off.
    finish = f"/api/v2/journals/articles/{aid}/pre-editing/structuring/finish"
    assert api.post(finish, json={}).status_code == 409
    fix_errors(api, aid, "structuring")
    blocked = api.post(finish, json={})
    assert blocked.status_code == 409 and "warning" in blocked.json()["detail"]
    done = api.post(finish, json={"accept_warnings": True})
    assert done.status_code == 200
    st = {s["key"]: s for s in done.json()["steps"]}
    assert st["structuring"]["status"] == "finished" and st["structuring"]["signed_off"]
    assert st["references"]["status"] == "ready" and st["ia_rules"]["status"] == "locked"
    accepted = api.get(f"/api/v2/journals/articles/{aid}/issues", params={"module": "structuring", "issue_status": "ignored"}).json()
    assert [i["resolution"] for i in accepted] == ["accepted_at_step_signoff"]

    gated = api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={})
    assert gated.status_code == 409 and gated.json()["detail"]["step"] == "references"

    for key in ("references", "ia_rules", "technical"):
        assert api.post(f"/api/v2/journals/articles/{aid}/pre-editing/{key}/run").status_code == 200
        assert api.post(f"/api/v2/journals/articles/{aid}/pre-editing/{key}/finish", json={}).status_code == 200
    state = api.get(f"/api/v2/journals/articles/{aid}/pre-editing").json()
    assert state["all_finished"] and state["current_step"] is None

    # An editor save that introduces a structuring error reopens Structuring and locks the rest.
    from app.domains.journals.models import JournalArticle
    from app.domains.journals.pre_editing import recheck_after_edit
    fake_checks["structuring"] = [err("E2")]
    db_session.expire_all()
    recheck_after_edit(db_session, db_session.get(JournalArticle, aid))
    st = steps(api, aid)
    assert st["structuring"]["status"] == "in_progress"
    assert st["references"]["status"] == "locked" and st["references"]["was_finished"]
    assert api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={}).status_code == 409

    # Fixing it and finishing again brings the later (still finished) steps back.
    fix_errors(api, aid, "structuring")
    api.post(f"/api/v2/journals/articles/{aid}/pre-editing/structuring/finish", json={})
    assert api.get(f"/api/v2/journals/articles/{aid}/pre-editing").json()["all_finished"]
    advanced = api.post(f"/api/v2/journals/articles/{aid}/advance-stage", json={})
    assert advanced.status_code == 200, advanced.text
    assert advanced.json()["new_stage"] == "2. Language Editing"


def test_reopen_locks_later_steps(api, article_id, fake_checks):  # noqa: F811
    aid = article_id
    api.post(f"/api/v2/journals/articles/{aid}/pre-editing/structuring/run")
    api.post(f"/api/v2/journals/articles/{aid}/pre-editing/structuring/finish", json={})
    assert steps(api, aid)["references"]["status"] == "ready"
    api.post(f"/api/v2/journals/articles/{aid}/pre-editing/structuring/reopen")
    st = steps(api, aid)
    assert st["structuring"]["status"] == "in_progress" and st["references"]["status"] == "locked"


def test_ia_rules_keep_only_the_selected_rows(api, client_row, monkeypatch, tmp_path):  # noqa: F811
    from app.domains.journals.checks import ia_rules
    from app.domains.journals.models import JournalArticle  # noqa: F401
    j = api.post("/api/v2/journals", json={"client_id": client_row["id"], "journal_code": "JI", "journal_title": "JI"}).json()
    files = [("files", ("m.docx", docx_bytes("IA", "10.1/ia.1"), "application/octet-stream"))]
    aid = api.post(f"/api/v2/journals/{j['id']}/articles/upload", files=files).json()["created"][0]["id"]
    api.post(f"/api/v2/journals/articles/{aid}/process-pre-editing")

    # No IA rules selected yet: one error that points to Journal settings.
    run = api.post(f"/api/v2/journals/articles/{aid}/checks/ia_rules/run")
    assert run.status_code == 200, run.text
    issues = api.get(f"/api/v2/journals/articles/{aid}/issues", params={"module": "ia_rules", "issue_status": "open"}).json()
    assert [i["rule_id"] for i in issues] == ["IA-00"]

    catalog = api.get(f"/api/v2/journals/{j['id']}/ia-rules").json()["catalog"]
    ranges = next(r for r in catalog if r["element"] == "Ranges")
    assert api.put(f"/api/v2/journals/{j['id']}/ia-rules", json={"selected_ia_rows": [ranges]}).status_code == 200
    monkeypatch.setattr(ia_rules, "analyze_docx", lambda path: [
        {"rule_id": "range_hyphen", "category": ranges["subtype"], "rule_label": "Range style", "surface": "10-20",
         "replacement": "10–20", "para_index": 1, "match_start": 0, "severity": "warn", "source": "body", "context": "a ⟪10-20⟫ b"},
        {"rule_id": "zzz_other", "category": "not-selected", "rule_label": "Other", "surface": "x", "para_index": 1,
         "match_start": 0, "severity": "warn", "source": "body", "context": "x"},
    ])
    api.post(f"/api/v2/journals/articles/{aid}/checks/ia_rules/run")
    issues = api.get(f"/api/v2/journals/articles/{aid}/issues", params={"module": "ia_rules", "issue_status": "open"}).json()
    assert [i["rule_id"] for i in issues] == ["IA:range_hyphen"]
    # The replacement follows the selected row's preferred form ("10 to 20", "10–20" or "10-20").
    from app.processing.manuscript_core.ia_selection import annotate_with_stylesheet
    expected = annotate_with_stylesheet([{"rule_id": "range_hyphen", "surface": "10-20", "replacement": "10–20"}], [ranges])[0]["replacement"]
    assert issues[0]["severity"] == "warning" and issues[0]["suggestion"]["to"] == expected
    assert issues[0]["location"]["para_idx"] == 1


def test_ia_matcher_used_by_the_book_technical_page():
    from app.processing.manuscript_core.ia_selection import annotate_with_stylesheet
    rows = [{"element": "Ranges", "subtype": "Numeric ranges", "pattern": "en dash"},
            {"element": "Thousand separator (use/non-use)", "subtype": "Thousands", "pattern": "No comma"}]
    mapping = {"range_hyphen": ("Ranges", "Numeric ranges", "en dash")}
    found = annotate_with_stylesheet([
        {"rule_id": "range_hyphen", "surface": "10-20", "category": "te_point"},     # exact row match
        {"rule_id": "thous_sep_comma", "surface": "1,000", "category": "thousands"},  # subtype fallback
        {"rule_id": "other", "surface": "x", "category": "spelling"},
    ], rows, mapping)
    assert [f["in_stylesheet"] for f in found] == [True, True, False]
    assert found[0]["replacement"] == "10–20" and found[1]["replacement"] == "1000"


def test_upload_starts_structuring_in_the_background(api, client_row, monkeypatch):  # noqa: F811
    monkeypatch.setenv("JOURNAL_AUTO_STRUCTURE", "1")
    j = api.post("/api/v2/journals", json={"client_id": client_row["id"], "journal_code": "JA", "journal_title": "JA"}).json()
    files = [("files", ("m.docx", docx_bytes("Auto", "10.1/auto.1"), "application/octet-stream"))]
    aid = api.post(f"/api/v2/journals/{j['id']}/articles/upload", files=files).json()["created"][0]["id"]
    st = steps(api, aid)["structuring"]
    assert st["status"] in ("in_progress", "finished") and st["ran"], st
    ws = api.get(f"/api/v2/journals/articles/{aid}/workspace").json()
    assert ws["xhtml"] is not None and ws["pre_editing"]["steps"][0]["key"] == "structuring"
    # A second trigger (the editor opening) simply re-runs the step; it is not locked.
    assert api.post(f"/api/v2/journals/articles/{aid}/pre-editing/structuring/run").status_code == 200


def _load_migration():
    path = os.path.join(os.path.dirname(__file__), "..", "alembic", "versions", "0037_merge_pre_editing.py")
    spec = importlib.util.spec_from_file_location("m0037", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_renumbers_workflows_stages_and_articles():
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    mod = _load_migration()
    engine = sa.create_engine("sqlite://")
    md = sa.MetaData()
    sa.Table("journal_workflows", md, sa.Column("id", sa.Integer, primary_key=True), sa.Column("stage_numbers", sa.JSON))
    sa.Table("journal_articles", md, sa.Column("id", sa.Integer, primary_key=True), sa.Column("current_stage", sa.String))
    sa.Table("journal_stage_details", md, sa.Column("id", sa.Integer, primary_key=True), sa.Column("article_id", sa.Integer),
             sa.Column("stage_number", sa.Integer), sa.Column("stage_name", sa.String), sa.Column("stage_status", sa.String),
             sa.Column("actual_start_date", sa.DateTime), sa.Column("actual_end_date", sa.DateTime))
    sa.Table("journal_check_runs", md, sa.Column("id", sa.Integer, primary_key=True), sa.Column("module", sa.String),
             sa.Column("stage_number", sa.Integer))
    md.create_all(engine)
    with engine.begin() as conn:
        conn.execute(md.tables["journal_workflows"].insert(), [{"id": 1, "stage_numbers": [1, 2, 4, 5, 6, 7, 8]}])
        conn.execute(md.tables["journal_articles"].insert(), [{"id": 1, "current_stage": "2. Technical Editing"},
                                                              {"id": 2, "current_stage": "5. Generate InDesign"}])
        rows = [{"article_id": a, "stage_number": n, "stage_name": mod.OLD[n - 1], "stage_status": "Completed" if n < 2 else "Pending"}
                for a in (1, 2) for n in (1, 2, 4, 5, 6, 7, 8)]
        conn.execute(md.tables["journal_stage_details"].insert(), rows)
        conn.execute(md.tables["journal_check_runs"].insert(), [{"module": "technical", "stage_number": 2}, {"module": "xml", "stage_number": 4}])

        mod.op = Operations(MigrationContext.configure(conn))
        mod.upgrade()

        assert conn.execute(sa.text("select stage_numbers from journal_workflows")).scalar() in ("[1, 3, 4, 5, 6, 7]", [1, 3, 4, 5, 6, 7])
        stages = dict(conn.execute(sa.text("select current_stage, id from journal_articles")).fetchall())
        assert set(stages) == {"1. Pre-Editing", "4. Generate InDesign"}
        a1 = conn.execute(sa.text("select stage_number, stage_name, stage_status, step_state from journal_stage_details "
                                  "where article_id = 1 order by stage_number")).fetchall()
        assert [r[0] for r in a1] == [1, 3, 4, 5, 6, 7]
        assert a1[0][1] == "1. Pre-Editing" and a1[0][2] == "In-progress" and '"technical": {"status": "in_progress"' in a1[0][3]
        assert a1[1][1] == "3. XML Conversion"
        assert sorted(conn.execute(sa.text("select module, stage_number from journal_check_runs")).fetchall()) == [("technical", 1), ("xml", 3)]
