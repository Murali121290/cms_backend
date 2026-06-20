import os
import shutil
import tempfile
import zipfile
from datetime import datetime
import logging
from typing import Any, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File as FastAPIFile, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app import database, models, schemas_v2
from app.auth import get_current_user_from_cookie
from app.core.config import get_settings
from app.services import (
    activity_service,
    admin_user_service,
    auth_service,
    chapter_service,
    checkout_service,
    dashboard_service,
    file_service,
    notification_service,
    project_service,
    project_read_service,
    processing_service,
    session_service,
    structuring_review_service,
    stylesheet_service,
    technical_editor_service,
    version_service,
)
from app.utils.timezone import now_ist_naive
from app.utils.inject_styles import inject_publisher_styles
from app.processing.ppd_engine import PPDEngine
from app.processing.permissions_engine import PermissionsEngine
from app.processing.technical_engine import TechnicalEngine
from app.processing.legacy.highlighter.technical_editor import TechnicalEditor
from app.processing.references_engine import ReferencesEngine
from app.processing.structuring_engine import StructuringEngine
from app.processing.bias_engine import BiasEngine
from app.processing.ai_extractor_engine import AIExtractorEngine
from app.processing.xml_engine import XMLEngine
from app.utils.utils.structuring_lib.doc_utils import extract_document_structure, update_document_structure
from app.utils.utils.structuring_lib.rules_loader import get_rules_loader
from app.integrations.collabora.config import COLLABORA_PUBLIC_URL, WOPI_BASE_URL
from app.integrations.onlyoffice import (
    ONLYOFFICE_PUBLIC_URL,
    ONLYOFFICE_JWT_ENABLED,
    sign_config,
    verify_callback_token,
)
from app.integrations.wopi import service as wopi_service

settings = get_settings()
router = APIRouter()
logger = logging.getLogger("app.processing")
logger.setLevel(logging.INFO)

_STANDARD_FILE_ACTIONS = ["download", "delete", "edit", "technical_edit"]

# Valid production workflow ids (mirrors frontend workflowDefinitions.ts WF-01 … WF-08).
_WORKFLOW_TYPE_IDS = {f"WF-{n:02d}" for n in range(1, 9)}


def _error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, str] | None = None,
    details: dict[str, str | int | float | bool | None] | None = None,
):
    payload = schemas_v2.ErrorResponse(
        code=code,
        message=message,
        field_errors=field_errors,
        details=details,
    )
    return JSONResponse(status_code=status_code, content=payload.model_dump(mode="json"))


def _strip_bearer_prefix(token_value: str | None):
    if not token_value:
        return None
    normalized = token_value.strip().strip('"')
    scheme, _, param = normalized.partition(" ")
    if scheme.lower() == "bearer" and param:
        return param
    return normalized


def _decode_token_payload(token: str | None):
    if not token:
        return None
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None


def _resolve_session(request: Request, db: Session):
    cookie_payload = _decode_token_payload(
        _strip_bearer_prefix(request.cookies.get(session_service.ACCESS_TOKEN_COOKIE_NAME))
    )
    if cookie_payload:
        username = cookie_payload.get("sub")
        user = db.query(models.User).filter(models.User.username == username).first()
        if user:
            return user, "cookie", cookie_payload.get("exp")

    authorization = request.headers.get("Authorization")
    scheme, _, param = authorization.partition(" ") if authorization else ("", "", "")
    if authorization and scheme.lower() == "bearer" and param:
        bearer_payload = _decode_token_payload(param)
        if bearer_payload:
            username = bearer_payload.get("sub")
            user = db.query(models.User).filter(models.User.username == username).first()
            if user:
                return user, "bearer", bearer_payload.get("exp")

    return None, None, None


def _require_cookie_user(user):
    if user:
        return user
    return None


def _has_admin_role(user: models.User):
    return "Admin" in [role.name for role in user.roles]


def _has_admin_or_pm_role(user: models.User):
    return any(role.name in ("Admin", "ProjectManager") for role in user.roles)



def _serialize_admin_role(role: Any):
    return schemas_v2.AdminRole(id=role.id, name=role.name, description=role.description)


def _serialize_admin_user(user: models.User):
    return schemas_v2.AdminUser(
        id=user.id,
        username=user.username,
        email=user.email,
        is_active=user.is_active,
        roles=[schemas_v2.AdminUserRole(id=role.id, name=role.name) for role in user.roles],
        team=user.team,
        customer_access=user.customer_access or [],
    )


def _serialize_viewer(user: models.User):
    return schemas_v2.Viewer(
        id=user.id,
        username=user.username,
        email=user.email,
        roles=[role.name for role in user.roles],
        is_active=user.is_active,
    )


def _serialize_project_summary(project: models.Project):
    from datetime import datetime as _dt
    due = project.due_date.isoformat() if getattr(project, "due_date", None) else None
    # Fall back to today for projects created before the created_at column was added
    _cat_raw = getattr(project, "created_at", None)
    cat = _cat_raw.isoformat() if _cat_raw else _dt.utcnow().date().isoformat()
    uat = project.updated_at.isoformat() if getattr(project, "updated_at", None) else None
    return schemas_v2.ProjectSummary(
        id=project.id,
        code=project.code,
        title=project.title,
        project_code=project.code,
        project_title=project.title,
        client_id=project.client_id,
        client_name=project.client_name,
        xml_standard=project.xml_standard or "",
        status=project.status,
        chapter_count=len(project.chapters),
        file_count=len(project.files),
        workflow_name=project.workflow_name,
        division_code=getattr(project, "division_code", None),
        customer_contact=getattr(project, "customer_contact", None),
        category=getattr(project, "category", None),
        composition=getattr(project, "composition", None),
        project_manager=getattr(project, "project_manager", None),
        sales_person=getattr(project, "sales_person", None),
        priority=getattr(project, "priority", None),
        edition=getattr(project, "edition", None),
        color=getattr(project, "color", None),
        trim_size=getattr(project, "trim_size", None),
        copyright_year=getattr(project, "copyright_year", None),
        manuscript_pages=getattr(project, "manuscript_pages", None),
        estimated_pages=getattr(project, "estimated_pages", None),
        actual_pages=getattr(project, "actual_pages", None),
        isbn_no=getattr(project, "isbn_no", None),
        billing_location=getattr(project, "billing_location", None),
        due_date=due,
        file_details=getattr(project, "file_details", None),
        created_at=cat,
        updated_at=uat,
    )


def _serialize_chapter_summary(chapter: models.Chapter):
    has_art = bool(getattr(chapter, "has_art", any(file.category == "Art" for file in chapter.files)))
    has_ms = bool(getattr(chapter, "has_ms", any(file.category == "Manuscript" for file in chapter.files)))
    has_ind = bool(getattr(chapter, "has_ind", any(file.category == "InDesign" for file in chapter.files)))
    has_proof = bool(
        getattr(chapter, "has_proof", any(file.category == "Proof" for file in chapter.files))
    )
    has_xml = bool(getattr(chapter, "has_xml", any(file.category == "XML" for file in chapter.files)))
    return schemas_v2.ChapterSummary(
        id=chapter.id,
        project_id=chapter.project_id,
        number=chapter.number,
        title=chapter.title,
        has_art=has_art,
        has_manuscript=has_ms,
        has_indesign=has_ind,
        has_proof=has_proof,
        has_xml=has_xml,
    )


def _serialize_lock(file_record: models.File):
    checked_out_by_username = None
    if file_record.checked_out_by is not None:
        checked_out_by_username = file_record.checked_out_by.username
    return schemas_v2.LockState(
        is_checked_out=file_record.is_checked_out,
        checked_out_by_id=file_record.checked_out_by_id,
        checked_out_by_username=checked_out_by_username,
        checked_out_at=file_record.checked_out_at,
    )


def _serialize_file_record(file_record: models.File, *, viewer: models.User):
    actions = list(_STANDARD_FILE_ACTIONS)
    if file_record.is_checked_out:
        if file_record.checked_out_by_id == viewer.id:
            actions.append("cancel_checkout")
    else:
        actions.append("checkout")
    if file_record.category == "Manuscript":
        actions.append("structuring_review")
    return schemas_v2.FileRecord(
        id=file_record.id,
        project_id=file_record.project_id,
        chapter_id=file_record.chapter_id,
        filename=file_record.filename,
        file_type=file_record.file_type,
        category=file_record.category,
        uploaded_at=file_record.uploaded_at,
        version=file_record.version,
        lock=_serialize_lock(file_record),
        available_actions=actions,
    )


def _build_category_counts(files: list[models.File]):
    counts = {
        "Art": 0,
        "Manuscript": 0,
        "InDesign": 0,
        "Proof": 0,
        "XML": 0,
        "Miscellaneous": 0,
    }
    for file_record in files:
        if file_record.category in counts:
            counts[file_record.category] += 1
        else:
            counts["Miscellaneous"] += 1
    return schemas_v2.ChapterCategoryCounts(**counts)


def _serialize_chapter_detail(chapter: models.Chapter, files: list[models.File]):
    summary = _serialize_chapter_summary(chapter)
    return schemas_v2.ChapterDetail(
        **summary.model_dump(),
        category_counts=_build_category_counts(files),
    )


def _exp_to_datetime(exp_value):
    if exp_value is None:
        return None
    try:
        return datetime.utcfromtimestamp(exp_value)
    except (TypeError, ValueError, OSError):
        return None


def _build_chapter_tab_redirect(file_record: models.File, message: str):
    return (
        f"/projects/{file_record.project_id}/chapter/{file_record.chapter_id}"
        f"?tab={file_record.category}&msg={message}"
    )


def _build_structuring_return_action(file_record: models.File):
    if file_record.project_id and file_record.chapter_id:
        return {
            "return_href": f"/projects/{file_record.project_id}/chapter/{file_record.chapter_id}?tab=Manuscript",
            "return_mode": "route",
        }
    if file_record.project_id:
        return {
            "return_href": f"/projects/{file_record.project_id}",
            "return_mode": "route",
        }
    return {"return_href": None, "return_mode": "history"}


def _serialize_upload_result(upload_result: dict, *, viewer: models.User):
    archive_entry = upload_result.get("archive_entry")
    archive_path = archive_entry.path if archive_entry else None
    archived_version_num = archive_entry.version_num if archive_entry else None
    return schemas_v2.UploadResultItem(
        file=_serialize_file_record(upload_result["file"], viewer=viewer),
        operation=upload_result["operation"],
        archive_path=archive_path,
        archived_version_num=archived_version_num,
    )


def _serialize_version_record(version_entry: models.FileVersion):
    return schemas_v2.VersionRecord(
        id=version_entry.id,
        file_id=version_entry.file_id,
        version_num=version_entry.version_num,
        archived_filename=version_service.get_archived_filename(version_entry),
        archived_path=version_entry.path,
        uploaded_at=version_entry.uploaded_at,
        uploaded_by_id=version_entry.uploaded_by_id,
    )


def _processing_check_permission(user, process_type: str):
    return processing_service.check_permission(user, process_type, logger=logger)


def _api_v2_background_processing_task(
    file_id: int,
    process_type: str,
    user_id: int,
    user_username: str,
    mode: str = "style",
    options: dict[str, Any] | None = None,
):
    return processing_service.background_processing_task(
        file_id=file_id,
        process_type=process_type,
        user_id=user_id,
        user_username=user_username,
        mode=mode,
        options=options,
        logger=logger,
        inject_publisher_styles_func=inject_publisher_styles,
        permissions_engine_cls=PermissionsEngine,
        ppd_engine_cls=PPDEngine,
        technical_engine_cls=TechnicalEngine,
        references_engine_cls=ReferencesEngine,
        structuring_engine_cls=StructuringEngine,
        bias_engine_cls=BiasEngine,
        ai_extractor_engine_cls=AIExtractorEngine,
        xml_engine_cls=XMLEngine,
    )


def _serialize_technical_issue(key: str, issue_data: dict[str, Any]):
    return schemas_v2.TechnicalIssue(
        key=key,
        label=issue_data.get("label", key),
        category=issue_data.get("category"),
        count=issue_data.get("count", 0),
        found=list(issue_data.get("found", [])),
        options=list(issue_data.get("options", [])),
    )


@router.post("/session/login", response_model=schemas_v2.SessionLoginResponse)
def api_v2_session_login(
    payload: schemas_v2.SessionLoginRequest,
    db: Session = Depends(database.get_db),
):
    try:
        auth_result = auth_service.authenticate_browser_user(db, payload.username, payload.password)
    except ValueError as exc:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="INVALID_CREDENTIALS",
            message=str(exc),
        )

    redirect_to = payload.redirect_to or "/dashboard"
    response_payload = schemas_v2.SessionLoginResponse(
        session=schemas_v2.SessionState(
            authenticated=True,
            auth_mode="cookie",
            expires_at=_exp_to_datetime(
                _decode_token_payload(auth_result["access_token"]).get("exp")
                if _decode_token_payload(auth_result["access_token"])
                else None
            ),
        ),
        viewer=_serialize_viewer(auth_result["user"]),
        redirect_to=redirect_to,
    )
    response = JSONResponse(status_code=status.HTTP_200_OK, content=response_payload.model_dump(mode="json"))
    session_service.set_access_token_cookie(response, auth_result["access_token"])
    return response


