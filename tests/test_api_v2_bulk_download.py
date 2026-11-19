from datetime import datetime, timezone
import io
import os
from pathlib import Path
import zipfile

from app import models
from app.domains.projects.models import Project


def test_get_project_bulk_files_summary(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_factory,
    file_record_factory,
):
    project = project_record
    project.project_code = "SUMMBULK1"
    project.code = "SUMMBULK1"
    db_session.commit()

    ch1 = chapter_factory(project=project, number="01", title="Chapter 01")
    ch2 = chapter_factory(project=project, number="02", title="Chapter 02")

    # Add 2 manuscript files to ch1
    file_record_factory(project=project, chapter=ch1, filename="c1_doc.docx", category="Manuscript")
    # Add 1 XML file to ch1
    file_record_factory(project=project, chapter=ch1, filename="c1_xml.xml", category="XML")
    # Add 1 Misc (Final Delivery) file to ch2
    file_record_factory(project=project, chapter=ch2, filename="c2_final.epub", category="Misc")

    client = auth_cookie_client(admin_user)
    res = client.get(f"/api/v2/projects/{project.id}/bulk-files-summary")

    assert res.status_code == 200
    data = res.json()
    assert "chapters" in data
    assert len(data["chapters"]) >= 2

    ch1_summary = next(c for c in data["chapters"] if c["chapter_id"] == ch1.id)
    assert ch1_summary["number"] == "01"
    assert ch1_summary["counts"]["Manuscript"] == 1
    assert ch1_summary["counts"]["XML"] == 1
    assert ch1_summary["counts"]["Final Delivery"] == 0

    ch2_summary = next(c for c in data["chapters"] if c["chapter_id"] == ch2.id)
    assert ch2_summary["number"] == "02"
    assert ch2_summary["counts"]["Final Delivery"] == 1


def test_post_project_bulk_download_success(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
    project_record,
    chapter_factory,
    file_record_factory,
):
    project = project_record
    project.project_code = "DOWNBULK1"
    project.code = "DOWNBULK1"
    db_session.commit()

    ch1 = chapter_factory(project=project, number="1", title="Chapter 1")
    ch2 = chapter_factory(project=project, number="2", title="Chapter 2")

    f1 = file_record_factory(project=project, chapter=ch1, filename="alpha.docx", category="Manuscript")
    f2 = file_record_factory(project=project, chapter=ch2, filename="beta.xml", category="XML")

    # Add an older FileVersion row to f1 (which should NOT appear in the ZIP)
    old_version = models.FileVersion(
        file_id=f1.id,
        version_num=1,
        path=str(Path(f1.path).parent / "Archive" / "alpha_v1.docx"),
        uploaded_at=datetime.now(timezone.utc),
        uploaded_by_id=admin_user.id,
    )
    db_session.add(old_version)
    db_session.commit()

    client = auth_cookie_client(admin_user)
    payload = {
        "chapter_ids": [ch1.id, ch2.id],
        "categories": ["Manuscript", "XML"],
    }
    res = client.post(f"/api/v2/projects/{project.id}/bulk-download", json=payload)

    assert res.status_code == 200
    assert "application/zip" in res.headers["content-type"]
    assert "attachment;" in res.headers["content-disposition"]
    today_str = datetime.now().strftime("%Y%m%d")
    assert f"DOWNBULK1_bulk_{today_str}.zip" in res.headers["content-disposition"]

    # Verify zip content
    with zipfile.ZipFile(io.BytesIO(res.content), "r") as zf:
        namelist = zf.namelist()
        assert "01/Manuscript/alpha.docx" in namelist
        assert "02/XML/beta.xml" in namelist
        assert not any("Archive" in n for n in namelist)
        assert not any("alpha_v1" in n for n in namelist)


def test_post_project_bulk_download_art_track(
    auth_cookie_client,
    admin_user,
    db_session,
    temp_upload_root,
    project_record,
    chapter_factory,
):
    project = project_record
    project.project_code = "ARTBULK1"
    project.code = "ARTBULK1"
    db_session.commit()

    art_chap = chapter_factory(project=project, number="Ch 01 - Art", title="Chapter 01 Artwork")

    # Create dummy image file on disk
    art_dir = temp_upload_root / project.client_name / project.code / "Ch 01 - Art" / "Art"
    art_dir.mkdir(parents=True, exist_ok=True)
    img_path = art_dir / "figure1.png"
    img_path.write_bytes(b"\x89PNG\r\n\x1a\nfakeimagebytes")

    file_rec = models.File(
        project_id=project.id,
        chapter_id=art_chap.id,
        filename="figure1.png",
        file_type="image/png",
        category="Art",
        path=str(img_path),
        version=1,
    )
    db_session.add(file_rec)
    db_session.commit()

    client = auth_cookie_client(admin_user)
    payload = {
        "chapter_ids": [art_chap.id],
        "categories": ["Art"],
    }
    res = client.post(f"/api/v2/projects/{project.id}/bulk-download", json=payload)

    assert res.status_code == 200
    with zipfile.ZipFile(io.BytesIO(res.content), "r") as zf:
        namelist = zf.namelist()
        assert "Ch 01 - Art/Art/figure1.png" in namelist


