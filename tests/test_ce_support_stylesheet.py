import os
import json
import pytest
from app.services import stylesheet_service
from app.domains.projects.models import ProjectStylesheet, Project


def test_save_and_find_ce_support_stylesheet(db_session, temp_upload_root, monkeypatch):
    monkeypatch.setattr(stylesheet_service, "UPLOADS_DIR", temp_upload_root)

    # Create dummy project
    proj = Project(
        project_code="PRJ_TEST_999",
        title="Test Medical Guide",
        client_name="Test Publisher",
        xml_standard="jats"
    )
    db_session.add(proj)
    db_session.commit()
    db_session.refresh(proj)

    # 1. Create a stylesheet via stylesheet_service
    ss = stylesheet_service.create_stylesheet(
        db_session,
        project_id=proj.id,
        name="House Style 2026",
        description="Test description",
        selected_ia_rows=[],
        created_by_id=None,
        ce_rules={"6": {"enabled": True, "option": 1, "severity": "Minor"}},
        style_profile={"numbers": "numerals"},
    )
    stylesheet_service.activate_stylesheet(db_session, stylesheet_id=ss.id, project_id=proj.id)

    # Verify canonical stylesheet.json was saved in CE support/Style sheet template/
    ce_template_dir = temp_upload_root / "Test Publisher" / "PRJ_TEST_999" / "CE support" / "Style sheet template"
    canonical_json = ce_template_dir / "stylesheet.json"
    assert canonical_json.exists()

    with open(canonical_json, encoding="utf-8") as f:
        data = json.load(f)
    assert data["name"] == "House Style 2026"
    assert data["ce_rules"]["6"]["option"] == 1

    # 2. Test find_ce_support_stylesheet_file
    found = stylesheet_service.find_ce_support_stylesheet_file(db_session, project_id=proj.id)
    assert found is not None
    file_path, file_data = found
    assert file_data["name"] == "House Style 2026"

    # 3. Modify the disk file directly in CE support (simulate external editor / intake update)
    file_data["ce_rules"]["6"]["option"] = 2
    with open(canonical_json, "w", encoding="utf-8") as f:
        json.dump(file_data, f, indent=2)

    # Touch mtime to ensure disk file is newer
    future_time = os.path.getmtime(canonical_json) + 10
    os.utime(canonical_json, (future_time, future_time))

    # 4. Sync from CE support
    synced = stylesheet_service.sync_stylesheet_from_ce_support(db_session, project_id=proj.id)
    assert synced is not None
    db_session.refresh(synced)
    ce_rules = json.loads(synced.ce_rules)
    assert ce_rules["6"]["option"] == 2

    # 5. Verify ensure_publisher_stylesheet returns this synced active stylesheet
    ensured = stylesheet_service.ensure_publisher_stylesheet(db_session, project_id=proj.id)
    assert ensured is not None
    assert ensured.id == synced.id
