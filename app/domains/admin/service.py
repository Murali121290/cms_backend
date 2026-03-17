from sqlalchemy.orm import Session

from app import models
from app.auth import hash_password


def get_admin_dashboard_stats(db: Session):
    return {
        "total_users": db.query(models.User).count(),
        "total_files": db.query(models.File).count(),
        "total_validations": 0,
        "total_macro": 0,
    }


def get_admin_users_page_data(db: Session):
    return {
        "users": db.query(models.User).all(),
        "all_roles": db.query(models.Role).all(),
    }


def get_available_roles(db: Session):
    return db.query(models.Role).all()


def create_admin_user(db: Session, *, username: str, email: str, password: str, role_id: int):
    existing_user = db.query(models.User).filter(
        (models.User.username == username) | (models.User.email == email)
    ).first()
    if existing_user:
        raise ValueError("Username or Email already exists")

    new_user = models.User(
        username=username,
        email=email,
        password_hash=hash_password(password),
        is_active=True,
    )

    target_role = db.query(models.Role).filter(models.Role.id == role_id).first()
    if target_role:
        new_user.roles.append(target_role)

    db.add(new_user)
    db.commit()
    return new_user


def replace_user_role(db: Session, *, user_id: int, role_id: int):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    new_role = db.query(models.Role).filter(models.Role.id == role_id).first()
    if not target_user or not new_role:
        return {"status": "invalid"}

    admin_role = db.query(models.Role).filter(models.Role.name == "Admin").first()
    if admin_role:
        admin_count = db.query(models.UserRole).filter(models.UserRole.role_id == admin_role.id).count()
        target_has_admin = any(role.name == "Admin" for role in target_user.roles)
        if target_has_admin and new_role.name != "Admin" and admin_count <= 1:
            return {"status": "last_admin_blocked"}

    target_user.roles = [new_role]
    db.commit()
    return {"status": "updated"}


def toggle_user_status(db: Session, *, user_id: int, actor_user_id: int):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if target_user and target_user.id != actor_user_id:
        target_user.is_active = not target_user.is_active
        db.commit()
    return target_user


def update_user_email(db: Session, *, user_id: int, email: str | None):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        raise LookupError("User not found")

    if email:
        target_user.email = email
    db.commit()
    return target_user


def change_password_first_handler(db: Session, *, user_id: int, new_password: str):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if target_user:
        target_user.password_hash = hash_password(new_password)
        db.commit()
    return target_user


def get_user_for_password_change(db: Session, *, user_id: int):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        raise LookupError("User not found")
    return target_user


def change_password_validated_handler(db: Session, *, user_id: int, new_password: str):
    target_user = get_user_for_password_change(db, user_id=user_id)
    if len(new_password) < 6:
        return {"status": "error", "target_user": target_user, "error": "Password must be at least 6 characters"}

    target_user.password_hash = hash_password(new_password)
    db.commit()
    return {"status": "updated", "target_user": target_user}


def delete_user(db: Session, *, user_id: int, actor_username: str):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        return {"status": "not_found"}
    if target_user.username == actor_username:
        return {"status": "self_delete_blocked"}

    db.delete(target_user)
    db.commit()
    return {"status": "deleted"}
