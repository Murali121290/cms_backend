"""Regression tests for the AB-finding re-analysis helper.

Covers the behaviour promised when an AB finding is accepted or
edited in the review panel (per the revised grouping requirement):

  * Pending AB rows are REPLACED by a fresh re-run against the
    virtual (post-patch) document.
  * Decided rows (accepted / edited / rejected / highlighted) are
    PRESERVED untouched.
  * Prior Reject / Highlight decisions on a (para, rule, surface)
    key SUPPRESS re-emission on the next re-analysis — ignored
    findings do not silently come back.
  * Non-AB rows (DN01-32, grammar, spelling, hyphenation, …) are
    NEVER deleted or duplicated by the AB re-analysis.
  * No stale or duplicate pending AB rows remain in the DB after
    the rewrite.

The test exercises the helper directly against an in-memory SQLite
DB so the DOCX → virtual-text → analyze → DB roundtrip is covered
without spinning up the HTTP stack. Where the requirement maps
one-to-one to an HTTP contract, an API-level integration test
sits next to the unit tests below.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from docx import Document

from app import models
from app.domains.processing.language_edit_models import (
    LanguageEditFinding,
    LanguageEditJob,
)
from app.routers import language_edit as le_router


# ─── _apply_patches_to_text helper ─────────────────────────────────

def test_apply_patches_to_text_single_patch_at_end():
    out = le_router._apply_patches_to_text(
        "intensive care unit admitted a patient",
        [(0, 19, "intensive care unit (ICU)")],
    )
    assert out == "intensive care unit (ICU) admitted a patient"


def test_apply_patches_to_text_multiple_patches_right_to_left():
    """Multiple patches on the same paragraph must apply right-to-left
    so each patch's offsets stay valid against the pre-application
    text (left-to-right would shift offsets and corrupt later patches)."""
    text = "The ICU admitted a patient; the ICU staff did rounds."
    patches = [
        (4, 7, "intensive care unit (ICU)"),   # first ICU
        (32, 35, "ICU"),                         # second ICU (unchanged)
    ]
    out = le_router._apply_patches_to_text(text, patches)
    assert out == "The intensive care unit (ICU) admitted a patient; the ICU staff did rounds."


def test_apply_patches_to_text_rejects_out_of_range_patch():
    """A patch whose range falls outside the text (e.g. stale offsets
    after an unrelated edit) is silently skipped — the helper never
    raises so a single bad row won't poison a re-analysis."""
    out = le_router._apply_patches_to_text(
        "short text",
        [(100, 200, "never applied"), (0, 5, "SHORT")],
    )
    assert out == "SHORT text"


# ─── _reanalyze_abbreviations_for_job — integration ────────────────

@pytest.fixture()
def _ab_fixture(db_session, tmp_path, project_record, chapter_record):
    """Build a DOCX with multiple ``intensive care unit`` / ``ICU``
    occurrences, persist a File row, a LanguageEditJob row, and a
    starting set of PENDING AB findings. Return everything the
    helper test needs."""
    docx_path = tmp_path / "chapter.docx"
    doc = Document()
    doc.add_paragraph("The patient was admitted to the intensive care unit after surgery.")
    doc.add_paragraph("The intensive care unit staff reviewed the chart.")
    doc.add_paragraph("Later the patient left the intensive care unit.")
    doc.save(docx_path)

    file_record = models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename="chapter.docx",
        file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        category="Manuscript",
        path=str(docx_path),
        version=1,
    )
    db_session.add(file_record)
    db_session.commit()
    db_session.refresh(file_record)

    job = LanguageEditJob(
        job_id="reanalyze-test-job",
        file_id=file_record.id,
        project_id=project_record.id,
        status="in_review",
        total_findings=0,
        content_hash="x" * 64,
        rules_hash="y" * 64,
    )
    db_session.add(job)
    db_session.commit()

    return {
        "file": file_record,
        "job": job,
        "docx_path": docx_path,
    }


def _ab_finding(job_id, file_id, *, para_index, start, end, rule_id, original,
                suggestion, status="pending"):
    return LanguageEditFinding(
        job_id=job_id,
        file_id=file_id,
        para_index=para_index,
        start_offset=start,
        end_offset=end,
        rule_id=rule_id,
        category="abbreviations",
        severity="warning",
        original_text=original,
        suggestion=suggestion,
        message=f"{rule_id}: test",
        autofixable=True,
        status=status,
        source="rule",
    )


