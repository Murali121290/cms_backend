import pytest
from pathlib import Path
from docx import Document
from app import models
from app.domains.review import service as structuring_review_service

def _build_docx_with_styles(path: Path, paragraphs_with_styles: list[tuple[str, str]]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()
    for text, style_name in paragraphs_with_styles:
        p = doc.add_paragraph(text)
        try:
            p.style = style_name
        except KeyError:
            doc.styles.add_style(style_name, 1) # WD_STYLE_TYPE.PARAGRAPH
            p.style = style_name
    doc.save(path)
    return path

def test_reference_review_detected_style_ama(
    db_session,
    temp_upload_root,
    project_record,
    chapter_record,
    auth_cookie_client,
    admin_user,
):
    # Create an AMA/Numerical document
    file_path = temp_upload_root / project_record.code / chapter_record.number / "Manuscript"
    file_path.mkdir(parents=True, exist_ok=True)
    
    # original file
    original_filename = "chapter01.docx"
    original_docx = _build_docx_with_styles(file_path / original_filename, [("Text with citation [1].", "Normal")])
    
    original_record = models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename=original_filename,
        file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        category="Manuscript",
        path=str(original_docx),
        version=1,
    )
    db_session.add(original_record)
    db_session.commit()
    db_session.refresh(original_record)

    # processed file
    processed_filename = "chapter01_Processed.docx"
    paragraphs = [
        ("Some text with a citation [1].", "Normal"),
        ("1. Smith J. Reference 1.", "REF-N"),
    ]
    processed_docx = _build_docx_with_styles(file_path / processed_filename, paragraphs)
    
    processed_record = models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename=processed_filename,
        file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        category="Manuscript",
        path=str(processed_docx),
        version=1,
    )
    db_session.add(processed_record)
    db_session.commit()
    db_session.refresh(processed_record)

    # Let's call the API client
    client = auth_cookie_client(admin_user)
    response = client.get(f"/api/v2/files/{processed_record.id}/reference-review")
    
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["validation_logs"]["detected_style"] == "AMA"


def test_reference_review_detected_style_apa(
    db_session,
    temp_upload_root,
    project_record,
    chapter_record,
    auth_cookie_client,
    admin_user,
):
    # Create an APA/Author-Year document with REF-U paragraphs
    file_path = temp_upload_root / project_record.code / chapter_record.number / "Manuscript"
    file_path.mkdir(parents=True, exist_ok=True)
    
    # original file
    original_filename = "chapter02.docx"
    original_docx = _build_docx_with_styles(file_path / original_filename, [("Text with citation (Smith, 2020).", "Normal")])
    
    original_record = models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename=original_filename,
        file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        category="Manuscript",
        path=str(original_docx),
        version=1,
    )
    db_session.add(original_record)
    db_session.commit()
    db_session.refresh(original_record)

    # processed file
    processed_filename = "chapter02_Processed.docx"
    paragraphs = [
        ("Some text with a citation (Smith, 2020).", "Normal"),
        ("Smith, J. (2020). Reference 2.", "REF-U"),
    ]
    processed_docx = _build_docx_with_styles(file_path / processed_filename, paragraphs)
    
    processed_record = models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename=processed_filename,
        file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        category="Manuscript",
        path=str(processed_docx),
        version=1,
    )
    db_session.add(processed_record)
    db_session.commit()
    db_session.refresh(processed_record)

    # Let's call the API client
    client = auth_cookie_client(admin_user)
    response = client.get(f"/api/v2/files/{processed_record.id}/reference-review")
    
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["validation_logs"]["detected_style"] == "APA"


def test_reference_review_style_override(
    db_session,
    temp_upload_root,
    project_record,
    chapter_record,
    auth_cookie_client,
    admin_user,
):
    file_path = temp_upload_root / project_record.code / chapter_record.number / "Manuscript"
    file_path.mkdir(parents=True, exist_ok=True)
    
    # Create an AMA/Numerical document with REF-N style
    filename = "chapter03_Processed.docx"
    paragraphs = [
        ("Some text with a citation [1].", "Normal"),
        ("1. Smith J. Reference 1.", "REF-N"),
    ]
    docx_file = _build_docx_with_styles(file_path / filename, paragraphs)
    
    file_record = models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename=filename,
        file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        category="Manuscript",
        path=str(docx_file),
        version=1,
    )
    db_session.add(file_record)
    db_session.commit()
    db_session.refresh(file_record)

    client = auth_cookie_client(admin_user)
    
    # 1. Check default auto-detection (should be AMA)
    response = client.get(f"/api/v2/files/{file_record.id}/reference-review")
    assert response.status_code == 200
    data = response.json()
    assert data["validation_logs"]["detected_style"] == "AMA"
    
    # 2. Check override with APA
    response = client.get(f"/api/v2/files/{file_record.id}/reference-review?style=APA")
    assert response.status_code == 200
    data = response.json()
    assert data["validation_logs"]["detected_style"] == "APA"
    
    # 3. Check validate-only endpoint override with APA
    response = client.get(f"/api/v2/files/{file_record.id}/reference-review/validate-only?style=APA")
    assert response.status_code == 200
    data = response.json()
    assert data["detected_style"] == "APA"

    # 4. Check validate-only endpoint override with AMA
    response = client.get(f"/api/v2/files/{file_record.id}/reference-review/validate-only?style=AMA")
    assert response.status_code == 200
    data = response.json()
    assert data["detected_style"] == "AMA"
