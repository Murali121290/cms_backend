from pathlib import Path

from app import models


def test_api_v2_upload_returns_created_items_and_redirect_hint(
    auth_cookie_client,
    admin_user,
    project_record,
    chapter_record,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        f"/api/v2/projects/{project_record.id}/chapters/{chapter_record.id}/files/upload",
        data={"category": "Manuscript"},
        files={
            "files": (
                "new_upload.docx",
                b"new manuscript bytes",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["redirect_to"] == (
        f"/projects/{project_record.id}/chapter/{chapter_record.id}?tab=Manuscript&msg=Files+Uploaded+Successfully"
    )
    assert body["skipped"] == []
    assert len(body["uploaded"]) == 1
    assert body["uploaded"][0]["operation"] == "created"
    assert body["uploaded"][0]["archive_path"] is None
    assert body["uploaded"][0]["archived_version_num"] is None
    assert body["uploaded"][0]["file"]["filename"] == "new_upload.docx"
    assert body["uploaded"][0]["file"]["version"] == 1

    file_record = (
        db_session.query(models.File)
        .filter(models.File.chapter_id == chapter_record.id, models.File.filename == "new_upload.docx")
        .first()
    )
    assert file_record is not None
    expected_path = temp_upload_root / project_record.code / chapter_record.number / "Manuscript" / "new_upload.docx"
    assert Path(file_record.path) == expected_path
    assert expected_path.read_bytes() == b"new manuscript bytes"


def test_api_v2_upload_overwrite_returns_archive_metadata_and_resets_lock(
    auth_cookie_client,
    admin_user,
    project_record,
    chapter_record,
    file_record_factory,
    db_session,
    temp_upload_root,
):
    existing_file, _ = file_record_factory(
        project=project_record,
        chapter=chapter_record,
        filename="existing.docx",
        category="Manuscript",
    )
    Path(existing_file.path).write_bytes(b"old-content")
    existing_file.version = 3
    existing_file.is_checked_out = True
    existing_file.checked_out_by_id = admin_user.id
    db_session.commit()

    client = auth_cookie_client(admin_user)
    response = client.post(
        f"/api/v2/projects/{project_record.id}/chapters/{chapter_record.id}/files/upload",
        data={"category": "Manuscript"},
        files={
            "files": (
                "existing.docx",
                b"new-content",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["skipped"] == []
    assert len(body["uploaded"]) == 1
    assert body["uploaded"][0]["operation"] == "replaced"
    assert body["uploaded"][0]["file"]["filename"] == "existing.docx"
    assert body["uploaded"][0]["file"]["version"] == 4
    assert body["uploaded"][0]["file"]["lock"]["is_checked_out"] is False
    assert body["uploaded"][0]["archive_path"].endswith("Archive/existing_v3.docx")
    assert body["uploaded"][0]["archived_version_num"] == 3

    db_session.refresh(existing_file)
    assert existing_file.version == 4
    assert existing_file.is_checked_out is False
    assert existing_file.checked_out_by_id is None
    assert Path(existing_file.path).read_bytes() == b"new-content"

    version_entry = (
        db_session.query(models.FileVersion)
        .filter(models.FileVersion.file_id == existing_file.id, models.FileVersion.version_num == 3)
        .first()
    )
    assert version_entry is not None
    archive_path = temp_upload_root / project_record.code / chapter_record.number / "Manuscript" / "Archive" / "existing_v3.docx"
    assert Path(version_entry.path) == archive_path
    assert archive_path.read_bytes() == b"old-content"


def test_api_v2_upload_locked_by_other_preserves_partial_success_skip_behavior(
    auth_cookie_client,
    admin_user,
    viewer_user,
    project_record,
    chapter_record,
    file_record_factory,
    db_session,
):
    existing_file, _ = file_record_factory(
        project=project_record,
        chapter=chapter_record,
        filename="locked.docx",
        category="Manuscript",
        checked_out_by=viewer_user,
    )
    Path(existing_file.path).write_bytes(b"locked-original")
    existing_file.version = 2
    db_session.commit()

    client = auth_cookie_client(admin_user)
    response = client.post(
        f"/api/v2/projects/{project_record.id}/chapters/{chapter_record.id}/files/upload",
        data={"category": "Manuscript"},
        files={
            "files": (
                "locked.docx",
                b"replacement-bytes",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["uploaded"] == []
    assert body["skipped"] == [
        {
            "filename": "locked.docx",
            "code": "LOCKED_BY_OTHER",
            "message": "File is locked by another user.",
        }
    ]

    db_session.refresh(existing_file)
    assert existing_file.version == 2
    assert existing_file.checked_out_by_id == viewer_user.id
    assert existing_file.is_checked_out is True
    assert Path(existing_file.path).read_bytes() == b"locked-original"
    assert db_session.query(models.FileVersion).filter(models.FileVersion.file_id == existing_file.id).count() == 0


def test_api_v2_file_versions_and_archive_download_return_current_rows(
    auth_cookie_client,
    admin_user,
    project_record,
    chapter_record,
    file_record_factory,
    db_session,
):
    existing_file, _ = file_record_factory(
        project=project_record,
        chapter=chapter_record,
        filename="versioned.docx",
        category="Manuscript",
    )
    Path(existing_file.path).write_bytes(b"old-content")
    existing_file.version = 3
    db_session.commit()

    client = auth_cookie_client(admin_user)
    upload_response = client.post(
        f"/api/v2/projects/{project_record.id}/chapters/{chapter_record.id}/files/upload",
        data={"category": "Manuscript"},
        files={
            "files": (
                "versioned.docx",
                b"new-content",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert upload_response.status_code == 200

    versions_response = client.get(f"/api/v2/files/{existing_file.id}/versions")
    assert versions_response.status_code == 200
    versions_body = versions_response.json()
    assert versions_body["file"] == {
        "id": existing_file.id,
        "filename": "versioned.docx",
        "current_version": 4,
    }
    assert len(versions_body["versions"]) == 1
    version_item = versions_body["versions"][0]
    assert version_item["version_num"] == 3
    assert version_item["archived_filename"] == "versioned_v3.docx"
    assert version_item["archived_path"].endswith("Archive/versioned_v3.docx")

    download_response = client.get(
        f"/api/v2/files/{existing_file.id}/versions/{version_item['id']}/download"
    )
    assert download_response.status_code == 200
    assert download_response.content == b"old-content"
    assert download_response.headers["content-type"] == "application/octet-stream"
    assert 'filename="versioned_v3.docx"' in download_response.headers["content-disposition"]


def test_api_v2_version_download_returns_stable_not_found_error_for_missing_version(
    auth_cookie_client,
    admin_user,
    project_record,
    chapter_record,
    file_record_factory,
):
    existing_file, _ = file_record_factory(
        project=project_record,
        chapter=chapter_record,
        filename="missing-version.docx",
        category="Manuscript",
    )
    Path(existing_file.path).write_bytes(b"current-content")

    client = auth_cookie_client(admin_user)
    response = client.get(f"/api/v2/files/{existing_file.id}/versions/999999/download")

    assert response.status_code == 404
    assert response.json() == {
        "status": "error",
        "code": "VERSION_NOT_FOUND",
        "message": "Version not found.",
        "field_errors": None,
        "details": None,
    }


def test_api_v2_multiple_overwrites_preserve_each_archived_version_bytes(
    auth_cookie_client,
    admin_user,
    project_record,
    chapter_record,
    file_record_factory,
    db_session,
):
    versioned_file, _ = file_record_factory(
        project=project_record,
        chapter=chapter_record,
        filename="history.docx",
        category="Manuscript",
    )
    Path(versioned_file.path).write_bytes(b"v1-content")
    versioned_file.version = 1
    db_session.commit()

    client = auth_cookie_client(admin_user)

    first_overwrite = client.post(
        f"/api/v2/projects/{project_record.id}/chapters/{chapter_record.id}/files/upload",
        data={"category": "Manuscript"},
        files={
            "files": (
                "history.docx",
                b"v2-content",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert first_overwrite.status_code == 200

    second_overwrite = client.post(
        f"/api/v2/projects/{project_record.id}/chapters/{chapter_record.id}/files/upload",
        data={"category": "Manuscript"},
        files={
            "files": (
                "history.docx",
                b"v3-content",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert second_overwrite.status_code == 200

    db_session.refresh(versioned_file)
    assert versioned_file.version == 3
    assert Path(versioned_file.path).read_bytes() == b"v3-content"

    versions_response = client.get(f"/api/v2/files/{versioned_file.id}/versions")
    assert versions_response.status_code == 200
    versions = versions_response.json()["versions"]
    assert [version["version_num"] for version in versions] == [2, 1]

    latest_archive = versions[0]
    original_archive = versions[1]

    latest_download = client.get(
        f"/api/v2/files/{versioned_file.id}/versions/{latest_archive['id']}/download"
    )
    assert latest_download.status_code == 200
    assert latest_download.content == b"v2-content"
    assert 'filename="history_v2.docx"' in latest_download.headers["content-disposition"]

    original_download = client.get(
        f"/api/v2/files/{versioned_file.id}/versions/{original_archive['id']}/download"
    )
    assert original_download.status_code == 200
    assert original_download.content == b"v1-content"
    assert 'filename="history_v1.docx"' in original_download.headers["content-disposition"]