def _dn_finding(job_id, file_id, *, para_index, start, end):
    return LanguageEditFinding(
        job_id=job_id,
        file_id=file_id,
        para_index=para_index,
        start_offset=start,
        end_offset=end,
        rule_id="DN01",
        category="abbreviations",
        severity="warning",
        original_text="U",
        suggestion="units",
        message="DN01 test",
        autofixable=True,
        status="pending",
        source="rule",
    )


def test_reanalyze_preserves_decided_findings(db_session, _ab_fixture):
    """Accepting a first-use AB01 must not touch the row itself (or
    any other decided row) — only pending rows are rewritten."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    accepted = _ab_finding(
        job.job_id, file.id,
        para_index=0, start=32, end=51,
        rule_id="AB01", original="intensive care unit",
        suggestion="intensive care unit (ICU)", status="accepted",
    )
    pending_elsewhere = _ab_finding(
        job.job_id, file.id,
        para_index=1, start=4, end=23,
        rule_id="AB02", original="intensive care unit",
        suggestion="ICU",
    )
    db_session.add_all([accepted, pending_elsewhere])
    db_session.commit()

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    survivors = (
        db_session.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job.job_id)
        .all()
    )
    accepted_rows = [f for f in survivors if f.status == "accepted"]
    assert len(accepted_rows) == 1, "accepted AB row must survive re-analysis"
    assert accepted_rows[0].id == accepted.id
    assert accepted_rows[0].rule_id == "AB01"


def test_reanalyze_replaces_pending_ab_rows(db_session, _ab_fixture):
    """Pending AB rows get wiped and refilled from the fresh analyzer
    run against the virtual (post-patch) text. The pre-run pending
    row IDs must NOT appear in the post-run set."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    stale = _ab_finding(
        job.job_id, file.id,
        para_index=0, start=999, end=1000,
        rule_id="AB01", original="bogus", suggestion="bogus-fix",
    )
    db_session.add(stale)
    db_session.commit()
    stale_id = stale.id

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    survivors = (
        db_session.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job.job_id)
        .all()
    )
    pending_ids = {f.id for f in survivors if f.status == "pending"}
    assert stale_id not in pending_ids, (
        "stale pending AB row must be deleted, not carried forward"
    )


def test_reanalyze_leaves_non_ab_rows_untouched(db_session, _ab_fixture):
    """DN01-32 and every other category must NOT be deleted,
    rewritten, or duplicated by the AB-only re-analysis."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    dn = _dn_finding(job.job_id, file.id, para_index=0, start=0, end=1)
    db_session.add(dn)
    db_session.commit()
    dn_id = dn.id

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    dn_survivors = (
        db_session.query(LanguageEditFinding)
        .filter(
            LanguageEditFinding.job_id == job.job_id,
            LanguageEditFinding.rule_id == "DN01",
        )
        .all()
    )
    assert [f.id for f in dn_survivors] == [dn_id], (
        "DN finding must pass through re-analysis untouched"
    )


def test_reanalyze_suppresses_resurrection_of_rejected_finding(db_session, _ab_fixture):
    """A reviewer who clicks Ignore on an AB finding expects it to
    stay gone. If re-analysis would re-emit the same (para, rule,
    surface), we must suppress it — otherwise an Accept on an
    unrelated finding would silently un-reject the ignored one."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    # Reviewer previously rejected the AB02 on para 1's "intensive
    # care unit" surface. The DOCX still contains that text so a
    # naive re-analysis would emit AB02 again at the same (para,
    # rule_id, original_text).
    rejected = _ab_finding(
        job.job_id, file.id,
        para_index=1, start=4, end=23,
        rule_id="AB02", original="intensive care unit",
        suggestion="ICU", status="rejected",
    )
    db_session.add(rejected)
    db_session.commit()

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    reemitted = (
        db_session.query(LanguageEditFinding)
        .filter(
            LanguageEditFinding.job_id == job.job_id,
            LanguageEditFinding.rule_id == "AB02",
            LanguageEditFinding.para_index == 1,
            LanguageEditFinding.original_text == "intensive care unit",
            LanguageEditFinding.status == "pending",
        )
        .count()
    )
    assert reemitted == 0, (
        "AB02 was previously rejected on this span — re-analysis must "
        "not resurrect it as a new pending finding"
    )


