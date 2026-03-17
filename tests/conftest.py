import os
import tempfile
from pathlib import Path
from typing import Iterable

import pytest
from docx import Document
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from app.utils.timezone import now_ist_naive


_BOOTSTRAP_ROOT = Path(tempfile.gettempdir()) / "cms_backend_codex_pytest_bootstrap"
_BOOTSTRAP_ROOT.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("CMS_RUNTIME_ROOT", str(_BOOTSTRAP_ROOT))
os.environ.setdefault("DATABASE_URL", f"sqlite:///{(_BOOTSTRAP_ROOT / 'bootstrap.sqlite3').as_posix()}")


ROLE_DEFINITIONS = [
    ("Viewer", "Read-only access"),
    ("Editor", "General editing access"),
    ("ProjectManager", "Can manage projects"),
    ("Admin", "Full access"),
    ("Tagger", "Responsible for XML/content tagging"),
    ("CopyEditor", "Reviews and edits manuscripts"),
    ("GraphicDesigner", "Manages art and visual assets"),
    ("Typesetter", "Formats layout for publication"),
    ("QCPerson", "Quality control assurance"),
    ("PPD", "Pre-press and production"),
    ("PermissionsManager", "Manages rights and permissions"),
]


def _build_docx(path: Path, paragraphs: Iterable[str] | None = None) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()
    for text in paragraphs or ["Sample paragraph for regression tests."]:
        doc.add_paragraph(text)
    doc.save(path)
    return path


