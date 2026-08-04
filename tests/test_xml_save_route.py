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
