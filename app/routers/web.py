from app.utils.timezone import now_ist_naive
from app.services.file_service import UPLOAD_DIR
from fastapi import APIRouter, Request, Form, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from typing import Optional
from jose import jwt, JWTError
from datetime import datetime

from app import database, models, schemas
from app.auth import create_access_token, verify_password, hash_password, oauth2_scheme, get_current_user_from_cookie
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
    project_read_service,
    project_service,
    session_service,
    version_service,
)

settings = get_settings()
templates = Jinja2Templates(directory="app/templates")

import pytz as _pytz
_IST = _pytz.timezone("Asia/Kolkata")

def _to_ist(dt):
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = _pytz.utc.localize(dt)
    return dt.astimezone(_IST).strftime("%Y-%m-%d %H:%M")

templates.env.filters["ist"] = _to_ist
router = APIRouter()

@router.get("/", response_class=HTMLResponse)
async def home(request: Request, user=Depends(get_current_user_from_cookie)):
    return session_service.get_home_redirect_response(user)

@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})

@router.post("/login", response_class=HTMLResponse)
async def login_submit(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(database.get_db)
):
    try:
        auth_result = auth_service.authenticate_browser_user(db, username, password)
        return session_service.build_login_redirect_response(auth_result["access_token"])
    except Exception as e:
         return templates.TemplateResponse("login.html", {"request": request, "error": str(e)})

@router.get("/logout")
async def logout():
    return session_service.build_logout_response()

@router.get("/register", response_class=HTMLResponse)
async def register_page(request: Request):
    return templates.TemplateResponse("register.html", {"request": request})

@router.post("/register", response_class=HTMLResponse)
async def register_submit(
    request: Request,
    username: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    confirm_password: str = Form(...),
    db: Session = Depends(database.get_db)
):
    try:
        auth_service.register_browser_user(
            db,
            username=username,
            email=email,
            password=password,
            confirm_password=confirm_password,
        )
        return session_service.build_registration_success_response()
    except Exception as e:
         return templates.TemplateResponse("register.html", {"request": request, "error": str(e)})