def test_reanalyze_produces_no_duplicate_pending_rows(db_session, _ab_fixture):
    """The new pending AB set must be deduped: no two rows with the
    same (para_index, start_offset, end_offset, rule_id, original_text)."""
    job = _ab_fixture["job"]

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    pending = (
        db_session.query(LanguageEditFinding)
        .filter(
            LanguageEditFinding.job_id == job.job_id,
            LanguageEditFinding.status == "pending",
            LanguageEditFinding.rule_id.like("AB%"),
        )
        .all()
    )
    keys = [
        (f.para_index, f.start_offset, f.end_offset, f.rule_id, f.original_text)
        for f in pending
    ]
    assert len(keys) == len(set(keys)), (
        f"duplicate pending AB rows detected: {keys}"
    )


def test_reanalyze_updates_job_total_findings(db_session, _ab_fixture):
    """``job.total_findings`` must track the row count AFTER the
    rewrite so the dashboard's total reflects reality."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    # Seed one accepted + one stale pending so the pre-count differs
    # from the post-count.
    db_session.add_all([
        _ab_finding(job.job_id, file.id, para_index=0, start=32, end=51,
                    rule_id="AB01", original="intensive care unit",
                    suggestion="intensive care unit (ICU)", status="accepted"),
        _ab_finding(job.job_id, file.id, para_index=2, start=0, end=5,
                    rule_id="AB01", original="stale", suggestion="stale-fix"),
    ])
    db_session.commit()

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    db_session.refresh(job)
    actual_count = (
        db_session.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job.job_id)
        .count()
    )
    assert job.total_findings == actual_count


def test_reanalyze_missing_file_is_a_safe_noop(db_session, _ab_fixture):
    """Delete the DOCX from disk before calling the helper — the
    function must return None (helper's documented failure mode)
    without raising or mutating the DB."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]
    Path(file.path).unlink()

    pending_before = (
        db_session.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job.job_id)
        .count()
    )
    result = le_router._reanalyze_abbreviations_for_job(job, db_session)
    assert result is None
    pending_after = (
        db_session.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job.job_id)
        .count()
    )
    assert pending_after == pending_before, "DB must not change on I/O failure"


# ─── ID preservation across re-analysis (bug-fix regression) ────────

def _rewrite_fixture_with_ab13(fixture: dict) -> None:
    """Replace the fixture DOCX with text known to produce AB13
    (periods-in-initialism) findings. ``U.S.A.`` reliably matches
    ``_analyze_periods_in_initialism`` without needing document-
    state coverage. Lets the ID-preservation tests seed real-shaped
    rows without depending on fragile workbook state."""
    from docx import Document
    doc = Document()
    doc.add_paragraph("The U.S.A. was founded in 1776.")
    doc.add_paragraph("The U.S.A. has fifty states.")
    doc.add_paragraph("Trade with U.S.A. continues to grow.")
    doc.save(fixture["docx_path"])