@router.post("/session/register", response_model=schemas_v2.SessionRegisterResponse)
def api_v2_session_register(
    payload: schemas_v2.SessionRegisterRequest,
    db: Session = Depends(database.get_db),
):
    try:
        registered_user = auth_service.register_browser_user(
            db,
            username=payload.username,
            email=payload.email,
            password=payload.password,
            confirm_password=payload.confirm_password,
        )
    except ValueError as exc:
        message = str(exc)
        code = "REGISTRATION_FAILED"
        field_errors = None
        if message == "Passwords do not match":
            code = "PASSWORD_MISMATCH"
            field_errors = {"confirm_password": message}
        elif message == "Username or email already exists":
            code = "DUPLICATE_USER"
            field_errors = {
                "username": message,
                "email": message,
            }
        return _error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            code=code,
            message=message,
            field_errors=field_errors,
        )

    return schemas_v2.SessionRegisterResponse(
        user=_serialize_viewer(registered_user),
        redirect_to=payload.redirect_to or "/ui/login",
    )


@router.get("/session", response_model=schemas_v2.SessionGetResponse)
def api_v2_get_session(
    request: Request,
    db: Session = Depends(database.get_db),
):
    user, auth_mode, exp_value = _resolve_session(request, db)
    if not user:
        return schemas_v2.SessionGetResponse(
            authenticated=False,
            viewer=None,
            auth=schemas_v2.SessionAuth(mode=None, expires_at=None),
        )

    return schemas_v2.SessionGetResponse(
        authenticated=True,
        viewer=_serialize_viewer(user),
        auth=schemas_v2.SessionAuth(mode=auth_mode, expires_at=_exp_to_datetime(exp_value)),
    )


@router.delete("/session", response_model=schemas_v2.SessionDeleteResponse)
def api_v2_delete_session():
    payload = schemas_v2.SessionDeleteResponse(redirect_to="/login")
    response = JSONResponse(status_code=status.HTTP_200_OK, content=payload.model_dump(mode="json"))
    session_service.clear_access_token_cookie(response)
    return response


