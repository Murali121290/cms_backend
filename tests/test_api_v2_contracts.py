from app import models
from app.utils.timezone import now_ist_naive


def test_api_v2_session_login_sets_cookie_and_returns_viewer_payload(client, user_factory):
    user_factory("alice", password="Secret123!", role_names=("Viewer",))

    response = client.post(
        "/api/v2/session/login",
        json={"username": "alice", "password": "Secret123!"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["redirect_to"] == "/dashboard"
    assert body["session"]["authenticated"] is True
    assert body["session"]["auth_mode"] == "cookie"
    assert body["viewer"]["username"] == "alice"
    assert body["viewer"]["roles"] == ["Viewer"]
    assert "access_token" in response.cookies
    assert response.cookies["access_token"].strip('"').startswith("Bearer ")


def test_api_v2_session_login_invalid_returns_stable_error(client, user_factory):
    user_factory("alice", password="Secret123!", role_names=("Viewer",))

    response = client.post(
        "/api/v2/session/login",
        json={"username": "alice", "password": "wrong"},
    )

    assert response.status_code == 401
    assert response.json() == {
        "status": "error",
        "code": "INVALID_CREDENTIALS",
        "message": "Invalid credentials",
        "field_errors": None,
        "details": None,
    }


def test_api_v2_session_register_bootstraps_first_user_without_auth_cookie(client, db_session):
    response = client.post(
        "/api/v2/session/register",
        json={
            "username": "founder",
            "email": "founder@example.com",
            "password": "Secret123!",
            "confirm_password": "Secret123!",
        },
    )

    assert response.status_code == 200
    assert "access_token" not in response.cookies
    assert response.json() == {
        "status": "ok",
        "user": {
            "id": 1,
            "username": "founder",
            "email": "founder@example.com",
            "roles": ["Admin"],
            "is_active": True,
        },
        "redirect_to": "/ui/login",
    }
    founder = db_session.query(models.User).filter(models.User.username == "founder").first()
    assert founder is not None
    assert sorted(role.name for role in founder.roles) == ["Admin"]


def test_api_v2_session_register_assigns_viewer_after_first_user(client, user_factory, db_session):
    user_factory("existing-admin", email="admin@example.com", password="Secret123!", role_names=("Admin",))

    response = client.post(
        "/api/v2/session/register",
        json={
            "username": "viewer-user",
            "email": "viewer@example.com",
            "password": "Secret123!",
            "confirm_password": "Secret123!",
        },
    )

    assert response.status_code == 200
    assert response.json()["user"]["roles"] == ["Viewer"]
    created_user = db_session.query(models.User).filter(models.User.username == "viewer-user").first()
    assert created_user is not None
    assert sorted(role.name for role in created_user.roles) == ["Viewer"]


def test_api_v2_session_register_rejects_duplicate_username_or_email(client, user_factory):
    user_factory("existing", email="existing@example.com", password="Secret123!")

    response = client.post(
        "/api/v2/session/register",
        json={
            "username": "existing",
            "email": "existing@example.com",
            "password": "Secret123!",
            "confirm_password": "Secret123!",
        },
    )

    assert response.status_code == 400
    assert response.json() == {
        "status": "error",
        "code": "DUPLICATE_USER",
        "message": "Username or email already exists",
        "field_errors": {
            "username": "Username or email already exists",
            "email": "Username or email already exists",
        },
        "details": None,
    }


def test_api_v2_session_register_rejects_password_mismatch(client, db_session):
    response = client.post(
        "/api/v2/session/register",
        json={
            "username": "mismatch",
            "email": "mismatch@example.com",
            "password": "Secret123!",
            "confirm_password": "Different123!",
        },
    )

    assert response.status_code == 400
    assert response.json() == {
        "status": "error",
        "code": "PASSWORD_MISMATCH",
        "message": "Passwords do not match",
        "field_errors": {
            "confirm_password": "Passwords do not match",
        },
        "details": None,
    }
    assert db_session.query(models.User).count() == 0


def test_api_v2_session_get_supports_cookie_auth(auth_cookie_client, admin_user):
    client = auth_cookie_client(admin_user)

    response = client.get("/api/v2/session")

    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] is True
    assert body["auth"]["mode"] == "cookie"
    assert body["viewer"]["username"] == admin_user.username
    assert body["viewer"]["roles"] == ["Admin"]


def test_api_v2_session_get_supports_bearer_auth(bearer_auth_client, viewer_user):
    client = bearer_auth_client(viewer_user)

    response = client.get("/api/v2/session")

    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] is True
    assert body["auth"]["mode"] == "bearer"
    assert body["viewer"]["username"] == viewer_user.username


