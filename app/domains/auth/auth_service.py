from sqlalchemy.orm import Session

from app import models
from app.domains.auth.security import create_access_token, hash_password, verify_password


def authenticate_browser_user(db: Session, username: str, password: str):
    user = db.query(models.User).filter(models.User.username == username).first()
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

    existing_user = db.query(models.User).filter(
        (models.User.username == username) | (models.User.email == email)
    ).first()
    if existing_user:
        raise ValueError("Username or email already exists")

    is_first_user = db.query(models.User).count() == 0
    role_name = "admin" if is_first_user else "viewer"
    team_name = "Admin Team" if is_first_user else "General"

    new_user = models.User(
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