@router.get("/dashboard", response_model=schemas_v2.DashboardResponse)
def api_v2_dashboard(
    include_projects: bool = True,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    page_data = dashboard_service.get_dashboard_page_data(db, skip=0, limit=100)
    projects = [_serialize_project_summary(project) for project in page_data["projects"]] if include_projects else []
    return schemas_v2.DashboardResponse(
        viewer=_serialize_viewer(viewer),
        stats=schemas_v2.DashboardStats(**page_data["dashboard_stats"]),
        projects=projects,
    )


@router.get("/projects", response_model=schemas_v2.ProjectsListResponse)
def api_v2_projects(
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    page_data = project_read_service.get_projects_page_data(db, skip=offset, limit=limit)
    total = db.query(models.Project).count()
    return schemas_v2.ProjectsListResponse(
        projects=[_serialize_project_summary(project) for project in page_data["projects"]],
        pagination=schemas_v2.ProjectsPagination(offset=offset, limit=limit, total=total),
    )


@router.get("/projects/client/{client_id}")
def api_v2_projects_by_client(
    client_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    from sqlalchemy import or_
    from app.domains.clients.models import Client as _Client

    # Resolve client name for fallback match (projects created before client_id FK was stored)
    client_obj = db.query(_Client).filter(_Client.id == client_id).first()
    client_name = client_obj.company if client_obj else None

    if client_name:
        projects = db.query(models.Project).filter(
            or_(
                models.Project.client_id == client_id,
                models.Project.client_name == client_name,
            )
        ).all()
    else:
        projects = db.query(models.Project).filter(models.Project.client_id == client_id).all()

    # Back-fill client_id on projects that matched by name only
    for p in projects:
        if p.client_id != client_id:
            p.client_id = client_id
    db.commit()

    return [_serialize_project_summary(p) for p in projects]


@router.get("/projects/{project_id}", response_model=schemas_v2.ProjectDetailResponse)
def api_v2_project_detail(
    project_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    page_data = project_read_service.get_project_chapters_page_data(db, project_id)
    project = page_data["project"]
    if not project:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROJECT_NOT_FOUND",
            message="Project not found.",
        )

    project_summary = _serialize_project_summary(project)
    return schemas_v2.ProjectDetailResponse(
        project=schemas_v2.ProjectDetail(
            **project_summary.model_dump(),
            chapters=[_serialize_chapter_summary(chapter) for chapter in page_data["chapters"]],
        )
    )


@router.get("/projects/{project_id}/chapters", response_model=schemas_v2.ProjectChaptersResponse)
def api_v2_project_chapters(
    project_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    page_data = project_read_service.get_project_chapters_page_data(db, project_id)
    project = page_data["project"]
    if not project:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROJECT_NOT_FOUND",
            message="Project not found.",
        )

    return schemas_v2.ProjectChaptersResponse(
        project=_serialize_project_summary(project),
        chapters=[_serialize_chapter_summary(chapter) for chapter in page_data["chapters"]],
    )


@router.get(
    "/projects/{project_id}/chapters/{chapter_id}",
    response_model=schemas_v2.ChapterDetailResponse,
)
def api_v2_chapter_detail(
    project_id: int,
    chapter_id: int,
    tab: str = "Manuscript",
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    page_data = project_read_service.get_chapter_detail_page_data(db, project_id, chapter_id)
    project = page_data["project"]
    chapter = page_data["chapter"]
    if not chapter or chapter.project_id != project_id or not project:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="CHAPTER_NOT_FOUND",
            message="Chapter not found.",
        )

    return schemas_v2.ChapterDetailResponse(
        project=_serialize_project_summary(project),
        chapter=_serialize_chapter_detail(chapter, page_data["files"]),
        active_tab=tab,
        viewer=_serialize_viewer(viewer),
    )


@router.get(
    "/projects/{project_id}/chapters/{chapter_id}/files",
    response_model=schemas_v2.ChapterFilesResponse,
)
def api_v2_chapter_files(
    project_id: int,
    chapter_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    page_data = project_read_service.get_chapter_detail_page_data(db, project_id, chapter_id)
    project = page_data["project"]
    chapter = page_data["chapter"]
    if not chapter or chapter.project_id != project_id or not project:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="CHAPTER_NOT_FOUND",
            message="Chapter not found.",
        )

    files = db.query(models.File).filter(models.File.chapter_id == chapter_id).all()
    return schemas_v2.ChapterFilesResponse(
        project=_serialize_project_summary(project),
        chapter=_serialize_chapter_detail(chapter, files),
        files=[_serialize_file_record(file_record, viewer=viewer) for file_record in files],
        viewer=_serialize_viewer(viewer),
    )


@router.get("/notifications", response_model=schemas_v2.NotificationsResponse)
def api_v2_notifications(
    limit: int = Query(5, ge=1),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    recent_files = db.query(models.File).order_by(models.File.uploaded_at.desc()).limit(limit).all()
    notifications = [
        schemas_v2.NotificationItem(
            id=f"file:{file_record.id}:upload",
            type="file_upload",
            title="File Uploaded",
            description=file_record.filename,
            relative_time=notification_service._format_relative_time(file_record.uploaded_at),
            icon="fa-file-upload",
            color="text-primary",
            file_id=file_record.id,
            project_id=file_record.project_id,
            chapter_id=file_record.chapter_id,
        )
        for file_record in recent_files
    ]
    return schemas_v2.NotificationsResponse(
        notifications=notifications,
        refreshed_at=now_ist_naive(),
    )


@router.get("/activities", response_model=schemas_v2.ActivitiesResponse)
def api_v2_activities(
    limit: int = Query(50, ge=1),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    activities, today_count = activity_service.get_recent_activities(db, file_limit=limit, version_limit=limit)
    activity_items = [
        schemas_v2.ActivityItem(
            id=f"activity:{activity['type']}:{index}",
            type=activity["type"],
            title=activity["title"],
            description=activity["description"],
            project=schemas_v2.ActivityEntityRef(title=activity["project"]),
            chapter=schemas_v2.ActivityEntityRef(title=activity["chapter"]),
            category=activity["category"],
            timestamp=activity["timestamp"],
            relative_time=activity["time"],
            icon=activity["icon"],
            color=activity["color"],
        )
        for index, activity in enumerate(activities[:limit], start=1)
    ]
    return schemas_v2.ActivitiesResponse(
        summary=schemas_v2.ActivitiesSummary(total=len(activity_items), today=today_count),
        activities=activity_items,
    )


@router.post("/projects/bootstrap", response_model=schemas_v2.ProjectBootstrapResponse)
def api_v2_project_bootstrap(
    code: str = Form(...),
    title: str = Form(...),
    client_id: int | None = Form(None),
    client_name: str | None = Form(None),
    xml_standard: str = Form(...),
    chapter_count: int = Form(...),
    workflow_name: str | None = Form(None),
    division_code: str | None = Form(None),
    customer_contact: str | None = Form(None),
    category: str | None = Form(None),
    composition: str | None = Form(None),
    project_manager: str | None = Form(None),
    sales_person: str | None = Form(None),
    priority: str | None = Form(None),
    edition: str | None = Form(None),
    color: str | None = Form(None),
    trim_size: str | None = Form(None),
    copyright_year: int | None = Form(None),
    manuscript_pages: int | None = Form(None),
    estimated_pages: int | None = Form(None),
    isbn_no: str | None = Form(None),
    billing_location: str | None = Form(None),
    due_date: str | None = Form(None),
    files: list[UploadFile] | None = FastAPIFile(None),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    if workflow_name:
        db_workflows = {w.workflow_name for w in db.query(models.WorkflowMaster).all()}
        if workflow_name not in db_workflows and workflow_name not in _WORKFLOW_TYPE_IDS:
            return _error_response(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="INVALID_WORKFLOW_TYPE",
                message=f"Unknown workflow type: {workflow_name}",
            )

    try:
        project = project_service.create_project_with_initial_files(
            db,
            code=code,
            title=title,
            client_name=client_name,
            xml_standard=xml_standard,
            chapter_count=chapter_count,
            files=files,
            upload_dir=file_service.UPLOAD_DIR,
        )
    except project_service.ProjectBootstrapValidationError as exc:
        logging.error(f"Project bootstrap validation error: {str(exc)}")
        return _error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="PROJECT_BOOTSTRAP_VALIDATION_ERROR",
            message=str(exc),
        )
    except Exception as exc:
        logging.error(f"Project bootstrap error: {type(exc).__name__}: {str(exc)}", exc_info=True)
        return _error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="PROJECT_BOOTSTRAP_ERROR",
            message=str(exc),
        )

    chapters = (
        db.query(models.Chapter)
        .filter(models.Chapter.project == project.project_code)
        .order_by(models.Chapter.chapters.asc())
        .all()
    )
    ingested_files = (
        db.query(models.File)
        .filter(models.File.project_id == project.id)
        .order_by(models.File.id.asc())
        .all()
    )
    if workflow_name:
        project.workflow_name = workflow_name

    if client_id is not None:
        project.client_id = client_id
        from app.domains.clients.models import Client as _Client
        c = db.query(_Client).filter(_Client.id == client_id).first()
        if c:
            project.client_name = c.company

    for _f in ("division_code", "customer_contact", "category", "composition",
               "project_manager", "sales_person", "priority", "edition", "color",
               "trim_size", "copyright_year", "manuscript_pages", "estimated_pages",
               "isbn_no", "billing_location"):
        _v = locals().get(_f)
        if _v is not None:
            setattr(project, _f, _v)

    if due_date:
        try:
            from datetime import date as _date
            project.due_date = _date.fromisoformat(due_date)
        except ValueError:
            pass

    db.commit()
    db.refresh(project)

    # Sync CMS chapters → WMS ChapterInfo records so planning page has data
    from app.domains.workflow.models import ChapterInfo as _ChapterInfo
    _existing_ci = {
        ci.chapters for ci in db.query(_ChapterInfo).filter(_ChapterInfo.project == project.code).all()
    }
    for _ch in chapters:
        if _ch.number and _ch.number not in _existing_ci:
            db.add(_ChapterInfo(
                client=project.client_name or "",
                project=project.code,
                chapters=_ch.number,
                chapter_title=_ch.title or f"Chapter {_ch.number}",
                workflow=project.workflow_name or "",
                status="Received",
                complexity_level=getattr(project, "composition", None) or "Medium",
                stage_level=1,
                published_status="Draft",
                priority=getattr(project, "priority", None) or "Normal",
                project_manager_name=getattr(project, "project_manager", None) or None,
            ))
            _existing_ci.add(_ch.number)
    db.commit()

    return schemas_v2.ProjectBootstrapResponse(
        project=_serialize_project_summary(project),
        chapters=[_serialize_chapter_summary(chapter) for chapter in chapters],
        ingested_files=[_serialize_file_record(file_record, viewer=viewer) for file_record in ingested_files],
        redirect_to="/dashboard",
    )


@router.put("/projects/{project_id}", response_model=schemas_v2.ProjectSummary)
def api_v2_update_project(
    project_id: int,
    payload: schemas_v2.ProjectUpdateRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROJECT_NOT_FOUND",
            message="Project not found.",
        )

    if payload.status is not None:
        project.status = payload.status
    if payload.workflow_name is not None:
        project.workflow_name = payload.workflow_name
    if payload.client_id is not None:
        project.client_id = payload.client_id
        from app.domains.clients.models import Client as _Client
        c = db.query(_Client).filter(_Client.id == payload.client_id).first()
        if c:
            project.client_name = c.company

    for _f in ("project_manager", "priority", "composition", "category", "edition",
               "color", "trim_size", "copyright_year", "actual_pages", "division_code",
               "customer_contact", "sales_person", "isbn_no", "billing_location"):
        _v = getattr(payload, _f, None)
        if _v is not None:
            setattr(project, _f, _v)

    if payload.due_date is not None:
        if payload.due_date:
            try:
                from datetime import date as _date
                project.due_date = _date.fromisoformat(payload.due_date)
            except ValueError:
                pass
        else:
            project.due_date = None

    db.commit()
    db.refresh(project)

    # Update related chapter_details in workflow schema if they exist
    from app.domains.workflow.models import ChapterInfo, StageDetail
    from datetime import datetime

    update_dict = {}
    if payload.project_manager is not None:
        update_dict[ChapterInfo.project_manager_name] = payload.project_manager
    if payload.priority is not None:
        update_dict[ChapterInfo.priority] = payload.priority
    if payload.due_date is not None:
        if payload.due_date:
            try:
                update_dict[ChapterInfo.due_date] = datetime.fromisoformat(payload.due_date.replace("Z", "+00:00"))
            except ValueError:
                pass
        else:
            update_dict[ChapterInfo.due_date] = None

    if update_dict:
        db.query(ChapterInfo).filter(ChapterInfo.project == project.code).update(update_dict, synchronize_session=False)
        db.commit()

    if payload.project_manager is not None:
        db.query(StageDetail).filter(StageDetail.project == project.code).update({
            StageDetail.project_manager_name: payload.project_manager
        }, synchronize_session=False)
        db.commit()

    return _serialize_project_summary(project)


@router.delete("/projects/{project_id}", response_model=schemas_v2.ProjectDeleteResponse)
def api_v2_delete_project(
    project_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    project = project_service.delete_project_with_filesystem(
        db,
        project_id=project_id,
        upload_dir=file_service.UPLOAD_DIR,
    )
    if not project:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROJECT_NOT_FOUND",
            message="Project not found.",
        )

    return schemas_v2.ProjectDeleteResponse(
        deleted=schemas_v2.ProjectDeleteInfo(
            project_id=project.id,
            code=project.code,
            db_cleanup=True,
            filesystem_cleanup=True,
        ),
        redirect_to="/dashboard?msg=Book+Deleted",
    )


@router.put("/projects/{project_id}/workflow", response_model=schemas_v2.ProjectWorkflowUpdateResponse)
def api_v2_update_project_workflow(
    project_id: int,
    payload: schemas_v2.ProjectWorkflowUpdateRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROJECT_NOT_FOUND",
            message="Project not found.",
        )

    if payload.workflow_name is not None:
        db_workflows = {w.workflow_name for w in db.query(models.WorkflowMaster).all()}
        if payload.workflow_name not in db_workflows and payload.workflow_name not in _WORKFLOW_TYPE_IDS:
            return _error_response(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="INVALID_WORKFLOW_TYPE",
                message=f"Unknown workflow type: {payload.workflow_name}",
            )

    # Setting a workflow name
    if payload.workflow_name is not None:
        project.workflow_name = payload.workflow_name

    db.commit()
    db.refresh(project)
    return schemas_v2.ProjectWorkflowUpdateResponse(project=_serialize_project_summary(project))


@router.post("/projects/{project_id}/chapters", response_model=schemas_v2.ChapterCreateResponse)
def api_v2_create_chapter(
    project_id: int,
    payload: schemas_v2.ChapterCreateRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    result = chapter_service.create_chapter(
        db,
        project_id=project_id,
        number=payload.number,
        title=payload.title,
        upload_dir=file_service.UPLOAD_DIR,
    )
    if not result["project"]:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROJECT_NOT_FOUND",
            message="Project not found.",
        )

    return schemas_v2.ChapterCreateResponse(
        chapter=_serialize_chapter_summary(result["chapter"]),
        redirect_to=f"/projects/{project_id}?msg=Chapter+Created+Successfully",
    )


@router.patch("/projects/{project_id}/chapters/{chapter_id}", response_model=schemas_v2.ChapterRenameResponse)
def api_v2_rename_chapter(
    project_id: int,
    chapter_id: int,
    payload: schemas_v2.ChapterRenameRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    original_chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    previous_number = original_chapter.number if original_chapter else ""
    result = chapter_service.rename_chapter(
        db,
        project_id=project_id,
        chapter_id=chapter_id,
        number=payload.number,
        title=payload.title,
        upload_dir=file_service.UPLOAD_DIR,
    )
    if not result["project"] or not result["chapter"]:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="CHAPTER_OR_PROJECT_NOT_FOUND",
            message="Chapter or project not found.",
        )

    return schemas_v2.ChapterRenameResponse(
        chapter=_serialize_chapter_summary(result["chapter"]),
        previous_number=previous_number,
        redirect_to=f"/projects/{project_id}?msg=Chapter+Renamed+Successfully",
    )


@router.delete("/projects/{project_id}/chapters/{chapter_id}", response_model=schemas_v2.ChapterDeleteResponse)
def api_v2_delete_chapter(
    project_id: int,
    chapter_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    chapter_number = chapter.number if chapter else ""
    result = chapter_service.delete_chapter_primary(
        db,
        project_id=project_id,
        chapter_id=chapter_id,
        upload_dir=file_service.UPLOAD_DIR,
    )
    if not result["project"] or not result["chapter"]:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="CHAPTER_OR_PROJECT_NOT_FOUND",
            message="Chapter or project not found.",
        )

    return schemas_v2.ChapterDeleteResponse(
        deleted=schemas_v2.ChapterDeleteInfo(
            project_id=project_id,
            chapter_id=chapter_id,
            chapter_number=chapter_number,
        ),
        redirect_to=f"/projects/{project_id}?msg=Chapter+Deleted+Successfully",
    )


# ─────────────────────────────────────────────────────────────────────────────
# STYLESHEET ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/ia-template", response_model=schemas_v2.IATemplateResponse)
def api_v2_ia_template(
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )
    # pyrefly: ignore [missing-import]
    from app.data.ia_template_rows import IA_TEMPLATE_ROWS
    return schemas_v2.IATemplateResponse(
        rows=[
            schemas_v2.IATemplateRow(
                element=row[0], subtype=row[1], pattern=row[2], example=row[3]
            )
            for row in IA_TEMPLATE_ROWS
        ]
    )


@router.get(
    "/projects/{project_id}/stylesheets",
    response_model=schemas_v2.StylesheetsListResponse,
)
def api_v2_list_stylesheets(
    project_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROJECT_NOT_FOUND",
            message="Project not found.",
        )
    result = stylesheet_service.get_stylesheets_for_project(db, project_id=project_id)
    serialized = [stylesheet_service._serialize_stylesheet(s) for s in result["stylesheets"]]
    active = stylesheet_service._serialize_stylesheet(result["active"]) if result["active"] else None
    return schemas_v2.StylesheetsListResponse(
        project_id=project_id,
        stylesheets=serialized,
        active_stylesheet=active,
    )


@router.post(
    "/projects/{project_id}/stylesheets",
    response_model=schemas_v2.StylesheetCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def api_v2_create_stylesheet(
    project_id: int,
    payload: schemas_v2.StylesheetCreateRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROJECT_NOT_FOUND",
            message="Project not found.",
        )
    ss = stylesheet_service.create_stylesheet(
        db,
        project_id=project_id,
        name=payload.name,
        description=payload.description,
        selected_ia_rows=payload.selected_ia_rows,
        created_by_id=viewer.id,
        analyzed_file_ids=payload.analyzed_file_ids,
    )
    return schemas_v2.StylesheetCreateResponse(
        stylesheet=stylesheet_service._serialize_stylesheet(ss)
    )


@router.patch(
    "/projects/{project_id}/stylesheets/{stylesheet_id}",
    response_model=schemas_v2.StylesheetUpdateResponse,
)
def api_v2_update_stylesheet(
    project_id: int,
    stylesheet_id: int,
    payload: schemas_v2.StylesheetUpdateRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )
    ss = stylesheet_service.update_stylesheet(
        db,
        stylesheet_id=stylesheet_id,
        project_id=project_id,
        name=payload.name,
        description=payload.description,
        selected_ia_rows=payload.selected_ia_rows,
        analyzed_file_ids=payload.analyzed_file_ids,
    )
    if not ss:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="STYLESHEET_NOT_FOUND",
            message="Stylesheet not found.",
        )
    return schemas_v2.StylesheetUpdateResponse(
        stylesheet=stylesheet_service._serialize_stylesheet(ss)
    )


@router.delete(
    "/projects/{project_id}/stylesheets/{stylesheet_id}",
    response_model=schemas_v2.StylesheetDeleteResponse,
)
def api_v2_delete_stylesheet(
    project_id: int,
    stylesheet_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )
    deleted = stylesheet_service.delete_stylesheet(
        db, stylesheet_id=stylesheet_id, project_id=project_id
    )
    if not deleted:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="STYLESHEET_NOT_FOUND",
            message="Stylesheet not found.",
        )
    return schemas_v2.StylesheetDeleteResponse(deleted_id=stylesheet_id)


@router.post(
    "/projects/{project_id}/stylesheets/{stylesheet_id}/activate",
    response_model=schemas_v2.StylesheetActivateResponse,
)
def api_v2_activate_stylesheet(
    project_id: int,
    stylesheet_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )
    result = stylesheet_service.activate_stylesheet(
        db, stylesheet_id=stylesheet_id, project_id=project_id
    )
    if not result:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="STYLESHEET_NOT_FOUND",
            message="Stylesheet not found.",
        )
    return schemas_v2.StylesheetActivateResponse(**result)


@router.post(
    "/projects/{project_id}/analyze-files-for-stylesheet",
    response_model=schemas_v2.AnalyzeFilesForStylesheetResponse,
)
def api_v2_analyze_files_for_stylesheet(
    project_id: int,
    payload: schemas_v2.AnalyzeFilesRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    logger.info(f"Analyze files endpoint called with project_id={project_id}, file_ids={payload.file_ids}")
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    # Validate project exists
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROJECT_NOT_FOUND",
            message="Project not found.",
        )

    try:
        _processing_check_permission(viewer, "technical")
    except HTTPException as exc:
        return _error_response(
            status_code=exc.status_code,
            code="PERMISSION_DENIED",
            message="Permission denied.",
        )

    # Validate all files belong to the project
    file_ids = payload.file_ids
    if not file_ids:
        return schemas_v2.AnalyzeFilesForStylesheetResponse(
            analyzed_files=[],
            triggered_rules=[],
            total_findings=0,
        )

    files = db.query(models.File).filter(
        models.File.id.in_(file_ids),
        models.File.project_id == project_id,
    ).all()

    if len(files) != len(file_ids):
        return _error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_FILE_IDS",
            message="Some file IDs do not belong to this project.",
        )

    # Run analysis on each file and aggregate findings
    all_findings = []
    analyzed_files = []

    for file_record in files:
        try:
            raw_scan = technical_editor_service.scan_errors(
                db,
                file_id=file_record.id,
                logger=logger,
                technical_editor_cls=TechnicalEditor,
            )
            findings = raw_scan.get("findings", [])
            all_findings.extend(findings)
            analyzed_files.append({"id": file_record.id, "filename": file_record.filename})
        except Exception as e:
            logger.error(f"Failed to analyze file {file_record.id}: {e}")
            continue

    # Aggregate findings by IA rule
    triggered_rules_map = {}  # key: (element, subtype, pattern), value: {count, example_surfaces}

    try:
        from manuscript_core.ia_mapping import RULE_ID_TO_IA
    except ImportError:
        RULE_ID_TO_IA = {}

    for finding in all_findings:
        rule_id = finding.get("rule_id")
        if rule_id and rule_id in RULE_ID_TO_IA:
            ia_row = RULE_ID_TO_IA[rule_id]
            # ia_row should be a tuple (element, subtype, pattern) or similar
            if isinstance(ia_row, (tuple, list)) and len(ia_row) >= 3:
                key = (ia_row[0], ia_row[1], ia_row[2])
                if key not in triggered_rules_map:
                    triggered_rules_map[key] = {"count": 0, "example_surfaces": []}
                triggered_rules_map[key]["count"] += 1
                # Collect up to 3 example surfaces
                surface = finding.get("surface", "")
                if surface and len(triggered_rules_map[key]["example_surfaces"]) < 3:
                    triggered_rules_map[key]["example_surfaces"].append(surface)

    # Convert to list of TriggeredIARule, sorted by count DESC
    triggered_rules = [
        schemas_v2.TriggeredIARule(
            element=key[0],
            subtype=key[1],
            pattern=key[2],
            count=data["count"],
            example_surfaces=data["example_surfaces"],
        )
        for key, data in triggered_rules_map.items()
    ]
    triggered_rules.sort(key=lambda x: x.count, reverse=True)

    return schemas_v2.AnalyzeFilesForStylesheetResponse(
        analyzed_files=analyzed_files,
        triggered_rules=triggered_rules,
        total_findings=len(all_findings),
    )



@router.get("/files/{file_id}/download")
def api_v2_download_file(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    file_record = file_service.get_file_for_download(db, file_id=file_id)
    if not file_record:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="FILE_NOT_FOUND",
            message="File not found.",
        )

    return FileResponse(
        path=file_record.path,
        filename=file_record.filename,
        media_type="application/octet-stream",
    )


@router.delete("/files/{file_id}", response_model=schemas_v2.FileDeleteResponse)
def api_v2_delete_file(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="FILE_NOT_FOUND",
            message="File not found.",
        )

    deleted_info = schemas_v2.FileDeleteInfo(
        file_id=file_record.id,
        filename=file_record.filename,
        category=file_record.category,
        project_id=file_record.project_id,
        chapter_id=file_record.chapter_id,
    )
    redirect_to = (
        f"/projects/{file_record.project_id}/chapter/{file_record.chapter_id}"
        f"?tab={file_record.category}&msg=File+Deleted"
    )
    file_service.delete_file_and_capture_context(db, file_id=file_id)
    return schemas_v2.FileDeleteResponse(deleted=deleted_info, redirect_to=redirect_to)


@router.post("/files/{file_id}/checkout", response_model=schemas_v2.FileCheckoutResponse)
def api_v2_checkout_file(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="FILE_NOT_FOUND",
            message="File not found.",
        )

    result = checkout_service.checkout_file(db, file_record=file_record, actor_user_id=viewer.id)
    if result["status"] == "locked_by_other":
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="LOCKED_BY_OTHER",
            message="File locked by other user.",
            details={"checked_out_by_id": file_record.checked_out_by_id},
        )

    db.refresh(file_record)
    return schemas_v2.FileCheckoutResponse(
        file_id=file_record.id,
        lock=_serialize_lock(file_record),
        redirect_to=_build_chapter_tab_redirect(file_record, "File+Checked+Out"),
    )


