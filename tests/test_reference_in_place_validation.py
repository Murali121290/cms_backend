import os
import shutil
import pytest
from pathlib import Path
from app import models
from app.utils.timezone import now_ist_naive

def test_reference_validation_no_changes(
    monkeypatch,
    admin_user,
    file_record,
    db_session,
):
    from app.domains.processing.service import start_process, get_reference_validation_status
    from app.routers.processing import background_processing_task
    from app.services.file_service import UPLOAD_DIR

    # 1. Setup mock DOCX file XML comparisons
    monkeypatch.setattr("app.domains.processing.service.docx_has_changes", lambda p1, p2: False)
    
    # Mock engine execution
    called_engine = []
    class FakeEngine:
        def process_document(self, path, **kwargs):
            called_engine.append(True)
            # Create a mock processed docx output path
            out_path = path.replace(".docx", "_Processed.docx")
            Path(out_path).write_bytes(b"some processed bytes")
            return [out_path]

    monkeypatch.setattr("app.routers.processing.ReferencesEngine", FakeEngine)
    monkeypatch.setattr("app.routers.processing.inject_publisher_styles", lambda path: None)

    # Clean checkouts
    file_record.is_checked_out = False
    file_record.checked_out_by_id = None
    db_session.commit()

    # 2. Start validation process
    from fastapi import BackgroundTasks
    bg_tasks = BackgroundTasks()
    start_process(
        db_session,
        file_id=file_record.id,
        process_type="reference_validation",
        user=admin_user,
        background_tasks=bg_tasks,
        mode="style",
        upload_dir=UPLOAD_DIR,
        logger=__import__("logging").getLogger("test"),
        background_task_callable=background_processing_task,
    )

    db_session.refresh(file_record)
    assert file_record.is_checked_out is True
    assert file_record.version == 1  # Verify version is NOT bumped before execution!

    # 3. Execute background task
    background_processing_task(
        file_id=file_record.id,
        process_type="reference_validation",
        user_id=admin_user.id,
        user_username=admin_user.username,
        options={},
    )

    db_session.refresh(file_record)
    assert file_record.is_checked_out is False
    assert file_record.version == 1  # Verify version is NOT bumped since there were no changes!

    # 4. Check status
    status = get_reference_validation_status(db=db_session, file_id=file_record.id, user=admin_user)
    assert status["status"] == "completed"
    assert status["new_file_id"] == file_record.id


def test_reference_validation_with_changes(
    monkeypatch,
    admin_user,
    file_record,
    db_session,
):
    from app.domains.processing.service import start_process, get_reference_validation_status
    from app.routers.processing import background_processing_task
    from app.services.file_service import UPLOAD_DIR

    # Mock docx_has_changes to return True (changes detected)
    monkeypatch.setattr("app.domains.processing.service.docx_has_changes", lambda p1, p2: True)
    
    called_engine = []
    class FakeEngine:
        def process_document(self, path, **kwargs):
            called_engine.append(True)
            out_path = path.replace(".docx", "_Processed.docx")
            Path(out_path).write_bytes(b"some changes bytes")
            return [out_path]

    monkeypatch.setattr("app.routers.processing.ReferencesEngine", FakeEngine)
    monkeypatch.setattr("app.routers.processing.inject_publisher_styles", lambda path: None)

    # Reset
    file_record.is_checked_out = False
    file_record.checked_out_by_id = None
    file_record.version = 1
    db_session.commit()

    # Start validation
    from fastapi import BackgroundTasks
    bg_tasks = BackgroundTasks()
    start_process(
        db_session,
        file_id=file_record.id,
        process_type="reference_validation",
        user=admin_user,
        background_tasks=bg_tasks,
        mode="style",
        upload_dir=UPLOAD_DIR,
        logger=__import__("logging").getLogger("test"),
        background_task_callable=background_processing_task,
    )

    db_session.refresh(file_record)
    assert file_record.is_checked_out is True
    assert file_record.version == 1  # Still 1 before background task runs

    # Run background task
    background_processing_task(
        file_id=file_record.id,
        process_type="reference_validation",
        user_id=admin_user.id,
        user_username=admin_user.username,
        options={},
    )

    db_session.refresh(file_record)
    assert file_record.is_checked_out is False
    assert file_record.version == 2  # Verify version IS bumped because changes were detected!

    # Check that backup record was created
    versions = db_session.query(models.FileVersion).filter(models.FileVersion.file_id == file_record.id).all()
    assert len(versions) == 1
    assert versions[0].version_num == 1
    assert os.path.exists(versions[0].path)

    # Check status
    status = get_reference_validation_status(db=db_session, file_id=file_record.id, user=admin_user)
    assert status["status"] == "completed"
    assert status["new_file_id"] == file_record.id
