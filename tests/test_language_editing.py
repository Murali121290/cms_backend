"""
Unit tests for Ninja Inkflow Language Editing module.
"""
import pytest
import os
from docx import Document
from app.processing.language_editing import segmenter, engine, rules, docx_io


def test_segmenter_abbreviations_and_decimals():
    text = "The results in Fig. 7 were analyzed carefully (3.14). Dr. Smith et al. met the deadline."
    sents = segmenter.sentences(text)
    assert len(sents) == 2
    assert "Fig. 7" in sents[0][2]
    assert "Dr. Smith et al. met" in sents[1][2]


def test_engine_grammar_and_spelling_rules():
    rule_dicts = [
        {"id": "GP001", "category": "grammar", "type": "regex", "pattern": " {2,}", "replacement": " ", "message": "Double space", "severity": "error", "enabled": True},
        {"id": "GP002", "category": "grammar", "type": "regex", "pattern": "\\s+([,;:.!?])", "replacement": "\\1", "message": "Space before punctuation", "severity": "error", "enabled": True},
        {"id": "SP000", "category": "spelling", "type": "dictionary", "message": "House style", "severity": "suggestion", "enabled": True}
    ]
    compiled_rules = rules.load_rules_from_dict(rule_dicts)
    house_style = rules.load_house_style_from_dict({"color": "colour", "organization": "organisation"})

    text = "The  color pattern was analyzed carefully . The organization met ."
    sents = segmenter.sentences(text)
    findings = engine.analyze(text, compiled_rules, house_style, sents)

    originals = [f.original for f in findings]
    assert "  " in originals or "color" in originals or " ." in originals


def test_tracked_changes_exporter(tmp_path):
    doc = Document()
    doc.add_paragraph("The results were analyzed carefully .The team met the the deadline.")
    path = os.path.join(tmp_path, "test.docx")
    doc.save(path)

    doc_read, paras = docx_io.read_paragraphs(path)
    p = doc_read.paragraphs[0]
    
    # Apply tracked change
    docx_io.apply_tracked_change(p, start=4, end=11, new_text="outcomes", author="LangQA")
    
    out_path = os.path.join(tmp_path, "test_redline.docx")
    doc_read.save(out_path)
    assert os.path.exists(out_path)


def test_medical_pharmaceutical_profile():
    from app.services.language_rule_service import get_available_style_profiles
    profiles = get_available_style_profiles()
    assert "medical_pharmaceutical" in profiles
    med = profiles["medical_pharmaceutical"]
    assert "anaemia" in med["variant_to_canonical"]
    assert med["variant_to_canonical"]["anaemia"] == "anemia"


def test_umls_service():
    from app.services.umls_service import validate_medical_term
    res = validate_medical_term("ibuprofen")
    assert "valid" in res
    assert res["term"] == "ibuprofen"


def test_paragraph_exclusions(tmp_path):
    doc = Document()
    doc.add_paragraph("<front>")
    doc.add_paragraph("<PT>Part II: The Science of Personal Training")
    doc.add_paragraph("<CN>CHAPTER 3")
    doc.add_paragraph("<CT>Anatomy and Kinesiology")
    doc.add_paragraph("<OBJ1>OBJECTIVES")
    doc.add_paragraph("Personal Trainers should be able to:")
    doc.add_paragraph("<body>")
    doc.add_paragraph("<H1-INTRO>INTRODUCTION")
    doc.add_paragraph("A major goal of exercise training is to improve cardiovascular fitness.")
    doc.add_paragraph("<BXM>")
    doc.add_paragraph("Kinesiology is the study of human movement.")
    doc.add_paragraph("</BXM>")
    doc.add_paragraph("<FIG3.4>")
    doc.add_paragraph("<TAB3.2>")
    doc.add_paragraph("<ref-open>")
    doc.add_paragraph("<REF-N>Smith J. Journal of Science 2020.")
    doc.add_paragraph("<ref-close>")
    
    path = os.path.join(tmp_path, "exclusions_test.docx")
    doc.save(path)

    doc_read, paras = docx_io.read_paragraphs(path)
    filtered_texts = [p_text for idx, p_text in paras]
    
    # Only body paragraphs should be included (<FIG3.4>, <TAB3.2>, <BXM>, </BXM> skipped)
    assert len(filtered_texts) == 2
    assert any("A major goal of exercise training" in t for t in filtered_texts)
    assert any("Kinesiology is the study" in t for t in filtered_texts)
    assert not any("<FIG3.4>" in t for t in filtered_texts)
    assert not any("<TAB3.2>" in t for t in filtered_texts)
    assert not any("</BXM>" in t for t in filtered_texts)


def test_inline_markup_tag_findings_filter():
    from app.processing.language_editing.rules import Rule
    rule = Rule(id="GP002", category="grammar", type="regex", pattern=r"\s+([,;:\.!?])", replacement=r"\1", message="Space before punct", severity="error", enabled=True)
    text = "Kinesiology dates back to the sixth century B.C (10-12-26). </BXM>"
    findings = engine.run_regex_rule(rule, text)
    filtered = engine.filter_markup_tag_findings(text, findings)
    
    # Finding on </BXM> should be filtered out
    assert not any(f.original == " >" or ">" in f.original for f in filtered)


def test_ninja_inkflow_spec_rules():
    from app.processing.language_editing import sentence_checks
    # 1. Test GP005 repeated words guarding that that and had had
    rule_gp005 = rules.Rule(id="GP005", category="grammar", type="regex", pattern=r"\b(\w+)\s+\1\b", replacement=r"\1", message="Repeated word", severity="warning", flags=2, enabled=True).compile()
    text_dup = "He said that that decision was wrong and they had had enough time to met the the deadline."
    findings_dup = engine.run_regex_rule(rule_gp005, text_dup)
    origs = [f.original.lower() for f in findings_dup]
    assert "the the" in origs
    assert "that that" not in origs
    assert "had had" not in origs

    # 2. Test SL003 start_capital display quote guard
    rule_sl003 = rules.Rule(id="SL003", category="sentence", type="function", function="start_capital", severity="warning", enabled=True)
    sent_quote = '"this is a display quote."'
    findings_quote = sentence_checks.start_capital(sent_quote, 0, rule_sl003, {})
    assert len(findings_quote) == 0

    # 3. Test SL004 wordiness phrase replacements
    rule_sl004 = rules.Rule(id="SL004", category="sentence", type="function", function="wordiness", severity="suggestion", enabled=True)
    sent_wordy = "The study was conducted in order to test outcomes due to the fact that data was limited."
    findings_wordy = sentence_checks.wordiness(sent_wordy, 0, rule_sl004, {})
    suggs = [f.suggestion for f in findings_wordy]
    assert "to" in suggs
    assert "because" in suggs






