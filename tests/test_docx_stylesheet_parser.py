"""
Unit tests for DocxStylesheetParser.
"""

import io
import docx
import pytest

from app.processing.manuscript_core.parsers.docx_stylesheet_parser import DocxStylesheetParser


def create_mock_editorial_docx(
    title: str = "Cardiology Handbook",
    author: str = "Dr. Jane Smith",
    edition: str = "4e",
    manual: str = "AMA, 11e",
    percent_style: str = "10%",
    temp_style: str = "5 °C (spaced out) 10 °F",
    ranges_style: str = 'Use "to" in text',
    number_style: str = "0 to 9 spell out",
    words: list[str] | None = None,
) -> bytes:
    """Helper that creates an in-memory editorial stylesheet DOCX."""
    doc = docx.Document()

    # Table 0: Metadata
    t0 = doc.add_table(rows=7, cols=2)
    t0.rows[0].cells[0].text = "Customer:"
    t0.rows[0].cells[1].text = "LWW"
    t0.rows[1].cells[0].text = "Book Title:"
    t0.rows[1].cells[1].text = title
    t0.rows[2].cells[0].text = "Author(s):"
    t0.rows[2].cells[1].text = author
    t0.rows[3].cells[0].text = "Edition:"
    t0.rows[3].cells[1].text = edition
    t0.rows[4].cells[0].text = "Manual/Previous edition to be followed:"
    t0.rows[4].cells[1].text = manual
    t0.rows[5].cells[0].text = "Book category:"
    t0.rows[5].cells[1].text = "Clinical Medicine"
    t0.rows[6].cells[0].text = "CE Sample Chapter:"
    t0.rows[6].cells[1].text = "Chapter 4"

    # Table 1: Specifications
    specs = [
        ("Level of editing", "Standard"),
        ("Reference books, dictionaries followed, websites (CMS/AMA)", manual),
        ("Head1", "ALL CAPS (Bold)"),
        ("Head2", "Title Case (Bold)"),
        ("Figure Citation style", "Direct: Figure 4.1 Indirect: (Figure 4.1)"),
        ("Table citation style", "Table 1.1"),
        ("Table footnote designators", "a, b, c, d"),
        ("Percent style", percent_style),
        ("Style for C and ratio", temp_style),
        ("Ranges", ranges_style),
        ("Number usage (0–9/10 or above)", number_style),
        ("Dates, year, time (AM/PM/Hours)", "Small caps am, pm eg, 6:00 am"),
        ("versus/v.s. usage", '“versus” in text “vs” in parenthesis and tables'),
        ("Greek Characters", "Use symbol (e.g., α-tubulin)"),
        ("microgram", "μg"),
        ("angle", "Symbol e.g., 45° angle"),
        ("Trademark, copyright and registered symbol", "Delete"),
    ]

    t1 = doc.add_table(rows=len(specs), cols=2)
    for i, (k, v) in enumerate(specs):
        t1.rows[i].cells[0].text = k
        t1.rows[i].cells[1].text = v

    # Table 2: Word List
    term_list = words or ["anti-poliovirus", "cryo-electron microscopy", "decision-making"]
    t2 = doc.add_table(rows=len(term_list) + 1, cols=3)
    t2.rows[0].cells[0].text = "A"
    t2.rows[0].cells[1].text = "B"
    t2.rows[0].cells[2].text = "C"
    for idx, term in enumerate(term_list):
        t2.rows[idx + 1].cells[0].text = term

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_parser_initialization():
    parser = DocxStylesheetParser()
    assert len(parser.catalog_rules) > 50
    assert 6 in parser.catalog_rules
    assert 5 in parser.catalog_rules


def test_detect_preset():
    parser = DocxStylesheetParser()
    assert parser._detect_preset({"Manual/Previous edition to be followed": "AMA 11th edition"}, {}) == "ama"
    assert parser._detect_preset({"Manual/Previous edition to be followed": "Follow APA 7e style"}, {}) == "apa"
    assert parser._detect_preset({"Manual/Previous edition to be followed": "Oxford Style Guide (UK)"}, {}) == "oxford"
    assert parser._detect_preset({"Manual/Previous edition to be followed": "Chicago Manual of Style 17th"}, {}) == "chicago"
    assert parser._detect_preset({"Manual/Previous edition to be followed": "Nature / Springer protocols"}, {}) == "nature"