@router.delete("/files/{file_id}/checkout", response_model=schemas_v2.FileCheckoutResponse)
def api_v2_cancel_checkout(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="FILE_NOT_FOUND",
            message="File not found.",
        )

    checkout_service.cancel_checkout(db, file_record=file_record, actor_user_id=viewer.id)
    db.refresh(file_record)
    return schemas_v2.FileCheckoutResponse(
        file_id=file_record.id,
        lock=_serialize_lock(file_record),
        redirect_to=_build_chapter_tab_redirect(file_record, "Checkout+Cancelled"),
    )


@router.post(
    "/projects/{project_id}/chapters/{chapter_id}/files/upload",
    response_model=schemas_v2.FileUploadResponse,
)
def api_v2_upload_chapter_files(
    project_id: int,
    chapter_id: int,
    category: str = Form(...),
    files: list[UploadFile] = FastAPIFile(...),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    upload_result = file_service.upload_chapter_files(
        db,
        project_id=project_id,
        chapter_id=chapter_id,
        category=category,
        files=files,
        actor_user_id=viewer.id,
        upload_dir=file_service.UPLOAD_DIR,
    )
    if not upload_result["project"] or not upload_result["chapter"]:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROJECT_OR_CHAPTER_NOT_FOUND",
            message="Project or chapter not found.",
        )

    return schemas_v2.FileUploadResponse(
        uploaded=[_serialize_upload_result(item, viewer=viewer) for item in upload_result["uploaded"]],
        skipped=[schemas_v2.UploadSkippedItem(**item) for item in upload_result["skipped"]],
        redirect_to=(
            f"/projects/{project_id}/chapter/{chapter_id}?tab={category}&msg=Files+Uploaded+Successfully"
        ),
    )


