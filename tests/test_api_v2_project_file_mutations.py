from io import BytesIO
from pathlib import Path
import zipfile

from app import models


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

    project = db_session.query(models.Project).filter(models.Project.code == "V2BOOK100").first()
    assert project is not None
    chapters = (
        db_session.query(models.Chapter)
        .filter(models.Chapter.project_id == project.id)
        .order_by(models.Chapter.number.asc())
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
    assert db_session.query(models.Project).filter(models.Project.code == "V2BOOK101").first() is None
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
    assert db_session.query(models.Project).filter(models.Project.code == "V2BOOK102").first() is None
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
    assert db_session.query(models.Project).filter(models.Project.id == project_record.id).first() is None
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
        .filter(models.Chapter.project_id == project_record.id, models.Chapter.number == "03")
        .first()
    )
    manuscript_file = temp_upload_root / project_record.code / "03" / "Manuscript" / "chapter03.docx"
    manuscript_file.write_bytes(b"chapter-zip-bytes")

    package_response = client.get(
        f"/api/v2/projects/{project_record.id}/chapters/{chapter.id}/package"
    )
    assert package_response.status_code == 200
    assert package_response.headers["content-type"] == "application/zip"
    assert f"filename={project_record.code}_Chapter_03.zip" in package_response.headers["content-disposition"]
    with zipfile.ZipFile(BytesIO(package_response.content)) as zip_file:
        assert "Manuscript/chapter03.docx" in zip_file.namelist()
        assert zip_file.read("Manuscript/chapter03.docx") == b"chapter-zip-bytes"

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