def test_parse_mock_ama_docx():
    parser = DocxStylesheetParser()
    raw_docx = create_mock_editorial_docx(
        title="Fields Virology",
        author="Peter M. Howley",
        edition="8e",
        manual="AMA, 11e",
        percent_style="10%",
        temp_style="5 °C (spaced out) 10 °F",
        ranges_style='Use "to" in text',
        number_style="0 to 9 spell out",
    )

    res = parser.parse(raw_docx)

    assert "Fields Virology (8e)" in res["suggested_name"]
    assert "AMA 11th Edition" in res["suggested_name"]
    assert res["detected_preset_id"] == "ama"
    assert "Peter M. Howley" in res["suggested_description"]

    # Verify CE rules
    ce = res["matched_ce_rules"]
    assert "6" in ce  # Percentage
    assert ce["6"]["option"] == 1  # 10% closed
    assert "5" in ce  # Temperature
    assert ce["5"]["option"] == 5  # Dual °C and °F
    assert "13" in ce  # Numbers
    assert ce["13"]["option"] == 1  # 0 to 9 spelled
    assert "14" in ce  # Ranges
    assert ce["14"]["option"] == 2  # word "to"
    assert "43" in ce  # Trademark delete
    assert ce["43"]["option"] == 1

    # Verify IA rows
    ia = res["matched_ia_rows"]
    assert len(ia) >= 4
    elements = [row["element"] for row in ia]
    assert "Figure" in elements
    assert "Table" in elements
    assert "Percent" in elements
    assert "Degree Celsius" in elements

    # Verify Word List
    assert len(res["word_list"]) >= 3
    assert "anti-poliovirus" in res["word_list"]


def test_parse_mock_apa_docx():
    parser = DocxStylesheetParser()
    raw_docx = create_mock_editorial_docx(
        title="Nursing Assessment",
        author="Sharon Jensen",
        edition="5e",
        manual="APA, 7e",
        percent_style="10 %",  # spaced percent
        temp_style="38.3°C (closed-up)",
        ranges_style="Use en-dash in text and tables",
        number_style="0 to 9 spell out",
    )

    res = parser.parse(raw_docx)
    assert res["detected_preset_id"] == "apa"
    assert "APA 7th Edition" in res["suggested_name"]

    ce = res["matched_ce_rules"]
    assert ce["6"]["option"] == 2  # spaced percent
    assert ce["5"]["option"] == 2  # closed °C
    assert ce["14"]["option"] == 1  # en-dash


def test_empty_or_plain_docx():
    parser = DocxStylesheetParser()
    doc = docx.Document()
    doc.add_paragraph("This is just a document without style tables.")
    buf = io.BytesIO()
    doc.save(buf)

    res = parser.parse(buf.getvalue())
    assert res["detected_preset_id"] == "chicago"
    assert res["total_specs_scanned"] == 0
    assert res["matched_rules_count"] == 0
    assert res["word_list"] == []


def test_api_v2_parse_docx_stylesheet_endpoint(client, user_factory, db_session):
    user_factory("alice", password="Secret123!", role_names=("Admin",))
    client.post("/api/v2/session/login", json={"username": "alice", "password": "Secret123!"})

    from app.domains.projects.models import Project
    project = Project(name="Virology Book", code="VIR-01", description="Virology test project")
    db_session.add(project)
    db_session.commit()

    docx_bytes = create_mock_editorial_docx(
        title="Fields Virology",
        author="Peter M. Howley",
        edition="8e",
        manual="AMA, 11e",
        percent_style="10%",
    )

    response = client.post(
        f"/api/v2/projects/{project.id}/stylesheets/parse-docx",
        files={"file": ("Howley-8e_187202.docx", docx_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )

    assert response.status_code == 200
    data = response.json()
    assert "Fields Virology (8e)" in data["suggested_name"]
    assert data["detected_preset_id"] == "ama"
    assert "6" in data["matched_ce_rules"]
    assert data["matched_ce_rules"]["6"]["option"] == 1
    assert data["matched_rules_count"] >= 10