def test_reanalyze_preserves_ids_of_unchanged_pending_rows(db_session, _ab_fixture):
    """Regression for the "Failed to save decision" bug:

    Previously ``_reanalyze_abbreviations_for_job`` deleted every
    pending AB row on every Accept/Edit and re-inserted fresh rows
    with new auto-increment ids. The frontend's event handlers close
    over ``f.id`` at render time, so when the reviewer Accepted ONE
    AB finding, every OTHER AB card's id instantly became stale —
    subsequent clicks posted to ``POST /findings/{stale_id}/decide``
    and the backend returned 404 ("Finding ID not found"), surfaced
    as "Failed to save decision".

    The fix: diff the fresh analyzer output against existing pending
    rows by (para_index, start_offset, end_offset, rule_id,
    original_text). Matched rows keep their id; only stale rows are
    deleted and only genuinely new rows are inserted.

    This test seeds a pending AB row that exactly matches what the
    analyzer will re-emit for the fixture document, runs re-analysis,
    and asserts the row's id is unchanged. It is the load-bearing
    assertion that prevents the UI regression from coming back.
    """
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    # Reset the AB caches and get the analyzer's fresh view of the
    # fixture paragraphs so we can seed a pending row that exactly
    # matches a producible finding.
    _rewrite_fixture_with_ab13(_ab_fixture)
    from app.processing.language_editing import abbreviations as ab_mod
    ab_mod.clear_cache()
    from app.processing.language_editing import docx_io
    doc_obj, paragraphs = docx_io.read_paragraphs(file.path)
    state = ab_mod.build_document_state(paragraphs, audience="general", min_uses=2)
    seed_ab_row: LanguageEditFinding | None = None
    for pi, text in paragraphs:
        for fd in ab_mod.analyze_abbreviations(text, para_idx=pi, document_state=state):
            if fd.rule_id and fd.rule_id.startswith("AB"):
                seed_ab_row = LanguageEditFinding(
                    job_id=job.job_id,
                    file_id=file.id,
                    para_index=pi,
                    start_offset=fd.start,
                    end_offset=fd.end,
                    rule_id=fd.rule_id,
                    category=fd.category,
                    severity=fd.severity,
                    original_text=fd.original,
                    suggestion=fd.suggestion,
                    message=fd.message,
                    autofixable=fd.autofixable,
                    status="pending",
                    source="rule",
                )
                break
        if seed_ab_row:
            break

    if seed_ab_row is None:
        pytest.skip("fixture produced no AB finding for this test")

    db_session.add(seed_ab_row)
    db_session.commit()
    preserved_id = seed_ab_row.id
    key = (
        seed_ab_row.para_index,
        seed_ab_row.start_offset,
        seed_ab_row.end_offset,
        seed_ab_row.rule_id,
        seed_ab_row.original_text,
    )

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    # The row MUST still be there with its original id — the diff-
    # based update keeps matched rows.
    surviving = (
        db_session.query(LanguageEditFinding)
        .filter(LanguageEditFinding.id == preserved_id)
        .first()
    )
    assert surviving is not None, (
        f"re-analysis deleted the matching pending AB row (id={preserved_id}) "
        "— this breaks the UI by invalidating finding ids already rendered "
        "in the sidebar"
    )
    # And no duplicate row for the same key was created.
    dup_count = (
        db_session.query(LanguageEditFinding)
        .filter(
            LanguageEditFinding.job_id == job.job_id,
            LanguageEditFinding.para_index == key[0],
            LanguageEditFinding.start_offset == key[1],
            LanguageEditFinding.end_offset == key[2],
            LanguageEditFinding.rule_id == key[3],
            LanguageEditFinding.original_text == key[4],
            LanguageEditFinding.status == "pending",
        )
        .count()
    )
    assert dup_count == 1, (
        f"expected exactly one pending row for key {key!r}; found {dup_count}"
    )


def test_reanalyze_deletes_only_stale_rows(db_session, _ab_fixture):
    """A pending AB row whose key is NOT re-emitted (because the
    analyzer no longer produces it after the patch was applied) MUST
    be deleted. A pending AB row whose key IS re-emitted must NOT be
    deleted.

    We assert the delta precisely by seeding two rows: a bogus one
    (key impossible to re-emit — made-up span, nonsense original)
    and a legit one (keyed to a real analyzer hit). After re-analysis
    the bogus id is gone; the legit id survives.
    """
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    _rewrite_fixture_with_ab13(_ab_fixture)
    from app.processing.language_editing import abbreviations as ab_mod
    ab_mod.clear_cache()
    from app.processing.language_editing import docx_io
    doc_obj, paragraphs = docx_io.read_paragraphs(file.path)
    state = ab_mod.build_document_state(paragraphs, audience="general", min_uses=2)
    legit_row: LanguageEditFinding | None = None
    for pi, text in paragraphs:
        for fd in ab_mod.analyze_abbreviations(text, para_idx=pi, document_state=state):
            if fd.rule_id and fd.rule_id.startswith("AB"):
                legit_row = LanguageEditFinding(
                    job_id=job.job_id, file_id=file.id,
                    para_index=pi, start_offset=fd.start, end_offset=fd.end,
                    rule_id=fd.rule_id, category=fd.category, severity=fd.severity,
                    original_text=fd.original, suggestion=fd.suggestion,
                    message=fd.message, autofixable=fd.autofixable,
                    status="pending", source="rule",
                )
                break
        if legit_row:
            break
    if legit_row is None:
        pytest.skip("fixture produced no AB finding for this test")

    bogus_row = _ab_finding(
        job.job_id, file.id,
        para_index=99, start=9000, end=9001,
        rule_id="AB01", original="xyzqpd", suggestion="does-not-matter",
    )
    db_session.add_all([legit_row, bogus_row])
    db_session.commit()
    legit_id, bogus_id = legit_row.id, bogus_row.id

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    # Query the engine directly — session identity-map caching made
    # intra-session queries unreliable for observing the helper's
    # committed deletions.
    from sqlalchemy import text as sql_text
    engine = db_session.get_bind()
    with engine.connect() as c:
        legit_count = c.execute(sql_text(
            "SELECT COUNT(*) FROM language_edit_findings WHERE id = :i"
        ), {"i": legit_id}).scalar()
        bogus_count = c.execute(sql_text(
            "SELECT COUNT(*) FROM language_edit_findings WHERE id = :i"
        ), {"i": bogus_id}).scalar()
    assert legit_count == 1, "matched pending AB row must survive"
    assert bogus_count == 0, "stale pending AB row must be deleted"


