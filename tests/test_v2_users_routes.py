import pytest
from app import models
from app.domains.auth.security import verify_password
from app.domains.workflow.models import RolesMaster

def test_v2_create_user_success(auth_cookie_client, admin_user, roles, db_session):
    client = auth_cookie_client(admin_user)
    
    # Ensure role is active
    editor_role = roles["Editor"]
    
    response = client.post(
        "/api/v2/users",
        json={
            "username": "v2testuser",
            "email": "v2test@example.com",
            "password": "SecretPassword123!",
            "role": editor_role.role_name,
            "team": editor_role.team,
            "customer_access": ["ClientA"],
            "active_status": True
        }
    )
    
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["username"] == "v2testuser"
    assert res_data["email"] == "v2test@example.com"
    assert res_data["team"] == editor_role.team
    assert res_data["customer_access"] == ["ClientA"]
    
    # Check in DB
    user_in_db = db_session.query(models.User).filter(models.User.username == "v2testuser").first()
    assert user_in_db is not None
    assert verify_password("SecretPassword123!", user_in_db.password_hash)
    assert user_in_db.role == editor_role.role_name

def test_v2_create_user_duplicate_username(auth_cookie_client, admin_user, roles, db_session):
    client = auth_cookie_client(admin_user)
    editor_role = roles["Editor"]
    
    # Pre-create user
    existing_user = models.User(
        username="v2testuser",
        email="v2test_other@example.com",
        password_hash="dummy",
        role=editor_role.role_name,
        team=editor_role.team
    )
    db_session.add(existing_user)
    db_session.commit()
    
    response = client.post(
        "/api/v2/users",
        json={
            "username": "v2testuser",
            "email": "v2test@example.com",
            "password": "SecretPassword123!",
            "role": editor_role.role_name,
            "team": editor_role.team,
            "customer_access": [],
            "active_status": True
        }
    )
    assert response.status_code == 400
    assert "Username already registered" in response.json()["message"]

def test_v2_update_user_details(auth_cookie_client, admin_user, roles, db_session):
    client = auth_cookie_client(admin_user)
    editor_role = roles["Editor"]
    pm_role = roles["ProjectManager"]
    
    # Create user to update
    user = models.User(
        username="updateme2",
        email="updateme2@example.com",
        password_hash="dummy",
        role=editor_role.role_name,
        team=editor_role.team
    )
    db_session.add(user)
    db_session.commit()
    
    response = client.put(
        f"/api/v2/users/{user.id}",
        json={
            "role": pm_role.role_name,
            "team": pm_role.team,
            "password": "NewSecretPassword123!",
            "customer_access": ["ClientB"]
        }
    )
    
    assert response.status_code == 200
    db_session.refresh(user)
    assert user.role == pm_role.role_name
    assert user.team == pm_role.team
    assert user.customer_access == ["ClientB"]
    assert verify_password("NewSecretPassword123!", user.password_hash)

def test_v2_patch_user_status(auth_cookie_client, admin_user, roles, db_session):
    client = auth_cookie_client(admin_user)
    editor_role = roles["Editor"]
    
    # Create user
    user = models.User(
        username="statusme2",
        email="statusme2@example.com",
        password_hash="dummy",
        role=editor_role.role_name,
        team=editor_role.team,
        active_status=True
    )
    db_session.add(user)
    db_session.commit()
    
    response = client.patch(
        f"/api/v2/users/{user.id}/status",
        json={
            "active_status": False
        }
    )
    
    assert response.status_code == 200
    db_session.refresh(user)
    assert user.is_active is False
