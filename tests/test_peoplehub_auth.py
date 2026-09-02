import pytest
from werkzeug.security import generate_password_hash
from app.domains.auth.security import verify_password, hash_password
from app.domains.auth.models import map_role_to_capitalized

def test_verify_werkzeug_scrypt_password():
    raw_pass = "SecurePass123!"
    werkzeug_hash = generate_password_hash(raw_pass, method="scrypt")
    
    assert verify_password(raw_pass, werkzeug_hash) is True
    assert verify_password("WrongPassword", werkzeug_hash) is False

def test_verify_bcrypt_password():
    raw_pass = "SecurePass123!"
    bcrypt_hash = hash_password(raw_pass)
    
    assert verify_password(raw_pass, bcrypt_hash) is True
    assert verify_password("WrongPassword", bcrypt_hash) is False

def test_peoplehub_roles_preservation():
    assert map_role_to_capitalized("admin") == "Admin"
    assert map_role_to_capitalized("manager") == "Manager"
    assert map_role_to_capitalized("employee") == "Employee"
    assert map_role_to_capitalized("hr") == "HR"