def test_api_v2_session_get_returns_unauthenticated_without_credentials(client):
    response = client.get("/api/v2/session")

    assert response.status_code == 200
    assert response.json() == {
        "authenticated": False,
        "viewer": None,
        "auth": {"mode": None, "expires_at": None},
    }


def test_api_v2_session_delete_clears_cookie_and_returns_redirect_hint(auth_cookie_client, admin_user):
    client = auth_cookie_client(admin_user)

    response = client.delete("/api/v2/session")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "redirect_to": "/login"}
    assert 'access_token=""' in response.headers.get("set-cookie", "")


def test_api_v2_dashboard_requires_cookie_auth(client):
    response = client.get("/api/v2/dashboard")

    assert response.status_code == 401
    assert response.json()["code"] == "AUTH_REQUIRED"


def test_api_v2_dashboard_returns_viewer_stats_and_projects(
    auth_cookie_client,
    admin_user,
    project_factory,
):
    project_factory(code="BOOK100", title="Alpha Project", client_name="Client A")
    project_factory(code="BOOK200", title="Beta Project", client_name="Client B")
    client = auth_cookie_client(admin_user)

    response = client.get("/api/v2/dashboard")

    assert response.status_code == 200
    body = response.json()
    assert body["viewer"]["username"] == admin_user.username
    assert body["stats"] == {
        "total_projects": 2,
        "on_time_rate": 94,
        "on_time_trend": "+12%",
        "avg_days": 8.5,
        "avg_days_trend": "-2 days",
        "delayed_count": 0,
        "delayed_trend": "0",
    }
    assert sorted(project["code"] for project in body["projects"]) == ["BOOK100", "BOOK200"]


def test_api_v2_projects_returns_pagination_and_summaries(
    auth_cookie_client,
    admin_user,
    project_factory,
):
    project_factory(code="BOOK100", title="Alpha Project", client_name="Client A")
    project_factory(code="BOOK200", title="Beta Project", client_name="Client B")
    client = auth_cookie_client(admin_user)

    response = client.get("/api/v2/projects?offset=0&limit=100")

    assert response.status_code == 200
    body = response.json()
    assert body["pagination"] == {"offset": 0, "limit": 100, "total": 2}
    assert sorted(project["title"] for project in body["projects"]) == ["Alpha Project", "Beta Project"]
    assert all("chapter_count" in project for project in body["projects"])
    assert all("file_count" in project for project in body["projects"])


def test_api_v2_project_detail_and_chapters_return_derived_flags(
    auth_cookie_client,
    admin_user,
    project_record,
    chapter_record,
    chapter_factory,
    file_record_factory,
):
    second_chapter = chapter_factory(project=project_record, number="02", title="Chapter 02")
    file_record_factory(project=project_record, chapter=chapter_record, filename="ms.docx", category="Manuscript")
    file_record_factory(project=project_record, chapter=second_chapter, filename="art.jpg", category="Art")
    client = auth_cookie_client(admin_user)

    detail_response = client.get(f"/api/v2/projects/{project_record.id}")
    chapters_response = client.get(f"/api/v2/projects/{project_record.id}/chapters")

    assert detail_response.status_code == 200
    detail_body = detail_response.json()
    assert detail_body["project"]["id"] == project_record.id
    detail_chapters = {chapter["number"]: chapter for chapter in detail_body["project"]["chapters"]}
    assert detail_chapters["01"]["has_manuscript"] is True
    assert detail_chapters["02"]["has_art"] is True

    assert chapters_response.status_code == 200
    chapters_body = chapters_response.json()
    assert chapters_body["project"]["id"] == project_record.id
    chapter_map = {chapter["number"]: chapter for chapter in chapters_body["chapters"]}
    assert chapter_map["01"]["has_manuscript"] is True
    assert chapter_map["02"]["has_art"] is True


