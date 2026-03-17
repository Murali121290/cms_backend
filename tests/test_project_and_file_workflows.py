from pathlib import Path

from app import models
from app.utils.timezone import now_ist_naive


def test_project_create_with_files_bootstraps_project_chapters_directories_and_files(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    files = [
        (
            "files",
            ("edawards12345.docx", b"chapter one manuscript", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ),
        (
            "files",
            ("supplement-notes.docx", b"chapter two manuscript", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ),
    ]

    response = client.post(
        "/projects/create_with_files",
        data={
            "code": "BOOK100",
            "title": "Book Title",
            "client_name": "Client A",
            "xml_standard": "NLM",
            "chapter_count": "2",
        },
        files=files,
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/dashboard"

    project = db_session.query(models.Project).filter(models.Project.code == "BOOK100").first()
    assert project is not None
    assert project.client_name == "Client A"

    chapters = (
        db_session.query(models.Chapter)
        .filter(models.Chapter.project_id == project.id)
        .order_by(models.Chapter.number.asc())
        .all()
    )
    assert [chapter.number for chapter in chapters] == ["01", "02"]
    assert [chapter.title for chapter in chapters] == ["edawards12345", "supplement-notes"]

    chapter_01_ms = (
        temp_upload_root
        / "BOOK100"
        / "Chapter 1 - edawards12345"
        / "Manuscript"
        / "edawards12345.docx"
    )
    chapter_02_art = (
        temp_upload_root
        / "BOOK100"
        / "Chapter 2 - supplement-notes"
        / "Manuscript"
        / "supplement-notes.docx"
    )
    assert chapter_01_ms.exists()
    assert chapter_02_art.exists()
    for category in ["Manuscript", "Art", "InDesign", "Proof", "XML"]:
        assert (temp_upload_root / "BOOK100" / "Chapter 1 - edawards12345" / category).is_dir()
        assert (temp_upload_root / "BOOK100" / "Chapter 2 - supplement-notes" / category).is_dir()

    stored_files = (
        db_session.query(models.File)
        .filter(models.File.project_id == project.id)
        .order_by(models.File.filename.asc())
        .all()
    )
    assert [file.filename for file in stored_files] == ["edawards12345.docx", "supplement-notes.docx"]
    assert stored_files[0].chapter.number == "01"
    assert stored_files[1].chapter.number == "02"
    assert stored_files[0].chapter.title == "edawards12345"
    assert stored_files[1].chapter.title == "supplement-notes"
    assert [file.category for file in stored_files] == ["Manuscript", "Manuscript"]


def test_project_create_with_files_rejects_chapter_count_mismatch_without_creating_rows(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        "/projects/create_with_files",
        data={
            "code": "BOOK101",
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
        follow_redirects=False,
    )

    assert response.status_code == 200
    assert "Create New Project" in response.text
    assert "Number of chapters must exactly match the number of uploaded files." in response.text
    assert db_session.query(models.Project).filter(models.Project.code == "BOOK101").first() is None
    assert db_session.query(models.Chapter).count() == 0
    assert db_session.query(models.File).count() == 0
    assert not (temp_upload_root / "BOOK101").exists()


def test_project_create_with_files_mismatch_has_zero_partial_creation(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        "/projects/create_with_files",
        data={
            "code": "BOOK101B",
            "title": "Mismatch Book B",
            "client_name": "Client A",
            "xml_standard": "NLM",
            "chapter_count": "1",
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
        follow_redirects=False,
    )

    assert response.status_code == 200
    assert "Number of chapters must exactly match the number of uploaded files." in response.text
    assert db_session.query(models.Project).filter(models.Project.code == "BOOK101B").first() is None
    assert db_session.query(models.Chapter).count() == 0
    assert db_session.query(models.File).count() == 0
    assert not (temp_upload_root / "BOOK101B").exists()


def test_project_create_with_files_stores_one_file_only_in_its_matching_chapter_folder(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        "/projects/create_with_files",
        data={
            "code": "BOOK102",
            "title": "Mapped Book",
            "client_name": "Client B",
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
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/dashboard"

    alpha_dir = temp_upload_root / "BOOK102" / "Chapter 1 - alpha" / "Manuscript"
    beta_dir = temp_upload_root / "BOOK102" / "Chapter 2 - beta" / "Manuscript"
    assert sorted(path.name for path in alpha_dir.iterdir()) == ["alpha.docx"]
    assert sorted(path.name for path in beta_dir.iterdir()) == ["beta.docx"]
    assert not (temp_upload_root / "BOOK102" / "01").exists()
    assert not (temp_upload_root / "BOOK102" / "02").exists()

    stored_files = (
        db_session.query(models.File)
        .filter(models.File.project.has(code="BOOK102"))
        .order_by(models.File.filename.asc())
        .all()
    )
    assert len(stored_files) == 2
    assert Path(stored_files[0].path).parent == alpha_dir
    assert Path(stored_files[1].path).parent == beta_dir
    assert stored_files[0].chapter.number == "01"
    assert stored_files[1].chapter.number == "02"
    assert stored_files[0].chapter.title == "alpha"
    assert stored_files[1].chapter.title == "beta"


def test_project_create_with_files_has_no_fallback_into_first_chapter_folder(
    auth_cookie_client,
    admin_user,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        "/projects/create_with_files",
        data={
            "code": "BOOK102B",
            "title": "No Fallback Book",
            "client_name": "Client B",
            "xml_standard": "NLM",
            "chapter_count": "2",
        },
        files=[
            (
                "files",
                (
                    "first.docx",
                    b"first manuscript",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ),
            ),
            (
                "files",
                (
                    "second.docx",
                    b"second manuscript",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ),
            ),
        ],
        follow_redirects=False,
    )

    assert response.status_code == 302
    first_folder = temp_upload_root / "BOOK102B" / "Chapter 1 - first" / "Manuscript"
    second_folder = temp_upload_root / "BOOK102B" / "Chapter 2 - second" / "Manuscript"
    assert sorted(path.name for path in first_folder.iterdir()) == ["first.docx"]
    assert sorted(path.name for path in second_folder.iterdir()) == ["second.docx"]
    assert not (first_folder / "second.docx").exists()
    assert not (second_folder / "first.docx").exists()


def test_project_create_with_files_rejects_duplicate_derived_stems(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        "/projects/create_with_files",
        data={
            "code": "BOOK103",
            "title": "Duplicate Stem Book",
            "client_name": "Client C",
            "xml_standard": "NLM",
            "chapter_count": "2",
        },
        files=[
            (
                "files",
                (
                    "same-name.docx",
                    b"same one",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ),
            ),
            (
                "files",
                (
                    "same-name.pdf",
                    b"same two",
                    "application/pdf",
                ),
            ),
        ],
        follow_redirects=False,
    )

    assert response.status_code == 200
    assert "Uploaded files must have unique filename stems." in response.text
    assert db_session.query(models.Project).filter(models.Project.code == "BOOK103").first() is None
    assert db_session.query(models.Chapter).count() == 0
    assert db_session.query(models.File).count() == 0
    assert not (temp_upload_root / "BOOK103").exists()


def test_project_create_with_files_uses_chapter_index_and_safe_stem_folder_naming(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        "/projects/create_with_files",
        data={
            "code": "BOOK104",
            "title": "Safe Stem Book",
            "client_name": "Client D",
            "xml_standard": "NLM",
            "chapter_count": "1",
        },
        files={
            "files": (
                "Spacing & Symbols!.docx",
                b"safe stem manuscript",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
        follow_redirects=False,
    )

    assert response.status_code == 302
    project = db_session.query(models.Project).filter(models.Project.code == "BOOK104").first()
    chapter = db_session.query(models.Chapter).filter(models.Chapter.project_id == project.id).one()
    assert chapter.number == "01"
    assert chapter.title == "Spacing_Symbols"

    manuscript_path = (
        temp_upload_root
        / "BOOK104"
        / "Chapter 1 - Spacing_Symbols"
        / "Manuscript"
        / "Spacing & Symbols!.docx"
    )
    assert manuscript_path.exists()
    for category in ["Manuscript", "Art", "InDesign", "Proof", "XML"]:
        assert (temp_upload_root / "BOOK104" / "Chapter 1 - Spacing_Symbols" / category).is_dir()


def test_chapter_create_rename_and_delete_preserve_storage_behavior(
    auth_cookie_client,
    admin_user,
    project_record,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    create_response = client.post(
        f"/projects/{project_record.id}/chapters/create",
        data={"number": "03", "title": "Chapter 03"},
        follow_redirects=False,
    )
    assert create_response.status_code == 302
    assert create_response.headers["location"] == f"/projects/{project_record.id}?msg=Chapter+Created+Successfully"

    chapter = (
        db_session.query(models.Chapter)
        .filter(models.Chapter.project_id == project_record.id, models.Chapter.number == "03")
        .first()
    )
    assert chapter is not None
    for category in ["Manuscript", "Art", "InDesign", "Proof", "XML"]:
        assert (temp_upload_root / project_record.code / "03" / category).is_dir()

    rename_response = client.post(
        f"/projects/{project_record.id}/chapter/{chapter.id}/rename",
        data={"number": "05", "title": "Renamed Chapter"},
        follow_redirects=False,
    )
    assert rename_response.status_code == 302
    assert rename_response.headers["location"] == f"/projects/{project_record.id}?msg=Chapter+Renamed+Successfully"

    db_session.refresh(chapter)
    assert chapter.number == "05"
    assert chapter.title == "Renamed Chapter"
    assert not (temp_upload_root / project_record.code / "03").exists()
    assert (temp_upload_root / project_record.code / "05").is_dir()

    delete_response = client.post(
        f"/projects/{project_record.id}/chapter/{chapter.id}/delete",
        follow_redirects=False,
    )
    assert delete_response.status_code == 302
    assert delete_response.headers["location"] == f"/projects/{project_record.id}?msg=Chapter+Deleted+Successfully"
    assert db_session.query(models.Chapter).filter(models.Chapter.id == chapter.id).first() is None
    assert not (temp_upload_root / project_record.code / "05").exists()


def test_upload_new_file_creates_file_row_and_writes_expected_path(
    auth_cookie_client,
    admin_user,
    project_record,
    chapter_record,
    db_session,
    temp_upload_root,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        f"/projects/{project_record.id}/chapter/{chapter_record.id}/upload",
        data={"category": "Manuscript"},
        files={
            "files": ("new_upload.docx", b"new manuscript bytes", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        },
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == (
        f"/projects/{project_record.id}/chapter/{chapter_record.id}?tab=Manuscript&msg=Files+Uploaded+Successfully"
    )

    file_record = (
        db_session.query(models.File)
        .filter(models.File.chapter_id == chapter_record.id, models.File.filename == "new_upload.docx")
        .first()
    )
    assert file_record is not None
    expected_path = temp_upload_root / project_record.code / chapter_record.number / "Manuscript" / "new_upload.docx"
    assert Path(file_record.path) == expected_path
    assert expected_path.read_bytes() == b"new manuscript bytes"
    assert file_record.version == 1


def test_upload_existing_file_creates_archive_fileversion_and_increments_version(
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
        f"/projects/{project_record.id}/chapter/{chapter_record.id}/upload",
        data={"category": "Manuscript"},
        files={
            "files": ("existing.docx", b"new-content", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        },
        follow_redirects=False,
    )

    assert response.status_code == 302
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


def test_upload_existing_file_locked_by_other_user_is_skipped_without_versioning(
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
        f"/projects/{project_record.id}/chapter/{chapter_record.id}/upload",
        data={"category": "Manuscript"},
        files={
            "files": ("locked.docx", b"replacement-bytes", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        },
        follow_redirects=False,
    )

    assert response.status_code == 302
    db_session.refresh(existing_file)
    assert existing_file.version == 2
    assert existing_file.checked_out_by_id == viewer_user.id
    assert existing_file.is_checked_out is True
    assert Path(existing_file.path).read_bytes() == b"locked-original"
    assert (
        db_session.query(models.FileVersion)
        .filter(models.FileVersion.file_id == existing_file.id)
        .count()
        == 0
    )


def test_checkout_and_cancel_checkout_preserve_lock_ownership(
    auth_cookie_client,
    admin_user,
    viewer_user,
    file_record,
    db_session,
):
    admin_client = auth_cookie_client(admin_user)
    viewer_client = auth_cookie_client(viewer_user)

    checkout_response = admin_client.post(
        f"/projects/files/{file_record.id}/checkout",
        follow_redirects=False,
    )
    assert checkout_response.status_code == 302
    db_session.refresh(file_record)
    assert file_record.is_checked_out is True
    assert file_record.checked_out_by_id == admin_user.id

    conflict_response = viewer_client.post(
        f"/projects/files/{file_record.id}/checkout",
        follow_redirects=False,
    )
    assert conflict_response.status_code == 302
    assert "File+Locked+By+Other" in conflict_response.headers["location"]
    db_session.refresh(file_record)
    assert file_record.checked_out_by_id == admin_user.id

    cancel_response = admin_client.post(
        f"/projects/files/{file_record.id}/cancel_checkout",
        follow_redirects=False,
    )
    assert cancel_response.status_code == 302
    db_session.refresh(file_record)
    assert file_record.is_checked_out is False
    assert file_record.checked_out_by_id is None


def test_download_file_returns_octet_stream_with_original_filename(
    auth_cookie_client,
    admin_user,
    file_record_factory,
):
    file_record, _ = file_record_factory(filename="download_me.docx", category="Manuscript")
    Path(file_record.path).write_bytes(b"download-bytes")
    client = auth_cookie_client(admin_user)

    response = client.get(f"/projects/files/{file_record.id}/download")

    assert response.status_code == 200
    assert response.content == b"download-bytes"
    assert response.headers["content-type"] == "application/octet-stream"
    assert 'filename="download_me.docx"' in response.headers["content-disposition"]


def test_delete_file_removes_disk_and_row_and_preserves_redirect_context(
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
    assert file_path.exists()
    client = auth_cookie_client(admin_user)

    response = client.post(
        f"/projects/files/{file_record.id}/delete",
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == (
        f"/projects/{project_record.id}/chapter/{chapter_record.id}?tab=Manuscript&msg=File+Deleted"
    )
    assert db_session.query(models.File).filter(models.File.id == file_record.id).first() is None
    assert not file_path.exists()


def test_notifications_returns_recent_upload_feed_for_authenticated_users(
    auth_cookie_client,
    admin_user,
    file_record_factory,
):
    client = auth_cookie_client(admin_user)
    file_record_factory(filename="a.docx")
    file_record_factory(filename="b.docx")

    response = client.get("/api/notifications")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    assert payload
    assert payload[0]["title"] == "File Uploaded"
    assert "desc" in payload[0]
    assert "time" in payload[0]
    assert "icon" in payload[0]


def test_notifications_returns_empty_list_for_anonymous_users(client):
    response = client.get("/api/notifications")

    assert response.status_code == 200
    assert response.json() == []


def test_project_delete_removes_project_row_and_project_directory(
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
    response = client.post(
        f"/projects/{project_record.id}/delete",
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/dashboard?msg=Book+Deleted"
    assert db_session.query(models.Project).filter(models.Project.id == project_record.id).first() is None
    assert not project_dir.exists()


def test_duplicate_chapter_delete_routes_remain_registered(app_env):
    delete_routes = [
        route.endpoint.__name__
        for route in app_env["app"].router.routes
        if route.path == "/projects/{project_id}/chapter/{chapter_id}/delete"
        and "POST" in getattr(route, "methods", set())
    ]

    assert len(delete_routes) == 2


def test_activities_page_redirects_anonymous_users_to_login(client):
    response = client.get("/activities", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"] == "/login"


def test_activities_page_renders_upload_and_processing_entries(
    auth_cookie_client,
    admin_user,
    file_record_factory,
    db_session,
    project_record,
    chapter_record,
):
    client = auth_cookie_client(admin_user)
    file_record, _ = file_record_factory(
        project=project_record,
        chapter=chapter_record,
        filename="activity_source.docx",
        category="Manuscript",
    )
    version_record = models.FileVersion(
        file_id=file_record.id,
        version_num=1,
        path="archive/activity_source_v1.docx",
        uploaded_at=now_ist_naive(),
        uploaded_by_id=admin_user.id,
    )
    db_session.add(version_record)
    db_session.commit()

    response = client.get("/activities")

    assert response.status_code == 200
    assert "Recent Activities" in response.text
    assert "File Uploaded" in response.text
    assert "File Processed" in response.text
    assert "activity_source.docx" in response.text
    assert project_record.title in response.text
    assert chapter_record.title in response.text
