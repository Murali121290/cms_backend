import os
import pytest
from app import models
from app.domains.projects.models import Project
from app.services.file_service import UPLOAD_DIR

def test_xml_save_route(auth_cookie_client, admin_user, db_session):
    client = auth_cookie_client(admin_user)
    
    # 1. Create mock project
    proj = Project(
        title="Test Project XML",
        code="TESTPROJXML",
        client_name="Test Client",
        status="Active",
        xml_standard="BITS"
    )
    db_session.add(proj)
    db_session.commit()
    
    # 2. Create mock chapter
    ch = models.ChapterInfo(
        client=proj.client_name,
        project=proj.code,
        chapters="01",
        stage_name=None,
        status="Active"
    )
    db_session.add(ch)
    db_session.commit()
    
    # 3. Call save route to write mock file
    xml_content = "<root><child>Hello Test</child></root>"
    
    response = client.put(
        f"/api/uploads/{proj.id}/chapter/chapter-01/XML/Bhuyan45413_ch01.xml/save",
        json={"content": xml_content}
    )
    
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["status"] is True
    assert res_data["message"] == "File saved"
    assert "log_content" in res_data
    assert isinstance(res_data["log_content"], str)
    
    # 4. Verify file exists on disk and content is correct
    import app.services.file_service
    expected_path = os.path.join(app.services.file_service.UPLOAD_DIR, proj.code, ch.chapters, "XML", "Bhuyan45413_ch01.xml")
    assert os.path.exists(expected_path)
    
    with open(expected_path, "r", encoding="utf-8") as f:
        written_content = f.read()
    assert written_content == xml_content
    
    # Cleanup disk file
    try:
        os.remove(expected_path)
        log_path = os.path.splitext(expected_path)[0] + ".log"
        if os.path.exists(log_path):
            os.remove(log_path)
        os.rmdir(os.path.dirname(expected_path))
        os.rmdir(os.path.join(app.services.file_service.UPLOAD_DIR, proj.code, ch.chapters))
        os.rmdir(os.path.join(app.services.file_service.UPLOAD_DIR, proj.code))
    except Exception:
        pass


def test_xml_save_to_indesign_folder_redirection(auth_cookie_client, admin_user, db_session):
    client = auth_cookie_client(admin_user)
    
    # 1. Create mock project
    proj = Project(
        title="Test Project XML Redirection",
        code="TESTPROJXMLRED",
        client_name="Test Client",
        status="Active",
        xml_standard="BITS"
    )
    db_session.add(proj)
    db_session.commit()
    
    # 2. Create mock chapter
    ch = models.ChapterInfo(
        client=proj.client_name,
        project=proj.code,
        chapters="01",
        stage_name=None,
        status="Active"
    )
    db_session.add(ch)
    db_session.commit()
    
    # 3. Create a legacy file record under category "InDesign" for the XML file
    import app.services.file_service
    file_path = os.path.join(app.services.file_service.UPLOAD_DIR, proj.code, ch.chapters, "InDesign", "Bhuyan45413_ch01.xml")
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write("<root>old</root>")
        
    db_file = models.File(
        project_id=proj.id,
        chapter_id=ch.id,
        filename="Bhuyan45413_ch01.xml",
        file_type="xml",
        category="InDesign",
        path=file_path,
        version=1,
    )
    db_session.add(db_file)
    db_session.commit()

    # 4. Call save route to write mock file, passing "InDesign" in route
    xml_content = "<root><child>Hello Redirected</child></root>"
    
    response = client.put(
        f"/api/uploads/{proj.id}/chapter/chapter-01/InDesign/Bhuyan45413_ch01.xml/save",
        json={"content": xml_content}
    )
    
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["status"] is True
    
    # 5. Verify database record corrected
    db_session.refresh(db_file)
    assert db_file.category == "XML"
    expected_xml_path = os.path.join(app.services.file_service.UPLOAD_DIR, proj.code, ch.chapters, "XML", "Bhuyan45413_ch01.xml")
    assert db_file.path == expected_xml_path
    
    # 6. Verify file exists in XML folder and content is correct
    assert os.path.exists(expected_xml_path)
    with open(expected_xml_path, "r", encoding="utf-8") as f:
        written_content = f.read()
    assert written_content == xml_content
    
    # Cleanup
    try:
        os.remove(expected_xml_path)
        log_path = os.path.splitext(expected_xml_path)[0] + ".log"
        if os.path.exists(log_path):
            os.remove(log_path)
        os.remove(file_path)
        os.rmdir(os.path.dirname(file_path))
        os.rmdir(os.path.dirname(expected_xml_path))
        os.rmdir(os.path.join(app.services.file_service.UPLOAD_DIR, proj.code, ch.chapters))
        os.rmdir(os.path.join(app.services.file_service.UPLOAD_DIR, proj.code))
    except Exception:
        pass


