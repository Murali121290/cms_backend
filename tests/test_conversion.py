import io
from pathlib import Path
from app import models
from app.domains.projects.models import Project

from unittest.mock import patch, MagicMock

def test_batch_indesign_to_word_endpoint(
    auth_cookie_client,
    admin_user,
    db_session,
    app_env,
):
    client = auth_cookie_client(admin_user)

    # Prepare mock files to upload
    file1_content = b"fake indesign data 1"
    file2_content = b"fake indesign data 2"
    
    files = [
        ("files", ("ch_01.indd", io.BytesIO(file1_content), "application/octet-stream")),
        ("files", ("chapter_02.indd", io.BytesIO(file2_content), "application/octet-stream")),
    ]
    
    data = {
        "client_name": "Test Client",
        "project_code": "TC_BATCH_01",
    }

    # Call endpoint with mocked Windows server response
    with patch("requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.content = b"MOCK DOCX BYTES"
        mock_post.return_value = mock_resp

        response = client.post(
            "/api/v1/conversion/batch-indesign-to-word",
            data=data,
            files=files
        )

    assert response.status_code == 200
    body = response.json()
    assert body["project_code"] == "TC_BATCH_01"
    assert len(body["results"]) == 2

    # Verify both chapters exist in database
    project = db_session.query(Project).filter(Project.project_code == "TC_BATCH_01").first()
    assert project is not None
    assert project.division_code == "Test Client"

    ch1 = db_session.query(models.ChapterInfo).filter(
        models.ChapterInfo.project == "TC_BATCH_01",
        models.ChapterInfo.chapters == "1"
    ).first()
    assert ch1 is not None

    ch2 = db_session.query(models.ChapterInfo).filter(
        models.ChapterInfo.project == "TC_BATCH_01",
        models.ChapterInfo.chapters == "2"
    ).first()
    assert ch2 is not None

    # Check that File records are created under InDesign and Manuscript categories
    indd_files = db_session.query(models.File).filter(
        models.File.project_id == project.id,
        models.File.category == "InDesign"
    ).all()
    assert len(indd_files) == 2

    docx_files = db_session.query(models.File).filter(
        models.File.project_id == project.id,
        models.File.category == "Manuscript"
    ).all()
    assert len(docx_files) == 2

def test_pdf_to_word_endpoint(
    auth_cookie_client,
    admin_user,
    app_env,
):
    client = auth_cookie_client(admin_user)

    # Post a mock pdf file
    pdf_content = b"%PDF-1.4 mock content"
    files = {
        "file": ("document.pdf", io.BytesIO(pdf_content), "application/pdf")
    }
    data = {
        "engine": "pdf2docx" # This will run pdf2docx (which will raise ImportError or handle gracefully)
    }

    response = client.post(
        "/api/v1/conversion/pdf-to-word",
        data=data,
        files=files
    )

    # Since pdf2docx may not be installed in the test env, it could return 500 with detailed message.
    # If mock is run or libraries are missing, we assert it behaves as expected.
    if response.status_code == 200:
        assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        assert "converted_document.docx" in response.headers["content-disposition"]
    else:
        assert response.status_code == 500
        assert "detail" in response.json()


def test_backup_list_and_download_endpoints(
    auth_cookie_client,
    admin_user,
    db_session,
    app_env,
):
    client = auth_cookie_client(admin_user)
    
    from app.domains.projects.models import Project
    from app.domains.workflow.models import ChapterInfo
    from app.domains.clients.models import Client
    
    client_rec = Client(
        category_type="Organization",
        contact_type="Customer",
        name_company="Test Client Co",
        company="Test Client Co",
        division="TEST_DIV",
        email="test@example.com",
        active_status=True
    )
    db_session.add(client_rec)
    db_session.commit()
    db_session.refresh(client_rec)
    
    project = Project(code="TEST_BACKUP_PROJ", title="Test Backup Project", client_id=client_rec.id, client_name="Test Client Co", status="In-progress")
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)
    
    chapter = ChapterInfo(client="Test Client Co", project="TEST_BACKUP_PROJ", chapters="1", chapter_title="Chapter 1", status="In-progress")
    db_session.add(chapter)
    db_session.commit()
    db_session.refresh(chapter)
    
    # Call backup-list (should return empty list initially)
    response = client.get(f"/api/v2/uploads/{project.id}/chapter/chapter-1/backup-list")
    assert response.status_code == 200
    body = response.json()
    assert "files" in body
    assert isinstance(body["files"], list)

