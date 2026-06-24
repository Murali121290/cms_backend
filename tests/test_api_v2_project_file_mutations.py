from io import BytesIO
from pathlib import Path
import zipfile

from app import models
from app.domains.projects.models import Project



def test_api_v2_project_bootstrap_creates_project_chapters_files_and_redirect(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        "/api/v2/projects/bootstrap",
        data={
            "code": "V2BOOK100",
            "title": "V2 Bootstrap Book",
            "client_name": "Client A",
            "xml_standard": "NLM",
            "chapter_count": "2",
        },
        files=[
            (
                "files",
                (
                    "alpha.docx",
                    b"alpha manuscript",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ),
            ),
            (
                "files",
                (
                    "beta.docx",
                    b"beta manuscript",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ),
            ),
        ],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["redirect_to"] == "/dashboard"
    assert body["project"]["code"] == "V2BOOK100"
    assert [chapter["number"] for chapter in body["chapters"]] == ["01", "02"]
    assert [chapter["title"] for chapter in body["chapters"]] == ["alpha", "beta"]
    assert [file["filename"] for file in body["ingested_files"]] == ["alpha.docx", "beta.docx"]

    assert (temp_upload_root / "V2BOOK100" / "Chapter 1 - alpha" / "Manuscript" / "alpha.docx").exists()
    assert (temp_upload_root / "V2BOOK100" / "Chapter 2 - beta" / "Manuscript" / "beta.docx").exists()
    assert not (temp_upload_root / "V2BOOK100" / "01").exists()

    project = db_session.query(Project).filter(Project.code == "V2BOOK100").first()
    assert project is not None
    chapters = (
        db_session.query(models.Chapter)
        .filter(models.Chapter.project == project.code)
        .order_by(models.Chapter.chapters.asc())
        .all()
    )
    assert [chapter.title for chapter in chapters] == ["alpha", "beta"]


def test_api_v2_project_bootstrap_rejects_mismatch_and_duplicate_stems_without_partial_creation(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    mismatch_response = client.post(
        "/api/v2/projects/bootstrap",
        data={
            "code": "V2BOOK101",
            "title": "Mismatch Book",
            "client_name": "Client A",
            "xml_standard": "NLM",
            "chapter_count": "2",
        },
        files={
            "files": (
                "single.docx",
                b"single manuscript",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert mismatch_response.status_code == 400
    assert mismatch_response.json()["code"] == "PROJECT_BOOTSTRAP_VALIDATION_ERROR"
    assert mismatch_response.json()["message"] == "Number of chapters must exactly match the number of uploaded files."
    assert db_session.query(Project).filter(Project.code == "V2BOOK101").first() is None
    assert not (temp_upload_root / "V2BOOK101").exists()

    duplicate_response = client.post(
        "/api/v2/projects/bootstrap",
        data={
            "code": "V2BOOK102",
            "title": "Duplicate Stem Book",
            "client_name": "Client B",
            "xml_standard": "NLM",
            "chapter_count": "2",
        },
        files=[
            ("files", ("same-name.docx", b"one", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
            ("files", ("same-name.pdf", b"two", "application/pdf")),
        ],
    )
    assert duplicate_response.status_code == 400
    assert duplicate_response.json()["message"] == "Uploaded files must have unique filename stems."
    assert db_session.query(Project).filter(Project.code == "V2BOOK102").first() is None
    assert not (temp_upload_root / "V2BOOK102").exists()


def test_api_v2_project_delete_removes_filesystem_and_returns_redirect_hint(
    auth_cookie_client,
    admin_user,
    project_record,
    db_session,
    temp_upload_root,
):
    project_dir = temp_upload_root / project_record.code
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "keep.txt").write_text("remove-me", encoding="utf-8")
    client = auth_cookie_client(admin_user)

    response = client.delete(f"/api/v2/projects/{project_record.id}")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "deleted": {
            "project_id": project_record.id,
            "code": project_record.code,
            "db_cleanup": True,
            "filesystem_cleanup": True,
        },
        "redirect_to": "/dashboard?msg=Book+Deleted",
    }
    assert db_session.query(Project).filter(Project.id == project_record.id).first() is None
    assert not project_dir.exists()


def test_api_v2_chapter_create_rename_delete_and_package_preserve_storage_behavior(
    auth_cookie_client,
    admin_user,
    project_record,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    create_response = client.post(
        f"/api/v2/projects/{project_record.id}/chapters",
        json={"number": "03", "title": "Chapter 03"},
    )
    assert create_response.status_code == 200
    create_body = create_response.json()
    assert create_body["status"] == "ok"
    assert create_body["chapter"]["number"] == "03"
    assert create_body["redirect_to"] == f"/projects/{project_record.id}?msg=Chapter+Created+Successfully"
    for category in ["Manuscript", "Art", "InDesign", "Proof", "XML"]:
        assert (temp_upload_root / project_record.code / "03" / category).is_dir()

    chapter = (
        db_session.query(models.Chapter)
        .filter(models.Chapter.project == project_record.code, models.Chapter.chapters == "03")
        .first()
    )
    manuscript_file = temp_upload_root / project_record.code / "03" / "Manuscript" / "chapter03.docx"
    manuscript_file.write_bytes(b"chapter-zip-bytes")

    rename_response = client.patch(
        f"/api/v2/projects/{project_record.id}/chapters/{chapter.id}",
        json={"number": "05", "title": "Renamed Chapter"},
    )
    assert rename_response.status_code == 200
    rename_body = rename_response.json()
    assert rename_body["status"] == "ok"
    assert rename_body["previous_number"] == "03"
    assert rename_body["chapter"]["number"] == "05"
    assert rename_body["chapter"]["title"] == "Renamed Chapter"
    assert rename_body["redirect_to"] == f"/projects/{project_record.id}?msg=Chapter+Renamed+Successfully"
    assert not (temp_upload_root / project_record.code / "03").exists()
    assert (temp_upload_root / project_record.code / "05").is_dir()

    delete_response = client.delete(
        f"/api/v2/projects/{project_record.id}/chapters/{chapter.id}"
    )
    assert delete_response.status_code == 200
    assert delete_response.json() == {
        "status": "ok",
        "deleted": {
            "project_id": project_record.id,
            "chapter_id": chapter.id,
            "chapter_number": "05",
        },
        "redirect_to": f"/projects/{project_record.id}?msg=Chapter+Deleted+Successfully",
    }
    assert db_session.query(models.Chapter).filter(models.Chapter.id == chapter.id).first() is None
    assert not (temp_upload_root / project_record.code / "05").exists()


def test_api_v2_file_download_and_delete_preserve_current_behavior(
    auth_cookie_client,
    admin_user,
    project_record,
    chapter_record,
    file_record_factory,
    db_session,
):
    file_record, _ = file_record_factory(
        project=project_record,
        chapter=chapter_record,
        filename="delete_me.docx",
        category="Manuscript",
    )
    file_path = Path(file_record.path)
    file_path.write_bytes(b"download-delete-bytes")
    client = auth_cookie_client(admin_user)

    download_response = client.get(f"/api/v2/files/{file_record.id}/download")
    assert download_response.status_code == 200
    assert download_response.content == b"download-delete-bytes"
    assert download_response.headers["content-type"] == "application/octet-stream"
    assert 'filename="delete_me.docx"' in download_response.headers["content-disposition"]

    delete_response = client.delete(f"/api/v2/files/{file_record.id}")
    assert delete_response.status_code == 200
    assert delete_response.json() == {
        "status": "ok",
        "deleted": {
            "file_id": file_record.id,
            "filename": "delete_me.docx",
            "category": "Manuscript",
            "project_id": project_record.id,
            "chapter_id": chapter_record.id,
        },
        "redirect_to": (
            f"/projects/{project_record.id}/chapter/{chapter_record.id}?tab=Manuscript&msg=File+Deleted"
        ),
    }
    assert db_session.query(models.File).filter(models.File.id == file_record.id).first() is None
    assert not file_path.exists()


def test_api_v2_checkout_and_cancel_checkout_preserve_lock_behavior(
    auth_cookie_client,
    admin_user,
    viewer_user,
    file_record,
    db_session,
):
    admin_client = auth_cookie_client(admin_user)
    viewer_client = auth_cookie_client(viewer_user)

    checkout_response = admin_client.post(f"/api/v2/files/{file_record.id}/checkout")
    assert checkout_response.status_code == 200
    checkout_body = checkout_response.json()
    assert checkout_body["status"] == "ok"
    assert checkout_body["file_id"] == file_record.id
    assert checkout_body["lock"]["is_checked_out"] is True
    assert checkout_body["lock"]["checked_out_by_id"] == admin_user.id
    assert "File+Checked+Out" in checkout_body["redirect_to"]
    db_session.refresh(file_record)
    assert file_record.checked_out_by_id == admin_user.id

    conflict_response = viewer_client.post(f"/api/v2/files/{file_record.id}/checkout")
    assert conflict_response.status_code == 409
    assert conflict_response.json()["code"] == "LOCKED_BY_OTHER"
    db_session.refresh(file_record)
    assert file_record.checked_out_by_id == admin_user.id

    cancel_response = admin_client.delete(f"/api/v2/files/{file_record.id}/checkout")
    assert cancel_response.status_code == 200
    cancel_body = cancel_response.json()
    assert cancel_body["status"] == "ok"
    assert cancel_body["lock"]["is_checked_out"] is False
    assert cancel_body["lock"]["checked_out_by_id"] is None
    assert "Checkout+Cancelled" in cancel_body["redirect_to"]
    db_session.refresh(file_record)
    assert file_record.is_checked_out is False
    assert file_record.checked_out_by_id is None


def test_api_v2_cancel_checkout_by_non_owner_preserves_forgiving_noop_behavior(
    auth_cookie_client,
    admin_user,
    viewer_user,
    file_record,
    db_session,
):
    file_record.is_checked_out = True
    file_record.checked_out_by_id = admin_user.id
    db_session.commit()

    viewer_client = auth_cookie_client(viewer_user)
    response = viewer_client.delete(f"/api/v2/files/{file_record.id}/checkout")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["lock"]["is_checked_out"] is True
    assert body["lock"]["checked_out_by_id"] == admin_user.id
    db_session.refresh(file_record)
    assert file_record.is_checked_out is True
    assert file_record.checked_out_by_id == admin_user.id


def test_api_v2_project_bootstrap_empty_files_and_zip_upload(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    # 1. Bootstrap project with zero initial files
    response = client.post(
        "/api/v2/projects/bootstrap",
        data={
            "code": "V2BOOKZIP",
            "title": "ZIP Upload Book",
            "client_name": "Client A",
            "xml_standard": "NLM",
            "chapter_count": "2",
            "workflow_name": "WF-01",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["project"]["code"] == "V2BOOKZIP"
    assert [chapter["number"] for chapter in body["chapters"]] == ["01", "02"]
    assert len(body["ingested_files"]) == 0

    project = db_session.query(Project).filter(Project.code == "V2BOOKZIP").first()
    assert project is not None
    assert project.workflow_name == "WF-01"

    # 2. Prepare a ZIP file in memory
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.writestr("ch01/ch01_intro.docx", b"chapter 1 content")
        zip_file.writestr("ch02/ch02_body.docx", b"chapter 2 content")
        zip_file.writestr("images/ch01_fig1.png", b"fake image content")
        zip_file.writestr("project_settings.xml", b"<xml>settings</xml>")

    zip_buffer.seek(0)

    # 3. Post ZIP file to the uploads endpoint
    upload_response = client.post(
        "/api/v2/uploads/ClientA/V2BOOKZIP",
        data={"project_id": project.id},
        files={"file": ("V2BOOKZIP.zip", zip_buffer, "application/zip")},
    )

    assert upload_response.status_code == 200
    upload_body = upload_response.json()

    assert upload_body["total_chapters"] == 2
    assert len(upload_body["chapters"]) == 3  # ch01_intro.docx, ch02_body.docx, ch01_fig1.png
    assert len(upload_body["images"]) == 1
    assert len(upload_body["xml"]) == 1
    assert len(upload_body["docs"]) == 2

    # Verify database records
    files_in_db = db_session.query(models.File).filter(models.File.project_id == project.id).all()
    filenames = {f.filename for f in files_in_db}
    assert "ch01_intro.docx" in filenames
    assert "ch02_body.docx" in filenames
    assert "ch01_fig1.png" in filenames
    assert "project_settings.xml" in filenames


def test_api_v2_project_bootstrap_rejects_duplicate_project_code(
    auth_cookie_client,
    admin_user,
    project_record,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        "/api/v2/projects/bootstrap",
        data={
            "code": project_record.code,
            "title": "Another Project Title",
            "client_name": "Client A",
            "xml_standard": "NLM",
            "chapter_count": "1",
        },
    )

    assert response.status_code == 400
    body = response.json()
    assert body["status"] == "error"
    assert body["code"] == "PROJECT_ALREADY_EXISTS"
    assert body["message"] == f"Project code '{project_record.code}' already exists."


def test_api_v2_chapter_count_synchronization(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    # 1. Bootstrap project
    response = client.post(
        "/api/v2/projects/bootstrap",
        data={
            "code": "COUNTBOOK",
            "title": "Count Book",
            "client_name": "Client A",
            "xml_standard": "NLM",
            "chapter_count": "3",
        },
    )
    assert response.status_code == 200

    project = db_session.query(Project).filter(Project.code == "COUNTBOOK").first()
    assert project is not None
    assert project.chapter_count == 3

    # 2. Add a new chapter
    create_response = client.post(
        f"/api/v2/projects/{project.id}/chapters",
        json={"number": "04", "title": "Chapter 04"},
    )
    assert create_response.status_code == 200
    db_session.refresh(project)
    assert project.chapter_count == 4

    # 3. Delete a chapter
    chapter = (
        db_session.query(models.Chapter)
        .filter(models.Chapter.project == project.code, models.Chapter.chapters == "04")
        .first()
    )
    delete_response = client.delete(
        f"/api/v2/projects/{project.id}/chapters/{chapter.id}"
    )
    assert delete_response.status_code == 200
    db_session.refresh(project)
    assert project.chapter_count == 3


def test_api_v2_project_bootstrap_zip_upload_no_chapter_count(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    # 1. Bootstrap project without specifying chapter_count
    response = client.post(
        "/api/v2/projects/bootstrap",
        data={
            "code": "NOCOUNTZIP",
            "title": "No Count Zip Book",
            "client_name": "Client A",
            "xml_standard": "NLM",
            "workflow_name": "WF-01",
        },
    )
    assert response.status_code == 200

    project = db_session.query(Project).filter(Project.code == "NOCOUNTZIP").first()
    assert project is not None
    assert project.chapter_count == 0

    # 2. Prepare ZIP file with 2 chapters
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.writestr("ch01/intro.docx", b"ch 1 content")
        zip_file.writestr("ch02/body.docx", b"ch 2 content")
        zip_file.writestr("project_settings.xml", b"<xml></xml>")
    zip_buffer.seek(0)

    # 3. Upload ZIP
    upload_response = client.post(
        "/api/v2/uploads/ClientA/NOCOUNTZIP",
        data={"project_id": project.id},
        files={"file": ("NOCOUNTZIP.zip", zip_buffer, "application/zip")},
    )
    assert upload_response.status_code == 200
    db_session.refresh(project)

    # 4. Verify chapter_count is updated to 2
    assert project.chapter_count == 2


def test_api_v2_project_bootstrap_zip_upload_no_identifiable_chapters_fails(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    # 1. Bootstrap project
    response = client.post(
        "/api/v2/projects/bootstrap",
        data={
            "code": "NOCHAPSFAIL",
            "title": "No Chaps Fail Book",
            "client_name": "Client A",
            "xml_standard": "NLM",
        },
    )
    assert response.status_code == 200

    project = db_session.query(Project).filter(Project.code == "NOCHAPSFAIL").first()

    # 2. Prepare ZIP file with NO chapters (only random xml/assets files without ch/chap/chapter pattern)
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.writestr("random_file.xml", b"<xml></xml>")
        zip_file.writestr("docs/readme.txt", b"readme")
    zip_buffer.seek(0)

    # 3. Upload ZIP and check it fails
    upload_response = client.post(
        "/api/v2/uploads/ClientA/NOCHAPSFAIL",
        data={"project_id": project.id},
        files={"file": ("NOCHAPSFAIL.zip", zip_buffer, "application/zip")},
    )
    assert upload_response.status_code == 400
    body = upload_response.json()
    assert body["code"] == "NO_CHAPTERS_FOUND"
    assert body["message"] == "Unable to identify any chapters in the uploaded ZIP file."



