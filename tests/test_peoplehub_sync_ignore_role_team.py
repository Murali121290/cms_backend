import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.domains.auth.models import User
from app.domains.auth.auth_service import sync_user_from_peoplehub

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()

def test_sync_user_new_user_has_no_team_or_role(db_session):
    ph_user = {
        "employee_id": "9999",
        "company_email": "user9999@s4carlisle.com",
        "first_name": "John",
        "last_name": "Doe",
        "department": "Conversion",
        "designation": "Operator",
        "password_hash": "hash123",
        "is_active": True
    }

    user = sync_user_from_peoplehub(db_session, ph_user)

    assert user.username == "9999"
    assert user.first_name == "John"
    assert user.last_name == "Doe"
    assert user.role is None
    assert user.team is None
    assert user.access_level in (None, "standard")

def test_sync_user_existing_user_preserves_cms_role_and_team(db_session):
    # Setup existing user in CMS with manually assigned role and team
    existing = User(
        username="8888",
        email="user8888@s4carlisle.com",
        first_name="Jane",
        last_name="Smith",
        password_hash="oldhash",
        role="XML Manager",
        team="Editorial Team",
        access_level="Manager",
        active_status=True
    )
    db_session.add(existing)
    db_session.commit()

    ph_user = {
        "employee_id": "8888",
        "company_email": "user8888@s4carlisle.com",
        "first_name": "Jane",
        "last_name": "Smith-Updated",
        "department": "PeopleHub Conversion Department",
        "designation": "Senior Operator",
        "password_hash": "newhash",
        "is_active": True
    }

    synced = sync_user_from_peoplehub(db_session, ph_user)

    # Core identity updated
    assert synced.last_name == "Smith-Updated"
    assert synced.password_hash == "newhash"
    assert synced.designation == "Senior Operator"

    # Role and Team preserved from CMS, NOT overwritten by PeopleHub department
    assert synced.role == "XML Manager"
    assert synced.team == "Editorial Team"
    assert synced.access_level == "Manager"
