"""Tests for the Backlist Hub EOC/EOL question-file validator."""

import base64
import io
import zipfile

import docx
import pytest
from docx.shared import RGBColor
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.domains.post_prod.eoc_validator import check_run, parse_docx, shuffle_decision
from app.domains.post_prod.eoc_validator.router import check_post_prod_access, router

PREFIX = "machfund2028_eoc"


def make_docx(lines, colour_line=None) -> bytes:
    d = docx.Document()
    for i, t in enumerate(lines):
        p = d.add_paragraph()
        r = p.add_run(t)
        if colour_line is not None and i == colour_line:
            r.font.color.rgb = RGBColor(0xFF, 0x00, 0x00)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def q_block(n, stem, options, *, shuffle=True, title=None, lo="5.1", ref=None, ch=5):
    out = [f"{n}.\t{stem}", *options]
    if shuffle:
        out.append("Shuffle: True")
    out.append(f"Title: {title if title is not None else stem}")
    out.append(f"Learning Outcome: {lo}")
    out.append(f"Reference: {ref if ref is not None else f'{PREFIX}{ch:02d}_{n:03d}'}")
    return out


GOOD_OPTS = ["A.\tLondon", "*B.\tParis", "C.\tRome", "D.\tBerlin"]


def run(lines, filename="machfun2028_tx_ch05.docx", **kw):
    cf = parse_docx(make_docx(lines, **kw), filename)
    return check_run([cf], PREFIX)


def rules(issues, severity=None):
    return sorted({i.rule for i in issues if severity is None or i.severity == severity})


def test_valid_file_has_no_errors():
    lines = (
        q_block(1, "What is the capital of France?", GOOD_OPTS)
        + q_block(2, "Steel is an alloy.", ["*True", "False"], shuffle=False)
    )
    issues = run(lines)
    assert [i for i in issues if i.severity == "error"] == []


@pytest.mark.parametrize("opts,expected,reason", [
    (["A.\tx", "B.\ty", "C.\tz", "*D.\tAll are correct."], False, "All"),
    (["A.\tx", "B.\ty", "*C.\tNone of the above"], False, "None"),
    (["A.\tx", "B.\ty", "*C.\tBoth A and B"], False, "Both"),
    (["A.\tx", "B.\ty", "*C.\tNeither A nor B"], False, "Neither"),
    (["A.\t1", "*B.\t1 1/2", "C.\t2", "D.\t2 1/2"], False, "numbers by size — review"),
    (["A.\t1681", "*B.\t1781", "C.\t1870", "D.\t1981"], False, "years in order"),
    (["A.\t8′", "B.\t12′", "*C.\t10′", "D.\t15′"], None, "mixed numbers — not checked"),
    (["A.\tFirst", "B.\tSecond", "*C.\tThird"], False, "ordinal"),
    (["A.\tLondon", "*B.\tParis", "C.\tRome"], True, "independent"),
])
def test_shuffle_decision(opts, expected, reason):
    cf = parse_docx(make_docx([f"1.\tQ?", *opts]), "x_ch05.docx")
    should, why, _ = shuffle_decision(cf.questions[0])
    assert should is expected, why


def test_true_false_never_shuffles():
    cf = parse_docx(make_docx(["1.\tSteel is an alloy.", "*True", "False"]), "x_ch05.docx")
    assert shuffle_decision(cf.questions[0])[0] is False


def test_shuffle_with_all_are_correct_is_error():
    lines = q_block(1, "Which apply?", ["A.\tx", "B.\ty", "*C.\tAll are correct."], shuffle=True)
    assert "SH3" in rules(run(lines), "error")


def test_missing_shuffle_on_independent_options_is_error():
    lines = q_block(1, "What is the capital of France?", GOOD_OPTS, shuffle=False)
    assert "SH3" in rules(run(lines), "error")


def test_true_false_with_shuffle_is_error():
    lines = q_block(1, "Steel is an alloy.", ["*True", "False"], shuffle=True)
    assert "SH3" in rules(run(lines), "error")


@pytest.mark.parametrize("opts", [
    ["A.\t1/8″", "B.\t1/16″", "*C.\t3/32″", "D.\t1/32″"],  # mixed order
    ["A.\t8′", "B.\t12′", "*C.\t10′", "D.\t15′"],          # mixed order
])
@pytest.mark.parametrize("shuffle", [True, False])
def test_numbers_in_mixed_order_are_not_checked(opts, shuffle):
    issues = run(q_block(1, "How far?", opts, shuffle=shuffle))
    assert not any(i.rule == "SH3" for i in issues)


