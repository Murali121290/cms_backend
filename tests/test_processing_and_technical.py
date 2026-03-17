from pathlib import Path

from app import models


def test_processing_start_creates_backup_version_locks_file_and_schedules_background_task(
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
        f"/api/v1/processing/files/{file_record.id}/process/structuring",
        follow_redirects=False,
    )

    assert response.status_code == 200
    assert response.json()["status"] == "processing"

    db_session.refresh(file_record)
    assert file_record.is_checked_out is True
    assert file_record.checked_out_by_id == admin_user.id
    assert file_record.version == 2

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
    assert scheduled[0]["kwargs"]["user_id"] == admin_user.id
    assert scheduled[0]["kwargs"]["user_username"] == admin_user.username


def test_structuring_status_returns_processing_until_processed_file_row_exists(
    auth_cookie_client,
    admin_user,
    file_record,
    file_record_factory,
):
    client = auth_cookie_client(admin_user)

    processing_response = client.get(f"/api/v1/processing/files/{file_record.id}/structuring_status")
    assert processing_response.status_code == 200
    assert processing_response.json() == {"status": "processing"}

    _original, processed = file_record_factory(
        project=file_record.project,
        chapter=file_record.chapter,
        filename=file_record.filename,
        category=file_record.category,
        create_processed=True,
    )

    completed_response = client.get(f"/api/v1/processing/files/{file_record.id}/structuring_status")
    assert completed_response.status_code == 200
    assert completed_response.json() == {"status": "completed", "new_file_id": processed.id}


def test_background_processing_success_registers_outputs_and_unlocks_file(
    monkeypatch,
    admin_user,
    file_record,
    db_session,
):
    from app.routers.processing import background_processing_task

    output_path = Path(file_record.path).with_name(f"{Path(file_record.filename).stem}_Processed.docx")
    output_path.write_bytes(b"processed-docx-bytes")

    def _fake_structuring_process(self, file_path, mode="style"):
        assert Path(file_path) == Path(file_record.path).resolve()
        assert mode == "style"
        return [str(output_path)]

    monkeypatch.setattr("app.routers.processing.StructuringEngine.process_document", _fake_structuring_process)
    monkeypatch.setattr("app.routers.processing.inject_publisher_styles", lambda _path: None)

    file_record.is_checked_out = True
    file_record.checked_out_by_id = admin_user.id
    db_session.commit()

    background_processing_task(
        file_id=file_record.id,
        process_type="structuring",
        user_id=admin_user.id,
        user_username=admin_user.username,
    )

    db_session.refresh(file_record)
    assert file_record.is_checked_out is False
    assert file_record.checked_out_by_id is None
    assert file_record.checked_out_at is None

    generated = (
        db_session.query(models.File)
        .filter(
            models.File.project_id == file_record.project_id,
            models.File.chapter_id == file_record.chapter_id,
            models.File.filename == output_path.name,
        )
        .order_by(models.File.id.desc())
        .first()
    )
    assert generated is not None
    assert generated.path == str(output_path)
    assert generated.category == file_record.category


def test_background_processing_failure_unlocks_file_without_generating_rows(
    monkeypatch,
    admin_user,
    file_record,
    db_session,
):
    from app.routers.processing import background_processing_task

    before_ids = {
        row.id
        for row in db_session.query(models.File)
        .filter(models.File.project_id == file_record.project_id, models.File.chapter_id == file_record.chapter_id)
        .all()
    }

    def _failing_structuring_process(self, _file_path, mode="style"):
        assert mode == "style"
        raise RuntimeError("simulated processing failure")

    monkeypatch.setattr("app.routers.processing.StructuringEngine.process_document", _failing_structuring_process)

    file_record.is_checked_out = True
    file_record.checked_out_by_id = admin_user.id
    db_session.commit()

    background_processing_task(
        file_id=file_record.id,
        process_type="structuring",
        user_id=admin_user.id,
        user_username=admin_user.username,
    )

    db_session.refresh(file_record)
    assert file_record.is_checked_out is False
    assert file_record.checked_out_by_id is None

    after_ids = {
        row.id
        for row in db_session.query(models.File)
        .filter(models.File.project_id == file_record.project_id, models.File.chapter_id == file_record.chapter_id)
        .all()
    }
    assert after_ids == before_ids


def test_technical_scan_requires_permission_and_returns_legacy_dict_shape(
    monkeypatch,
    auth_cookie_client,
    viewer_user,
    editor_user,
    file_record,
):
    class FakeTechnicalEditor:
        def scan(self, _file_path):
            return {"xray": {"found": ["Xray"], "count": 1}}

    monkeypatch.setattr("app.routers.processing.TechnicalEditor", FakeTechnicalEditor)

    forbidden_client = auth_cookie_client(viewer_user)
    forbidden_response = forbidden_client.get(f"/api/v1/processing/files/{file_record.id}/technical/scan")
    assert forbidden_response.status_code == 403

    allowed_client = auth_cookie_client(editor_user)
    allowed_response = allowed_client.get(f"/api/v1/processing/files/{file_record.id}/technical/scan")
    assert allowed_response.status_code == 200
    assert allowed_response.json() == {"xray": {"found": ["Xray"], "count": 1}}


def test_technical_apply_creates_techedited_derivative_and_db_row(
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

    monkeypatch.setattr("app.routers.processing.TechnicalEditor.process", _fake_process)

    client = auth_cookie_client(editor_user)
    response = client.post(
        f"/api/v1/processing/files/{file_record.id}/technical/apply",
        json={"xray": "X-ray"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"

    new_file = db_session.query(models.File).filter(models.File.id == payload["new_file_id"]).first()
    assert new_file is not None
    assert new_file.filename.endswith("_TechEdited.docx")
    assert Path(new_file.path).exists()