def test_api_v2_chapter_detail_and_files_return_active_tab_lock_state_and_actions(
    auth_cookie_client,
    admin_user,
    viewer_user,
    project_record,
    chapter_record,
    file_record_factory,
):
    owned_file, _ = file_record_factory(
        project=project_record,
        chapter=chapter_record,
        filename="owned.docx",
        category="Manuscript",
        checked_out_by=admin_user,
    )
    other_locked_file, _ = file_record_factory(
        project=project_record,
        chapter=chapter_record,
        filename="other.docx",
        category="XML",
        checked_out_by=viewer_user,
    )
    client = auth_cookie_client(admin_user)

    detail_response = client.get(
        f"/api/v2/projects/{project_record.id}/chapters/{chapter_record.id}?tab=XML"
    )
    files_response = client.get(
        f"/api/v2/projects/{project_record.id}/chapters/{chapter_record.id}/files"
    )

    assert detail_response.status_code == 200
    detail_body = detail_response.json()
    assert detail_body["active_tab"] == "XML"
    assert detail_body["chapter"]["category_counts"] == {
        "Art": 0,
        "Manuscript": 1,
        "InDesign": 0,
        "Proof": 0,
        "XML": 1,
        "Miscellaneous": 0,
    }

    assert files_response.status_code == 200
    files_body = files_response.json()
    file_map = {item["id"]: item for item in files_body["files"]}
    assert file_map[owned_file.id]["lock"]["is_checked_out"] is True
    assert file_map[owned_file.id]["lock"]["checked_out_by_id"] == admin_user.id
    assert "cancel_checkout" in file_map[owned_file.id]["available_actions"]
    assert "checkout" not in file_map[owned_file.id]["available_actions"]
    assert file_map[other_locked_file.id]["lock"]["checked_out_by_id"] == viewer_user.id
    assert "checkout" not in file_map[other_locked_file.id]["available_actions"]
    assert "cancel_checkout" not in file_map[other_locked_file.id]["available_actions"]


def test_api_v2_notifications_returns_typed_wrapper(
    auth_cookie_client,
    admin_user,
    file_record_factory,
):
    file_record, _ = file_record_factory(filename="notify.docx")
    client = auth_cookie_client(admin_user)

    response = client.get("/api/v2/notifications")

    assert response.status_code == 200
    body = response.json()
    assert "refreshed_at" in body
    assert body["notifications"][0]["id"] == f"file:{file_record.id}:upload"
    assert body["notifications"][0]["type"] == "file_upload"
    assert body["notifications"][0]["description"] == "notify.docx"
    assert body["notifications"][0]["file_id"] == file_record.id


def test_api_v2_activities_returns_summary_and_typed_items(
    auth_cookie_client,
    admin_user,
    db_session,
    file_record_factory,
):
    file_record, _ = file_record_factory(filename="activity.docx", category="Manuscript")
    version_record = models.FileVersion(
        file_id=file_record.id,
        version_num=2,
        path=f"{file_record.path}.v2",
        uploaded_at=now_ist_naive(),
        uploaded_by_id=admin_user.id,
    )
    db_session.add(version_record)
    db_session.commit()
    client = auth_cookie_client(admin_user)

    response = client.get("/api/v2/activities?limit=10")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["total"] >= 2
    assert body["summary"]["today"] >= 2
    types = {item["type"] for item in body["activities"]}
    assert "upload" in types
    assert "version" in types
    first_item = body["activities"][0]
    assert "id" in first_item
    assert "project" in first_item
    assert "chapter" in first_item
    assert "relative_time" in first_item