def test_post_project_bulk_download_missing_files_reporting(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_factory,
    file_record_factory,
):
    project = project_record
    project.project_code = "MISSBULK1"
    project.code = "MISSBULK1"
    db_session.commit()

    ch1 = chapter_factory(project=project, number="01", title="Chapter 01")

    # 1 present file
    f1 = file_record_factory(project=project, chapter=ch1, filename="present.docx", category="Manuscript")

    # 1 missing file on disk
    f2 = models.File(
        project_id=project.id,
        chapter_id=ch1.id,
        filename="missing.docx",
        file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        category="Manuscript",
        path="/non/existent/path/missing.docx",
        version=1,
    )
    db_session.add(f2)
    db_session.commit()

    client = auth_cookie_client(admin_user)
    payload = {
        "chapter_ids": [ch1.id],
        "categories": ["Manuscript"],
    }
    res = client.post(f"/api/v2/projects/{project.id}/bulk-download", json=payload)

    assert res.status_code == 200
    assert res.headers.get("x-missing-count") == "1"

    with zipfile.ZipFile(io.BytesIO(res.content), "r") as zf:
        namelist = zf.namelist()
        assert "01/Manuscript/present.docx" in namelist
        assert "_missing_files.txt" in namelist
        report = zf.read("_missing_files.txt").decode("utf-8")
        assert "01/Manuscript/missing.docx" in report


def test_post_project_bulk_download_errors(
    auth_cookie_client,
    admin_user,
    db_session,
    project_record,
    chapter_factory,
):
    project = project_record
    project.project_code = "ERRBULK1"
    project.code = "ERRBULK1"
    db_session.commit()

    ch1 = chapter_factory(project=project, number="01", title="Chapter 01")

    client = auth_cookie_client(admin_user)

    # Empty categories
    res1 = client.post(f"/api/v2/projects/{project.id}/bulk-download", json={"chapter_ids": [ch1.id], "categories": []})
    assert res1.status_code == 404
    assert res1.json()["code"] == "NO_FILES"

    # Unknown chapter id
    res2 = client.post(f"/api/v2/projects/{project.id}/bulk-download", json={"chapter_ids": [999999], "categories": ["Manuscript"]})
    assert res2.status_code == 400
    assert res2.json()["code"] == "INVALID_CHAPTERS"

    # No files in chapter
    res3 = client.post(f"/api/v2/projects/{project.id}/bulk-download", json={"chapter_ids": [ch1.id], "categories": ["Manuscript"]})
    assert res3.status_code == 404
    assert res3.json()["code"] == "NO_FILES"


def test_combine_book_archive_existing_file_side_fix(
    db_session,
    temp_upload_root,
    project_record,
    chapter_factory,
    admin_user,
):
    from app.domains.files import version_service

    project = project_record
    project.project_code = "SIDEFIX1"
    project.code = "SIDEFIX1"
    db_session.commit()

    ch = chapter_factory(project=project, number="Final files", title="Final Files")

    dest_dir = temp_upload_root / (project.client_name or "unknown") / project.project_code / ch.chapters / "Misc"
    dest_dir.mkdir(parents=True, exist_ok=True)
    file_on_disk = dest_dir / "merged.xml"
    file_on_disk.write_text("<root>test</root>")

    existing_file = models.File(
        project_id=project.id,
        chapter_id=ch.id,
        filename="merged.xml",
        file_type="text/xml",
        category="Misc",
        path=str(file_on_disk),
        version=1,
    )
    db_session.add(existing_file)
    db_session.commit()

    # Call with base_path and uploaded_by_id (as fixed in api_v2.py:5272)
    base_path = os.path.dirname(existing_file.path)
    version_service.archive_existing_file(
        db_session,
        existing_file=existing_file,
        base_path=base_path,
        uploaded_by_id=admin_user.id,
    )

    # Verify archived file exists in Archive/
    archive_dir = Path(base_path) / "Archive"
    assert archive_dir.exists()
    assert (archive_dir / "merged_v1.xml").exists()
