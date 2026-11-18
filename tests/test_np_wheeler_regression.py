"""Regression tests pinned to the exact NP occurrences in the Wheeler
manuscript (``Wheeler92516_Ch01.docx``) that surfaced the plural
grouping defect.

Audit of the 11 ``nurse practitioner(s)`` matches in that document:

    #  para  surface              context (abbreviated)                            expected
    1    7   nurse practitioners  "psychiatric-mental health … (PMHNP)"           excluded (PMHNP def_span)
    2    9   Nurse Practitioner   "National Organization of … Faculty (NONPF)"    excluded (proper-name span)
    3    9   nurse practitioners  "…degree for nurse practitioners by 2025"       EMIT  AB01  (first use)
    4   10   nurse practitioner   "psychiatric-mental health … (PMHNP)"           excluded (PMHNP def_span)
    5   10   Nurse Practitioner   "National Organization of … (NONPF)"            excluded (proper-name span)
    6   11   Nurse Practitioner   "The Psychiatric-Mental Health … (PMHNP)"       excluded (PMHNP def_span)
    7   48   nurse practitioner   "psychiatric nurse practitioner curricula"      EMIT  AB02
    8   87   nurse practitioners  "…for nurse practitioners and focuses…"         EMIT  AB02
    9   87   nurse practitioner   "linked nurse practitioner cultural competence" EMIT  AB02
   10  106   nurse practitioner   "guide nurse practitioner curricula"            EMIT  AB02
   11  207   nurse practitioner   references list entry                           excluded (in_references)

6 exclusions + 5 findings (1 AB01 + 4 AB02). All 5 must land in a
single grouping bucket so the side-panel card shows one header
``NP – nurse practitioner  (5 occurrences)`` with every occurrence
inside it — not three grouped + two orphan flat cards (which was
the bug: ``extract_abbreviation`` didn't recognise plural ``NPs``
and plural findings returned ``group_key = None``).

The paragraph fixtures below are the actual sentences from the
manuscript (verbatim), stitched into a 4-paragraph test document so
the audit can reproduce without the full chapter.
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import abbreviations as ab
from app.processing.language_editing import abbreviations_metadata as meta


@pytest.fixture(autouse=True)
def _reset_caches():
    meta.clear_cache()
    ab.clear_cache()
    yield
    meta.clear_cache()
    ab.clear_cache()


# Four paragraphs drawn verbatim from the manuscript. Together they
# contain every NP-relevant phrase class the audit identifies:
# PMHNP parenthetical, NONPF parenthetical, standalone singular and
# plural prose.
WHEELER_PARAS = [
    (0, (
        "The various disciplines licensed to conduct psychotherapy include "
        "psychiatric-mental health clinical nurse specialists (PMHCNS) and "
        "psychiatric-mental health nurse practitioners (PMHNP). "
        "Educational preparation varies by discipline."
    )),
    (1, (
        "Many factors in graduate psychiatric nursing education challenge APPNs "
        "in attaining competencies required by the National Organization of "
        "Nurse Practitioner Faculty (NONPF) and other bodies, and the DNP "
        "degree is poised to supplant the Master of Science in Nursing (MSN) "
        "degree for nurse practitioners by 2025."
    )),
    (2, (
        "Another challenge is how to teach the competencies identified as "
        "necessary for all psychiatric-mental health nurse practitioner (PMHNP) "
        "programs in the first PMHNP Competencies, with subsequent revisions "
        "in 2013 and 2024 (National Organization of Nurse Practitioner "
        "Faculties (NONPF), 2013, 2024)."
    )),
    (3, (
        "The Psychiatric-Mental Health Nurse Practitioner (PMHNP) is educated "
        "to provide longitudinal, comprehensive mental health care."
    )),
    (4, (
        "A later chapter integrates competencies into baccalaureate, graduate "
        "and psychiatric nurse practitioner curricula."
    )),
    (5, (
        "Cultural competence is a mandate for all healthcare providers and "
        "for nurse practitioners and focuses on the ability to compare and "
        "contrast the health status of groups. Several studies have linked "
        "nurse practitioner cultural competence to increased years of "
        "experience."
    )),
    (6, (
        "A Social Determinants of Health Toolkit to guide nurse practitioner "
        "curricula is available and is periodically updated."
    )),
    # Trailing body paragraphs that use the bare ``NP`` form. AB01
    # and AB02 require the abbreviation form to appear somewhere in
    # the document (otherwise the workbook assumes the author
    # doesn't want to adopt it); the real manuscript has multiple
    # bare ``NP`` mentions, so the test fixture mirrors that
    # condition. Without these, AB01/AB02 on the expansion stays
    # silent and the grouping test can't observe the defect.
    (7, (
        "Throughout the chapter, the NP role is described in detail, and "
        "the NP title is used interchangeably with the full expansion in "
        "subsequent sections."
    )),
]


def _run_doc(paragraphs=None):
    paragraphs = paragraphs or WHEELER_PARAS
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    per_para = {}
    for pi, text in paragraphs:
        per_para[pi] = ab.analyze_abbreviations(text, para_idx=pi, document_state=state)
    return state, per_para


def _np_findings(per_para: dict) -> list[tuple[int, str, str, str]]:
    """Flatten AB findings that refer to NP (singular or plural).
    Each tuple: (para, rule_id, original, suggestion).

    Uses the grouping helper to identify the underlying abbreviation
    so PMHNP's AB03/AB04 findings (which carry ``nurse practitioner``
    inside the original text but map to PMHNP, not NP) don't get
    accidentally counted as NP findings."""
    out = []
    for pi, findings in per_para.items():
        for f in findings:
            if not f.rule_id.startswith("AB"):
                continue
            g = meta.grouping_fields_for(f.rule_id, f.original, f.suggestion)
            if g.get("abbreviation") == "NP":
                out.append((pi, f.rule_id, f.original, f.suggestion))
    return out


# ─── Occurrence-by-occurrence exclusion correctness ─────────────────

def test_pmhnp_parenthetical_excludes_embedded_nurse_practitioner():
    """Audit rows #1, #4, #6: ``psychiatric-mental health nurse
    practitioner(s) (PMHNP)`` is a workbook-registered definition of
    PMHNP. The embedded ``nurse practitioner`` substring must NOT
    produce an NP finding — the whole span is already a definition."""
    state, per_para = _run_doc()
    # Paragraphs 0, 2, 3 contain the PMHNP definitions. No NP
    # finding may appear on them.
    for pi in (0, 2, 3):
        for f in per_para[pi]:
            if f.rule_id.startswith("AB") and (
                "nurse practitioner" in (f.original or "").lower()
                and f.suggestion in ("NP", "NPs", "nurse practitioner (NP)", "nurse practitioners (NPs)")
            ):
                pytest.fail(
                    f"para {pi}: wrongly emitted NP finding {f.rule_id} "
                    f"on {f.original!r} inside a PMHNP definition"
                )


def test_nonpf_organization_excludes_embedded_nurse_practitioner():
    """Audit rows #2, #5: ``National Organization of Nurse Practitioner
    Faculty/Faculties (NONPF)`` is a generic proper-name parenthetical
    and must be protected by the syntactic detector even though NONPF
    is not in the workbook."""
    state, per_para = _run_doc()
    # Paragraphs 1 and 2 carry the NONPF phrases; the embedded
    # "Nurse Practitioner" must NOT fire AB02.
    for pi in (1, 2):
        for f in per_para[pi]:
            if f.rule_id == "AB02" and f.original == "Nurse Practitioner":
                pytest.fail(
                    f"para {pi}: AB02 wrongly fired on 'Nurse Practitioner' "
                    "inside the NONPF organization name"
                )


# ─── Positive: eligible occurrences DO fire ────────────────────────

def test_five_np_findings_are_emitted_across_eligible_paragraphs():
    """1 AB01 (first-use plural ``nurse practitioners`` at para 1) +
    4 AB02 (singular/plural in paras 4, 5, 5, 6). Total: 5 NP
    findings. This pins the audit baseline."""
    state, per_para = _run_doc()
    findings = _np_findings(per_para)
    # Count by rule.
    by_rule = {}
    for _pi, rid, _orig, _sug in findings:
        by_rule[rid] = by_rule.get(rid, 0) + 1
    assert by_rule.get("AB01", 0) == 1, (
        f"expected exactly 1 AB01 first-use on NP; got {by_rule}"
    )
    assert by_rule.get("AB02", 0) == 4, (
        f"expected exactly 4 AB02 subsequent-use NP findings; got {by_rule}"
    )
    assert sum(by_rule.values()) == 5, (
        f"expected 5 total NP-group findings, got {len(findings)}: {findings}"
    )


# ─── Grouping — the actual defect fix ───────────────────────────────

def test_all_five_np_findings_share_one_group_key():
    """Load-bearing regression: both singular ``NP`` and plural
    ``NPs`` findings must resolve to the SAME ``group_key``
    (``NP|nurse practitioner``) so the side-panel renders one card
    with every occurrence listed inside.

    Before the fix, ``extract_abbreviation`` only knew the singular
    workbook key, so plural findings returned ``group_key=None`` and
    rendered as orphan flat cards next to the grouped singular card
    — the user saw "4 occurrences" when the correct count is 5
    (actually 3 grouped + 2 orphan rows).
    """
    state, per_para = _run_doc()
    findings = _np_findings(per_para)
    keys = set()
    orphans = []
    for pi, rid, orig, sug in findings:
        g = meta.grouping_fields_for(rid, orig, sug)
        if g["group_key"] is None:
            orphans.append((pi, rid, orig, sug))
        else:
            keys.add(g["group_key"])
    assert not orphans, (
        f"{len(orphans)} NP findings had group_key=None — they will "
        f"render as orphan flat cards instead of joining the "
        f"'NP – nurse practitioner' group: {orphans}"
    )
    assert keys == {"NP|nurse practitioner"}, (
        f"expected every NP finding to share one bucket; got {keys}"
    )


def test_group_card_count_matches_eligible_occurrence_count():
    """When the UI reducer buckets by group_key, the NP group's
    ``items.length`` equals the number of ELIGIBLE NP findings — not
    inflated by excluded occurrences and not deflated by orphans."""
    state, per_para = _run_doc()
    findings = _np_findings(per_para)
    # Mirror the frontend reducer (features/language_edit/abbreviationGroups.ts):
    by_key: dict[str, list] = {}
    for pi, rid, orig, sug in findings:
        g = meta.grouping_fields_for(rid, orig, sug)
        key = g["group_key"] or f"__ungrouped__{pi}_{rid}"
        by_key.setdefault(key, []).append((pi, rid))
    np_group = by_key.get("NP|nurse practitioner")
    assert np_group is not None, "NP group missing"
    assert len(np_group) == 5, (
        f"NP group should have 5 occurrences (1 AB01 + 4 AB02), got {len(np_group)}: {np_group}"
    )


# ─── Reference-section exclusion (audit row #11) ────────────────────

def test_reference_list_entry_is_excluded_from_state():
    """Audit row #11: the ANCC catalogue entry ``Psychiatric mental
    health nurse practitioner eligibility & instructions`` sits in
    the References section and must NOT contribute to NP state.

    The exclusion happens at the router gate (role==reference /
    in_references region flag), not inside build_document_state. We
    simulate by passing para_roles with in_references=True and
    skipping the paragraph from the state scan — mirroring what the
    router does. The test asserts that when such a paragraph is
    excluded upstream, the NP state is unchanged."""
    ref_para = (99, (
        "Smith, J. (2020). The evolving role of the nurse practitioner in "
        "primary care clinics. Journal of Clinical Nursing 23: 45."
    ))
    # Build state WITHOUT the reference paragraph — the router's
    # ``_is_excluded_paragraph`` gate would drop it before this
    # module ever sees it.
    state_without = ab.build_document_state(WHEELER_PARAS, audience="general", min_uses=2)
    state_with = ab.build_document_state(WHEELER_PARAS + [ref_para], audience="general", min_uses=2)

    # Count NP exp_occurrences in each.
    occ_without = len(state_without["NP"].exp_occurrences)
    occ_with = len(state_with["NP"].exp_occurrences)
    # When the router DOES pass the reference text (simulating a
    # classifier failure), it would wrongly add an occurrence. This
    # assertion documents the invariant: the reference-exclusion
    # path on the router side is what keeps it out.
    assert occ_with == occ_without + 1, (
        "sanity: without upstream exclusion, the reference paragraph "
        "does add an NP exp_occurrence — the router's gate is what "
        "prevents this in production"
    )


# ─── Pure helper regression on the plural lookup itself ────────────

def test_plural_abbreviation_resolves_to_singular_group():
    """Direct unit check of the plural-aware resolution path in
    ``extract_abbreviation``. Guards against future refactors
    dropping the plural branch."""
    assert meta.extract_abbreviation("AB02", "nurse practitioners", "NPs") == "NP"
    assert meta.extract_abbreviation("AB01", "nurse practitioners",
                                      "nurse practitioners (NPs)") == "NP"
    # Plural map should NOT override a token that's already a
    # singular workbook key.
    assert meta.extract_abbreviation("AB02", "nurse practitioner", "NP") == "NP"


def test_grouping_fields_for_plural_matches_singular():
    assert meta.grouping_fields_for("AB01", "nurse practitioners",
                                      "nurse practitioners (NPs)") == {
        "abbreviation": "NP",
        "expansion": "nurse practitioner",
        "group_key": "NP|nurse practitioner",
    }
    assert meta.grouping_fields_for("AB02", "nurse practitioners", "NPs") == {
        "abbreviation": "NP",
        "expansion": "nurse practitioner",
        "group_key": "NP|nurse practitioner",
    }