def test_shuffle_format_and_position():
    lines = q_block(1, "What is the capital of France?", GOOD_OPTS, shuffle=False)
    lines.insert(5, "Shuffle:True")
    assert "SH1" in rules(run(lines), "error")
    lines2 = q_block(1, "What is the capital of France?", GOOD_OPTS, shuffle=False)
    lines2.insert(6, "Shuffle: True")  # after Title
    found = rules(run(lines2), "error")
    assert "SH2" in found and "R2" in found


def test_asterisk_rules():
    none_marked = q_block(1, "Capital?", ["A.\tLondon", "B.\tParis"])
    assert "O2" in rules(run(none_marked), "error")
    two_marked = q_block(1, "Capital?", ["*A.\tLondon", "*B.\tParis"])
    assert "O2" in rules(run(two_marked), "error")
    misplaced = q_block(1, "Capital?", ["A.\tLondon", "B.*\tParis"])
    assert "O1" in rules(run(misplaced), "error")


def test_option_letters_must_be_in_order():
    lines = q_block(1, "Capital?", ["A.\tLondon", "C.\tRome", "*B.\tParis"])
    assert "O1" in rules(run(lines), "error")


def test_learning_outcome_rules():
    assert "L1" in rules(run(q_block(1, "Capital?", GOOD_OPTS, lo="")), "error")
    assert "L1" in rules(run(q_block(1, "Capital?", GOOD_OPTS, lo="6.1")), "error")  # wrong chapter
    nospace = q_block(1, "Capital?", GOOD_OPTS)
    nospace[-2] = "Learning Outcome:5.1"
    assert "L1" in rules(run(nospace), "error")
    assert "L1" not in rules(run(q_block(1, "Capital?", GOOD_OPTS, lo="5.1, 5.2")))


def test_reference_rules():
    wrong_num = q_block(1, "Capital?", GOOD_OPTS, ref=f"{PREFIX}05_002")
    assert "R1" in rules(run(wrong_num), "error")
    # A reused ID is reported once, as the wrong value for that question
    dup = q_block(1, "Capital?", GOOD_OPTS) + q_block(2, "Capital again?", GOOD_OPTS, ref=f"{PREFIX}05_001")
    r1 = [i for i in run(dup) if i.rule == "R1"]
    assert len(r1) == 1 and r1[0].question == 2 and "expected" in r1[0].message
    # Two files for the same chapter → identical correct IDs are flagged as not unique
    a = parse_docx(make_docx(q_block(1, "Q?", GOOD_OPTS)), "x_ch05.docx")
    b = parse_docx(make_docx(q_block(1, "Q?", GOOD_OPTS)), "y_ch05.docx")
    assert any("not unique" in i.message for i in check_run([a, b], PREFIX) if i.rule == "R1")


def test_file_wide_wrong_prefix_reported_once():
    lines = []
    for n in (1, 2, 3):
        lines += q_block(n, f"Question {n}?", GOOD_OPTS, ref=f"machfun2028_eoc05_{n:03d}")
    r1 = [i for i in run(lines) if i.rule == "R1"]
    assert len(r1) == 1 and "machfun2028_eoc" in r1[0].message


def test_title_rules():
    long_q = "The Industrial Revolution could not have taken place without the cheap, convenient power of the _____."
    ok = q_block(1, long_q, GOOD_OPTS, title="The Industrial Revolution could not have taken place …")
    assert "T1" not in rules(run(ok), "error")
    no_ellipsis = q_block(1, long_q, GOOD_OPTS, title="The Industrial Revolution could not have taken place")
    assert "T1" in rules(run(no_ellipsis), "error")
    typo = q_block(1, long_q, GOOD_OPTS, title="The Industrial Revolutions could not have taken place …")
    assert "T1" in rules(run(typo), "error")
    mid_word = q_block(1, long_q, GOOD_OPTS, title="The Industrial Revolution could not have taken pla …")
    assert "T1" in rules(run(mid_word), "error")
    mismatch = q_block(1, "Cast iron plates are affected by temperature changes.", ["*True", "False"],
                       shuffle=False, title="Cast iron plates are affected by temperature.")
    assert "T1" in rules(run(mismatch), "error")


