import os
from app.domains.projects.po_intake import service, detect

SAMPLE_DOCX = r"C:\Users\Muraliba\Downloads\Giardino_4e_189565-Art_1\Giardino_assignment memo.docx"


def test_springer_po_intake():
    assert os.path.exists(SAMPLE_DOCX), "Sample file does not exist"

    result = service.extract_po(SAMPLE_DOCX, "Giardino_assignment memo.docx")

    assert result["template_detected"] == detect.SPRINGER, f"Expected {detect.SPRINGER}, got {result['template_detected']}"

    fields = result["fields"]
    print("Extracted fields:", fields)

    assert fields.get("project_title") == "Evaluation of Quality in Health Care for DNPs, Fourth Edition"
    assert fields.get("author_names") == ["Eileen R. Giardino"]
    assert fields.get("isbn_no") == "9780826100443"
    assert fields.get("trim_size") == "8.5 X 11/SC"
    assert fields.get("chapter_count") == 12
    assert fields.get("estimated_pages") in (484, 383)
    assert fields.get("turnover_date") == "2026-06-11"
    assert fields.get("due_date") == "2026-12-01"
    assert fields.get("color") == "4-color throughout"