@router.post(
    "/uploads/{customer_code}/{project_code}",
    response_model=schemas_v2.UploadZipResponse,
)
def api_v2_upload_zip(
    customer_code: str,
    project_code: str,
    project_id: int = Form(...),
    file: UploadFile = FastAPIFile(...),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROJECT_NOT_FOUND",
            message="Project not found.",
        )

    temp_dir = tempfile.mkdtemp()
    try:
        zip_path = os.path.join(temp_dir, file.filename)
        with open(zip_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        zip_archive_dir = os.path.join(file_service.UPLOAD_DIR, project.code)
        os.makedirs(zip_archive_dir, exist_ok=True)
        zip_archive_path = os.path.join(zip_archive_dir, f"{project.code}_manuscript.zip")
        shutil.copy2(zip_path, zip_archive_path)

        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(temp_dir)

        import re
        def extract_chapter_number(name: str) -> str | None:
            name_lower = name.lower()
            m = re.search(r'(?:chapter|chap|ch)[_\s-]*(\d+)', name_lower)
            if m:
                return f"{int(m.group(1)):02d}"
            base = os.path.splitext(os.path.basename(name))[0]
            m = re.match(r'^(\d+)', base)
            if m:
                return f"{int(m.group(1)):02d}"
            m = re.search(r'(\d+)$', base)
            if m:
                return f"{int(m.group(1)):02d}"
            m = re.search(r'(\d+)', base)
            if m:
                return f"{int(m.group(1)):02d}"
            return None

        def determine_category_and_type(name: str) -> tuple[str, str]:
            ext = name.split(".")[-1].lower() if "." in name else ""
            if ext in ["xml", "html", "xhtml"]:
                return "XML", ext
            elif ext in ["png", "jpg", "jpeg", "gif", "tiff", "tif", "svg", "eps"]:
                return "Art", ext
            elif ext in ["indd"]:
                return "InDesign", ext
            elif ext in ["pdf"] and "proof" in name.lower():
                return "Proof", ext
            else:
                return "Manuscript", ext

        chapters_list = []
        images_list = []
        xml_list = []
        docs_list = []
        
        initial_chapters_count = db.query(models.Chapter).filter(models.Chapter.project == project.project_code).count()

        for root, _, filenames in os.walk(temp_dir):
            for fname in filenames:
                if fname == file.filename or "__MACOSX" in root or fname.startswith("."):
                    continue

                full_path = os.path.join(root, fname)
                rel_path = os.path.relpath(full_path, temp_dir)
                category, ext = determine_category_and_type(fname)

                chapter_no_str = extract_chapter_number(fname)
                if not chapter_no_str:
                    path_parts = rel_path.replace("\\", "/").split("/")
                    for part in path_parts[:-1]:
                        chapter_no_str = extract_chapter_number(part)
                        if chapter_no_str:
                            break

                chapter = None
                if chapter_no_str:
                    chapter = db.query(models.Chapter).filter(
                        models.Chapter.project == project.project_code,
                        models.Chapter.chapters == chapter_no_str,
                    ).first()
                    if not chapter:
                        chapter = models.Chapter(
                            client=project.client_name or "",
                            project=project.project_code,
                            chapters=chapter_no_str,
                            chapter_title=f"Chapter {chapter_no_str}",
                            workflow=project.workflow_name or "",
                            status="Received",
                            complexity_level=getattr(project, "composition", None) or "Medium",
                            stage_level=1,
                            published_status="Draft",
                            priority=getattr(project, "priority", None) or "Normal",
                        )
                        db.add(chapter)
                        db.commit()
                        db.refresh(chapter)


                if chapter:
                    dest_dir = os.path.join(file_service.UPLOAD_DIR, project.code, chapter.chapters, category)
                else:
                    dest_dir = os.path.join(file_service.UPLOAD_DIR, project.code, "project_files", category)

                os.makedirs(dest_dir, exist_ok=True)
                dest_path = os.path.join(dest_dir, fname)
                shutil.copy2(full_path, dest_path)

                existing_file = db.query(models.File).filter(
                    models.File.project_id == project.id,
                    models.File.chapter_id == (chapter.id if chapter else None),
                    models.File.category == category,
                    models.File.filename == fname,
                ).first()

                if existing_file:
                    version_service.archive_existing_file(
                        db,
                        existing_file=existing_file,
                        base_path=dest_dir,
                        uploaded_by_id=viewer.id,
                    )
                    existing_file.version += 1
                    existing_file.uploaded_at = now_ist_naive()
                    checkout_service.reset_checkout_after_overwrite(existing_file)
                else:
                    db_file = models.File(
                        project_id=project.id,
                        chapter_id=chapter.id if chapter else None,
                        filename=fname,
                        file_type=ext,
                        category=category,
                        path=dest_path,
                        version=1,
                        uploaded_at=now_ist_naive(),
                    )
                    db.add(db_file)

                file_entry = {"file_name": fname, "path": dest_path}
                if category == "Art":
                    images_list.append(schemas_v2.UploadZipFileEntry(**file_entry))
                elif category == "XML":
                    xml_list.append(schemas_v2.UploadZipFileEntry(**file_entry))
                elif category == "Manuscript":
                    docs_list.append(schemas_v2.UploadZipFileEntry(**file_entry))
                elif category == "Proof" or category == "InDesign":
                    docs_list.append(schemas_v2.UploadZipFileEntry(**file_entry))

                if chapter_no_str:
                    chapter_no_int = int(chapter_no_str)
                    chapters_list.append(
                        schemas_v2.UploadZipChapterEntry(
                            chapter_no=chapter_no_int,
                            file_name=fname,
                            path=dest_path,
                        )
                    )

        db.commit()

        # Sync: ensure every CMS chapter has a matching WMS ChapterInfo record
        from app.domains.workflow.models import ChapterInfo as _ChapterInfo
        all_cms_chapters = db.query(models.Chapter).filter(models.Chapter.project == project.project_code).all()
        existing_ci_nums = {
            ci.chapters for ci in db.query(_ChapterInfo).filter(_ChapterInfo.project == project.code).all()
        }
        for _ch in all_cms_chapters:
            if _ch.chapters and _ch.chapters not in existing_ci_nums:
                db.add(_ChapterInfo(
                    client=project.client_name or "",
                    project=project.code,
                    chapters=_ch.chapters,
                    chapter_title=_ch.chapter_title or f"Chapter {_ch.chapters}",
                    workflow=project.workflow_name or "",
                    status="Received",
                    complexity_level=getattr(project, "composition", None) or "Medium",
                    stage_level=1,
                    published_status="Draft",
                    priority=getattr(project, "priority", None) or "Normal",
                    project_manager_name=getattr(project, "project_manager", None) or None,
                ))
                existing_ci_nums.add(_ch.chapters)
        db.commit()

        final_chapters_count = db.query(models.Chapter).filter(models.Chapter.project == project.project_code).count()
        chapters_inserted = final_chapters_count - initial_chapters_count
        unique_extracted_chapters = len({c.chapter_no for c in chapters_list if c.chapter_no is not None})

        return schemas_v2.UploadZipResponse(
            zip_path=zip_archive_path,
            extracted_path=os.path.abspath(zip_archive_dir),
            total_chapters=unique_extracted_chapters,
            chapters=chapters_list,
            images=images_list,
            xml=xml_list,
            docs=docs_list,
            chapters_inserted=chapters_inserted,
        )

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.get("/files/{file_id}/editor")
def api_v2_file_editor(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Return Collabora editor URL for a file."""
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )
    import logging as _logging
    _logging.getLogger("app.editor").warning(f"EDITOR_DEBUG: viewer={viewer}, file_id={file_id}")
    from app.models import File as _File
    _test = db.query(_File).filter(_File.id == file_id).first()
    _logging.getLogger("app.editor").warning(f"EDITOR_DEBUG: direct_query={_test}, path={_test.path if _test else None}")
    from fastapi import HTTPException as _HTTPException
    try:
        page_state = wopi_service.build_editor_page_state(
            db,
            file_id=file_id,
            collabora_public_url=COLLABORA_PUBLIC_URL,
            wopi_base_url=WOPI_BASE_URL,
        )
        return {"collabora_url": page_state["collabora_url"], "filename": page_state["filename"]}
    except _HTTPException:
        raise
    except Exception as e:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="FILE_NOT_FOUND",
            message=str(e),
        )

@router.get("/files/{file_id}/onlyoffice-config")
def api_v2_onlyoffice_config(
    file_id: int,
    mode: str = "original",
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="FILE_NOT_FOUND",
            message="File not found.",
        )

    file_path, filename = wopi_service.get_target_path(file_record, mode=mode)
    if not os.path.exists(file_path):
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="FILE_NOT_FOUND",
            message="Physical file not found.",
        )

    # Compute key
    import hashlib
    with open(file_path, "rb") as f:
        version_key = hashlib.sha256(f.read()).hexdigest()[:16]

    # Document download URL (OnlyOffice container must reach this)
    if mode == "structuring":
        doc_url = f"{WOPI_BASE_URL}/wopi/files/{file_id}/structuring/contents"
    else:
        doc_url = f"{WOPI_BASE_URL}/wopi/files/{file_id}/contents"

    callback_url = f"{WOPI_BASE_URL}/api/v2/onlyoffice/callback/{file_id}?mode={mode}"

    config = {
        "document": {
            "fileType": "docx",
            "key": version_key,
            "title": filename,
            "url": doc_url,
        },
        "documentType": "word",
        "editorConfig": {
            "mode": "edit",
            "callbackUrl": callback_url,
            "user": {
                "id": str(viewer.id),
                "name": viewer.username,
            },
            "lang": "en",
            "customization": {
                "autosave": True,
                "chat": False,
                "comments": True,
                "compactHeader": True,
                "compactToolbar": True,
                "feedback": {"url": ""},
                "forcesave": True,
                "help": False,
                "plugins": False,
                "goback": {"url": ""},
            },
        },
    }

    if ONLYOFFICE_JWT_ENABLED:
        config["token"] = sign_config(config)

    return {
        "config": config,
        "onlyoffice_public_url": ONLYOFFICE_PUBLIC_URL,
    }

@router.post("/onlyoffice/callback/{file_id}")
async def api_v2_onlyoffice_callback(
    file_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    mode: str = "original",
    db: Session = Depends(database.get_db),
):
    body = await request.json()
    
    # Verify JWT if enabled
    verified_body = verify_callback_token(dict(request.headers), body)
    if verified_body is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid JWT signature in OnlyOffice callback.",
        )
        
    status_code = verified_body.get("status")
    if status_code in (2, 6):
        download_url = verified_body.get("url")
        if not download_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Download URL missing in OnlyOffice callback.",
            )
            
        import requests
        try:
            response = requests.get(download_url, timeout=30)
            response.raise_for_status()
            docx_bytes = response.content
        except Exception as e:
            logger.error(f"Failed to download edited file from OnlyOffice: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to download edited file: {str(e)}",
            )
            
        # Re-use wopi_service.write_file_bytes
        wopi_service.write_file_bytes(
            db,
            file_id=file_id,
            mode=mode,
            body=docx_bytes,
            logger=logger,
        )
        
        # Trigger background task for XHTML regeneration if in structuring mode
        if mode == "structuring":
            from app.integrations.wopi.router import _regen_xhtml_background
            background_tasks.add_task(_regen_xhtml_background, file_id=file_id)

    return {"error": 0}

@router.get("/files/{file_id}/versions", response_model=schemas_v2.FileVersionsResponse)
def api_v2_file_versions(
    file_id: int,
    limit: int = Query(50, ge=1),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="FILE_NOT_FOUND",
            message="File not found.",
        )

    versions = version_service.get_versions_for_file(db, file_id=file_id, limit=limit)
    return schemas_v2.FileVersionsResponse(
        file=schemas_v2.FileVersionsFile(
            id=file_record.id,
            filename=file_record.filename,
            current_version=file_record.version,
        ),
        versions=[_serialize_version_record(version_entry) for version_entry in versions],
    )


@router.get("/files/{file_id}/versions/{version_id}/download")
def api_v2_download_file_version(
    file_id: int,
    version_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )

    version_entry = version_service.get_version_for_download(db, file_id=file_id, version_id=version_id)
    if not version_entry:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="VERSION_NOT_FOUND",
            message="Version not found.",
        )

    return FileResponse(
        path=version_entry.path,
        filename=version_service.get_archived_filename(version_entry),
        media_type="application/octet-stream",
    )


@router.post("/files/{file_id}/processing-jobs", response_model=schemas_v2.ProcessingStartResponse)
def api_v2_start_processing(
    file_id: int,
    payload: schemas_v2.ProcessingStartRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    try:
        response = processing_service.start_process(
            db,
            file_id=file_id,
            process_type=payload.process_type,
            background_tasks=background_tasks,
            mode=payload.mode,
            user=viewer,
            upload_dir=file_service.UPLOAD_DIR,
            logger=logger,
            background_task_callable=_api_v2_background_processing_task,
            options=payload.options,
        )
    except HTTPException as exc:
        code = "PROCESSING_START_FAILED"
        if exc.status_code == 401:
            code = "AUTH_REQUIRED"
        elif exc.status_code == 403:
            code = "PERMISSION_DENIED"
        elif exc.status_code == 404:
            code = "FILE_NOT_FOUND"
        elif exc.status_code == 400:
            code = "FILE_LOCKED"
        return _error_response(
            status_code=exc.status_code,
            code=code,
            message=str(exc.detail),
        )

    _ = response  # side effects already performed by the service
    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    return schemas_v2.ProcessingStartResponse(
        message=(
            f"{payload.process_type.capitalize()} started in background. "
            "The file is locked and will be updated shortly."
        ),
        source_file_id=file_id,
        process_type=payload.process_type,
        mode=payload.mode,
        source_version=file_record.version,
        lock=_serialize_lock(file_record),
        status_endpoint=(
            f"/api/v2/files/{file_id}/processing-status?process_type=structuring"
            if payload.process_type == "structuring"
            else None
        ),
    )


@router.get("/files/{file_id}/processing-status", response_model=schemas_v2.ProcessingStatusResponse)
def api_v2_processing_status(
    file_id: int,
    process_type: str = "structuring",
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    if process_type not in ("structuring", "reference_validation", "reference_structuring"):
        return _error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="STATUS_UNSUPPORTED",
            message="Only structuring, reference_validation and reference_structuring statuses are currently supported.",
        )

    try:
        if process_type in ("reference_validation", "reference_structuring"):
            status_payload = processing_service.get_reference_validation_status(db, file_id=file_id, user=viewer)
        else:
            status_payload = processing_service.get_structuring_status(db, file_id=file_id, user=viewer)
    except HTTPException as exc:
        code = "PROCESSING_STATUS_FAILED"
        if exc.status_code == 401:
            code = "AUTH_REQUIRED"
        elif exc.status_code == 404:
            code = "FILE_NOT_FOUND"
        return _error_response(
            status_code=exc.status_code,
            code=code,
            message=str(exc.detail),
        )

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    derived_file_id = status_payload.get("new_file_id")
    derived_filename = None
    if derived_file_id is not None:
        derived_file = db.query(models.File).filter(models.File.id == derived_file_id).first()
        if derived_file:
            derived_filename = derived_file.filename

    return schemas_v2.ProcessingStatusResponse(
        status=status_payload["status"],
        source_file_id=file_id,
        process_type=process_type,
        derived_file_id=derived_file_id,
        derived_filename=derived_filename,
        compatibility_status=status_payload["status"],
        legacy_status_endpoint=f"/api/v1/processing/files/{file_id}/structuring_status",
    )


@router.get("/files/{file_id}/technical-review", response_model=schemas_v2.TechnicalScanResponse)
def api_v2_technical_scan(
    file_id: int,
    stylesheet_id: int | None = None,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    try:
        _processing_check_permission(viewer, "technical")
        raw_scan = technical_editor_service.scan_errors(
            db,
            file_id=file_id,
            logger=logger,
            technical_editor_cls=TechnicalEditor,
        )
    except HTTPException as exc:
        code = "TECHNICAL_SCAN_FAILED"
        if exc.status_code == 401:
            code = "AUTH_REQUIRED"
        elif exc.status_code == 403:
            code = "PERMISSION_DENIED"
        elif exc.status_code == 404:
            code = "FILE_NOT_FOUND"
        return _error_response(
            status_code=exc.status_code,
            code=code,
            message=str(exc.detail),
        )

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    
    # Generate Collabora URL if available
    collabora_url = None
    try:
        editor_state = wopi_service.build_editor_page_state(
            db,
            file_id=file_id,
            collabora_public_url=COLLABORA_PUBLIC_URL,
            wopi_base_url=WOPI_BASE_URL,
        )
        collabora_url = editor_state.get("collabora_url")
    except Exception as e:
        logger.warning(f"Failed to generate Collabora launch URL: {e}")

    # Attach active stylesheet for this project
    active_stylesheet = None
    if file_record and file_record.project_id:
        active_ss = stylesheet_service.get_active_stylesheet_for_project(
            db, project_id=file_record.project_id
        )
        if active_ss:
            active_stylesheet = stylesheet_service._serialize_stylesheet(active_ss)

    # Annotate findings with stylesheet matching if stylesheet_id provided
    findings = raw_scan.get("findings", [])
    if stylesheet_id and findings:
        selected_stylesheet = db.query(models.ProjectStylesheet).filter(
            models.ProjectStylesheet.id == stylesheet_id,
            models.ProjectStylesheet.project_id == file_record.project_id,
        ).first()

        if selected_stylesheet:
            # Build set of (element, subtype, pattern) tuples from stylesheet
            stylesheet_ia_rows = set()
            import json
            try:
                selected_rows = json.loads(selected_stylesheet.selected_ia_rows)
                for row in selected_rows:
                    stylesheet_ia_rows.add((row.get("element"), row.get("subtype"), row.get("pattern")))
            except (json.JSONDecodeError, TypeError):
                pass

            # Build category-level set for fallback matching
            try:
                selected_rows_list = json.loads(selected_stylesheet.selected_ia_rows)
            except (json.JSONDecodeError, TypeError):
                selected_rows_list = []
            stylesheet_subtypes = {
                row.get("subtype", "").lower()
                for row in selected_rows_list
                if row.get("subtype")
            }

            # Use rule_id_to_ia already embedded in cached scan result (no import needed)
            rule_id_to_ia = raw_scan.get("ia_report", {}).get("rule_id_to_ia", {})

            # Fall back to module import only if not in cached result
            if not rule_id_to_ia:
                try:
                    from app.processing.manuscript_core.ia_mapping import RULE_ID_TO_IA as rule_id_to_ia
                except ImportError:
                    try:
                        from manuscript_core.ia_mapping import RULE_ID_TO_IA as rule_id_to_ia
                    except ImportError:
                        rule_id_to_ia = {}

            # Annotate in_stylesheet for each finding
            for finding in findings:
                rule_id = finding.get("rule_id")
                matched = False
                if rule_id and rule_id in rule_id_to_ia:
                    ia_row = rule_id_to_ia[rule_id]
                    if isinstance(ia_row, (tuple, list)) and len(ia_row) >= 3:
                        matched = (ia_row[0], ia_row[1], ia_row[2]) in stylesheet_ia_rows
                if not matched:
                    # Fallback: category-level match (finding.category == ia_row.subtype)
                    cat = finding.get("category", "").lower()
                    matched = bool(cat and cat in stylesheet_subtypes)
                finding["in_stylesheet"] = matched

            # Apply dynamic replacement overrides for range and thousand-separator rules
            import re as regex_module
            preferred_patterns: dict = {}
            for row in selected_rows_list:
                el = row.get("element", "")
                pat = row.get("pattern", "")
                if el and pat:
                    preferred_patterns.setdefault(el, set()).add(pat)

            range_rule_ids = {"range_to", "range_endash", "range_hyphen"}
            thous_rule_ids = {"thous_sep_missing", "thous_sep_comma", "thous_sep_space", "thous_sep_nbsp"}

            for finding in findings:
                rule_id = finding.get("rule_id", "")
                surface = finding.get("surface", "")

                if rule_id in range_rule_ids:
                    prefs = preferred_patterns.get("Ranges", set())
                    if prefs:
                        pref = next(iter(prefs))
                        nums = regex_module.findall(r'\d+', surface)
                        if len(nums) >= 2:
                            if "to" in pref.lower():
                                finding["replacement"] = f"{nums[0]} to {nums[1]}"
                            elif "en dash" in pref.lower():
                                finding["replacement"] = f"{nums[0]}–{nums[1]}"
                            elif "hyphen" in pref.lower():
                                finding["replacement"] = f"{nums[0]}-{nums[1]}"

                elif rule_id in thous_rule_ids:
                    prefs = preferred_patterns.get("Thousand separator (use/non-use)", set())
                    if prefs:
                        pref = next(iter(prefs))
                        clean = regex_module.sub(r'[,\s ]', '', surface)
                        try:
                            n = int(clean)
                            if "comma" in pref.lower() and "no comma" not in pref.lower():
                                finding["replacement"] = f"{n:,}"
                            elif "no comma" in pref.lower():
                                finding["replacement"] = clean
                        except ValueError:
                            pass

    # Ensure inconsistencies is a dict (convert list to dict if needed)
    inconsistencies_data = raw_scan.get("inconsistencies", {})
    if isinstance(inconsistencies_data, list):
        inconsistencies_data = {}

    return schemas_v2.TechnicalScanResponse(
        file=_serialize_file_record(file_record, viewer=viewer),
        issues=raw_scan.get("issues", []),
        raw_scan=raw_scan.get("raw_scan", raw_scan),
        onlyoffice_available=bool(ONLYOFFICE_PUBLIC_URL),
        collabora_url=collabora_url,
        findings=raw_scan.get("findings", []),
        inconsistencies=inconsistencies_data,
        spelling_summary=raw_scan.get("spelling_summary", {}),
        ia_report=raw_scan.get("ia_report", {}),
        stats=raw_scan.get("stats", {}),
        active_stylesheet=active_stylesheet,
    )


# Excel export endpoints
@router.get("/files/{file_id}/technical-review/export/excel")
def api_v2_technical_export_excel(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    from app.processing.manuscript_core.exporters import build_combined_excel
    from starlette.responses import Response

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    scan_data = technical_editor_service.scan_errors(
        db,
        file_id=file_id,
        logger=logger,
        technical_editor_cls=TechnicalEditor,
    )

    excel_bytes = build_combined_excel(scan_data, job_id=str(file_id))
    filename = f"{Path(file_record.filename).stem}_consistency_report.xlsx"

    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/files/{file_id}/technical-review/export/ia-excel")
def api_v2_technical_export_ia_excel(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    from app.processing.manuscript_core.exporters import build_ia_excel
    from starlette.responses import Response

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    scan_data = technical_editor_service.scan_errors(
        db,
        file_id=file_id,
        logger=logger,
        technical_editor_cls=TechnicalEditor,
    )

    excel_bytes = build_ia_excel(scan_data, job_id=str(file_id))
    filename = f"{Path(file_record.filename).stem}_ia_report.xlsx"

    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/files/{file_id}/technical-review/export/html")
def api_v2_technical_export_html(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    from app.utils.html_dashboard import build_html_dashboard
    from starlette.responses import Response

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    scan_data = technical_editor_service.scan_errors(
        db,
        file_id=file_id,
        logger=logger,
        technical_editor_cls=TechnicalEditor,
    )

    html_content = build_html_dashboard(scan_data, file_record.filename)
    filename = f"{Path(file_record.filename).stem}_dashboard.html"

    return Response(
        content=html_content,
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/projects/{project_id}/technical-review/export")
def api_v2_bulk_export_analysis(
    project_id: int,
    file_ids: str = "",  # comma-separated list e.g. "1,2,3"
    format: str = "excel",  # "excel" | "ia-excel" | "html"
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Pre-save consolidated export for a list of file IDs (no stylesheet required)."""
    from app.processing.manuscript_core.exporters import build_combined_excel, build_ia_excel
    from app.utils.html_dashboard import build_html_dashboard
    from starlette.responses import Response

    viewer = _require_cookie_user(user)
    if not viewer:
        raise HTTPException(status_code=401, detail="Authentication required.")

    ids = [int(x.strip()) for x in file_ids.split(",") if x.strip().isdigit()]
    if not ids:
        raise HTTPException(status_code=400, detail="No valid file_ids provided.")

    all_scan_data: list[dict] = []
    for fid in ids:
        file_record = db.query(models.File).filter(models.File.id == fid).first()
        if not file_record:
            continue
        try:
            scan_data = technical_editor_service.scan_errors(
                db, file_id=fid, logger=logger, technical_editor_cls=TechnicalEditor
            )
            all_scan_data.append(scan_data)
        except Exception:
            pass

    if not all_scan_data:
        raise HTTPException(status_code=422, detail="Could not scan any of the provided files.")

    merged = _merge_stylesheet_scan_data(all_scan_data)

    if format == "html":
        html_content = build_html_dashboard(merged, f"consolidated_{len(ids)}_files")
        return Response(
            content=html_content,
            media_type="text/html",
            headers={"Content-Disposition": 'attachment; filename="consolidated_dashboard.html"'},
        )
    elif format == "ia-excel":
        excel_bytes = build_ia_excel(merged, job_id=f"bulk_{project_id}")
        return Response(
            content=excel_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="consolidated_ia_report.xlsx"'},
        )
    else:
        excel_bytes = build_combined_excel(merged, job_id=f"bulk_{project_id}")
        return Response(
            content=excel_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="consolidated_consistency_report.xlsx"'},
        )


@router.get("/projects/{project_id}/stylesheets/{stylesheet_id}/export")
def api_v2_export_stylesheet_report(
    project_id: int,
    stylesheet_id: int,
    format: str = "excel",  # "excel" | "ia-excel" | "html"
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Merged export across all files that were used to build a stylesheet."""
    from app.processing.manuscript_core.exporters import build_combined_excel, build_ia_excel
    from app.utils.html_dashboard import build_html_dashboard
    from starlette.responses import Response

    viewer = _require_cookie_user(user)
    if not viewer:
        raise HTTPException(status_code=401, detail="Authentication required.")

    ss = (
        db.query(models.ProjectStylesheet)
        .filter(
            models.ProjectStylesheet.id == stylesheet_id,
            models.ProjectStylesheet.project_id == project_id,
        )
        .first()
    )
    if not ss:
        raise HTTPException(status_code=404, detail="Stylesheet not found.")

    import json as _json
    file_ids: list[int] = _json.loads(ss.analyzed_file_ids or "[]")
    if not file_ids:
        raise HTTPException(status_code=404, detail="No analyzed files stored for this stylesheet.")

    # Scan each file and collect results
    all_scan_data: list[dict] = []
    filenames: list[str] = []
    for fid in file_ids:
        file_record = db.query(models.File).filter(models.File.id == fid).first()
        if not file_record:
            continue
        filenames.append(file_record.filename)
        try:
            scan_data = technical_editor_service.scan_errors(
                db, file_id=fid, logger=logger, technical_editor_cls=TechnicalEditor
            )
            all_scan_data.append(scan_data)
        except Exception:
            pass

    if not all_scan_data:
        raise HTTPException(status_code=422, detail="Could not scan any of the stored files.")

    # Merge all scan results into one combined dict
    merged = _merge_stylesheet_scan_data(all_scan_data)
    stylesheet_name = ss.name.replace(" ", "_")

    if format == "html":
        combined_filename = ", ".join(filenames)
        html_content = build_html_dashboard(merged, combined_filename)
        return Response(
            content=html_content,
            media_type="text/html",
            headers={"Content-Disposition": f'attachment; filename="{stylesheet_name}_dashboard.html"'},
        )
    elif format == "ia-excel":
        excel_bytes = build_ia_excel(merged, job_id=str(stylesheet_id))
        return Response(
            content=excel_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{stylesheet_name}_ia_report.xlsx"'},
        )
    else:
        excel_bytes = build_combined_excel(merged, job_id=str(stylesheet_id))
        return Response(
            content=excel_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{stylesheet_name}_consistency_report.xlsx"'},
        )


def _merge_stylesheet_scan_data(scan_data_list: list[dict]) -> dict:
    """Merge multiple per-file scan results into one combined dict for bulk export."""
    if len(scan_data_list) == 1:
        return scan_data_list[0]

    merged_findings: list[dict] = []
    merged_chapters: list[dict] = []
    merged_ia_rows: list[dict] = []
    merged_inconsistencies: list[dict] = []
    chapter_offset = 0

    for scan_data in scan_data_list:
        chapters = scan_data.get("chapters") or []
        findings = scan_data.get("findings") or []
        ia_report = scan_data.get("ia_report") or {}
        ia_rows = ia_report.get("rows") or []

        for f in findings:
            f_copy = dict(f)
            f_copy["chapter_index"] = (f.get("chapter_index") or 0) + chapter_offset
            merged_findings.append(f_copy)

        for i, ch in enumerate(chapters):
            ch_copy = dict(ch)
            ch_copy["index"] = i + chapter_offset
            merged_chapters.append(ch_copy)

        merged_ia_rows.extend(ia_rows)
        merged_inconsistencies.extend(scan_data.get("inconsistencies") or [])
        chapter_offset += len(chapters)

    # Aggregate category totals
    category_totals: dict[str, int] = {}
    for sd in scan_data_list:
        for cat, cnt in (sd.get("category_totals") or {}).items():
            category_totals[cat] = category_totals.get(cat, 0) + cnt

    first = scan_data_list[0]
    return {
        "meta": {
            "chapter_count": len(merged_chapters),
            "total_words": sum((sd.get("meta") or {}).get("total_words", 0) for sd in scan_data_list),
            "total_findings": len(merged_findings),
            "total_inconsistencies": len(merged_inconsistencies),
        },
        "chapters": merged_chapters,
        "findings": merged_findings,
        "inconsistencies": merged_inconsistencies,
        "ia_report": {"rows": merged_ia_rows},
        "category_totals": category_totals,
        "spelling_summary": (first.get("meta") or {}).get("spelling_summary") or first.get("spelling_summary") or {},
        "spelling_profile": {},
    }


@router.post("/files/{file_id}/technical-review/apply", response_model=schemas_v2.TechnicalApplyResponse)
def api_v2_technical_apply(
    file_id: int,
    payload: schemas_v2.TechnicalApplyRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    try:
        _processing_check_permission(viewer, "technical")
        apply_result = technical_editor_service.apply_edits(
            db,
            file_id=file_id,
            replacements=payload.replacements,
            selected_findings=payload.selected_findings,
            highlight_findings=payload.highlight_findings,
            username=viewer.username,
            logger=logger,
            technical_editor_cls=TechnicalEditor,
        )
    except HTTPException as exc:
        code = "TECHNICAL_APPLY_FAILED"
        if exc.status_code == 401:
            code = "AUTH_REQUIRED"
        elif exc.status_code == 403:
            code = "PERMISSION_DENIED"
        elif exc.status_code == 404:
            code = "FILE_NOT_FOUND"
        return _error_response(
            status_code=exc.status_code,
            code=code,
            message=str(exc.detail),
        )

    new_file = db.query(models.File).filter(models.File.id == apply_result["new_file_id"]).first()
    return schemas_v2.TechnicalApplyResponse(
        source_file_id=file_id,
        new_file_id=apply_result["new_file_id"],
        new_file=_serialize_file_record(new_file, viewer=viewer),
    )


@router.get("/files/{file_id}/xhtml")
def api_v2_get_file_xhtml(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="FILE_NOT_FOUND",
            message="File not found",
        )

    file_path = os.path.abspath(file_record.path)
    if not os.path.exists(file_path):
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PHYSICAL_FILE_MISSING",
            message="Physical file missing on disk",
        )

    dir_name = os.path.dirname(file_path)
    base_name = os.path.splitext(os.path.basename(file_path))[0]
    xhtml_dir = os.path.join(dir_name, "xhtml")
    xhtml_path = os.path.join(xhtml_dir, f"{base_name}.html")

    # Use cached XHTML if the file on disk hasn't changed since the XHTML was last written
    file_mtime = os.path.getmtime(file_path)
    if os.path.exists(xhtml_path) and os.path.getmtime(xhtml_path) >= file_mtime:
        logger.info(f"Serving cached XHTML for file {file_id}")
    else:
        # Always force a fresh conversion to ensure the editor shows the latest text/formatting
        from app.processing.docx_to_xhtml import DocxToXhtmlEngine
        try:
            os.makedirs(os.path.dirname(xhtml_path), exist_ok=True)
            engine = DocxToXhtmlEngine()
            engine.convert(file_path, xhtml_path)
        except Exception as e:
            return _error_response(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                code="XHTML_GENERATION_FAILED",
                message=f"Failed to generate XHTML representation: {str(e)}",
            )

    try:
        with open(xhtml_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="XHTML_READ_FAILED",
            message=f"Failed to read converted XHTML: {str(e)}",
        )

    return {"content": content, "filename": file_record.filename}


@router.post("/files/{file_id}/xhtml/save")
def api_v2_save_file_xhtml(
    file_id: int,
    payload: schemas_v2.XhtmlSaveRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )
    try:
        result = structuring_review_service.save_xhtml_and_convert(
            db,
            file_id=file_id,
            html_content=payload.html_content,
            username=viewer.username,
            logger=logger,
        )
        return {"status": "ok", "file_id": result["file_id"]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Unexpected error saving XHTML: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/files/{file_id}/xhtml-runs")
def api_v2_get_file_xhtml_runs(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Run-anchored XHTML for the formatting-preserving WYSIWYG editor."""
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )
    try:
        result = structuring_review_service.get_file_xhtml_runs(db, file_id=file_id, logger=logger)
        return {"content": result["content"], "filename": result["filename"]}
    except HTTPException:
        raise
    except Exception as exc:
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="XHTML_RUNS_GENERATION_FAILED",
            message=str(exc),
        )


@router.post("/files/{file_id}/xhtml-runs/save")
def api_v2_save_file_xhtml_runs(
    file_id: int,
    payload: schemas_v2.XhtmlSaveRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Delta-patch save: apply only changed runs/marks back into a new DOCX version."""
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )
    try:
        result = structuring_review_service.save_xhtml_delta_and_convert(
            db,
            file_id=file_id,
            html_content=payload.html_content,
            username=viewer.username,
            logger=logger,
        )
        # Invalidate the reference review cache so next load is fresh
        structuring_review_service.invalidate_ref_review_cache(
            structuring_review_service.resolve_processed_target(db, file_id=file_id)["processed_path"],
            logger=logger,
        )
        return {"status": "ok", "file_id": result["file_id"]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Unexpected error in delta save: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


def _para_to_html(para) -> str:
    """Convert a docx paragraph to HTML string."""
    import html
    result = []
    for run in para.runs:
        text = run.text
        if not text:
            continue
        tag = "span"
        if run.bold:
            tag = "strong"
        elif run.italic:
            tag = "em"
        elif run.underline:
            tag = "u"
        result.append(f"<{tag}>{html.escape(text)}</{tag}>")
    if not result:
        return f"<p>{html.escape(para.text)}</p>"
    return f"<p>{''.join(result)}</p>"


def _table_to_html(table) -> str:
    """Convert a docx table to HTML string."""
    import html
    rows = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            text = "".join(p.text for p in cell.paragraphs)
            cells.append(f"<td>{html.escape(text)}</td>")
        rows.append(f"<tr>{''.join(cells)}</tr>")
    return f"<table><tbody>{''.join(rows)}</tbody></table>"


def _extract_structured_blocks_from_docx(file_path: str) -> tuple[list[dict], list[str]]:
    """
    Extract structured blocks from DOCX with style names.
    Returns: (blocks, available_styles)
    """
    import docx
    from lxml import etree

    doc = docx.Document(file_path)
    blocks = []
    available_styles_set = set()
    idx = 0

    # Extract paragraphs and tables from body
    for elem in doc.element.body:
        tag = etree.QName(elem.tag).localname
        if tag == "p":
            para = docx.text.paragraph.Paragraph(elem, doc)
            style_name = para.style.name if para.style else "Normal"
            available_styles_set.add(style_name)
            html = _para_to_html(para)
            blocks.append({
                "index": idx,
                "type": "paragraph",
                "style": style_name,
                "html": html,
                "ref_index": None,
            })
            idx += 1
        elif tag == "tbl":
            table = docx.table.Table(elem, doc)
            available_styles_set.add("Table Grid")
            html = _table_to_html(table)
            blocks.append({
                "index": idx,
                "type": "table",
                "style": "Table Grid",
                "html": html,
                "ref_index": None,
            })
            idx += 1

    # Extract footnotes if present (simplified - skip for now due to python-docx limitations)
    # Footnotes in python-docx require accessing internal XML structures
    # For MVP, we'll skip footnotes - can be added later with proper extraction

    # Extract endnotes if present (simplified - skip for now due to python-docx limitations)
    # Endnotes in python-docx require accessing internal XML structures
    # For MVP, we'll skip endnotes - can be added later with proper extraction

    # Get all available style names from document
    available_styles = sorted(list(available_styles_set))

    return blocks, available_styles


@router.get(
    "/files/{file_id}/structured-content",
    response_model=schemas_v2.StructuredContentResponse,
)
def api_v2_get_structured_content(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="FILE_NOT_FOUND",
            message="File not found",
        )

    file_path = os.path.abspath(file_record.path)
    if not os.path.exists(file_path):
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PHYSICAL_FILE_MISSING",
            message="Physical file missing on disk",
        )

    try:
        blocks, available_styles = _extract_structured_blocks_from_docx(file_path)
    except Exception as e:
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="EXTRACTION_FAILED",
            message=f"Failed to extract document structure: {str(e)}",
        )

    return schemas_v2.StructuredContentResponse(
        filename=file_record.filename,
        blocks=[schemas_v2.StructuredBlock(**b) for b in blocks],
        available_styles=available_styles,
    )


@router.get(
    "/files/{file_id}/structuring-review",
    response_model=schemas_v2.StructuringReviewResponse,
)
def api_v2_structuring_review(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    try:
        page_state = structuring_review_service.build_review_page_state(
            db,
            file_id=file_id,
            collabora_public_url=COLLABORA_PUBLIC_URL,
            wopi_base_url=WOPI_BASE_URL,
            extract_document_structure_func=extract_document_structure,
            get_rules_loader_func=get_rules_loader,
        )
    except HTTPException as exc:
        code = "STRUCTURING_REVIEW_FAILED"
        if exc.status_code == 404:
            code = "FILE_NOT_FOUND"
        return _error_response(
            status_code=exc.status_code,
            code=code,
            message=str(exc.detail),
        )
    except Exception as exc:
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="STRUCTURING_REVIEW_FAILED",
            message=f"Error loading document structure: {str(exc)}",
        )

    if page_state["status"] == "error":
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROCESSED_FILE_MISSING",
            message=page_state["error_message"],
        )

    file_record = page_state["file"]
    return_action = _build_structuring_return_action(file_record)
    return schemas_v2.StructuringReviewResponse(
        viewer=_serialize_viewer(viewer),
        file=_serialize_file_record(file_record, viewer=viewer),
        processed_file=schemas_v2.StructuringProcessedFile(filename=page_state["filename"]),
        editor=schemas_v2.StructuringReviewEditor(
            onlyoffice_available=bool(ONLYOFFICE_PUBLIC_URL),
            collabora_url=page_state.get("collabora_url")
        ),
        actions=schemas_v2.StructuringReviewActions(
            save_endpoint=f"/api/v2/files/{file_id}/structuring-review/save",
            export_href=f"/api/v2/files/{file_id}/structuring-review/export",
            **return_action,
        ),
        styles=page_state["styles"],
        char_styles=page_state.get("char_styles", []),
    )


@router.post(
    "/files/{file_id}/structuring-review/save",
    response_model=schemas_v2.StructuringSaveResponse,
)
def api_v2_structuring_save(
    file_id: int,
    payload: schemas_v2.StructuringSaveRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Unauthorized",
        )

    try:
        resolved = structuring_review_service.resolve_processed_target(db, file_id=file_id)
        structuring_review_service.save_changes(
            db,
            file_id=file_id,
            changes={"changes": payload.changes},
            update_document_structure_func=update_document_structure,
            logger=logger,
        )
    except HTTPException as exc:
        code = "STRUCTURING_SAVE_FAILED"
        detail_message = str(exc.detail)
        if exc.status_code == 404:
            code = "PROCESSED_FILE_MISSING" if "Processed file not found" in detail_message else "FILE_NOT_FOUND"
        elif exc.status_code == 401:
            code = "AUTH_REQUIRED"
        return _error_response(
            status_code=exc.status_code,
            code=code,
            message=detail_message,
        )

    return schemas_v2.StructuringSaveResponse(
        file_id=file_id,
        saved_change_count=len(payload.changes),
        target_filename=resolved["processed_filename"],
    )


@router.get("/files/{file_id}/structuring-review/export")
def api_v2_structuring_export(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    try:
        export_payload = structuring_review_service.get_export_payload(
            db,
            file_id=file_id,
            logger=logger,
        )
    except HTTPException as exc:
        code = "STRUCTURING_EXPORT_FAILED"
        detail_message = str(exc.detail)
        if exc.status_code == 404:
            code = "PROCESSED_FILE_MISSING" if "Processed file not found" in detail_message else "FILE_NOT_FOUND"
        return _error_response(
            status_code=exc.status_code,
            code=code,
            message=detail_message,
        )

    return FileResponse(
        path=export_payload["path"],
        filename=export_payload["filename"],
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@router.get(
    "/files/{file_id}/reference-review",
    response_model=schemas_v2.ReferenceValidationReviewResponse,
)
def api_v2_reference_review(
    file_id: int,
    style: Optional[str] = Query(None),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    try:
        page_state = structuring_review_service.build_reference_review_page_state(
            db,
            file_id=file_id,
            style=style,
            logger=logger,
        )
    except HTTPException as exc:
        code = "REFERENCE_REVIEW_FAILED"
        if exc.status_code == 404:
            code = "FILE_NOT_FOUND"
        return _error_response(
            status_code=exc.status_code,
            code=code,
            message=str(exc.detail),
        )
    except Exception as exc:
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="REFERENCE_REVIEW_FAILED",
            message=f"Error loading reference review: {str(exc)}",
        )

    if page_state["status"] == "error":
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROCESSED_FILE_MISSING",
            message=page_state["error_message"],
        )

    file_record = page_state["file"]
    return schemas_v2.ReferenceValidationReviewResponse(
        viewer=_serialize_viewer(viewer),
        file=_serialize_file_record(file_record, viewer=viewer),
        content=page_state["content"],
        filename=page_state["filename"],
        styles=page_state["styles"],
        validation_logs=page_state["validation_logs"],
        save_endpoint=f"/files/{file_id}/reference-review/save",
        export_href=f"/api/v2/files/{file_id}/reference-review/export",
    )


@router.post(
    "/files/{file_id}/reference-review/save",
    response_model=schemas_v2.ReferenceSaveResponse,
)
def api_v2_reference_save(
    file_id: int,
    payload: schemas_v2.XhtmlSaveRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Unauthorized",
        )

    try:
        resolved = structuring_review_service.resolve_processed_target(db, file_id=file_id)
        structuring_review_service.save_xhtml_delta_and_convert(
            db,
            file_id=file_id,
            html_content=payload.html_content,
            username=viewer.username,
            logger=logger,
        )
        # Invalidate the reference review cache so next load is fresh
        structuring_review_service.invalidate_ref_review_cache(
            resolved["processed_path"],
            logger=logger,
        )
    except HTTPException as exc:
        code = "REFERENCE_SAVE_FAILED"
        detail_message = str(exc.detail)
        if exc.status_code == 404:
            code = "PROCESSED_FILE_MISSING" if "Processed file not found" in detail_message else "FILE_NOT_FOUND"
        return _error_response(
            status_code=exc.status_code,
            code=code,
            message=detail_message,
        )
    except Exception as exc:
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="REFERENCE_SAVE_FAILED",
            message=f"Failed to save references: {str(exc)}",
        )

    return schemas_v2.ReferenceSaveResponse(
        file_id=file_id,
        target_filename=resolved["processed_filename"],
    )


@router.get("/files/{file_id}/reference-review/export")
def api_v2_reference_export(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    try:
        export_payload = structuring_review_service.get_export_payload(
            db,
            file_id=file_id,
            logger=logger,
        )
    except HTTPException as exc:
        code = "REFERENCE_EXPORT_FAILED"
        detail_message = str(exc.detail)
        if exc.status_code == 404:
            code = "PROCESSED_FILE_MISSING" if "Processed file not found" in detail_message else "FILE_NOT_FOUND"
        return _error_response(
            status_code=exc.status_code,
            code=code,
            message=detail_message,
        )

    return FileResponse(
        path=export_payload["path"],
        filename=export_payload["filename"],
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@router.get("/files/{file_id}/reference-review/validate-only", response_model=schemas_v2.ReferenceValidateOnlyResponse)
def api_v2_reference_validate_only(
    file_id: int,
    style: Optional[str] = Query(None),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    try:
        result = structuring_review_service.run_validation_only(
            db,
            file_id=file_id,
            style=style,
            logger=logger,
        )
        return result
    except HTTPException as exc:
        code = "VALIDATION_FAILED"
        detail_message = str(exc.detail)
        if exc.status_code == 404:
            code = "FILE_NOT_FOUND"
        return _error_response(
            status_code=exc.status_code,
            code=code,
            message=detail_message,
        )


@router.post("/files/{file_id}/citation-candidates")
def api_v2_citation_candidates(
    file_id: int,
    request: dict,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Find candidate references for a missing citation."""
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    try:
        from app.processing.citation_matching import find_citation_candidates

        citation_text = request.get("citation_text", "")
        author = request.get("author", "")
        year = request.get("year")

        result = structuring_review_service.run_validation_only(
            db,
            file_id=file_id,
            logger=logger,
        )

        validation_logs = result.get("validation_logs", {})
        reference_entries = validation_logs.get("reference_entries", [])

        # Build bibliography dict for matching
        bibliography = {}
        for idx, ref_entry in enumerate(reference_entries):
            bibliography[idx] = {
                "full_author": ref_entry.get("text", "").split("(")[0].strip(),
                "year": year,
                "raw_text": ref_entry.get("text", ""),
                "text": ref_entry.get("text", ""),
            }

        candidates = find_citation_candidates(author or citation_text, year, bibliography)

        return {
            "status": "ok",
            "citation_text": citation_text,
            "candidates": candidates,
        }
    except HTTPException as exc:
        return _error_response(
            status_code=exc.status_code,
            code="VALIDATION_FAILED",
            message=str(exc.detail),
        )
    except Exception as e:
        logger.error(f"Citation candidates error: {e}")
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="INTERNAL_ERROR",
            message=str(e),
        )


@router.post("/files/{file_id}/reference-candidates")
def api_v2_reference_candidates(
    file_id: int,
    request: dict,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Find candidate citations for an unused reference."""
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    try:
        from app.processing.citation_matching import find_reference_candidates

        ref_text = request.get("ref_text", "")
        ref_idx = request.get("ref_idx")

        result = structuring_review_service.run_validation_only(
            db,
            file_id=file_id,
            logger=logger,
        )

        validation_logs = result.get("validation_logs", {})
        citation_pairs = validation_logs.get("citation_pairs", [])

        # Build citations list for reverse matching
        citations_in_doc = []
        for pair in citation_pairs:
            citations_in_doc.append({
                "text": pair.get("citation", ""),
                "author": pair.get("author", ""),
                "year": pair.get("year", ""),
                "para_idx": pair.get("para_idx"),
            })

        candidates = find_reference_candidates(ref_text, citations_in_doc)

        return {
            "status": "ok",
            "reference_key": f"ref_{ref_idx}",
            "candidates": candidates,
        }
    except HTTPException as exc:
        return _error_response(
            status_code=exc.status_code,
            code="VALIDATION_FAILED",
            message=str(exc.detail),
        )
    except Exception as e:
        logger.error(f"Reference candidates error: {e}")
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="INTERNAL_ERROR",
            message=str(e),
        )


@router.post("/files/{file_id}/link-citation-to-reference")
def api_v2_link_citation(
    file_id: int,
    request: dict,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Create a bidirectional link between citation and reference."""
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    try:
        from app.services.citation_linking_service import add_link, add_comment
        from app.services.file_service import get_processed_docx_path

        citation_key = request.get("citation_key", "")
        citation_text = request.get("citation_text", "")
        para_idx = request.get("para_idx")
        ref_idx = request.get("ref_idx")
        ref_text = request.get("ref_text", "")
        match_type = request.get("match_type", "user_selected")
        confidence = request.get("confidence", 0.85)
        link_flags = request.get("link_flags", {})

        # Get processed DOCX path
        processed_path = get_processed_docx_path(db, file_id, logger)
        if not processed_path:
            return _error_response(
                status_code=status.HTTP_404_NOT_FOUND,
                code="FILE_NOT_FOUND",
                message="Processed file not found",
            )

        # Add link to reflinks.json
        link_id = add_link(
            processed_path,
            citation_key=citation_key,
            citation_text=citation_text,
            para_idx=para_idx,
            ref_idx=ref_idx,
            ref_text=ref_text,
            match_type=match_type,
            confidence=confidence,
            linked_by=viewer.username if viewer else None,
            link_flags=link_flags,
        )

        # Add automatic comment about the link
        comment_text = f"[LINKED] Matched citation to reference [{ref_idx}]: {ref_text[:100]}"
        comment_id = add_comment(
            processed_path,
            target_type="citation",
            comment_text=comment_text,
            citation_key=citation_key,
            para_idx=para_idx,
            ref_idx=ref_idx,
            created_by=viewer.username if viewer else None,
            flags=["auto_linked"],
        )

        return {
            "status": "ok",
            "link_id": link_id,
            "citation_key": citation_key,
            "ref_idx": ref_idx,
            "comment_id": comment_id,
        }
    except HTTPException as exc:
        return _error_response(
            status_code=exc.status_code,
            code="LINKING_FAILED",
            message=str(exc.detail),
        )
    except Exception as e:
        logger.error(f"Link citation error: {e}")
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="INTERNAL_ERROR",
            message=str(e),
        )


@router.get("/files/{file_id}/citation-comments")
def api_v2_citation_comments(
    file_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Fetch all comments on citations and references."""
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    try:
        from app.services.citation_linking_service import get_all_links_and_comments
        from app.services.file_service import get_processed_docx_path

        # Get processed DOCX path
        processed_path = get_processed_docx_path(db, file_id, logger)
        if not processed_path:
            return _error_response(
                status_code=status.HTTP_404_NOT_FOUND,
                code="FILE_NOT_FOUND",
                message="Processed file not found",
            )

        # Get links and comments
        data = get_all_links_and_comments(processed_path)

        return {
            "status": "ok",
            "links": data.get("links", []),
            "comments": data.get("comments", []),
        }
    except HTTPException as exc:
        return _error_response(
            status_code=exc.status_code,
            code="FETCH_FAILED",
            message=str(exc.detail),
        )
    except Exception as e:
        logger.error(f"Citation comments error: {e}")
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="INTERNAL_ERROR",
            message=str(e),
        )


@router.post("/files/{file_id}/citation-comments")
def api_v2_add_citation_comment(
    file_id: int,
    request: dict,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Add a comment to a citation or reference."""
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Not authenticated",
        )

    try:
        from app.services.citation_linking_service import add_comment
        from app.services.file_service import get_processed_docx_path

        target_type = request.get("target_type", "citation")  # citation or reference
        comment_text = request.get("comment_text", "")
        citation_key = request.get("citation_key")
        para_idx = request.get("para_idx")
        ref_idx = request.get("ref_idx")
        flags = request.get("flags", [])

        if not comment_text.strip():
            return _error_response(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="INVALID_INPUT",
                message="Comment text cannot be empty",
            )

        # Get processed DOCX path
        processed_path = get_processed_docx_path(db, file_id, logger)
        if not processed_path:
            return _error_response(
                status_code=status.HTTP_404_NOT_FOUND,
                code="FILE_NOT_FOUND",
                message="Processed file not found",
            )

        # Add comment
        comment_id = add_comment(
            processed_path,
            target_type=target_type,
            comment_text=comment_text,
            citation_key=citation_key,
            para_idx=para_idx,
            ref_idx=ref_idx,
            created_by=viewer.username if viewer else None,
            flags=flags,
        )

        return {
            "status": "ok",
            "comment_id": comment_id,
            "created_at": datetime.utcnow().isoformat(),
        }
    except HTTPException as exc:
        return _error_response(
            status_code=exc.status_code,
            code="COMMENT_FAILED",
            message=str(exc.detail),
        )
    except Exception as e:
        logger.error(f"Add comment error: {e}")
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="INTERNAL_ERROR",
            message=str(e),
        )


