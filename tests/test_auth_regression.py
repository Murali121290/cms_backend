from app import models


def test_login_valid_sets_access_token_cookie_and_redirects_dashboard(client, user_factory):
    user_factory("alice", password="Secret123!", role_names=("Viewer",))

    response = client.post(
        "/login",
        data={"username": "alice", "password": "Secret123!"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/dashboard"
    assert "access_token" in response.cookies
    assert response.cookies["access_token"].strip('"').startswith("Bearer ")


def test_login_invalid_renders_login_with_error_and_no_cookie(client, user_factory):
    user_factory("alice", password="Secret123!", role_names=("Viewer",))

    response = client.post(
        "/login",
        data={"username": "alice", "password": "wrong-password"},
        follow_redirects=False,
    )

    assert response.status_code == 200
    assert "Invalid credentials" in response.text
    assert "access_token" not in response.cookies


def test_logout_clears_cookie_and_redirects_login(client, user_factory):
    user_factory("alice", password="Secret123!", role_names=("Viewer",))
    login_response = client.post(
        "/login",
        data={"username": "alice", "password": "Secret123!"},
        follow_redirects=False,
    )
    client.cookies.set("access_token", login_response.cookies["access_token"])

    response = client.get("/logout", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"] == "/login"
    assert "access_token=\"\"" in response.headers.get("set-cookie", "")


def test_register_first_user_bootstraps_roles_and_assigns_admin(client, db_session):
    response = client.post(
        "/register",
        data={
            "username": "founder",
            "email": "founder@example.com",
            "password": "Secret123!",
            "confirm_password": "Secret123!",
        },
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"].startswith("/login?msg=Registration")

    founder = db_session.query(models.User).filter(models.User.username == "founder").first()
    assert founder is not None
    assert sorted(role.name for role in founder.roles) == ["Admin"]
    role_names = {role.name for role in db_session.query(models.Role).all()}
    assert "Viewer" in role_names
    assert "Admin" in role_names


def test_register_duplicate_user_renders_error_without_new_rows(client, user_factory, db_session):
    user_factory("existing", email="existing@example.com", password="Secret123!")
    before_count = db_session.query(models.User).count()

    response = client.post(
        "/register",
        data={
            "username": "existing",
            "email": "existing@example.com",
            "password": "Secret123!",
            "confirm_password": "Secret123!",
        },
        follow_redirects=False,
    )

    assert response.status_code == 200
    assert "Username or email already exists" in response.text
    assert db_session.query(models.User).count() == before_count


def test_register_password_mismatch_returns_error_template(client, db_session):
    response = client.post(
        "/register",
        data={
            "username": "mismatch",
            "email": "mismatch@example.com",
            "password": "Secret123!",
            "confirm_password": "Different123!",
        },
        follow_redirects=False,
    )

    assert response.status_code == 200
    assert "Passwords do not match" in response.text
    assert db_session.query(models.User).count() == 0
