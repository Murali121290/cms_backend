import bcrypt
from app.database import SessionLocal
from app.models import Role, User

def reset_admin():
    db = SessionLocal()
    try:
        # Create Roles
        roles = ["Admin", "ProjectManager", "Editor", "Author", "Typesetter"]
        for role_name in roles:
            role = db.query(Role).filter(Role.name == role_name).first()
            if not role:
                print(f"Creating role: {role_name}")
                role = Role(name=role_name, description=f"Role for {role_name}")
                db.add(role)
        db.commit()

        # Hash password using bcrypt
        admin_email = "admin@example.com"
        password = b"admin123"
        password_hash = bcrypt.hashpw(password, bcrypt.gensalt()).decode('utf-8')

        admin = db.query(User).filter(User.email == admin_email).first()
        if admin:
            db.delete(admin)
            db.commit()
            print("Deleted old admin")

        admin_role = db.query(Role).filter(Role.name == "Admin").first()
        new_admin = User(
            username="admin",
            email=admin_email,
            password_hash=password_hash,
            is_active=True
        )
        new_admin.roles.append(admin_role)
        db.add(new_admin)
        db.commit()
        print(f"✓ Admin reset successfully")
        print(f"  Email: {admin_email}")
        print(f"  Password: admin123")

    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    reset_admin()
