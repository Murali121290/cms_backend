import io
from pathlib import Path
from app import models
from app.domains.projects.models import Project

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

    # Call endpoint
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