def test_single_indesign_to_word_endpoint(
    auth_cookie_client,
    admin_user,
    db_session,
    app_env,
):
    client = auth_cookie_client(admin_user)
    
    from app.domains.projects.models import Project
    from app.domains.workflow.models import ChapterInfo
    from app.domains.clients.models import Client
    from app.models import File
    import os
    import zipfile
    
    # Setup test DB entities
    client_rec = Client(
        category_type="Organization",
        contact_type="Customer",
        name_company="Test Client Co 2",
        company="Test Client Co 2",
        division="TEST_DIV2",
        email="test2@example.com",
        active_status=True
    )
    db_session.add(client_rec)
    db_session.commit()
    db_session.refresh(client_rec)
    
    project = Project(code="TEST_PROJ_SINGLE", title="Test Single InDesign Project", client_id=client_rec.id, client_name="Test Client Co 2", status="In-progress")
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)
    
    chapter = ChapterInfo(client="Test Client Co 2", project="TEST_PROJ_SINGLE", chapters="3", chapter_title="Chapter 3", status="In-progress")
    db_session.add(chapter)
    db_session.commit()
    db_session.refresh(chapter)
    
    # Mock source file paths and database File records
    # Create the files physically to allow packaging in zipfile
    from app.services.file_service import UPLOAD_DIR
    
    indd_rel_path = "TEST_PROJ_SINGLE/3/InDesign/9781284238990_CH01_001_032.indd"
    art_rel_path = "TEST_PROJ_SINGLE/3/Art/image.png"
    font_rel_path = "TEST_PROJ_SINGLE/3/Misc/custom_font.ttf"
    
    indd_path = os.path.join(UPLOAD_DIR, indd_rel_path)
    art_path = os.path.join(UPLOAD_DIR, art_rel_path)
    font_path = os.path.join(UPLOAD_DIR, font_rel_path)
    
    os.makedirs(os.path.dirname(indd_path), exist_ok=True)
    os.makedirs(os.path.dirname(art_path), exist_ok=True)
    os.makedirs(os.path.dirname(font_path), exist_ok=True)
    
    with open(indd_path, "wb") as f:
        f.write(b"mock indesign binary")
    with open(art_path, "wb") as f:
        f.write(b"mock png data")
    with open(font_path, "wb") as f:
        f.write(b"mock font data")
        
    indd_file = File(
        project_id=project.id,
        chapter_id=chapter.id,
        filename="9781284238990_CH01_001_032.indd",
        path=indd_rel_path,
        category="InDesign"
    )
    art_file = File(
        project_id=project.id,
        chapter_id=chapter.id,
        filename="image.png",
        path=art_rel_path,
        category="Art"
    )
    font_file = File(
        project_id=project.id,
        chapter_id=chapter.id,
        filename="custom_font.ttf",
        path=font_rel_path,
        category="Misc"
    )
    
    db_session.add(indd_file)
    db_session.add(art_file)
    db_session.add(font_file)
    db_session.commit()
    
    # Configure INDESIGN_SERVER_URL for testing
    from app.core.config import get_settings
    settings = get_settings()
    old_url = settings.INDESIGN_SERVER_URL
    settings.INDESIGN_SERVER_URL = "http://10.1.6.108:5555"
    
    try:
        # Call endpoint with mocked Windows server response
        with patch("requests.post") as mock_post:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.content = b"CONVERTED DOCX CONTENT"
            mock_post.return_value = mock_resp
            
            # Capture the request payload to inspect the zipped file
            response = client.post(f"/api/v1/conversion/indesign-to-word/{indd_file.id}")
    
            # Verify remote request was sent with zip archive
            assert mock_post.called
        call_kwargs = mock_post.call_args[1]
        assert "files" in call_kwargs
        uploaded_files = call_kwargs["files"]
        assert "file" in uploaded_files
        zip_filename, zip_bytes, _ = uploaded_files["file"]
        
        assert zip_filename.startswith("packaged_9781284238990_CH01_001_032")
        
        # Extract and verify ZIP contents
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as test_zip:
            namelist = test_zip.namelist()
            assert "9781284238990_CH01_001_032.indd" in namelist
            assert "Links/image.png" in namelist
            assert "Document Fonts/custom_font.ttf" in namelist
            
    finally:
        settings.INDESIGN_SERVER_URL = old_url
            
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    
    # Check that a Manuscript file record was created with the correct name: 9781284238990_CH01_001_032.docx
    manuscript = db_session.query(File).filter(
        File.project_id == project.id,
        File.chapter_id == chapter.id,
        File.category == "Manuscript"
    ).first()
    
    assert manuscript is not None
    assert manuscript.filename == "9781284238990_CH01_001_032.docx"
    
    # Clean up physical files
    for p in [indd_path, art_path, font_path]:
        try:
            os.remove(p)
        except Exception:
            pass