def test_xml_layout_preview(auth_cookie_client, admin_user, db_session):
    client = auth_cookie_client(admin_user)
    
    # 1. Create mock project
    proj = Project(
        title="Test Layout Proj",
        code="TESTLAYOUT",
        client_name="Test Client",
        status="Active",
        xml_standard="BITS"
    )
    db_session.add(proj)
    db_session.commit()
    
    # 2. Create mock chapter
    ch = models.ChapterInfo(
        client=proj.client_name,
        project=proj.code,
        chapters="01",
        stage_name=None,
        status="Active"
    )
    db_session.add(ch)
    db_session.commit()
    
    # 3. Create a mock XML file in the filesystem
    import app.services.file_service
    file_path = os.path.join(app.services.file_service.UPLOAD_DIR, proj.code, ch.chapters, "XML", "preview_test.xml")
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    
    xml_content = """<?xml version="1.0" encoding="UTF-8"?>
    <book>
      <book-body>
        <book-part book-part-type="chapter">
          <book-part-meta>
            <title-group>
              <label>Chapter 1</label>
              <title>XML Layout Preview Test <highlight><query>AQ: Please ignore this title query</query></highlight>Title</title>
            </title-group>
          </book-part-meta>
          <body>
            <p>This is a paragraph under body with <highlight>nested <query>another AQ to ignore</query> text</highlight>.</p>
            <boxed-text id="cs1">
              <label>Case Study 1.1</label>
              <caption><title>Test Box Title</title></caption>
              <p>Box text content.</p>
            </boxed-text>
          </body>
        </book-part>
      </book-body>
    </book>
    """
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(xml_content)
        
    db_file = models.File(
        project_id=proj.id,
        chapter_id=ch.id,
        filename="preview_test.xml",
        file_type="xml",
        category="XML",
        path=os.path.relpath(file_path, app.services.file_service.UPLOAD_DIR).replace("\\", "/"),
        version=1,
    )
    db_session.add(db_file)
    db_session.commit()

    # 4. Call layout-preview route
    response = client.get(
        f"/api/uploads/{proj.id}/chapter/chapter-01/XML/preview_test.xml/layout-preview"
    )
    
    assert response.status_code == 200
    html_text = response.text
    
    # Assert XSLT transformed successfully
    assert "<html" in html_text
    assert "XML Layout Preview Test Title" in html_text
    assert "This is a paragraph under body with nested  text." in html_text or "This is a paragraph under body with nested text." in html_text
    
    # Assert boxed-text rendered successfully
    assert "Case Study 1.1" in html_text
    assert "Test Box Title" in html_text
    assert "Box text content." in html_text
    
    # Assert query tag content is ignored
    assert "AQ: Please ignore this title query" not in html_text
    assert "another AQ to ignore" not in html_text
    
    # Assert stylesheet injected
    assert "<style>" in html_text
    assert "body {" in html_text
    assert ".container {" in html_text
    
    # Assert duplicate text prevention works (title is only printed in the header, not matched by general wildcards again)
    # We check if the title occurs exactly once in the rendered body
    # (Excluding title inside head <title> tag, so we count occurrences in the HTML text)
    # Title tag in head: <title>XML Layout Preview Test Title</title>
    # Header tag: <h1 class="chapter-title">XML Layout Preview Test Title</h1>
    # Should not occur a third time.
    occurrences = html_text.count("XML Layout Preview Test Title")
    assert occurrences == 2, f"Title text duplicated: found {occurrences} times instead of 2."

    # Cleanup
    try:
        os.remove(file_path)
        os.rmdir(os.path.dirname(file_path))
        os.rmdir(os.path.join(app.services.file_service.UPLOAD_DIR, proj.code, ch.chapters))
        os.rmdir(os.path.join(app.services.file_service.UPLOAD_DIR, proj.code))
    except Exception:
        pass