@pytest.fixture()
def app_env(monkeypatch, tmp_path):
    from app import database
    from app.core.config import get_settings
    from app.database import Base
    from app.routers import processing, web
    from app.services import file_service

    db_path = tmp_path / "test.sqlite3"
    upload_root = tmp_path / "uploads"
    upload_root.mkdir(parents=True, exist_ok=True)

    engine = create_engine(
        f"sqlite:///{db_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _enable_sqlite_fk(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    monkeypatch.setattr(database, "engine", engine, raising=False)
    monkeypatch.setattr(database, "SessionLocal", TestingSessionLocal, raising=False)

    monkeypatch.setattr(file_service, "UPLOAD_DIR", str(upload_root), raising=False)
    monkeypatch.setattr(web, "UPLOAD_DIR", str(upload_root), raising=False)
    monkeypatch.setattr(processing, "UPLOAD_DIR", str(upload_root), raising=False)

    Base.metadata.create_all(bind=engine)
    get_settings.cache_clear()

    from app.main import app

    app.dependency_overrides.clear()

    yield {
        "app": app,
        "engine": engine,
        "SessionLocal": TestingSessionLocal,
        "upload_root": upload_root,
    }

    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture()
def client_factory(app_env):
    clients: list[TestClient] = []

    def _make() -> TestClient:
        client = TestClient(app_env["app"])
        client.__enter__()
        clients.append(client)
        return client

    yield _make

    while clients:
        client = clients.pop()
        client.__exit__(None, None, None)


@pytest.fixture()
def client(client_factory):
    return client_factory()


@pytest.fixture()
def db_session(app_env):
    session = app_env["SessionLocal"]()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def roles(db_session):
    from app import models

    existing = {role.name: role for role in db_session.query(models.Role).all()}
    for name, description in ROLE_DEFINITIONS:
        if name not in existing:
            db_session.add(models.Role(name=name, description=description))
    db_session.commit()
    return {role.name: role for role in db_session.query(models.Role).all()}


@pytest.fixture()
def team(db_session):
    from app import models

    team = db_session.query(models.Team).filter(models.Team.id == 1).first()
    if not team:
        team = models.Team(id=1, name="Test Team")
        db_session.add(team)
        db_session.commit()
        db_session.refresh(team)
    return team


@pytest.fixture()
def user_factory(db_session, roles, team):
    from app import models
    from app.auth import hash_password

    def _create(
        username: str,
        *,
        password: str = "Password123!",
        email: str | None = None,
        role_names: tuple[str, ...] = ("Viewer",),
        is_active: bool = True,
    ):
        user = models.User(
            username=username,
            email=email or f"{username}@example.com",
            password_hash=hash_password(password),
            is_active=is_active,
            team_id=team.id,
        )
        for role_name in role_names:
            user.roles.append(roles[role_name])
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        return user

    return _create


@pytest.fixture()
def admin_user(user_factory):
    return user_factory("admin", role_names=("Admin",))


@pytest.fixture()
def viewer_user(user_factory):
    return user_factory("viewer", role_names=("Viewer",))


@pytest.fixture()
def editor_user(user_factory):
    return user_factory("editor", role_names=("Editor",))


@pytest.fixture()
def project_manager_user(user_factory):
    return user_factory("pm", role_names=("ProjectManager",))


@pytest.fixture()
def temp_upload_root(app_env):
    return app_env["upload_root"]


@pytest.fixture()
def docx_factory():
    def _create(path: Path, paragraphs: Iterable[str] | None = None) -> Path:
        return _build_docx(path, paragraphs)

    return _create


@pytest.fixture()
def temp_docx(tmp_path, docx_factory):
    return docx_factory(tmp_path / "sample.docx", ["Alpha paragraph", "Beta paragraph"])


@pytest.fixture()
def project_factory(db_session, team):
    from app import models

    def _create(
        *,
        code: str = "BOOK001",
        title: str = "Regression Book",
        client_name: str = "Client A",
        xml_standard: str = "NLM",
        status: str = "RECEIVED",
    ):
        project = models.Project(
            team_id=team.id,
            code=code,
            title=title,
            client_name=client_name,
            xml_standard=xml_standard,
            status=status,
        )
        db_session.add(project)
        db_session.commit()
        db_session.refresh(project)
        return project

    return _create


@pytest.fixture()
def project_record(project_factory):
    return project_factory()


@pytest.fixture()
def chapter_factory(db_session, project_record):
    from app import models

    def _create(*, project=None, number: str = "01", title: str = "Chapter 01"):
        project = project or project_record
        chapter = models.Chapter(project_id=project.id, number=number, title=title)
        db_session.add(chapter)
        db_session.commit()
        db_session.refresh(chapter)
        return chapter

    return _create


@pytest.fixture()
def chapter_record(chapter_factory):
    return chapter_factory()


@pytest.fixture()
def file_record_factory(db_session, temp_upload_root, docx_factory, project_record, chapter_record):
    from app import models

    def _create(
        *,
        project=None,
        chapter=None,
        filename: str = "chapter01.docx",
        category: str = "Manuscript",
        version: int = 1,
        checked_out_by=None,
        uploaded_at=None,
        create_processed: bool = False,
        paragraphs: Iterable[str] | None = None,
    ):
        project = project or project_record
        chapter = chapter or chapter_record
        file_path = temp_upload_root / project.code / chapter.number / category
        file_path.mkdir(parents=True, exist_ok=True)
        docx_path = docx_factory(file_path / filename, paragraphs)
        uploaded_value = uploaded_at or now_ist_naive()

        record = models.File(
            project_id=project.id,
            chapter_id=chapter.id,
            filename=filename,
            file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            category=category,
            path=str(docx_path),
            version=version,
            uploaded_at=uploaded_value,
        )
        if checked_out_by is not None:
            record.is_checked_out = True
            record.checked_out_by_id = checked_out_by.id
        db_session.add(record)
        db_session.commit()
        db_session.refresh(record)

        processed_record = None
        if create_processed:
            processed_filename = f"{Path(filename).stem}_Processed.docx"
            processed_path = docx_factory(file_path / processed_filename, ["Processed paragraph"])
            processed_record = models.File(
                project_id=project.id,
                chapter_id=chapter.id,
                filename=processed_filename,
                file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                category=category,
                path=str(processed_path),
                version=1,
                uploaded_at=uploaded_value,
            )
            db_session.add(processed_record)
            db_session.commit()
            db_session.refresh(processed_record)

        return record, processed_record

    return _create


@pytest.fixture()
def file_record(file_record_factory):
    record, _processed = file_record_factory()
    return record


@pytest.fixture()
def processed_file_record(file_record_factory):
    _record, processed = file_record_factory(create_processed=True)
    return processed


@pytest.fixture()
def auth_cookie_client(client_factory):
    from app.auth import create_access_token

    def _make(user):
        client = client_factory()
        token = create_access_token(data={"sub": user.username})
        client.cookies.set("access_token", f"Bearer {token}", path="/")
        return client

    return _make


@pytest.fixture()
def bearer_auth_client(client_factory):
    from app.auth import create_access_token

    def _make(user):
        client = client_factory()
        token = create_access_token(data={"sub": user.username})
        client.headers.update({"Authorization": f"Bearer {token}"})
        return client

    return _make
