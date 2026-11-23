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
    assert make_title(long_q).endswith(" …") and len(make_title(long_q)) <= 60
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


def test_title_of_60_chars_or_fewer_gets_no_warning_or_info():
    # trailing period only (was info)
    a = q_block(1, "First", GOOD_OPTS, title="First.")
    # question ≤ 60 chars but title shortened (was a warning)
    b = q_block(2, "Steel parts are often hardened by heating and quenching them.", GOOD_OPTS,
                title="Steel parts are often hardened by heating and …")
    # short title when one more word would fit (was a warning)
    long_q = "Installation of HVAC systems is the primary responsibility of the mechanical contractor."
    c = q_block(3, long_q, GOOD_OPTS, title="Installation of HVAC systems is the primary …")
    issues = run(a + b + c)
    assert not any(i.rule == "T1" and i.severity in ("warning", "info") for i in issues)
    # …but real errors on short titles are still reported
    bad_end = q_block(1, "Steel parts are often hardened by heating and quenching them.", GOOD_OPTS,
                      title="Steel parts are often hardened by heating and...")
    assert "T1" in rules(run(bad_end), "error")
    wrong = q_block(1, "Cast iron plates are affected by temperature changes.", ["*True", "False"],
                    shuffle=False, title="Cast iron plates are affected by temperature.")
    assert "T1" in rules(run(wrong), "error")


def test_title_length_counts_the_ellipsis_ending():
    from app.domains.post_prod.eoc_validator.rules import title_text_length
    body = "The Industrial Revolution could not have taken place without"  # 60 characters
    assert len(body) == 60
    # whatever the current ending, it is counted as the required ' …' (2 chars)
    for ending in (" …", "…", "...", ".."):
        assert title_text_length(body + ending) == 62
    assert title_text_length("First.") == 6  # full (not shortened) title: counted as is


def test_title_over_60_including_ellipsis_is_error_and_rebuilt():
    q = "The Industrial Revolution could not have taken place without the cheap, convenient power of the _____."
    lines = q_block(1, q, GOOD_OPTS, title="The Industrial Revolution could not have taken place without …")  # 62
    assert any(i.rule == "T1" and "60 characters or fewer" in i.message for i in run(lines) if i.severity == "error")
    out, _, fixed = fix_and_lines(lines)
    new = "The Industrial Revolution could not have taken place …"
    assert "Title: " + new in out and len(new) <= 60
    assert not any(i.rule == "T1" for i in check_run([parse_docx(fixed, "machfun2028_tx_ch05.docx")], PREFIX))


def test_short_question_title_must_be_whole_question_and_is_fixed():
    q = "Almost all machine tools have evolved from the steam engine."  # 60 chars
    lines = q_block(1, q, ["*True", "False"], shuffle=False, title="Almost all machine tools have evolved…")
    assert any(i.rule == "T1" and "whole question" in i.message for i in run(lines) if i.severity == "error")
    out, _, fixed = fix_and_lines(lines)
    assert "Title: " + q in out
    assert not any(i.rule == "T1" for i in check_run([parse_docx(fixed, "machfun2028_tx_ch05.docx")], PREFIX))


@pytest.mark.parametrize("title,expected", [
    ("Machinists can attain professional…", "Machinists can attain professional _____ through …"),
    ("The introduction of the microchip in the…", "The introduction of the microchip in the mid-1970s led to …"),
])
def test_too_short_title_is_error_and_rebuilt(title, expected):
    stems = {
        "Machinists": "Machinists can attain professional _____ through performance testing and accredited training programs that meet industry standards.",
        "The introduction": "The introduction of the microchip in the mid-1970s led to the introduction of _____ machine tools.",
    }
    stem = next(v for k, v in stems.items() if title.startswith(k))
    lines = q_block(1, stem, GOOD_OPTS, title=title)
    assert any(i.rule == "T1" and "too short" in i.message for i in run(lines) if i.severity == "error")
    out, _, fixed = fix_and_lines(lines)
    assert "Title: " + expected in out
    assert not any(i.rule == "T1" for i in check_run([parse_docx(fixed, "machfun2028_tx_ch05.docx")], PREFIX))