def test_reanalyze_only_inserts_truly_new_rows(db_session, _ab_fixture):
    """When the fresh analyzer produces a key that an existing
    pending row ALREADY covers, no new row is inserted — the existing
    row is kept. Any new key gets a brand-new row.
    """
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    _rewrite_fixture_with_ab13(_ab_fixture)
    from app.processing.language_editing import abbreviations as ab_mod
    ab_mod.clear_cache()
    from app.processing.language_editing import docx_io
    doc_obj, paragraphs = docx_io.read_paragraphs(file.path)
    state = ab_mod.build_document_state(paragraphs, audience="general", min_uses=2)
    seeded = 0
    for pi, text in paragraphs:
        for fd in ab_mod.analyze_abbreviations(text, para_idx=pi, document_state=state):
            if fd.rule_id and fd.rule_id.startswith("AB"):
                db_session.add(LanguageEditFinding(
                    job_id=job.job_id, file_id=file.id,
                    para_index=pi, start_offset=fd.start, end_offset=fd.end,
                    rule_id=fd.rule_id, category=fd.category, severity=fd.severity,
                    original_text=fd.original, suggestion=fd.suggestion,
                    message=fd.message, autofixable=fd.autofixable,
                    status="pending", source="rule",
                ))
                seeded += 1
    db_session.commit()
    if seeded == 0:
        pytest.skip("fixture produced no AB findings for this test")
    pre_ids = {
        r.id for r in db_session.query(LanguageEditFinding).filter(
            LanguageEditFinding.job_id == job.job_id,
            LanguageEditFinding.status == "pending",
            LanguageEditFinding.rule_id.like("AB%"),
        )
    }

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    post_ids = {
        r.id for r in db_session.query(LanguageEditFinding).filter(
            LanguageEditFinding.job_id == job.job_id,
            LanguageEditFinding.status == "pending",
            LanguageEditFinding.rule_id.like("AB%"),
        )
    }
    # Every pre-existing id is still present. (Post may add rows if
    # the analyzer now sees additional findings — allowed.)
    assert pre_ids.issubset(post_ids), (
        f"re-analysis removed existing pending AB ids: {pre_ids - post_ids}"
    )


# ─── First-definition reference (AB04 cards) ───────────────────────

