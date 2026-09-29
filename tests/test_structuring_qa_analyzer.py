import os
import zipfile
import pytest
from app.processing.structuring_qa_analyzer import (
    analyze_docx_structure,
    generate_qa_report_html,
)

def create_mock_docx(docx_path: str, styles: list):
    """Utility to build a minimal mock docx file with specific paragraph styles."""
    paragraphs_xml = ""
    for style in styles:
        paragraphs_xml += f"""
        <w:p>
          <w:pPr>
            <w:pStyle w:val="{style}"/>
          </w:pPr>
          <w:r><w:t>Sample text</w:t></w:r>
        </w:p>
        """

    doc_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        {paragraphs_xml}
      </w:body>
    </w:document>
    """

    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    </w:styles>
    """

    with zipfile.ZipFile(docx_path, "w") as z:
        z.writestr("word/document.xml", doc_xml)
        z.writestr("word/styles.xml", styles_xml)


def test_qa_analyzer_with_normal_paragraphs(tmp_path):
    docx_file = str(tmp_path / "test_doc_with_normal.docx")
    styles = ["H1", "TXT", "Normal", "Normal", "TXT", "Reference-Alphabetical"]
    create_mock_docx(docx_file, styles)

    metrics = analyze_docx_structure(docx_file)

    assert metrics["total_paragraphs"] == 6
    assert metrics["normal_paragraphs"] == 2
    assert metrics["tagged_paragraphs"] == 4
    assert metrics["completion_pct"] == 66.7
    assert any(c["status"] == "warning" for c in metrics["qa_checks"])


def test_qa_analyzer_100_percent_completion(tmp_path):
    docx_file = str(tmp_path / "test_doc_clean.docx")
    styles = ["H1", "TXT", "TXT", "Reference-Alphabetical", "Reference-Numbered"]
    create_mock_docx(docx_file, styles)

    metrics = analyze_docx_structure(docx_file)

    assert metrics["total_paragraphs"] == 5
    assert metrics["normal_paragraphs"] == 0
    assert metrics["tagged_paragraphs"] == 5
    assert metrics["completion_pct"] == 100.0
    assert any("100%" in c["title"] for c in metrics["qa_checks"])


def test_generate_qa_report_html(tmp_path):
    docx_file = str(tmp_path / "sample.docx")
    html_out = str(tmp_path / "qa_report.html")
    styles = ["H1", "TXT", "Normal", "T1"]
    create_mock_docx(docx_file, styles)

    generate_qa_report_html(docx_file, html_out)

    assert os.path.exists(html_out)
    with open(html_out, "r", encoding="utf-8") as f:
        content = f.read()

    assert "S4C Structuring QA Report" in content
    assert "Tagging Completion" in content
    assert "Paragraph Style Distribution" in content