def test_short_title_ok_when_next_word_does_not_fit():
    stem = "Which of the following is not a useful industrial application of robots?"
    lines = q_block(1, stem, GOOD_OPTS, title="Which of the following is not a useful industrial …")  # 49 + 'application' > 60
    assert not any(i.rule == "T1" for i in run(lines))


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


def test_image_alt_text_rules():
    from docx.oxml import OxmlElement
    # Image with alt text
    d = docx.Document()
    d.add_paragraph("1.\tIn the figure below, what is shown?")
    p_img = d.add_paragraph()
    drw = OxmlElement("w:drawing")
    inl = OxmlElement("wp:inline")
    dp = OxmlElement("wp:docPr")
    dp.set("id", "1")
    dp.set("name", "Picture 1")
    dp.set("descr", "A lathe workpiece diagram")
    inl.append(dp)
    drw.append(inl)
    p_img._p.append(drw)
    for line in GOOD_OPTS:
        d.add_paragraph(line)
    d.add_paragraph("Shuffle: True")
    d.add_paragraph("Title: In the figure below, what is shown?")
    d.add_paragraph("Learning Outcome: 5.1")
    d.add_paragraph(f"Reference: {PREFIX}05_001")
    buf = io.BytesIO()
    d.save(buf)
    cf = parse_docx(buf.getvalue(), "machfun2028_tx_ch05.docx")
    issues = check_run([cf], PREFIX)
    assert not any(i.rule == "F2" for i in issues)  # No blank line error on image
    assert not any(i.rule == "IMG1" and i.severity == "error" for i in issues)
    assert any(i.rule == "IMG1" and i.severity == "info" for i in issues)

    # Image missing alt text
    d2 = docx.Document()
    d2.add_paragraph("1.\tIn the figure below, what is shown?")
    p_img2 = d2.add_paragraph()
    drw2 = OxmlElement("w:drawing")
    inl2 = OxmlElement("wp:inline")
    dp2 = OxmlElement("wp:docPr")
    dp2.set("id", "2")
    dp2.set("name", "Picture 2")  # No descr
    inl2.append(dp2)
    drw2.append(inl2)
    p_img2._p.append(drw2)
    for line in GOOD_OPTS:
        d2.add_paragraph(line)
    d2.add_paragraph("Shuffle: True")
    d2.add_paragraph("Title: In the figure below, what is shown?")
    d2.add_paragraph("Learning Outcome: 5.1")
    d2.add_paragraph(f"Reference: {PREFIX}05_001")
    buf2 = io.BytesIO()
    d2.save(buf2)
    cf2 = parse_docx(buf2.getvalue(), "machfun2028_tx_ch05.docx")
    issues2 = check_run([cf2], PREFIX)
    assert any(i.rule == "IMG1" and i.severity == "error" and "missing Alt text" in i.message for i in issues2)


def test_check_alt_text_mode():
    from app.domains.post_prod.eoc_validator import check_alt_text_run, build_report, to_xlsx, to_csv
    import openpyxl
    from docx.oxml import OxmlElement
    # File 1 has an image
    d = docx.Document()
    d.add_paragraph("Manual Job Sheet 1")
    p = d.add_paragraph()
    drw = OxmlElement("w:drawing")
    inl = OxmlElement("wp:inline")
    dp = OxmlElement("wp:docPr")
    dp.set("id", "1")
    dp.set("name", "Picture 1")
    dp.set("descr", "Electric motor assembly")
    inl.append(dp)
    drw.append(inl)
    p._p.append(drw)
    buf = io.BytesIO()
    d.save(buf)

    # File 2 has NO image
    d2 = docx.Document()
    d2.add_paragraph("Manual Job Sheet 2 without any images.")
    buf2 = io.BytesIO()
    d2.save(buf2)

    cf1 = parse_docx(buf.getvalue(), "ev2028_sm_job41.docx")
    cf2 = parse_docx(buf2.getvalue(), "ev2028_sm_job42.docx")
    issues = check_alt_text_run([cf1, cf2])
    rep = build_report([cf1, cf2], issues, "alt_text", mode="alt_text")
    assert rep["totals"]["images"] == 1
    assert rep["totals"]["has_alt"] == 1
    assert rep["totals"]["missing_alt"] == 0
    assert rep["totals"]["errors"] == 0
    assert any(f["file"] == "ev2028_sm_job41.docx" and f["status"] == "pass" for f in rep["files"])

    # Test Excel export in Alt text mode:
    # Files without images must NOT be reported in Excel
    xlsx_bytes = to_xlsx(rep)
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes))
    ws_summary = wb["Summary"]
    summary_files = [row[0] for row in ws_summary.iter_rows(min_row=7, values_only=True) if row[0]]
    assert "ev2028_sm_job41.docx" in summary_files
    assert "ev2028_sm_job42.docx" not in summary_files

    ws_details = wb["Alt Text Details"]
    details_files = [row[0] for row in ws_details.iter_rows(min_row=2, values_only=True) if row[0]]
    assert "ev2028_sm_job41.docx" in details_files
    assert "ev2028_sm_job42.docx" not in details_files

    csv_text = to_csv(rep)
    assert "ev2028_sm_job41.docx" in csv_text
    assert "ev2028_sm_job42.docx" not in csv_text


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