def test_question_numbering_and_blank_lines():
    lines = q_block(1, "Capital?", GOOD_OPTS) + q_block(3, "Capital 3?", GOOD_OPTS)
    assert "Q1" in rules(run(lines), "error")
    blank = q_block(1, "Capital?", GOOD_OPTS)
    blank.insert(1, "")
    assert "F2" in rules(run(blank), "error")


def test_coloured_text_is_flagged():
    lines = q_block(1, "Capital?", GOOD_OPTS)
    assert "F2" in rules(run(lines, colour_line=1), "error")


def test_line_order():
    lines = q_block(1, "Capital?", GOOD_OPTS)
    lines[-1], lines[-2] = lines[-2], lines[-1]  # Reference before Learning Outcome
    assert "R2" in rules(run(lines), "error")


def test_chapter_gap_reported_across_run():
    a = parse_docx(make_docx(q_block(1, "Q?", GOOD_OPTS, ch=1, lo="1.1")), "x_ch01.docx")
    c = parse_docx(make_docx(q_block(1, "Q?", GOOD_OPTS, ch=3, lo="3.1")), "x_ch03.docx")
    issues = check_run([a, c], PREFIX)
    assert any(i.rule == "F1" and "2" in i.message for i in issues)


# ── Fixer ───────────────────────────────────────────────────────────────────

from app.domains.post_prod.eoc_validator.fixer import AlreadyTrackedError, fix_docx, make_title  # noqa: E402
from app.domains.post_prod.eoc_validator.tracked import accept_all  # noqa: E402
from docx.oxml.ns import qn  # noqa: E402


def accepted_doc(data: bytes):
    d = docx.Document(io.BytesIO(data))
    accept_all(d.element.body)
    return d


def rejected_lines(data: bytes):
    """Reject every revision: drop insertions (incl. inserted paragraphs), restore deletions."""
    d = docx.Document(io.BytesIO(data))
    body = d.element.body
    for p in list(body.iter(qn("w:p"))):
        rpr = p.find(qn("w:pPr") + "/" + qn("w:rPr"))
        if rpr is not None and rpr.find(qn("w:ins")) is not None:
            p.getparent().remove(p)
    for el in list(body.iter(qn("w:ins"))):
        el.getparent().remove(el)
    for el in list(body.iter(qn("w:del"))):
        parent = el.getparent()
        if parent.tag == qn("w:rPr"):
            parent.remove(el)
            continue
        for t in el.iter(qn("w:delText")):
            t.tag = qn("w:t")
        i = parent.index(el)
        for child in list(el):
            parent.insert(i, child)
            i += 1
        parent.remove(el)
    buf = io.BytesIO()
    d.save(buf)  # re-parse so renamed elements get their proper python-docx classes
    return [p.text for p in docx.Document(io.BytesIO(buf.getvalue())).paragraphs]


def fix_and_lines(lines, filename="machfun2028_tx_ch05.docx"):
    fixed, fixes = fix_docx(make_docx(lines), filename, PREFIX)
    return [p.text for p in accepted_doc(fixed).paragraphs], fixes, fixed


def test_fixer_shuffle_reference_lo_and_blank_lines():
    lines = (
        q_block(1, "Which apply?", ["A.\tx", "B.\ty", "*C.\tAll are correct."], shuffle=True,
                ref="machfun2028_eoc01_001")
        + q_block(2, "What is the capital of France?", GOOD_OPTS, shuffle=False, lo="5.1")
        + q_block(3, "Steel is an alloy.", ["*True", "False"], shuffle=False)
    )
    lines[lines.index("Learning Outcome: 5.1")] = "Learning Outcome:5.1"
    lines.insert(2, "")
    out, fixes, fixed = fix_and_lines(lines)
    q1 = out[: out.index("2.\tWhat is the capital of France?")]
    assert "Shuffle: True" not in q1  # removed: "All are correct"
    assert f"Reference: {PREFIX}05_001" in out
    i = out.index("D.\tBerlin")
    assert out[i + 1] == "Shuffle: True" and out[i + 2].startswith("Title:")  # added in place
    assert "Learning Outcome: 5.1" in out and "Learning Outcome:5.1" not in out
    assert "" not in out
    # Re-validation: no errors left
    assert [x for x in check_run([parse_docx(fixed, "machfun2028_tx_ch05.docx")], PREFIX) if x.severity == "error"] == []
    assert {f.rule for f in fixes} >= {"SH3", "R1", "L1", "F2"}


