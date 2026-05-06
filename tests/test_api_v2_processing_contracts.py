from pathlib import Path

from app import models


def test_api_v2_processing_start_preserves_backup_lock_and_response_contract(
    monkeypatch,
    auth_cookie_client,
    admin_user,
    file_record,
    project_record,
    chapter_record,
    db_session,
    temp_upload_root,
):
    scheduled = []

    def _record_task(self, func, *args, **kwargs):
        scheduled.append({"func": func, "args": args, "kwargs": kwargs})

    monkeypatch.setattr("starlette.background.BackgroundTasks.add_task", _record_task)
    Path(file_record.path).write_bytes(b"original-processing-content")

    client = auth_cookie_client(admin_user)
    response = client.post(
        f"/api/v2/files/{file_record.id}/processing-jobs",
        json={"process_type": "structuring", "mode": "style"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "processing"
    assert body["source_file_id"] == file_record.id
    assert body["process_type"] == "structuring"
    assert body["mode"] == "style"
    assert body["status_endpoint"] == f"/api/v2/files/{file_record.id}/processing-status?process_type=structuring"

    db_session.refresh(file_record)
    assert file_record.is_checked_out is True
    assert file_record.checked_out_by_id == admin_user.id
    assert file_record.version == 2
    assert body["source_version"] == 2
    assert body["lock"]["is_checked_out"] is True
    assert body["lock"]["checked_out_by_id"] == admin_user.id

    version_entry = (
        db_session.query(models.FileVersion)
        .filter(models.FileVersion.file_id == file_record.id, models.FileVersion.version_num == 1)
        .first()
    )
    assert version_entry is not None
    archive_path = temp_upload_root / project_record.code / chapter_record.number / file_record.category / "Archive" / "chapter01_v1.docx"
    assert Path(version_entry.path) == archive_path
    assert archive_path.read_bytes() == b"original-processing-content"

    assert len(scheduled) == 1
    assert scheduled[0]["kwargs"]["file_id"] == file_record.id
    assert scheduled[0]["kwargs"]["process_type"] == "structuring"
    assert scheduled[0]["kwargs"]["mode"] == "style"


def test_api_v2_processing_status_maps_current_structuring_contract(
    auth_cookie_client,
    admin_user,
    file_record,
    file_record_factory,
):
    client = auth_cookie_client(admin_user)

    processing_response = client.get(
        f"/api/v2/files/{file_record.id}/processing-status?process_type=structuring"
    )
    assert processing_response.status_code == 200
    assert processing_response.json() == {
        "status": "processing",
        "source_file_id": file_record.id,
        "process_type": "structuring",
        "derived_file_id": None,
        "derived_filename": None,
        "compatibility_status": "processing",
        "legacy_status_endpoint": f"/api/v1/processing/files/{file_record.id}/structuring_status",
    }

    _original, processed = file_record_factory(
        project=file_record.project,
        chapter=file_record.chapter,
        filename=file_record.filename,
        category=file_record.category,
        create_processed=True,
    )

    completed_response = client.get(
        f"/api/v2/files/{file_record.id}/processing-status?process_type=structuring"
    )
    assert completed_response.status_code == 200
    assert completed_response.json() == {
        "status": "completed",
        "source_file_id": file_record.id,
        "process_type": "structuring",
        "derived_file_id": processed.id,
        "derived_filename": processed.filename,
        "compatibility_status": "completed",
        "legacy_status_endpoint": f"/api/v1/processing/files/{file_record.id}/structuring_status",
    }


def test_api_v2_technical_scan_requires_permission_and_returns_normalized_contract(
    monkeypatch,
    auth_cookie_client,
    viewer_user,
    editor_user,
    file_record,
):
    class FakeTechnicalEditor:
        def scan(self, _file_path):
            return {
                "xray": {
                    "label": "X-ray",
                    "count": 1,
                    "found": ["Xray"],
                    "options": ["X-ray"],
                    "category": "spelling",
                }
            }

    monkeypatch.setattr("app.routers.api_v2.TechnicalEditor", FakeTechnicalEditor)

    forbidden_client = auth_cookie_client(viewer_user)
    forbidden_response = forbidden_client.get(f"/api/v2/files/{file_record.id}/technical-review")
    assert forbidden_response.status_code == 403
    assert forbidden_response.json()["code"] == "PERMISSION_DENIED"

    allowed_client = auth_cookie_client(editor_user)
    allowed_response = allowed_client.get(f"/api/v2/files/{file_record.id}/technical-review")
    assert allowed_response.status_code == 200
    body = allowed_response.json()
    assert body["status"] == "ok"
    assert body["file"]["id"] == file_record.id
    assert body["raw_scan"] == {
        "xray": {
            "label": "X-ray",
            "count": 1,
            "found": ["Xray"],
            "options": ["X-ray"],
            "category": "spelling",
        }
    }
    assert body["issues"] == [
        {
            "key": "xray",
            "label": "X-ray",
            "category": "spelling",
            "count": 1,
            "found": ["Xray"],
            "options": ["X-ray"],
        }
    ]


def test_api_v2_technical_apply_preserves_new_file_creation_and_contract(
    monkeypatch,
    auth_cookie_client,
    editor_user,
    file_record,
    db_session,
):
    def _fake_process(self, input_path, output_path, replacements, author):
        assert replacements == {"xray": "X-ray"}
        assert author == editor_user.username
        Path(output_path).write_bytes(Path(input_path).read_bytes())

    monkeypatch.setattr("app.routers.api_v2.TechnicalEditor.process", _fake_process)

    client = auth_cookie_client(editor_user)
    response = client.post(
        f"/api/v2/files/{file_record.id}/technical-review/apply",
        json={"replacements": {"xray": "X-ray"}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "completed"
    assert body["source_file_id"] == file_record.id

    new_file = db_session.query(models.File).filter(models.File.id == body["new_file_id"]).first()
    assert new_file is not None
    assert new_file.filename.endswith("_TechEdited.docx")
    assert Path(new_file.path).exists()
    assert body["new_file"]["id"] == new_file.id
    assert body["new_file"]["filename"] == new_file.filename