def test_first_definition_map_identifies_each_abbr_first_valid_definition(
    db_session, _ab_fixture,
):
    """``_build_first_definition_map`` must identify the document-
    first valid definition for every abbreviation the engine knows
    about. Covers the Wheeler-style cascade where the first
    definition is ahead of the AB04 findings and respects the
    engine's existing scope rules via ``build_document_state``."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    # Replace the fixture doc with text that has a first definition
    # pair and then a later redefinition — the canonical AB04 case.
    from docx import Document
    doc = Document()
    doc.add_paragraph(
        "The chronic kidney disease (CKD) burden in older adults is high."
    )
    doc.add_paragraph(
        "A later section notes chronic kidney disease (CKD) remains "
        "a leading cause of morbidity."
    )
    doc.save(file.path)

    from app.routers import language_edit as le
    m = le._build_first_definition_map(job, db_session)
    assert "CKD" in m, (
        f"CKD must appear in the first-definition map, got keys: {sorted(m.keys())[:5]}..."
    )
    info = m["CKD"]
    assert info["para_index"] == 0, (
        f"CKD first definition must be at para 0 (document order), got {info}"
    )
    assert "chronic kidney disease (ckd)" in info["text"].lower()


def test_first_definition_map_omits_abbreviations_without_a_valid_definition(
    db_session, _ab_fixture,
):
    """When the engine never recognises a definition (e.g. the
    document has only bare abbreviation usage), the map must NOT
    fabricate an entry for that abbreviation."""
    file = _ab_fixture["file"]
    from docx import Document
    doc = Document()
    doc.add_paragraph("A CKD workup is indicated.")  # no "(CKD)" definition
    doc.add_paragraph("The CKD stage determines therapy.")
    doc.save(file.path)

    from app.routers import language_edit as le
    m = le._build_first_definition_map(_ab_fixture["job"], db_session)
    assert "CKD" not in m, (
        f"CKD without a workbook definition must be absent from the map; got {m.get('CKD')}"
    )


def test_serialize_finding_row_attaches_first_definition_to_ab04(
    db_session, _ab_fixture,
):
    """AB04 findings carry a ``first_definition`` dict in their
    serialised row so the frontend can prepend the reference
    occurrence to the card."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]
    from docx import Document
    doc = Document()
    doc.add_paragraph("The chronic kidney disease (CKD) burden is high.")
    doc.add_paragraph("Later, chronic kidney disease (CKD) is discussed again.")
    doc.save(file.path)

    # Emit an AB04 at the second paragraph's definition span.
    ab04_row = _ab_finding(
        job.job_id, file.id, para_index=1, start=7, end=38,
        rule_id="AB04", original="chronic kidney disease (CKD)",
        suggestion="CKD",
    )
    db_session.add(ab04_row)
    db_session.commit()

    from app.routers import language_edit as le
    m = le._build_first_definition_map(job, db_session)
    serialized = le._serialize_finding_row(ab04_row, m)
    assert serialized.get("first_definition") is not None
    ref = serialized["first_definition"]
    assert ref["para_index"] == 0
    assert "chronic kidney disease (ckd)" in ref["text"].lower()