def test_fixer_leaves_human_items_alone():
    no_star = q_block(1, "Capital?", ["A.\tLondon", "B.\tParis"])
    empty_lo = q_block(2, "Capital 2?", GOOD_OPTS, lo="")
    out, fixes, fixed = fix_and_lines(no_star + empty_lo)
    assert "A.\tLondon" in out and "B.\tParis" in out  # no asterisk invented
    assert any(l.startswith("Learning Outcome:") and not l.split(":", 1)[1].strip() for l in out)
    remaining = {x.rule for x in check_run([parse_docx(fixed, "machfun2028_tx_ch05.docx")], PREFIX) if x.severity == "error"}
    assert {"O2", "L1"} <= remaining


def test_fixer_title_regenerated_but_typo_left_for_human():
    long_q = "The Industrial Revolution could not have taken place without the cheap, convenient power of the _____."
    wrong = q_block(1, long_q, GOOD_OPTS, title="Something else entirely")
    out, fixes, _ = fix_and_lines(wrong)
    assert "Title: " + make_title(long_q) in out
    assert make_title(long_q).endswith(" …") and len(make_title(long_q)) <= 62
    typo_q = "What type of workholding de2vices are most likely to be used on a lathe?"
    typo = q_block(1, typo_q, GOOD_OPTS, title="What type of workholding devices are most likely to be …")
    out, fixes, _ = fix_and_lines(typo)
    assert "Title: What type of workholding devices are most likely to be …" in out
    assert not any(f.rule == "T1" for f in fixes)


def test_fixer_keeps_italics_in_question_and_title():
    d = docx.Document()
    p = d.add_paragraph()
    p.add_run("1.\tThe ")
    p.add_run("bow lathe").italic = True
    p.add_run(" was one of the first machine tools ever built by people in history.")
    for t in ["A.\tTrue story", "*B.\tAnother", "C.\tThird", "Shuffle: True", "Title: wrong", "Learning Outcome: 5.1", f"Reference: {PREFIX}05_001"]:
        d.add_paragraph(t)
    buf = io.BytesIO()
    d.save(buf)
    fixed, _ = fix_docx(buf.getvalue(), "x_ch05.docx", PREFIX)
    out = accepted_doc(fixed)
    q = out.paragraphs[0]
    assert any(r.italic and r.text == "bow lathe" for r in q.runs)
    title = next(x for x in out.paragraphs if x.text.startswith("Title:"))
    assert any(r.italic and "bow lathe" in r.text for r in title.runs)


def test_fixes_are_tracked_changes_and_reject_restores_original():
    lines = (
        q_block(1, "Which apply?", ["A.\tx", "B.\ty", "*C.\tAll are correct."], shuffle=True,
                ref="machfun2028_eoc01_001")
        + q_block(2, "What is the capital of France?", GOOD_OPTS, shuffle=False)
    )
    lines[lines.index("Learning Outcome: 5.1")] = "Learning Outcome:5.1"
    original = make_docx(lines)
    fixed, fixes = fix_docx(original, "machfun2028_tx_ch05.docx", PREFIX, author="Tester")
    body = docx.Document(io.BytesIO(fixed)).element.body
    ins = list(body.iter(qn("w:ins")))
    dels = list(body.iter(qn("w:del")))
    assert ins and dels
    assert all(e.get(qn("w:author")) == "Tester" for e in ins + dels)
    ids = [e.get(qn("w:id")) for e in ins + dels]
    assert len(ids) == len(set(ids))
    # Reject all → exactly the original lines
    assert rejected_lines(fixed) == lines
    # Character-level: only the differing middle of a line is replaced
    # ('machfun|2028_eoc01|_001' → 'machfun|d2028_eoc05|_001'), never the whole line.
    del_texts = ["".join(t.text for t in e.iter(qn("w:delText"))) for e in dels]
    ins_texts = ["".join(t.text for t in e.iter(qn("w:t"))) for e in ins]
    assert "2028_eoc01" in del_texts and "d2028_eoc05" in ins_texts
    assert " " in ins_texts  # 'Learning Outcome:5.1' → only a space inserted
    assert not any(s.startswith(("Reference:", "Learning Outcome")) for s in ins_texts)


