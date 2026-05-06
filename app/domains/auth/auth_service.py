from sqlalchemy.orm import Session

from app import models
from app.auth import create_access_token, hash_password, verify_password


def authenticate_browser_user(db: Session, username: str, password: str):
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user or not verify_password(password, user.password_hash):
        raise ValueError("Invalid credentials")

    return {
        "user": user,
        "access_token": create_access_token(data={"sub": user.username}),
    }


def ensure_default_browser_roles(db: Session):
    viewer_role = db.query(models.Role).filter(models.Role.name == "Viewer").first()
    admin_role = None

    if not viewer_role:
        viewer_role = models.Role(name="Viewer", description="Read-only access")
        editor_role = models.Role(name="Editor", description="General editing access")
        manager_role = models.Role(name="ProjectManager", description="Can manage projects")
        admin_role = models.Role(name="Admin", description="Full access")

        tagger_role = models.Role(name="Tagger", description="Responsible for XML/content tagging")
        copyeditor_role = models.Role(name="CopyEditor", description="Reviews and edits manuscripts")
        graphic_role = models.Role(name="GraphicDesigner", description="Manages art and visual assets")
        typesetter_role = models.Role(name="Typesetter", description="Formats layout for publication")
        qc_role = models.Role(name="QCPerson", description="Quality control assurance")
        ppd_role = models.Role(name="PPD", description="Pre-press and production")
        permissions_role = models.Role(name="PermissionsManager", description="Manages rights and permissions")

        db.add_all(
            [
                viewer_role,
                editor_role,
                manager_role,
                admin_role,
                tagger_role,
                copyeditor_role,
                graphic_role,
                typesetter_role,
                qc_role,
                ppd_role,
                permissions_role,
            ]
        )
        db.commit()
        db.refresh(viewer_role)
        db.refresh(admin_role)
    else:
        admin_role = db.query(models.Role).filter(models.Role.name == "Admin").first()

    return viewer_role, admin_role


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

    new_user = models.User(
        username=username,
        email=email,
        password_hash=hash_password(password),
        is_active=True,
    )

    viewer_role, admin_role = ensure_default_browser_roles(db)

    is_first_user = db.query(models.User).count() == 0
    target_role = admin_role if is_first_user else viewer_role

    new_user.roles.append(target_role)
    db.add(new_user)
    db.commit()

    return new_user