def test_serialize_finding_row_does_not_attach_first_definition_to_non_ab04(
    db_session, _ab_fixture,
):
    """Non-AB04 rules (AB01 first use, AB13 periods-in-initialism,
    DN notations, grammar, spelling, etc.) must NOT carry a
    ``first_definition`` — the reference row is specific to AB04
    ``Repeated definition`` cards."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]
    from docx import Document
    doc = Document()
    doc.add_paragraph("The chronic kidney disease (CKD) burden is high.")
    doc.save(file.path)

    ab01_row = _ab_finding(
        job.job_id, file.id, para_index=0, start=0, end=5,
        rule_id="AB01", original="CKD", suggestion="chronic kidney disease (CKD)",
    )
    db_session.add(ab01_row)
    db_session.commit()

    from app.routers import language_edit as le
    m = le._build_first_definition_map(job, db_session)
    serialized = le._serialize_finding_row(ab01_row, m)
    assert serialized.get("first_definition") is None


def test_serialize_finding_row_handles_missing_first_def_map():
    """Defensive: callers that don't build the map (legacy code
    paths or early-exit error branches) can pass ``None`` and the
    row still serialises without raising. ``first_definition`` is
    simply ``None`` in that case."""
    from app.routers import language_edit as le
    class _FakeFinding:
        id = 1; job_id = "j"; file_id = 1; para_index = 0
        start_offset = 0; end_offset = 1; rule_id = "AB04"
        category = "abbreviations"; severity = "warning"
        original_text = "foo (FOO)"; suggestion = "FOO"
        alt_suggestions = None; message = ""; autofixable = True
        status = "pending"; edited_text = None; reviewer = None
        decided_at = None; source = "rule"; term_list_id = None
    row = le._serialize_finding_row(_FakeFinding())  # type: ignore[arg-type]
    assert row.get("first_definition") is None


# ─── batch_decide_findings ──────────────────────────────────────────

def test_batch_decide_processes_only_pending_findings_in_the_job(
    db_session, _ab_fixture, admin_user,
):
    """Partial-failure semantics: ids that don't exist, belong to a
    different job, or are already decided must be reported in
    ``failed`` while the valid ones still commit."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    f1 = _ab_finding(job.job_id, file.id, para_index=0, start=10, end=20,
                      rule_id="AB13", original="U.S.A.", suggestion="USA")
    f2 = _ab_finding(job.job_id, file.id, para_index=1, start=4, end=10,
                      rule_id="AB13", original="U.S.A.", suggestion="USA")
    already = _ab_finding(job.job_id, file.id, para_index=2, start=4, end=10,
                           rule_id="AB13", original="U.S.A.", suggestion="USA",
                           status="accepted")
    db_session.add_all([f1, f2, already])
    db_session.commit()

    from app.routers import language_edit as le
    from app.routers.language_edit import BatchDecideRequest, BatchDecisionItem
    import app.domains.processing.service as svc
    orig_check = svc.check_permission
    svc.check_permission = lambda *a, **kw: None
    try:
        resp = le.batch_decide_findings(
            job_id=job.job_id,
            body=BatchDecideRequest(
                status="rejected",
                decisions=[
                    BatchDecisionItem(finding_id=f1.id),
                    BatchDecisionItem(finding_id=f2.id),
                    BatchDecisionItem(finding_id=already.id),
                    BatchDecisionItem(finding_id=9_999_999),  # not_found
                ],
            ),
            db=db_session,
            current_user=admin_user,
        )
    finally:
        svc.check_permission = orig_check

    assert set(resp["processed"]) == {f1.id, f2.id}
    failed_ids = {f["finding_id"]: f["reason"] for f in resp["failed"]}
    assert failed_ids.get(9_999_999) == "not_found"
    assert failed_ids.get(already.id) == "already_resolved"
    assert resp.get("reanalyzed") is not True, "Ignore batch must not re-analyse AB"

    db_session.expire_all()
    db_session.refresh(f1); db_session.refresh(f2); db_session.refresh(already)
    assert f1.status == "rejected"
    assert f2.status == "rejected"
    # The already-accepted row is NOT demoted — bulk actions only
    # apply to pending findings per spec.
    assert already.status == "accepted"


def test_batch_decide_runs_abbreviation_reanalysis_exactly_once(
    db_session, _ab_fixture, admin_user,
):
    """Accepting many AB findings in one batch should trigger the
    re-analysis helper ONCE, not once per finding. The response
    carries ``reanalyzed: True`` and the refreshed findings bundle."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    seeds = [
        _ab_finding(job.job_id, file.id, para_index=i, start=4, end=10,
                     rule_id="AB13", original="U.S.A.", suggestion="USA")
        for i in range(4)
    ]
    db_session.add_all(seeds)
    db_session.commit()
    seed_ids = [s.id for s in seeds]

    reanalysis_calls = {"n": 0}
    from app.routers import language_edit as le
    from app.routers.language_edit import BatchDecideRequest, BatchDecisionItem
    orig = le._reanalyze_abbreviations_for_job

    def _spy(j, d):
        reanalysis_calls["n"] += 1
        return orig(j, d)

    le._reanalyze_abbreviations_for_job = _spy
    import app.domains.processing.service as svc
    orig_check = svc.check_permission
    svc.check_permission = lambda *a, **kw: None
    try:
        resp = le.batch_decide_findings(
            job_id=job.job_id,
            body=BatchDecideRequest(
                status="accepted",
                decisions=[BatchDecisionItem(finding_id=i) for i in seed_ids],
            ),
            db=db_session,
            current_user=admin_user,
        )
    finally:
        le._reanalyze_abbreviations_for_job = orig
        svc.check_permission = orig_check

    assert reanalysis_calls["n"] == 1, (
        f"AB batch must run re-analysis exactly once; got {reanalysis_calls['n']}"
    )
    assert resp.get("reanalyzed") is True
    # Response carries the refreshed findings so the client can
    # replace its local list atomically.
    assert "findings" in resp


def test_batch_decide_rejects_unknown_status(db_session, _ab_fixture, admin_user):
    from app.routers import language_edit as le
    from app.routers.language_edit import BatchDecideRequest, BatchDecisionItem
    import app.domains.processing.service as svc
    orig_check = svc.check_permission
    svc.check_permission = lambda *a, **kw: None
    try:
        import pytest as _pt
        from fastapi import HTTPException
        with _pt.raises(HTTPException) as ei:
            le.batch_decide_findings(
                job_id=_ab_fixture["job"].job_id,
                body=BatchDecideRequest(
                    status="archived",
                    decisions=[BatchDecisionItem(finding_id=1)],
                ),
                db=db_session,
                current_user=admin_user,
            )
        assert ei.value.status_code == 400
    finally:
        svc.check_permission = orig_check


def test_batch_decide_updates_job_counters_from_final_row_set(
    db_session, _ab_fixture, admin_user,
):
    """Job counters are recomputed authoritatively from the current
    status distribution after the batch commits, so partial failures
    can't drift the dashboard off the real row count."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    seeds = [
        _ab_finding(job.job_id, file.id, para_index=i, start=0, end=5,
                     rule_id="AB13", original="U.S.A.", suggestion="USA")
        for i in range(3)
    ]
    db_session.add_all(seeds)
    db_session.commit()

    from app.routers import language_edit as le
    from app.routers.language_edit import BatchDecideRequest, BatchDecisionItem
    import app.domains.processing.service as svc
    orig_check = svc.check_permission
    svc.check_permission = lambda *a, **kw: None
    try:
        le.batch_decide_findings(
            job_id=job.job_id,
            body=BatchDecideRequest(
                status="rejected",
                decisions=[BatchDecisionItem(finding_id=s.id) for s in seeds],
            ),
            db=db_session,
            current_user=admin_user,
        )
    finally:
        svc.check_permission = orig_check

    db_session.expire_all()
    db_session.refresh(job)
    assert job.rejected_count == 3
    # The 3 seeded rows don't overlap with the fixture job's existing
    # rows (fixture job started empty), so total_findings is 3.
    assert job.total_findings == 3