@pytest.mark.parametrize("opts", [
    ["A.\t200 lb", "*B.\t225 lb", "C.\t250 lb", "D.\t300 lb"],   # ascending
    ["A.\t100′", "B.\t65′", "*C.\t45′", "D.\t25′"],              # descending
])
def test_numbers_by_size_with_shuffle_are_a_warning_and_not_changed(opts):
    lines = q_block(1, "Load rating?", opts, shuffle=True)
    sh3 = [i for i in run(lines) if i.rule == "SH3"]
    assert sh3 and all(i.severity == "warning" for i in sh3)
    out, fixes, _ = fix_and_lines(lines)
    assert "Shuffle: True" in out and not any(f.rule.startswith("SH") for f in fixes)
    # without Shuffle: nothing to report
    assert not any(i.rule == "SH3" for i in run(q_block(1, "Load rating?", opts, shuffle=False)))


def test_years_in_chronological_order_with_shuffle_are_error_and_fixed():
    lines = q_block(1, "When was the first water closet patented?", ["A.\t1681", "*B.\t1781", "C.\t1870", "D.\t1981"], shuffle=True)
    sh3 = [i for i in run(lines) if i.rule == "SH3"]
    assert sh3 and sh3[0].severity == "error" and "chronological" in sh3[0].message
    out, fixes, fixed = fix_and_lines(lines)
    assert "Shuffle: True" not in out and any(f.rule == "SH3" for f in fixes)
    assert [i for i in check_run([parse_docx(fixed, "machfun2028_tx_ch05.docx")], PREFIX) if i.severity == "error"] == []


def test_ordering_question_is_parsed_as_one_question():
    lines = (
        ["1.\tIndicate the order in which these occurred.",
         "1.\tC.\tfirst thing", "2.\tA.\tsecond thing", "3.\tB.\tthird thing",
         "Shuffle: True", "Title: Indicate the order in which these occurred.",
         "Learning Outcome: 5.1", f"Reference: {PREFIX}05_001"]
        + q_block(2, "Steel is an alloy.", ["*True", "False"], shuffle=False)
    )
    cf = parse_docx(make_docx(lines), "x_ch05.docx")
    assert [q.number for q in cf.questions] == [1, 2]
    assert cf.questions[0].kind == "ORDER" and len(cf.questions[0].options) == 3
    issues = check_run([cf], PREFIX)
    assert [i for i in issues if i.severity == "error"] == []
    assert any(i.rule == "SH3" and i.severity == "warning" for i in issues)  # confirm by hand
    bad = list(lines)
    bad[2] = "3.\tA.\tsecond thing"  # positions 1, 3, 3
    assert "O1" in rules(run(bad), "error")


def test_stray_title_after_reference_two_dot_title_and_lo_hyphen_are_fixed():
    long_q = "Pressure pipe and fittings are required for drain/waste lines in all buildings."
    lines = (
        q_block(1, long_q, GOOD_OPTS, title="Pressure pipe and fittings are required for drain/waste..", lo="5-1")
        + ["Title: lines in all buildings."]  # stray line after the Reference
        + q_block(2, "Capital?", GOOD_OPTS)
    )
    issues = run(lines)
    assert {"T1", "L1", "R2"} <= set(rules(issues, "error"))
    out, fixes, fixed = fix_and_lines(lines)
    assert "Title: lines in all buildings." not in out
    assert "Title: Pressure pipe and fittings are required for drain/waste …" in out
    assert "Learning Outcome: 5.1" in out
    assert [i for i in check_run([parse_docx(fixed, "machfun2028_tx_ch05.docx")], PREFIX) if i.severity == "error"] == []


def test_title_dropping_only_a_blank_is_fine():
    q = "The recommended minimum bending radius for 1/2 PEX is _____."
    lines = q_block(1, q, ["A.\t10", "B.\t9", "C.\t7", "*D.\t5"], shuffle=False,
                    title="The recommended minimum bending radius for 1/2 PEX is …")
    assert not any(i.rule == "T1" and i.severity in ("error", "warning") for i in run(lines))


def test_three_dot_title_is_error_and_fixed_to_ellipsis():
    long_q = "According to National Safety Council statistics, the most common injuries are _____."
    lines = q_block(1, long_q, GOOD_OPTS, title="According to National Safety Council statistics, the most...")
    assert "T1" in rules(run(lines), "error")
    out, fixes, fixed = fix_and_lines(lines)
    assert "Title: According to National Safety Council statistics, the most …" in out
    # tracked change touches only the dots
    body = docx.Document(io.BytesIO(fixed)).element.body
    assert ["".join(t.text for t in e.iter(qn("w:delText"))) for e in body.iter(qn("w:del"))] == ["..."]
    assert ["".join(t.text for t in e.iter(qn("w:t"))) for e in body.iter(qn("w:ins"))] == [" …"]
    assert [i for i in check_run([parse_docx(fixed, "machfun2028_tx_ch05.docx")], PREFIX) if i.severity == "error"] == []