@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard(
    request: Request, 
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user:
        return RedirectResponse(url="/login", status_code=status.HTTP_302_FOUND)

    page_data = dashboard_service.get_dashboard_page_data(db, skip=0, limit=100)
    user_data = session_service.build_user_context(user, include_email=True)
    
    return templates.TemplateResponse(
        "dashboard.html", 
        {
            "request": request,
            "user": user_data,
            "projects": page_data["projects"],
            "dashboard_stats": page_data["dashboard_stats"],
        }
    )

@router.get("/projects", response_class=HTMLResponse)
async def projects_list(
    request: Request, 
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user:
        return RedirectResponse(url="/login", status_code=status.HTTP_302_FOUND)

    page_data = project_read_service.get_projects_page_data(db, skip=0, limit=100)
    user_data = session_service.build_user_context(user)
    return templates.TemplateResponse(
        "projects.html", 
        {"request": request, "user": user_data, "projects": page_data["projects"]}
    )

@router.get("/projects/create", response_class=HTMLResponse)
async def create_project_page(
    request: Request,
    user=Depends(get_current_user_from_cookie)
):
    if not user:
        return RedirectResponse(url="/login", status_code=status.HTTP_302_FOUND)
        
    user_data = {"username": user.username, "roles": [r.name for r in user.roles], "id": user.id}
    return templates.TemplateResponse(
        "project_create.html",
        {"request": request, "user": user_data}
    )

@router.get("/admin", response_class=HTMLResponse)
async def admin_dashboard(
    request: Request,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user or "Admin" not in [r.name for r in user.roles]:
        return RedirectResponse(url="/dashboard", status_code=302)

    admin_stats = admin_user_service.get_admin_dashboard_stats(db)
    user_data = session_service.build_user_context(user)
    return templates.TemplateResponse(
        "admin_dashboard.html",
        {"request": request, "user": user_data, "admin_stats": admin_stats}
    )

@router.get("/admin/users/create", response_class=HTMLResponse)
async def admin_create_user_page(
    request: Request,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user or "Admin" not in [r.name for r in user.roles]:
        return RedirectResponse(url="/dashboard", status_code=302)
    
    roles = db.query(models.Role).all()
    user_data = {"username": user.username, "roles": [r.name for r in user.roles], "id": user.id}
    
    return templates.TemplateResponse(
        "admin_create_user.html",
        {"request": request, "user": user_data, "roles": roles}
    )

@router.post("/admin/users/create", response_class=HTMLResponse)
async def admin_create_user_submit(
    request: Request,
    username: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    role_id: int = Form(...),
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user or "Admin" not in [r.name for r in user.roles]:
        return RedirectResponse(url="/dashboard", status_code=302)
        
    try:
        admin_user_service.create_admin_user(
            db,
            username=username,
            email=email,
            password=password,
            role_id=role_id,
        )
        return RedirectResponse(url="/admin/users", status_code=302)
    except Exception as e:
        roles = admin_user_service.get_available_roles(db)
        user_data = session_service.build_user_context(user)
        return templates.TemplateResponse(
            "admin_create_user.html",
            {"request": request, "user": user_data, "roles": roles, "error": str(e)}
        )

@router.get("/admin/users", response_class=HTMLResponse)
async def admin_users(
    request: Request,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user:
        return RedirectResponse(url="/login", status_code=status.HTTP_302_FOUND)
    
    # Check if admin
    user_roles = [r.name for r in user.roles]
    if "Admin" not in user_roles:
        return RedirectResponse(url="/dashboard", status_code=status.HTTP_302_FOUND)

    page_data = admin_user_service.get_admin_users_page_data(db)
    user_data = session_service.build_user_context(user, include_email=True)
    
    return templates.TemplateResponse(
        "admin_users.html", 
        {
            "request": request, 
            "user": user_data, 
            "current_user": user, 
            "users": page_data["users"], 
            "all_roles": page_data["all_roles"]
        }
    )

@router.post("/admin/users/{user_id}/role")
async def update_user_role(
    request: Request,
    user_id: int,
    role_id: int = Form(...),
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login", status_code=status.HTTP_302_FOUND)
    if "Admin" not in [r.name for r in user.roles]:
        return RedirectResponse(url="/dashboard", status_code=status.HTTP_302_FOUND)

    role_update = admin_user_service.replace_user_role(db, user_id=user_id, role_id=role_id)
    if role_update["status"] == "invalid":
        return RedirectResponse(url="/admin/users?msg=Invalid+user+or+role", status_code=status.HTTP_302_FOUND)
    if role_update["status"] == "last_admin_blocked":
        page_data = admin_user_service.get_admin_users_page_data(db)
        user_data = session_service.build_user_context(user, include_email=True)
        return templates.TemplateResponse(
            "admin_users.html",
            {
                "request": request,
                "user": user_data,
                "current_user": user,
                "users": page_data["users"],
                "all_roles": page_data["all_roles"],
                "error": "Cannot remove the last Admin role.",
            }
        )

    return RedirectResponse(url="/admin/users?msg=Role+Updated", status_code=status.HTTP_302_FOUND)


@router.post("/admin/users/{user_id}/delete")
async def admin_delete_user(
    request: Request,
    user_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user:
        return RedirectResponse(url="/login", status_code=302)
    delete_result = admin_user_service.delete_user(db, user_id=user_id, actor_username=user.username)
    if delete_result["status"] == "not_found":
        return RedirectResponse(url="/admin/users?msg=User+not+found", status_code=302)
    if delete_result["status"] == "self_delete_blocked":
        return RedirectResponse(url="/admin/users?msg=Cannot+delete+yourself", status_code=302)
    return RedirectResponse(url="/admin/users?msg=User+deleted", status_code=302)

@router.post("/admin/users/{user_id}/status")
async def toggle_user_status(
    user_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login", status_code=status.HTTP_302_FOUND)
    if "Admin" not in [r.name for r in user.roles]:
        return RedirectResponse(url="/dashboard", status_code=status.HTTP_302_FOUND)

    admin_user_service.toggle_user_status(db, user_id=user_id, actor_user_id=user.id)
    return RedirectResponse(url="/admin/users", status_code=status.HTTP_302_FOUND)

@router.get("/admin/stats", response_class=HTMLResponse)
async def admin_stats(
    request: Request,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user or "Admin" not in [r.name for r in user.roles]:
        return RedirectResponse(url="/dashboard", status_code=302)
    
    # Calculate Stats
    total_users = db.query(models.User).count()
    total_projects = db.query(models.Project).count()
    total_chapters = db.query(models.Chapter).count()
    total_files = db.query(models.File).count()
    
    # Role Breakdown
    roles = db.query(models.Role).all()
    role_breakdown = {}
    for r in roles:
         count = db.query(models.UserRole).filter(models.UserRole.role_id == r.id).count()
         if count > 0:
             role_breakdown[r.name] = count
            
    stats = {
        "total_users": total_users,
        "total_projects": total_projects,
        "total_chapters": total_chapters,
        "total_files": total_files,
        "role_breakdown": role_breakdown
    }
    
    user_data = {"username": user.username, "roles": [r.name for r in user.roles], "id": user.id}
    return templates.TemplateResponse(
        "admin_stats.html",
        {"request": request, "user": user_data, "stats": stats}
    )

@router.get("/admin/users/{user_id}/password", response_class=HTMLResponse)
async def admin_change_password_page(
    request: Request,
    user_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user or "Admin" not in [r.name for r in user.roles]:
        return RedirectResponse(url="/dashboard", status_code=302)
        
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        return RedirectResponse(url="/admin/users", status_code=302)
        
    user_data = {"username": user.username, "roles": [r.name for r in user.roles], "id": user.id}
    return templates.TemplateResponse(
        "admin_change_password.html",
        {"request": request, "user": user_data, "target_user": target_user}
    )

@router.post("/admin/users/{user_id}/password")
async def admin_change_password_submit(
    request: Request,
    user_id: int,
    new_password: str = Form(...),
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user or "Admin" not in [r.name for r in user.roles]:
        return RedirectResponse(url="/dashboard", status_code=302)

    admin_user_service.change_password_first_handler(db, user_id=user_id, new_password=new_password)
    return RedirectResponse(url="/admin/users", status_code=302)

from fastapi import UploadFile, File as FastAPIFile
import shutil
import os
import re

# ... existing imports ...

@router.post("/projects/create_with_files")
async def create_project_with_files(
    request: Request,
    code: str = Form(...),
    title: str = Form(...),
    client_name: str = Form(None),  # Optional client name
    xml_standard: str = Form(...),
    chapter_count: int = Form(...),
    files: list[UploadFile] = FastAPIFile(None),
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login", status_code=302)

    try:
        project_service.create_project_with_initial_files(
            db,
            code=code,
            title=title,
            client_name=client_name,
            xml_standard=xml_standard,
            chapter_count=chapter_count,
            files=files,
            upload_dir=UPLOAD_DIR,
        )
    except project_service.ProjectBootstrapValidationError as exc:
        user_data = session_service.build_user_context(user)
        return templates.TemplateResponse(
            "project_create.html",
            {"request": request, "user": user_data, "error": str(exc)},
        )

    return RedirectResponse(url="/dashboard", status_code=302)

@router.get("/projects/{project_id}", response_class=HTMLResponse)
@router.get("/projects/{project_id}/chapters", response_class=HTMLResponse)
async def project_chapters(
    request: Request,
    project_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login")

    page_data = project_read_service.get_project_chapters_page_data(db, project_id)
    project = page_data["project"]
    if not project: raise HTTPException(status_code=404)

    user_data = session_service.build_user_context(user)
    return templates.TemplateResponse(
        "project_chapters.html", 
        {"request": request, "project": project, "chapters": page_data["chapters"], "user": user_data}
    )

@router.post("/projects/{project_id}/chapters/create")
async def create_chapter(
    project_id: int,
    number: str = Form(...),
    title: str = Form(...),
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login", status_code=302)

    chapter_result = chapter_service.create_chapter(
        db,
        project_id=project_id,
        number=number,
        title=title,
        upload_dir=UPLOAD_DIR,
    )
    if not chapter_result["project"]:
        raise HTTPException(status_code=404, detail="Project not found")

    return RedirectResponse(
        url=f"/projects/{project_id}?msg=Chapter+Created+Successfully",
        status_code=302
    )

@router.post("/projects/{project_id}/chapter/{chapter_id}/rename")
async def rename_chapter(
    project_id: int,
    chapter_id: int,
    number: str = Form(...),
    title: str = Form(...),
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login", status_code=302)

    chapter_result = chapter_service.rename_chapter(
        db,
        project_id=project_id,
        chapter_id=chapter_id,
        number=number,
        title=title,
        upload_dir=UPLOAD_DIR,
    )
    if not chapter_result["chapter"] or not chapter_result["project"]:
        raise HTTPException(status_code=404, detail="Chapter or Project not found")

    return RedirectResponse(
        url=f"/projects/{project_id}?msg=Chapter+Renamed+Successfully",
        status_code=302
    )

@router.get("/projects/{project_id}/chapter/{chapter_id}/download")
async def download_chapter_zip(
    project_id: int,
    chapter_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login", status_code=302)
    
    # Get the chapter and project
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    
    if not chapter or not project:
        raise HTTPException(status_code=404, detail="Chapter or Project not found")
    
    # Create ZIP file
    import zipfile
    import tempfile
    from fastapi.responses import FileResponse
    
    chapter_dir = f"{UPLOAD_DIR}/{project.code}/{chapter.number}"
    
    if not os.path.exists(chapter_dir):
        raise HTTPException(status_code=404, detail="Chapter directory not found")
    
    # Create temporary ZIP file
    temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    zip_filename = f"{project.code}_Chapter_{chapter.number}.zip"
    
    with zipfile.ZipFile(temp_zip.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(chapter_dir):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, chapter_dir)
                zipf.write(file_path, arcname)
    
    return FileResponse(
        temp_zip.name,
        media_type='application/zip',
        filename=zip_filename,
        headers={"Content-Disposition": f"attachment; filename={zip_filename}"}
    )

@router.post("/projects/{project_id}/chapter/{chapter_id}/delete")
async def delete_chapter(
    project_id: int,
    chapter_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login", status_code=302)

    chapter_result = chapter_service.delete_chapter_primary(
        db,
        project_id=project_id,
        chapter_id=chapter_id,
        upload_dir=UPLOAD_DIR,
    )
    if not chapter_result["chapter"] or not chapter_result["project"]:
        raise HTTPException(status_code=404, detail="Chapter or Project not found")

    return RedirectResponse(
        url=f"/projects/{project_id}?msg=Chapter+Deleted+Successfully",
        status_code=302
    )

@router.get("/projects/{project_id}/chapter/{chapter_id}", response_class=HTMLResponse)
async def chapter_detail(
    request: Request,
    project_id: int,
    chapter_id: int,
    tab: str = "Manuscript",
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login")

    page_data = project_read_service.get_chapter_detail_page_data(db, project_id, chapter_id)
    project = page_data["project"]
    chapter = page_data["chapter"]
    if not chapter or chapter.project_id != project_id:
        raise HTTPException(status_code=404)

    user_data = session_service.build_user_context(user)
    return templates.TemplateResponse(
        "chapter_detail.html", 
        {
            "request": request,
            "project": project,
            "chapter": chapter,
            "files": page_data["files"],
            "active_tab": tab,
            "user": user_data,
        }
    )

@router.post("/projects/{project_id}/chapter/{chapter_id}/upload")
async def upload_chapter_files(
    request: Request,
    project_id: int,
    chapter_id: int,
    category: str = Form(...),
    files: list[UploadFile] = FastAPIFile(...),
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login")

    upload_result = file_service.upload_chapter_files(
        db,
        project_id=project_id,
        chapter_id=chapter_id,
        category=category,
        files=files,
        actor_user_id=user.id,
        upload_dir=UPLOAD_DIR,
    )

    if not upload_result["project"] or not upload_result["chapter"]:
        raise HTTPException(status_code=404, detail="Project or Chapter not found")
    
    # Redirect back to the same tab
    return RedirectResponse(
        url=f"/projects/{project_id}/chapter/{chapter_id}?tab={category}&msg=Files+Uploaded+Successfully", 
        status_code=302
    )

@router.get("/projects/files/{file_id}/download")
async def download_file(
    file_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login")

    file_record = file_service.get_file_for_download(db, file_id=file_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")
        
    return FileResponse(
        path=file_record.path, 
        filename=file_record.filename, 
        media_type='application/octet-stream'
    )

@router.post("/projects/files/{file_id}/delete")
async def delete_file(
    file_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login")

    delete_context = file_service.delete_file_and_capture_context(db, file_id=file_id)
    if not delete_context:
        raise HTTPException(status_code=404, detail="File not found")

    return RedirectResponse(
        url=(
            f"/projects/{delete_context['project_id']}/chapter/{delete_context['chapter_id']}"
            f"?tab={delete_context['category']}&msg=File+Deleted"
        ),
        status_code=302
    )

@router.post("/projects/{project_id}/delete")
async def delete_project(
    project_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login")

    project = project_service.delete_project_with_filesystem(
        db,
        project_id=project_id,
        upload_dir=UPLOAD_DIR,
    )
    if not project: raise HTTPException(status_code=404)

    return RedirectResponse(url="/dashboard?msg=Book+Deleted", status_code=302)

@router.post("/projects/{project_id}/chapter/{chapter_id}/delete")
async def delete_chapter(
    project_id: int,
    chapter_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login")

    chapter_result = chapter_service.delete_chapter_secondary(
        db,
        project_id=project_id,
        chapter_id=chapter_id,
        upload_dir=UPLOAD_DIR,
    )
    if not chapter_result["chapter"]: raise HTTPException(status_code=404)

    return RedirectResponse(url=f"/projects/{project_id}?msg=Chapter+Deleted", status_code=302)

@router.post("/projects/files/{file_id}/checkout")
async def checkout_file(
    file_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login")

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record: raise HTTPException(status_code=404)

    checkout_result = checkout_service.checkout_file(db, file_record=file_record, actor_user_id=user.id)
    if checkout_result["status"] == "locked_by_other":
        return RedirectResponse(
            url=f"/projects/{file_record.project_id}/chapter/{file_record.chapter_id}?tab={file_record.category}&msg=File+Locked+By+Other", 
            status_code=302
        )
    
    return RedirectResponse(
        url=f"/projects/{file_record.project_id}/chapter/{file_record.chapter_id}?tab={file_record.category}&msg=File+Checked+Out", 
        status_code=302
    )

@router.post("/projects/files/{file_id}/cancel_checkout")
async def cancel_checkout(
    file_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login")

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record: raise HTTPException(status_code=404)

    checkout_service.cancel_checkout(db, file_record=file_record, actor_user_id=user.id)
    return RedirectResponse(
        url=f"/projects/{file_record.project_id}/chapter/{file_record.chapter_id}?tab={file_record.category}&msg=Checkout+Cancelled", 
        status_code=302
    )
    
@router.get("/api/notifications")
async def get_notifications_data(
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie)
):
    if not user:
        return []

    return notification_service.get_recent_upload_notifications(db)

@router.get("/activities", response_class=HTMLResponse)
async def activities_page(
    request: Request,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user:
        return session_service.redirect_to_login_response()

    activities, today_count = activity_service.get_recent_activities(db)
    user_data = session_service.build_user_context(user)
    return templates.TemplateResponse(
        "activities.html",
        {"request": request, "user": user_data, "activities": activities, "today_count": today_count}
    )

@router.get("/files/{file_id}/technical/edit", response_class=HTMLResponse)
async def technical_editor_page(
    request: Request,
    file_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user: return RedirectResponse(url="/login")
    
    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")
        
    user_data = {"username": user.username, "roles": [r.name for r in user.roles], "id": user.id}
    
    return templates.TemplateResponse(
        "technical_editor_form.html",
        {"request": request, "file": file_record, "user": user_data}
    )


@router.get("/admin/users/{user_id}/edit", response_class=HTMLResponse)
async def admin_edit_user_page(
    request: Request,
    user_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user:
        return RedirectResponse(url="/login", status_code=302)
    from app.models import User, Role
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    roles = db.query(Role).all()
    return templates.TemplateResponse("admin_edit_user.html", {
        "request": request, "user": user, "target": target, "roles": roles
    })


@router.post("/admin/users/{user_id}/edit")
async def admin_edit_user(
    request: Request,
    user_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user:
        return RedirectResponse(url="/login", status_code=302)
    form = await request.form()
    try:
        admin_user_service.update_user_email(db, user_id=user_id, email=form.get("email"))
    except LookupError:
        raise HTTPException(status_code=404, detail="User not found")
    return RedirectResponse(url="/admin/users?msg=User+updated", status_code=302)


@router.get("/admin/users/{user_id}/password", response_class=HTMLResponse)
async def admin_change_password_page(
    request: Request,
    user_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user:
        return RedirectResponse(url="/login", status_code=302)
    from app.models import User
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    return templates.TemplateResponse("admin_change_password.html", {
        "request": request, "user": user, "target": target
    })


@router.post("/admin/users/{user_id}/password")
async def admin_change_password(
    request: Request,
    user_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user:
        return RedirectResponse(url="/login", status_code=302)
    form = await request.form()
    try:
        result = admin_user_service.change_password_validated_handler(
            db,
            user_id=user_id,
            new_password=form.get("new_password", ""),
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="User not found")
    if result["status"] == "error":
        return templates.TemplateResponse("admin_change_password.html", {
            "request": request, "user": user, "target": result["target_user"],
            "error": result["error"]
        })
    return RedirectResponse(url="/admin/users?msg=Password+changed", status_code=302)


@router.post("/admin/users/{user_id}/delete")
async def admin_delete_user(
    request: Request,
    user_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    if not user:
        return RedirectResponse(url="/login", status_code=302)
    delete_result = admin_user_service.delete_user(db, user_id=user_id, actor_username=user.username)
    if delete_result["status"] == "not_found":
        return RedirectResponse(url="/admin/users?msg=User+not+found", status_code=302)
    if delete_result["status"] == "self_delete_blocked":
        return RedirectResponse(url="/admin/users?msg=Cannot+delete+yourself", status_code=302)
    return RedirectResponse(url="/admin/users?msg=User+deleted", status_code=302)