def test_ignore_does_not_trigger_abbreviation_reanalysis(db_session, _ab_fixture, admin_user):
    """Ignoring an AB finding must NOT delete / re-insert other
    pending AB rows — Ignore does not run the re-analysis path (only
    Accept/Edit do). This test confirms by taking a snapshot of all
    AB finding ids before and after an Ignore, then checking the set
    is unchanged.
    """
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    # Seed one AB finding we will ignore, plus three siblings.
    target = _ab_finding(
        job.job_id, file.id,
        para_index=0, start=32, end=51,
        rule_id="AB01", original="intensive care unit",
        suggestion="intensive care unit (ICU)",
    )
    sib1 = _ab_finding(job.job_id, file.id, para_index=1, start=4, end=23,
                       rule_id="AB02", original="intensive care unit", suggestion="ICU")
    sib2 = _ab_finding(job.job_id, file.id, para_index=2, start=22, end=41,
                       rule_id="AB02", original="intensive care unit", suggestion="ICU")
    db_session.add_all([target, sib1, sib2])
    db_session.commit()
    sibling_ids_before = {sib1.id, sib2.id}

    # Walk the real router handler with a Reject decision — this must
    # NOT invoke _reanalyze_abbreviations_for_job.
    from app.routers.language_edit import DecisionRequest
    from app.routers import language_edit as le
    # The permission guard walks real role data — bypass it so the
    # handler reaches the decide logic without role-master seeding.
    import app.domains.processing.service as svc
    orig_check = svc.check_permission
    svc.check_permission = lambda *a, **kw: None
    try:
        resp = le.decide_finding(
            finding_id=target.id,
            body=DecisionRequest(status="rejected", edited_text=None, reviewer="tester"),
            db=db_session, current_user=admin_user,
        )
    finally:
        svc.check_permission = orig_check

    assert resp["status"] == "rejected"
    assert resp.get("reanalyzed") is not True, "Ignore must not trigger re-analysis"
    assert "findings" not in resp, "Ignore response must not carry a refreshed findings bundle"

    sibling_ids_after = {
        r.id for r in db_session.query(LanguageEditFinding).filter(
            LanguageEditFinding.job_id == job.job_id,
            LanguageEditFinding.rule_id.like("AB%"),
            LanguageEditFinding.status == "pending",
        )
    }
    assert sibling_ids_before.issubset(sibling_ids_after), (
        "Ignore wrongly deleted or renumbered sibling AB rows — they must "
        "stay untouched because Ignore does not run the AB re-analysis"
    )