def test_hyphenated_learning_outcomes_and_short_answer():
    from app.domains.post_prod.eoc_validator import parse_docx, check_run, build_report, fix_docx
    d = docx.Document()
    # Q1: Short answer question with hyphenated LO
    d.add_paragraph("1.\tExplain the difference between a good, a service, and an idea.")
    d.add_paragraph("A good is a physical item that can be touched. A service is an action that one person performs.")
    d.add_paragraph("Title: Explain the difference between a good, a service, and an …")
    d.add_paragraph("Learning Outcome: 1.2-1")
    d.add_paragraph("Reference: md6e_2028_eoc01_001")

    # Q2: Short answer with comma-separated hyphenated LOs and space instead of tab
    d.add_paragraph("2. Discuss the role of a marketing professional.")
    d.add_paragraph("A marketing professional is a person who determines marketing needs.")
    d.add_paragraph("Title: Discuss the role of a marketing professional.")
    d.add_paragraph("Learning Outcome: 1.1-1, 1.1-3")
    d.add_paragraph("Reference: md6e_2028_eoc01_002")

    buf = io.BytesIO()
    d.save(buf)

    cf = parse_docx(buf.getvalue(), "md2028_tx_ch01.docx")
    assert len(cf.questions) == 2
    assert cf.questions[0].kind == "SA"
    assert cf.questions[1].kind == "SA"
    assert cf.questions[0].has_tab_error is False
    assert cf.questions[1].has_tab_error is True

    issues = check_run([cf], "md6e_2028_eoc")
    # No false O4 (missing options), no false X1, no false L1 (hyphenated LO)
    assert not any(i.rule == "O4" for i in issues)
    assert not any(i.rule == "X1" for i in issues)
    assert not any(i.rule == "L1" for i in issues)
    assert not any(i.rule == "SH3" for i in issues)
    # Exactly 1 issue: Q2 has space instead of tab
    assert any(i.rule == "Q1" and "followed by a tab" in i.message for i in issues)

    # Test fixer corrects space after question number
    fixed_bytes, fixes = fix_docx(buf.getvalue(), "md2028_tx_ch01.docx", "md6e_2028_eoc")
    assert any(f.rule == "Q1" and "replaced space with tab" in f.action for f in fixes)
    cf_fixed = parse_docx(fixed_bytes, "md2028_tx_ch01.docx")
    clean_issues = check_run([cf_fixed], "md6e_2028_eoc")
    assert [i for i in clean_issues if i.severity == "error"] == []