@router.get("/paragraph-styles", response_model=list[str])
def api_v2_get_paragraph_styles():
    """Return the list of all publisher paragraph styles."""
    from app.utils.inject_styles import PUBLISHER_STYLES
    return sorted(PUBLISHER_STYLES)




@router.get("/admin/users", response_model=schemas_v2.AdminUsersResponse)
def api_v2_admin_users(
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )
    if not _has_admin_or_pm_role(viewer):
        return _error_response(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ADMIN_REQUIRED",
            message="Admin or Project Manager access required.",
        )

    page_data = admin_user_service.get_admin_users_page_data(db)
    all_users = page_data["users"]
    window = all_users[offset : offset + limit]
    return schemas_v2.AdminUsersResponse(
        users=[_serialize_admin_user(target_user) for target_user in window],
        roles=[_serialize_admin_role(role) for role in page_data["all_roles"]],
        pagination=schemas_v2.AdminUsersPagination(offset=offset, limit=limit, total=len(all_users)),
    )


@router.get("/admin/roles", response_model=schemas_v2.AdminRolesResponse)
def api_v2_admin_roles(
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )
    if not _has_admin_role(viewer):
        return _error_response(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ADMIN_REQUIRED",
            message="Admin access required.",
        )

    return schemas_v2.AdminRolesResponse(
        roles=[_serialize_admin_role(role) for role in admin_user_service.get_available_roles(db)]
    )


