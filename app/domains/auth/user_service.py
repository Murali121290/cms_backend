from sqlalchemy.orm import Session
from app import models
from app.domains.auth.schemas import UserCreate
from app.domains.auth.security import hash_password

def get_user_by_username(db: Session, username: str):
    return db.query(models.User).filter(models.User.username == username).first()

def create_user(db: Session, user: UserCreate):
    hashed_password = hash_password(user.password)
    db_user = models.User(
        username=user.username,
        email=user.email,
        password_hash=hashed_password
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def assign_role(db: Session, user_id: int, role_name: str):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    role = db.query(models.Role).filter(models.Role.name == role_name).first()
    if user and role:
        user.roles.append(role)
        db.commit()
    return user


def get_admin_dashboard_stats(db: Session):
    return {
        "total_users": db.query(models.User).count(),
        "total_files": db.query(models.File).count(),
        "total_validations": 0,
        "total_macro": 0,
    }


def get_admin_users_page_data(db: Session):
    from app.domains.workflow.models import RolesMaster
    return {
        "users": db.query(models.User).all(),
        "all_roles": db.query(RolesMaster).all(),
    }


def get_available_roles(db: Session):
    from app.domains.workflow.models import RolesMaster
    return db.query(RolesMaster).all()


def create_admin_user(db: Session, *, username: str, email: str, password: str, role_id: int, team_name: str | None = None, customer_access: list[str] | None = None):
    from app.domains.workflow.models import RolesMaster

    existing_user = db.query(models.User).filter(
        (models.User.username == username) | (models.User.email == email)
    ).first()
    if existing_user:
        raise ValueError("Username or Email already exists")

    new_user = models.User(
        username=username,
        email=email,
        password_hash=hash_password(password),
        active_status=True,
        customer_access=customer_access or [],
    )

    target_role = db.query(RolesMaster).filter(RolesMaster.id == role_id).first()
    if target_role:
        new_user.role = target_role.role_name
        new_user.team = target_role.team
    else:
        new_user.role = "viewer"
        new_user.team = team_name or "General"

    db.add(new_user)
    db.commit()
    return new_user


def replace_user_role(db: Session, *, user_id: int, role_id: int, team_name: str | None = None):
    from app.domains.workflow.models import RolesMaster

    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    new_role = db.query(RolesMaster).filter(RolesMaster.id == role_id).first()
    if not target_user or not new_role:
        return {"status": "invalid"}

    is_target_admin = target_user.role and target_user.role.lower() == "admin"
    is_new_role_admin = new_role.role_name.lower() == "admin"

    if is_target_admin and not is_new_role_admin:
        admin_count = db.query(models.User).filter(models.User.role.ilike("admin")).count()
        if admin_count <= 1:
            return {"status": "last_admin_blocked"}

    target_user.role = new_role.role_name
    target_user.team = new_role.team
    
    db.commit()
    return {"status": "updated"}


def toggle_user_status(db: Session, *, user_id: int, actor_user_id: int):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if target_user and target_user.id != actor_user_id:
        target_user.active_status = not target_user.active_status
        db.commit()
    return target_user


def update_user_email(db: Session, *, user_id: int, email: str | None, customer_access: list[str] | None = None):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        raise LookupError("User not found")

    if email:
        target_user.email = email
    if customer_access is not None:
        target_user.customer_access = customer_access
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

