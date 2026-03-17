from pathlib import Path

from app import models
from app.auth import verify_password


def test_admin_create_user_assigns_selected_role_and_redirects(
    auth_cookie_client,
    admin_user,
    roles,
    db_session,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        "/admin/users/create",
        data={
            "username": "newuser",
            "email": "newuser@example.com",
            "password": "Secret123!",
            "role_id": str(roles["Editor"].id),
        },
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/admin/users"

    created = db_session.query(models.User).filter(models.User.username == "newuser").first()
    assert created is not None
    assert sorted(role.name for role in created.roles) == ["Editor"]


def test_admin_role_update_replaces_roles_for_target_user(
    auth_cookie_client,
    admin_user,
    viewer_user,
    roles,
    db_session,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        f"/admin/users/{viewer_user.id}/role",
        data={"role_id": str(roles["Editor"].id)},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/admin/users?msg=Role+Updated"
    db_session.refresh(viewer_user)
    assert sorted(role.name for role in viewer_user.roles) == ["Editor"]


def test_admin_role_update_blocks_removing_last_admin_role(
    auth_cookie_client,
    admin_user,
    roles,
    db_session,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        f"/admin/users/{admin_user.id}/role",
        data={"role_id": str(roles["Editor"].id)},
        follow_redirects=False,
    )

    assert response.status_code == 200
    assert "Cannot remove the last Admin role." in response.text
    db_session.refresh(admin_user)
    assert sorted(role.name for role in admin_user.roles) == ["Admin"]


def test_admin_status_toggle_does_not_disable_self_but_disables_other(
    auth_cookie_client,
    admin_user,
    viewer_user,
    db_session,
):
    client = auth_cookie_client(admin_user)

    self_response = client.post(f"/admin/users/{admin_user.id}/status", follow_redirects=False)
    assert self_response.status_code == 302
    db_session.refresh(admin_user)
    assert admin_user.is_active is True

    other_response = client.post(f"/admin/users/{viewer_user.id}/status", follow_redirects=False)
    assert other_response.status_code == 302
    db_session.refresh(viewer_user)
    assert viewer_user.is_active is False


def test_admin_edit_user_updates_email(
    auth_cookie_client,
    admin_user,
    viewer_user,
    db_session,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        f"/admin/users/{viewer_user.id}/edit",
        data={"email": "updated@example.com"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/admin/users?msg=User+updated"
    db_session.refresh(viewer_user)
    assert viewer_user.email == "updated@example.com"


def test_admin_password_route_uses_current_first_registered_handler(
    auth_cookie_client,
    admin_user,
    viewer_user,
    db_session,
):
    client = auth_cookie_client(admin_user)

    response = client.post(
        f"/admin/users/{viewer_user.id}/password",
        data={"new_password": "123"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/admin/users"
    db_session.refresh(viewer_user)
    assert verify_password("123", viewer_user.password_hash)


def test_admin_delete_user_blocks_self_but_deletes_other(
    auth_cookie_client,
    admin_user,
    viewer_user,
    db_session,
):
    client = auth_cookie_client(admin_user)

    self_delete = client.post(f"/admin/users/{admin_user.id}/delete", follow_redirects=False)
    assert self_delete.status_code == 302
    assert "Cannot+delete+yourself" in self_delete.headers["location"]
    assert db_session.query(models.User).filter(models.User.id == admin_user.id).first() is not None

    other_delete = client.post(f"/admin/users/{viewer_user.id}/delete", follow_redirects=False)
    assert other_delete.status_code == 302
    assert "User+deleted" in other_delete.headers["location"]
    assert db_session.query(models.User).filter(models.User.id == viewer_user.id).first() is None


def test_duplicate_admin_routes_remain_registered_in_current_order(app_env):
    password_post_routes = [
        route.endpoint.__name__
        for route in app_env["app"].router.routes
        if route.path == "/admin/users/{user_id}/password" and "POST" in getattr(route, "methods", set())
    ]
    delete_post_routes = [
        route.endpoint.__name__
        for route in app_env["app"].router.routes
        if route.path == "/admin/users/{user_id}/delete" and "POST" in getattr(route, "methods", set())
    ]

    assert password_post_routes[:2] == ["admin_change_password_submit", "admin_change_password"]
    assert len(delete_post_routes) == 2


def test_api_v1_projects_routes_preserve_current_compatibility_behavior(
    bearer_auth_client,
    auth_cookie_client,
    project_manager_user,
    admin_user,
    project_record,
    db_session,
    temp_upload_root,
    team,
):
    bearer_client = bearer_auth_client(project_manager_user)

    list_response = bearer_client.get("/api/v1/projects/")
    assert list_response.status_code == 200
    assert any(project["code"] == project_record.code for project in list_response.json())

    create_response = bearer_client.post(
        "/api/v1/projects/",
        json={
            "team_id": team.id,
            "code": "API100",
            "title": "API Project",
            "xml_standard": "NLM",
        },
    )
    assert create_response.status_code == 200
    assert db_session.query(models.Project).filter(models.Project.code == "API100").first() is not None

    status_response = bearer_client.put(f"/api/v1/projects/{project_record.id}/status", params={"status": "PROCESSING"})
    assert status_response.status_code == 200
    db_session.refresh(project_record)
    assert project_record.status == "PROCESSING"

    project_dir = temp_upload_root / project_record.code
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "keep.txt").write_text("db-delete-does-not-clean-disk", encoding="utf-8")

    cookie_client = auth_cookie_client(admin_user)
    delete_response = cookie_client.delete(f"/api/v1/projects/{project_record.id}")
    assert delete_response.status_code == 200
    assert delete_response.json() == {"message": "Project deleted successfully"}
    assert db_session.query(models.Project).filter(models.Project.id == project_record.id).first() is None
    assert project_dir.exists()


def test_api_v1_files_upload_writes_flat_file_record(
    bearer_auth_client,
    project_manager_user,
    project_record,
    db_session,
    temp_upload_root,
):
    client = bearer_auth_client(project_manager_user)

    response = client.post(
        "/api/v1/files/",
        params={"project_id": project_record.id},
        files={"file": ("flat_upload.docx", b"flat-bytes", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )

    assert response.status_code == 200
    payload = response.json()
    file_record = db_session.query(models.File).filter(models.File.id == payload["file_id"]).first()
    assert file_record is not None
    assert Path(file_record.path).exists()
    assert Path(file_record.path).parent == temp_upload_root
    assert Path(file_record.path).read_bytes() == b"flat-bytes"