def test_fill_in_the_blank_title_matching():
    """Fill-in-the-blank questions with [[answer]] in stem should match Title with '_____'."""
    from app.domains.post_prod.eoc_validator.parser import Question
    from app.domains.post_prod.eoc_validator.rules import check_title
    from app.domains.post_prod.eoc_validator.fixer import make_title

    # 1. Blank at beginning
    q1 = Question(number=2, idx=0, raw="2.\t[[Physical]] development includes the changes to your body.", stem="[[Physical]] development includes the changes to your body.")
    assert check_title(q1, "_____ development includes the changes to your body.") == []

    # 2. Blank in middle
    q2 = Question(number=4, idx=1, raw="4.\tBody language is a type of [[nonverbal]] communication.", stem="Body language is a type of [[nonverbal]] communication.")
    assert check_title(q2, "Body language is a type of _____ communication.") == []

    # 3. Blank at end
    q3 = Question(number=10, idx=2, raw="10.\tPeople in the same age group as you are your [[peers]].", stem="People in the same age group as you are your [[peers]].")
    assert check_title(q3, "People in the same age group as you are your _____.") == []

    # 4. Truncated title with blank (50-60 chars)
    s4 = "A(n) [[standard]] is a means to measure how well you achieve your long-term goals in life."
    q4 = Question(number=9, idx=3, raw="9.\t" + s4, stem=s4)
    assert check_title(q4, "A(n) _____ is a means to measure how well you achieve …") == []

    # 5. Multiple blanks
    s5 = "[[Human]] resources and [[nonhuman]] resources help people meet needs."
    q5 = Question(number=5, idx=4, raw="5.\t" + s5, stem=s5)
    assert check_title(q5, "_____ resources and _____ resources help people meet needs.") == []

    # 6. Underscore length tolerance (3, 4, 5, 6 underscores)
    s6 = "[[Water]] carries nutrients to every cell in your body."
    q6 = Question(number=6, idx=5, raw="6.\t" + s6, stem=s6)
    assert check_title(q6, "___ carries nutrients to every cell in your body.") == []
    assert check_title(q6, "_______ carries nutrients to every cell in your body.") == []

    # 7. make_title converts [[answer]] to _____
    assert make_title("[[Physical]] development includes the changes to your body.") == "_____ development includes the changes to your body."
    long_blank_stem = "The first step in making a decision is to [[define]] the problem and evaluate choices."
    gen_title = make_title(long_blank_stem)
    assert "[[" not in gen_title
    assert "_____ " in gen_title
    assert gen_title.endswith(" …")
    assert len(gen_title) <= 60


def test_fill_in_the_blank_full_docx_and_fixer():
    """End-to-end docx parsing and validation for fill-in-the-blank questions."""
    d = docx.Document()
    d.add_paragraph("1.\t[[Physical]] development includes the changes to your body.")
    d.add_paragraph("Title: _____ development includes the changes to your body.")
    d.add_paragraph("Learning Outcome: 1.1-4")
    d.add_paragraph("Reference: elc2028_eoc01_001")

    d.add_paragraph("2.\tBody language is a type of [[nonverbal]] communication.")
    d.add_paragraph("Title: Body language is a type of _____ communication.")
    d.add_paragraph("Learning Outcome: 1.3-1")
    d.add_paragraph("Reference: elc2028_eoc01_002")

    # Q3 has wrong title that needs fixer regeneration
    d.add_paragraph("3.\tResponsible decision-making means that you think about the [[consequences]] of your choices.")
    d.add_paragraph("Title: Completely Wrong Title Here")
    d.add_paragraph("Learning Outcome: 1.4-1")
    d.add_paragraph("Reference: elc2028_eoc01_003")

    buf = io.BytesIO()
    d.save(buf)

    cf = parse_docx(buf.getvalue(), "elc9e_2028_ch01.docx")
    issues = check_run([cf], "elc2028_eoc")

    # Q1 and Q2 should have zero errors
    q1_q2_issues = [i for i in issues if i.question in (1, 2) and i.severity == "error"]
    assert q1_q2_issues == []

    # Q3 has wrong title
    assert any(i.question == 3 and i.rule == "T1" for i in issues)

    # Test fixer regenerates Q3 with blanks
    fixed_bytes, fixes = fix_docx(buf.getvalue(), "elc9e_2028_ch01.docx", "elc2028_eoc")
    assert any(f.question == 3 and f.rule == "T1" for f in fixes)
    cf_fixed = parse_docx(fixed_bytes, "elc9e_2028_ch01.docx")
    clean_issues = check_run([cf_fixed], "elc2028_eoc")
    assert [i for i in clean_issues if i.severity == "error"] == []