def test_ellipsis_without_space_is_error_and_space_added():
    long_q = "According to National Safety Council statistics, the most common injuries are _____."
    lines = q_block(1, long_q, GOOD_OPTS, title="According to National Safety Council statistics, the most…")
    assert any(i.rule == "T1" and "space" in i.message for i in run(lines) if i.severity == "error")
    out, fixes, fixed = fix_and_lines(lines)
    assert "Title: According to National Safety Council statistics, the most …" in out
    assert any("space before the ellipsis" in f.action for f in fixes)
    # only a space is inserted; the existing '…' stays
    body = docx.Document(io.BytesIO(fixed)).element.body
    assert ["".join(t.text for t in e.iter(qn("w:t"))) for e in body.iter(qn("w:ins"))] == [" "]
    assert list(body.iter(qn("w:del"))) == []
    assert [i for i in check_run([parse_docx(fixed, "machfun2028_tx_ch05.docx")], PREFIX) if i.severity == "error"] == []


def test_fixer_refuses_file_with_existing_tracked_changes():
    once, _ = fix_docx(make_docx(q_block(1, "Q?", GOOD_OPTS, shuffle=False)), "x_ch05.docx", PREFIX)
    with pytest.raises(AlreadyTrackedError):
        fix_docx(once, "x_ch05.docx", PREFIX)
    # …but the validator reads it as accepted, so it re-validates clean
    assert [i for i in check_run([parse_docx(once, "x_ch05.docx")], PREFIX) if i.severity == "error"] == []


# ── Endpoint ────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router, prefix="/api/v2")
    app.dependency_overrides[check_post_prod_access] = lambda: object()
    return TestClient(app)


def test_endpoint_with_docx_and_zip(client):
    good = make_docx(q_block(1, "What is the capital of France?", GOOD_OPTS))
    bad = make_docx(q_block(1, "Which apply?", ["A.\tx", "*B.\tAll are correct."], ch=6, lo="6.1"))
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as z:
        z.writestr("FINAL/x_ch06.docx", bad)
    res = client.post(
        "/api/v2/eoc-validator/analyze",
        data={"reference_prefix": PREFIX},
        files=[("files", ("x_ch05.docx", good)), ("files", ("final.zip", zbuf.getvalue()))],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    rep = body["report"]
    assert rep["totals"]["files"] == 2
    statuses = {f["file"]: f["status"] for f in rep["files"]}
    assert statuses["x_ch05.docx"] == "pass" and statuses["x_ch06.docx"] == "fail"
    assert "File,Chapter,Question" in body["artifacts"]["csv"]
    xlsx = base64.b64decode(body["artifacts"]["xlsx_base64"])
    assert xlsx[:2] == b"PK"


def test_fix_endpoint_returns_report_fixes_and_zip(client):
    bad = make_docx(q_block(1, "Which apply?", ["A.\tx", "*B.\tAll are correct."], ch=6, lo="6.1",
                            ref="machfun2028_eoc01_001"))
    res = client.post("/api/v2/eoc-validator/fix", data={"reference_prefix": PREFIX},
                      files=[("files", ("x_ch06.docx", bad))])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mode"] == "fix" and len(body["fixes"]) >= 2
    assert body["before_totals"]["errors"] > body["report"]["totals"]["errors"] == 0
    assert body["report"]["files"][0]["fixes"] == len(body["fixes"])
    z = zipfile.ZipFile(io.BytesIO(base64.b64decode(body["artifacts"]["zip_base64"])))
    assert set(z.namelist()) == {"corrected/x_ch06.docx", "EOC_Correction_Report.xlsx"}
    txt = [p.text for p in accepted_doc(z.read("corrected/x_ch06.docx")).paragraphs]
    assert "Shuffle: True" not in txt and f"Reference: {PREFIX}06_001" in txt


def test_endpoint_rejects_bad_input(client):
    res = client.post("/api/v2/eoc-validator/analyze", data={"reference_prefix": "bad prefix!"},
                      files=[("files", ("a.docx", make_docx(["1.\tQ"])))])
    assert res.status_code == 400
    res = client.post("/api/v2/eoc-validator/analyze", data={"reference_prefix": PREFIX},
                      files=[("files", ("a.txt", b"hello"))])
    assert res.status_code == 400