@router.post("/users", response_model=schemas_v2.AdminUser)
def api_v2_create_user(
    payload: schemas_v2.UserCreate,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )
    if not _has_admin_role(viewer):
        return _error_response(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ADMIN_REQUIRED",
            message="Admin access required.",
        )

    # Role Validation: Ensure role exists and is active
    from app.domains.workflow.models import RolesMaster
    role_record = db.query(RolesMaster).filter(
        RolesMaster.role_name.ilike(payload.role)
    ).first()
    if not role_record:
        return _error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_ROLE",
            message=f"Role '{payload.role}' does not exist"
        )
    if not role_record.active_status:
        return _error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INACTIVE_ROLE",
            message=f"Role '{payload.role}' is inactive"
        )

    # Uniqueness Validation
    username_exists = db.query(models.User).filter(models.User.username == payload.username).first()
    if username_exists:
        return _error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="DUPLICATE_USER",
            message="Username already registered"
        )
        
    email_exists = db.query(models.User).filter(models.User.email == payload.email).first()
    if email_exists:
        return _error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="DUPLICATE_USER",
            message="Email already registered"
        )

    from app.auth import hash_password
    db_user = models.User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=role_record.role_name,
        team=role_record.team,
        customer_access=payload.customer_access,
        active_status=payload.active_status if payload.active_status is not None else True
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    return _serialize_admin_user(db_user)


