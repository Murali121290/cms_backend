from app.database import SessionLocal
from app.models import Role, User
from app.domains.auth.security import pwd_context
import sys

def reset_admin(new_password="admin123"):
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

        # Hash password
        password_hash = pwd_context.hash(new_password)
        
        # Reset admin user
        admin_email = "admin@example.com"
        admin = db.query(User).filter(User.email == admin_email).first()
        if admin:
            admin.password_hash = password_hash
            admin.is_active = True
            db.commit()
            print(f"✓ Admin password reset successfully")
            print(f"  Email: {admin_email}")
            print(f"  Password: {new_password}")
        else:
            print("Admin user not found, creating new admin...")
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
            print(f"✓ Admin user created")
            print(f"  Email: {admin_email}")
            print(f"  Password: {new_password}")
        
    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    # Use custom password from command line or default
    password = sys.argv[1] if len(sys.argv) > 1 else "admin123"
    reset_admin(password)
