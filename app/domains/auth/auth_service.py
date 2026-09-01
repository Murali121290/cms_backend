from sqlalchemy.orm import Session
from app.domains.auth.models import User
from app.domains.auth.security import create_access_token, hash_password, verify_password
from app.db.peoplehub_db import find_peoplehub_user

from app.domains.auth.user_service import determine_access_level

def sync_user_from_peoplehub(db: Session, ph_user: dict) -> User:
    emp_id = ph_user["employee_id"]
    email = ph_user.get("company_email") or ph_user.get("email") or f"{emp_id}@s4carlisle.com"
    role = None  # Blank / null as requested
    dept = ph_user.get("department") or "General"
    designation = ph_user.get("designation") or ph_user.get("role")
    access_lvl = determine_access_level(designation)
    password_hash = ph_user["password_hash"]

    # Match by employee_id or company email
    user = db.query(User).filter(
        (User.username == emp_id) | (User.email == email)
    ).first()

    fn = ph_user.get("first_name")
    ln = ph_user.get("last_name")

    if not user:
        user = User(
            username=emp_id,
            email=email,
            first_name=fn,
            last_name=ln,
            password_hash=password_hash,
            role=None,
            designation=designation,
            team=dept,
            access_level=access_lvl,
            active_status=ph_user.get("is_active", True)
        )
        db.add(user)
    else:
        user.username = emp_id
        user.email = email
        user.first_name = fn
        user.last_name = ln
        user.password_hash = password_hash
        user.role = None
        user.designation = designation
        user.team = dept
        user.access_level = access_lvl
        user.active_status = ph_user.get("is_active", True)

    db.commit()
    db.refresh(user)
    return user


def authenticate_browser_user(db: Session, username: str, password: str):
    # 1. First check PeopleHub DB (Read-Only query)
    try:
        ph_user = find_peoplehub_user(username)
        if ph_user and ph_user.get("password_hash"):
            if verify_password(password, ph_user["password_hash"]):
                user = sync_user_from_peoplehub(db, ph_user)
                return {
                    "user": user,
                    "access_token": create_access_token(data={"sub": user.username}),
                }
    except Exception as exc:
        pass

    # 2. Fallback to local CMS user query
    user = db.query(User).filter(
        (User.username == username) | (User.email == username)
    ).first()
    if not user or not verify_password(password, user.password_hash):
        raise ValueError("Invalid credentials")

    return {
        "user": user,
        "access_token": create_access_token(data={"sub": user.username}),
    }


def register_browser_user(
    db: Session,
    *,
    username: str,
    email: str,
    password: str,
    confirm_password: str,
):
    if password != confirm_password:
        raise ValueError("Passwords do not match")

    existing_user = db.query(User).filter(
        (User.username == username) | (User.email == email)
    ).first()
    if existing_user:
        raise ValueError("Username or email already exists")

    is_first_user = db.query(User).count() == 0
    role_name = "admin" if is_first_user else "viewer"
    team_name = "Admin Team" if is_first_user else "General"

    new_user = User(
        username=username,
        email=email,
        password_hash=hash_password(password),
        active_status=True,
        role=role_name,
        team=team_name,
    )

    db.add(new_user)
    db.commit()

    return new_user
