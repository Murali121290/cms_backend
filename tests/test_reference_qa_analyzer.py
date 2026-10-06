import os
import pytest
from app.processing.reference_qa_analyzer import (
    parse_reference_log,
    determine_qa_report_filename,
    generate_reference_qa_report_html,
)


def test_parse_apa_validation_log(tmp_path):
    log_file = str(tmp_path / "Wheeler92516_Ch01_log.txt")
    log_content = """PROCESS LOG FOR: Wheeler92516_Ch01-Tagged-Test.docx
====================================================================
APA 7th CITATION VALIDATION REPORT
====================================================================
  Total in-text citations                     : 178
  Total bibliography entries                  : 153
--------------------------------------------------------------------
  Matched (green)                             : 161
  Missing references                          : 4
  Year mismatches                             : 8
  Spelling mismatches                         : 1
  et al. violations                           : 1
  Unused references                           : 12
  Bib order errors                            : 4
====================================================================
"""
    with open(log_file, "w", encoding="utf-8") as f:
        f.write(log_content)

    parsed = parse_reference_log(log_file)
    assert parsed["log_type"] == "apa_validation"
    assert parsed["raw_counts"]["matched_citations"] == 161
    assert parsed["raw_counts"]["missing_references"] == 4
    assert len(parsed["metrics_table"]) == 9

    # Verify metric table is sorted alphabetically by metric_name
    names = [m["metric_name"] for m in parsed["metrics_table"]]
    assert names == sorted(names, key=lambda s: s.lower())


def test_parse_numbered_validation_log(tmp_path):
    log_file = str(tmp_path / "Jensen_log.txt")
    log_content = """PROCESS LOG FOR: Jensen9781975242831-ch001.docx
--- NUMERICAL VALIDATION ---
Result: Two-pass validation: Pass 1 renumbered, Pass 2 1 duplicate reference removed and renumbered.
Before Stats: {'total_references': 18, 'total_citations': 48, 'sequence_issues': [1, 2], 'duplicate_references': [{'id': 4}]}
After Stats: {'total_references': 17, 'total_citations': 47, 'sequence_issues': [], 'duplicate_references': []}
"""
    with open(log_file, "w", encoding="utf-8") as f:
        f.write(log_content)

    parsed = parse_reference_log(log_file)
    assert parsed["log_type"] == "numbered_validation"
    assert len(parsed["qa_checks"]) > 0


def test_determine_qa_report_filename():
    f1 = determine_qa_report_filename("/path/to/doc.docx", process_type="reference_conversion")
    assert f1.endswith("doc_AI_Conversion_QA_Report.html")

    f2 = determine_qa_report_filename("/path/to/doc.docx", process_type="reference_number_validation")
    assert f2.endswith("doc_Numbered_Validation_QA_Report.html")

    f3 = determine_qa_report_filename("/path/to/doc.docx", process_type="reference_apa_chicago_validation")
    assert f3.endswith("doc_Name_Year_Validation_QA_Report.html")


def test_generate_reference_qa_report_html(tmp_path):
    docx_file = str(tmp_path / "sample_doc.docx")
    log_file = str(tmp_path / "sample_doc_log.txt")
    html_out = str(tmp_path / "sample_doc_QA_Report.html")

    with open(log_file, "w", encoding="utf-8") as f:
        f.write("""PROCESS LOG FOR: sample_doc.docx
--- NUMERICAL VALIDATION ---
Result: One-pass validation completed.
Before Stats: {'total_references': 10, 'total_citations': 15}
After Stats: {'total_references': 10, 'total_citations': 15}
""")

    out = generate_reference_qa_report_html(docx_file, log_file, html_out)
    assert os.path.exists(out)

    with open(out, "r", encoding="utf-8") as f:
        content = f.read()

    assert "QA Report" in content
    assert "Before vs After Validation Summary" in content
    assert "sample_doc.docx" in content


def test_parse_combined_log(tmp_path):
    docx_file = str(tmp_path / "Jensen9781975242831-ch001.docx")
    log_file = str(tmp_path / "Jensen9781975242831-ch001_log.txt")

    with open(log_file, "w", encoding="utf-8") as f:
        f.write("""PROCESS LOG FOR: Jensen9781975242831-ch001.docx
--- NUMERICAL VALIDATION ---
Result: Two-pass validation: Pass 1 renumbered, Pass 2 1 duplicate reference removed and renumbered.
Before Stats: {'total_references': 18, 'total_citations': 48, 'sequence_issues': [1, 2], 'duplicate_references': [{'id': 4}]}
After Stats: {'total_references': 17, 'total_citations': 47, 'sequence_issues': [], 'duplicate_references': []}

--- REFERENCE CONVERSION ---
Source Style: APA 7th
Target Style: Vancouver
[1] TYPE: JOURNAL
FROM: Smith J. 2020. Article title. J Med 10:1-5.
TO: 1. Smith J. Article title. J Med. 2020;10:1-5. doi:10.1000/123
NOTES: Added DOI
""")

    parsed = parse_reference_log(log_file)
    assert parsed["log_type"] == "combined"
    assert parsed["before_summary"]["total_references"] == 18
    assert parsed["after_summary"]["total_references"] == 17
    assert len(parsed["conversion_entries"]) == 1

    out_path = generate_reference_qa_report_html(docx_file, log_file)
    assert os.path.exists(out_path)
    assert out_path.endswith("_Reference_QA_Report.html")

    with open(out_path, "r", encoding="utf-8") as f:
        html = f.read()

    assert "S4C Reference Process QA Report" in html
    assert "Before vs After Validation Summary" in html
    assert "Converted References Samples" in html

