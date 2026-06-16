from app import models
from app.auth import verify_password



def test_api_v2_admin_users_and_roles_return_typed_lists(
    auth_cookie_client,
    admin_user,
    viewer_user,
    roles,
):
    client = auth_cookie_client(admin_user)

    users_response = client.get("/api/v2/admin/users?offset=0&limit=100")
    roles_response = client.get("/api/v2/admin/roles")

    assert users_response.status_code == 200
    users_body = users_response.json()
    assert users_body["pagination"] == {"offset": 0, "limit": 100, "total": 2}
    assert sorted(user["username"] for user in users_body["users"]) == ["admin", "viewer"]
    assert any(role["name"] == "Admin" for role in users_body["roles"])
    assert any(role["name"] == "Viewer" for role in users_body["roles"])

    assert roles_response.status_code == 200
    roles_body = roles_response.json()
    assert any(role["id"] == roles["Admin"].id and role["name"] == "Admin" for role in roles_body["roles"])


def test_api_v2_admin_create_user_returns_user_and_duplicate_error(
    auth_cookie_client,
    admin_user,
    roles,
    db_session,
):
    client = auth_cookie_client(admin_user)

    create_response = client.post(
        "/api/v2/admin/users",
        json={
            "username": "newuser",
            "email": "newuser@example.com",
            "password": "Secret123!",
            "role_id": roles["Editor"].id,
        },
    )

    assert create_response.status_code == 200
    create_body = create_response.json()
    assert create_body["status"] == "ok"
    assert create_body["redirect_to"] == "/admin/users"
    assert create_body["user"]["username"] == "newuser"
    assert create_body["user"]["roles"][0]["name"] == "Editor"

    duplicate_response = client.post(
        "/api/v2/admin/users",
        json={
            "username": "newuser",
            "email": "newuser@example.com",
            "password": "Secret123!",
            "role_id": roles["Editor"].id,
        },
    )

    assert duplicate_response.status_code == 400
    assert duplicate_response.json()["code"] == "DUPLICATE_USER"
    assert db_session.query(models.User).filter(models.User.username == "newuser").count() == 1


def test_api_v2_admin_update_role_returns_previous_roles_and_blocks_last_admin(
    auth_cookie_client,
    admin_user,
    viewer_user,
    roles,
    db_session,
):
    client = auth_cookie_client(admin_user)

    success_response = client.put(
        f"/api/v2/admin/users/{viewer_user.id}/role",
        json={"role_id": roles["Editor"].id},
    )

    assert success_response.status_code == 200
    success_body = success_response.json()
    assert success_body["status"] == "ok"
    assert success_body["previous_role_ids"] == [roles["Viewer"].id]
    assert success_body["user"]["roles"][0]["name"] == "Editor"
    assert success_body["redirect_to"] == "/admin/users?msg=Role+Updated"

    blocked_response = client.put(
        f"/api/v2/admin/users/{admin_user.id}/role",
        json={"role_id": roles["Editor"].id},
    )

    assert blocked_response.status_code == 409
    assert blocked_response.json()["code"] == "LAST_ADMIN_PROTECTED"
    db_session.refresh(admin_user)
    assert sorted(role.name for role in admin_user.roles) == ["Admin"]


def test_api_v2_admin_status_update_uses_explicit_target_state_and_blocks_self_lockout(
    auth_cookie_client,
    admin_user,
    viewer_user,
    db_session,
):
    client = auth_cookie_client(admin_user)

    block_response = client.put(
        f"/api/v2/admin/users/{admin_user.id}/status",
        json={"is_active": False},
    )
    assert block_response.status_code == 409
    assert block_response.json()["code"] == "SELF_LOCKOUT_BLOCKED"
    db_session.refresh(admin_user)
    assert admin_user.is_active is True

    disable_response = client.put(
        f"/api/v2/admin/users/{viewer_user.id}/status",
        json={"is_active": False},
    )
    assert disable_response.status_code == 200
    assert disable_response.json() == {
        "status": "ok",
        "user": {"id": viewer_user.id, "is_active": False},
        "redirect_to": "/admin/users",
    }
    db_session.refresh(viewer_user)
    assert viewer_user.is_active is False


def test_api_v2_admin_edit_user_preserves_current_logged_in_auth_gap(
    auth_cookie_client,
    viewer_user,
    admin_user,
    db_session,
):
    client = auth_cookie_client(viewer_user)

    response = client.patch(
        f"/api/v2/admin/users/{admin_user.id}",
        json={"email": "admin-updated@example.com"},
    )

    assert response.status_code == 403
    assert response.json()["code"] == "ADMIN_REQUIRED"
    db_session.refresh(admin_user)
    assert admin_user.email == "admin@example.com"


def test_api_v2_admin_password_preserves_current_no_min_length_validation(
    auth_cookie_client,
    admin_user,
    viewer_user,
    db_session,
):
    client = auth_cookie_client(admin_user)

    response = client.put(
        f"/api/v2/admin/users/{viewer_user.id}/password",
        json={"new_password": "123"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "user": {"id": viewer_user.id},
        "password_updated": True,
        "redirect_to": "/admin/users",
    }
    db_session.refresh(viewer_user)
    assert verify_password("123", viewer_user.password_hash)


def test_api_v2_admin_delete_preserves_current_logged_in_delete_auth_gap(
    auth_cookie_client,
    viewer_user,
    admin_user,
    db_session,
):
    client = auth_cookie_client(viewer_user)

    self_delete = client.delete(f"/api/v2/admin/users/{viewer_user.id}")
    assert self_delete.status_code == 403
    assert self_delete.json()["code"] == "ADMIN_REQUIRED"
    assert db_session.query(models.User).filter(models.User.id == viewer_user.id).first() is not None

    other_delete = client.delete(f"/api/v2/admin/users/{admin_user.id}")
    assert other_delete.status_code == 403
    assert other_delete.json()["code"] == "ADMIN_REQUIRED"
    assert db_session.query(models.User).filter(models.User.id == admin_user.id).first() is not None