@router.put("/users/{user_id}", response_model=schemas_v2.AdminUser)
def api_v2_update_user(
    user_id: int,
    payload: schemas_v2.UserUpdate,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )
    if not _has_admin_role(viewer):
        return _error_response(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ADMIN_REQUIRED",
            message="Admin access required.",
        )

    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="USER_NOT_FOUND",
            message="User not found"
        )

    # Role updates and validation
    if payload.role:
        from app.domains.workflow.models import RolesMaster
        role_record = db.query(RolesMaster).filter(
            RolesMaster.role_name.ilike(payload.role)
        ).first()
        if not role_record:
            return _error_response(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="INVALID_ROLE",
                message=f"Role '{payload.role}' does not exist"
            )
        if not role_record.active_status:
            return _error_response(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="INACTIVE_ROLE",
                message=f"Role '{payload.role}' is inactive"
            )

        # Admin count check to protect the last admin
        was_admin = db_user.role and db_user.role.lower() == "admin"
        is_new_admin = role_record.role_name.lower() == "admin"
        if was_admin and not is_new_admin:
            admin_count = db.query(models.User).filter(models.User.role.ilike("admin")).count()
            if admin_count <= 1:
                return _error_response(
                    status_code=status.HTTP_409_CONFLICT,
                    code="LAST_ADMIN_PROTECTED",
                    message="Cannot remove the last Admin role"
                )

        db_user.role = role_record.role_name
        db_user.team = role_record.team

    # Other updates
    if payload.customer_access is not None:
        db_user.customer_access = payload.customer_access
    if payload.password:
        from app.auth import hash_password
        db_user.password_hash = hash_password(payload.password)
    if payload.active_status is not None:
        # Check self lockout
        if db_user.id == viewer.id and payload.active_status is False:
            return _error_response(
                status_code=status.HTTP_409_CONFLICT,
                code="SELF_LOCKOUT_BLOCKED",
                message="Cannot disable your own account"
            )
        db_user.active_status = payload.active_status

    db.commit()
    db.refresh(db_user)

    return _serialize_admin_user(db_user)


@router.patch("/users/{user_id}/status", response_model=schemas_v2.AdminUser)
def api_v2_update_user_status(

    user_id: int,
    payload: schemas_v2.UserStatusUpdate,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )
    if not _has_admin_role(viewer):
        return _error_response(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ADMIN_REQUIRED",
            message="Admin access required.",
        )

    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="USER_NOT_FOUND",
            message="User not found"
        )

    # Check self lockout
    if db_user.id == viewer.id and payload.active_status is False:
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="SELF_LOCKOUT_BLOCKED",
            message="Cannot disable your own account"
        )

    db_user.active_status = payload.active_status
    db.commit()
    db.refresh(db_user)

    return _serialize_admin_user(db_user)



@router.delete("/admin/users/{user_id}", response_model=schemas_v2.AdminDeleteUserResponse)
def api_v2_admin_delete_user(
    user_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_REQUIRED",
            message="Authentication required.",
        )
    if not _has_admin_role(viewer):
        return _error_response(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ADMIN_REQUIRED",
            message="Admin access required.",
        )

    delete_result = admin_user_service.delete_user(db, user_id=user_id, actor_username=viewer.username)
    if delete_result["status"] == "not_found":
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="USER_NOT_FOUND",
            message="User not found.",
        )
    if delete_result["status"] == "self_delete_blocked":
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="SELF_DELETE_BLOCKED",
            message="Cannot delete yourself.",
        )

    return schemas_v2.AdminDeleteUserResponse(
        deleted=schemas_v2.AdminDeleteUser(user_id=user_id),
        redirect_to="/admin/users?msg=User+deleted",
    )


# ── Standalone ChapterInfo (WMS Workflow Chapter details) Endpoints ───────────
from pydantic import BaseModel
from app.domains.workflow.models import ChapterInfo
from app.domains.workflow.schemas import ChapterInfoResponse, ChapterInfoUpdate

class BulkUpdatePriorityPayload(BaseModel):
    priority: str

class BulkUpdateStatusPayload(BaseModel):
    status: str

@router.get("/chapters/", response_model=List[ChapterInfoResponse])
def api_v2_list_chapters(db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    _require_cookie_user(user)
    from sqlalchemy import select
    return list(db.execute(select(ChapterInfo)).scalars().all())

@router.get("/chapters/{chapter_id}", response_model=ChapterInfoResponse)
def api_v2_get_chapter_by_id(chapter_id: int, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    _require_cookie_user(user)
    from sqlalchemy import select
    chapter = db.execute(select(ChapterInfo).where(ChapterInfo.id == chapter_id)).scalars().first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return chapter

@router.get("/chapters/project/{project}", response_model=List[ChapterInfoResponse])
def api_v2_get_chapters_by_project(project: str, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    _require_cookie_user(user)
    from sqlalchemy import select
    return list(db.execute(select(ChapterInfo).where(ChapterInfo.project == project)).scalars().all())

@router.get("/chapters/client/{client}", response_model=List[ChapterInfoResponse])
def api_v2_get_chapters_by_client(client: str, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    _require_cookie_user(user)
    from sqlalchemy import select
    return list(db.execute(select(ChapterInfo).where(ChapterInfo.client == client)).scalars().all())

@router.put("/chapters/{chapter_id}", response_model=ChapterInfoResponse)
def api_v2_update_chapter(chapter_id: int, payload: ChapterInfoUpdate, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    _require_cookie_user(user)
    from sqlalchemy import select
    chapter = db.execute(select(ChapterInfo).where(ChapterInfo.id == chapter_id)).scalars().first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(chapter, field, value)
    db.commit()
    db.refresh(chapter)
    return chapter

@router.put("/chapters/project/{project}/priority")
def api_v2_bulk_update_priority(project: str, payload: BulkUpdatePriorityPayload, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    _require_cookie_user(user)
    from sqlalchemy import update
    result = db.execute(
        update(ChapterInfo)
        .where(ChapterInfo.project == project)
        .values(priority=payload.priority)
    )
    db.commit()
    return {"updated": result.rowcount}

@router.put("/chapters/project/{project}/status")
def api_v2_bulk_update_status(project: str, payload: BulkUpdateStatusPayload, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    _require_cookie_user(user)
    from sqlalchemy import update
    result = db.execute(
        update(ChapterInfo)
        .where(ChapterInfo.project == project)
        .values(status=payload.status)
    )
    db.commit()
    return {"updated": result.rowcount}


@router.post("/projects/{project_id}/sync-chapters")
def api_v2_sync_chapters(project_id: int, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    """Sync CMS chapters → WMS chapter_details for projects created before auto-sync was added."""
    viewer = _require_cookie_user(user)
    if not viewer:
        return _error_response(status_code=status.HTTP_401_UNAUTHORIZED, code="AUTH_REQUIRED", message="Authentication required.")
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        return _error_response(status_code=status.HTTP_404_NOT_FOUND, code="PROJECT_NOT_FOUND", message="Project not found.")
    cms_chapters = db.query(models.Chapter).filter(models.Chapter.project == project.project_code).all()
    existing_nums = {ci.chapters for ci in db.query(ChapterInfo).filter(ChapterInfo.project == project.code).all()}
    created = 0
    for ch in cms_chapters:
        if ch.chapters and ch.chapters not in existing_nums:
            db.add(ChapterInfo(
                client=project.client_name or "",
                project=project.code,
                chapters=ch.chapters,
                chapter_title=ch.chapter_title or f"Chapter {ch.chapters}",
                workflow=project.workflow_name or "",
                status="Received",
                complexity_level=getattr(project, "composition", None) or "Medium",
                stage_level=1,
                published_status="Draft",
                priority=getattr(project, "priority", None) or "Normal",
                project_manager_name=getattr(project, "project_manager", None) or None,
            ))
            existing_nums.add(ch.chapters)
            created += 1
    db.commit()
    return {"synced": created, "total_chapters": len(cms_chapters)}


# ── Clients (v2) ─────────────────────────────────────────────────────────────
from app.domains.clients import crud as clients_crud
from app.domains.clients.schemas import (
    ClientCreate as V2ClientCreate,
    ClientListResponse as V2ClientListResponse,
    ClientResponse as V2ClientResponse,
    ClientUpdate as V2ClientUpdate,
)

class ClientStatusUpdate(BaseModel):
    active_status: bool

def _filter_clients_for_user(clients_list: list, user) -> list:
    if _has_admin_role(user):
        return clients_list
    allowed = set(user.customer_access or [])
    return [
        c for c in clients_list
        if (c.company in allowed or c.division in allowed or (getattr(c, 'name_company', None) in allowed))
    ]

@router.post("/clients", response_model=V2ClientListResponse, status_code=status.HTTP_201_CREATED)
def api_v2_create_client(client: V2ClientCreate, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    _require_cookie_user(user)
    return clients_crud.create_client(db, client)

@router.get("/clients", response_model=List[V2ClientListResponse])
def api_v2_list_clients(skip: int = 0, limit: int = 500, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    viewer = _require_cookie_user(user)
    all_clients = clients_crud.get_clients(db, skip=skip, limit=limit)
    return _filter_clients_for_user(all_clients, viewer)

@router.get("/clients/active", response_model=List[V2ClientListResponse])
def api_v2_list_active_clients(db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    viewer = _require_cookie_user(user)
    all_clients = clients_crud.get_active_clients(db)
    return _filter_clients_for_user(all_clients, viewer)

@router.get("/clients/{client_id}", response_model=V2ClientResponse)
def api_v2_get_client(client_id: int, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    viewer = _require_cookie_user(user)
    client = clients_crud.get_client(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if not _has_admin_role(viewer):
        allowed = set(viewer.customer_access or [])
        if client.company not in allowed and client.division not in allowed and getattr(client, 'name_company', None) not in allowed:
            raise HTTPException(status_code=404, detail="Client not found")
    return client

@router.put("/clients/{client_id}", response_model=V2ClientListResponse)
def api_v2_update_client(client_id: int, data: V2ClientUpdate, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    _require_cookie_user(user)
    updated = clients_crud.update_client(db, client_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Client not found")
    return updated

@router.delete("/clients/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_v2_delete_client(client_id: int, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    _require_cookie_user(user)
    if not clients_crud.delete_client(db, client_id):
        raise HTTPException(status_code=404, detail="Client not found")

@router.patch("/clients/{client_id}/status", response_model=V2ClientListResponse)
def api_v2_set_client_status(client_id: int, body: ClientStatusUpdate, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    _require_cookie_user(user)
    updated = clients_crud.set_client_active_status(db, client_id, body.active_status)
    if not updated:
        raise HTTPException(status_code=404, detail="Client not found")
    return updated


