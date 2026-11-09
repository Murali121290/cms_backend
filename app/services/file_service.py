from app.utils.timezone import now_ist_naive
from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import UploadFile
from app import models
from app.domains.projects.models import Project
import re
import shutil
import os
from datetime import datetime

from app.core.paths import UPLOADS_DIR
from app.services import checkout_service, version_service

UPLOAD_DIR = str(UPLOADS_DIR)
try:
    os.makedirs(UPLOAD_DIR, exist_ok=True)
except Exception:
    pass


def extract_chapter_number_from_filename(name: str) -> str | None:
    """Parse a zero-padded chapter number out of a filename or folder name.

    Matches "chapter"/"chap"/"ch" followed by digits (e.g. "Chapter_05.docx"),
    else falls back to a leading or trailing run of digits in the stem
    (e.g. "05_intro.docx" or "intro_05.docx").
    """
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


def resolve_chapter_art_folder(project_dir: str, chapter_dir: str, chapter_number: str) -> str | None:
    """Find the directory containing art files for a given chapter or complete book ('00').

    Searches:
    1. Direct chapter folders: <chapter_dir>/Art, <chapter_dir>/art, <chapter_dir>/Links, etc.
    2. Project-level chapter art folder names:
       - 'Ch {ch_num} - Art', 'Chapter {ch_num} - Art'
       - 'Book {ch_num} - Art', 'Book 00 - Art', 'Book - Art', 'Book Art'
       - 'Ch {ch_num}', 'Chapter {ch_num}', '{ch_num} - Art'
    3. Fallback for whole-book jobs ('00', '0', or 'book'): any project subfolder with 'book' and 'art'.
    """
    ch_num = (chapter_number or "").strip()
    ch_num_clean = ch_num.lstrip("0") if ch_num.lstrip("0") else "0"
    ch_num_padded = ch_num.zfill(2)

    img_exts = (".eps", ".tif", ".tiff", ".jpg", ".jpeg", ".png", ".pdf")

    # 1. Candidate folders inside chapter_dir
    if chapter_dir and os.path.exists(chapter_dir):
        for sub in ["Art", "art", "Links", "links", "ART"]:
            c = os.path.join(chapter_dir, sub)
            if os.path.exists(c) and os.path.isdir(c) and len(os.listdir(c)) > 0:
                return c

    if not project_dir or not os.path.exists(project_dir):
        return None

    # 2. Known project-level naming patterns
    possible_names = [
        f"Ch {ch_num} - Art", f"Ch {ch_num_clean} - Art", f"Ch {ch_num_padded} - Art",
        f"Ch_{ch_num}_Art", f"Ch_{ch_num_clean}_Art", f"Ch_{ch_num_padded}_Art",
        f"Chapter {ch_num} - Art", f"Chapter {ch_num_clean} - Art", f"Chapter {ch_num_padded} - Art",
        f"Book {ch_num} - Art", f"Book {ch_num_clean} - Art", f"Book {ch_num_padded} - Art",
        f"Book {ch_num}- Art", f"Book {ch_num_clean}- Art", f"Book {ch_num_padded}- Art",
        f"Book_{ch_num}_Art", f"Book_{ch_num_clean}_Art", f"Book_{ch_num_padded}_Art",
        f"Book {ch_num} Art", f"Book {ch_num_clean} Art", f"Book {ch_num_padded} Art",
        "Book 00 - Art", "Book 0 - Art", "Book - Art", "Book- Art", "Book_Art", "Book Art",
        f"Ch {ch_num}", f"Ch {ch_num_clean}", f"Ch {ch_num_padded}",
        f"Chapter {ch_num}", f"Chapter {ch_num_clean}", f"Chapter {ch_num_padded}",
        f"{ch_num} - Art", f"{ch_num_clean} - Art", f"{ch_num_padded} - Art",
        f"{ch_num}_Art", f"{ch_num_clean}_Art", f"{ch_num_padded}_Art",
        "Art", "art", "Links", "links",
    ]
    possible_names_lower = {n.lower() for n in possible_names}

    for entry in os.listdir(project_dir):
        entry_path = os.path.join(project_dir, entry)
        if os.path.isdir(entry_path):
            if entry.lower() in possible_names_lower:
                for sub in ["Art", "art", "Links", "links", "ART"]:
                    sub_path = os.path.join(entry_path, sub)
                    if os.path.exists(sub_path) and os.path.isdir(sub_path) and len(os.listdir(sub_path)) > 0:
                        return sub_path
                if any(f.lower().endswith(img_exts) for f in os.listdir(entry_path)):
                    return entry_path

    # 3. Fallback for book-level manuscripts (00 or 0 or 'book' in ch_num)
    if ch_num in ("00", "0") or "book" in ch_num.lower():
        for entry in os.listdir(project_dir):
            entry_path = os.path.join(project_dir, entry)
            if os.path.isdir(entry_path):
                el = entry.lower()
                if "book" in el and "art" in el:
                    for sub in ["Art", "art", "Links", "links", "ART"]:
                        sub_path = os.path.join(entry_path, sub)
                        if os.path.exists(sub_path) and os.path.isdir(sub_path) and len(os.listdir(sub_path)) > 0:
                            return sub_path
                    if any(f.lower().endswith(img_exts) for f in os.listdir(entry_path)):
                        return entry_path

    return None


def resolve_project_common_art_files(project_dir: str, db: Session = None, project_id: int = None) -> list[str]:
    """Find all common art files (.ai, .eps, .tif, .jpg, .png, etc.) for a project.

    Searches:
    1. Known project common art folders:
       - <project_dir>/Design/template/Common Art
       - <project_dir>/Design/template/Common_Art
       - <project_dir>/Design/Common Art
       - <project_dir>/Design/Common_Art
       - <project_dir>/template/Common Art
       - <project_dir>/template/Common_Art
    2. Any subfolder inside <project_dir>/Design or <project_dir>/Design/template whose name
       case-insensitively contains 'common' and 'art'.
    3. Database records (if db and project_id are provided) where category matches 'common art' or 'template/common art'.
    Returns a deduplicated list of verified physical file paths.
    """
    found_paths = []
    seen_names = set()

    def add_file(p: str):
        if not p or not os.path.exists(p) or not os.path.isfile(p):
            return
        abs_p = os.path.abspath(p)
        fname_lower = os.path.basename(abs_p).lower()
        if fname_lower not in seen_names:
            seen_names.add(fname_lower)
            found_paths.append(abs_p)

    if project_dir and os.path.exists(project_dir):
        candidate_subdirs = [
            os.path.join(project_dir, "Design", "template", "Common Art"),
            os.path.join(project_dir, "Design", "template", "Common_Art"),
            os.path.join(project_dir, "Design", "Common Art"),
            os.path.join(project_dir, "Design", "Common_Art"),
            os.path.join(project_dir, "template", "Common Art"),
            os.path.join(project_dir, "template", "Common_Art"),
        ]
        # Dynamic scan of Design folder
        design_dir = os.path.join(project_dir, "Design")
        if os.path.exists(design_dir):
            for root, dirs, _ in os.walk(design_dir):
                dirs[:] = [d for d in dirs if d.lower() != "archive"]
                for d in dirs:
                    d_clean = d.lower().replace("_", " ").strip()
                    if "common" in d_clean and "art" in d_clean:
                        candidate_subdirs.append(os.path.join(root, d))

        for folder in candidate_subdirs:
            if os.path.exists(folder) and os.path.isdir(folder):
                for root, dirs, files in os.walk(folder):
                    dirs[:] = [d for d in dirs if d.lower() != "archive"]
                    if "archive" in root.lower().replace("\\", "/").split("/"):
                        continue
                    for file in files:
                        if not file.startswith("."):
                            add_file(os.path.join(root, file))

    if db and project_id:
        try:
            from app.domains.processing.service import resolve_physical_file_path
            db_files = db.query(models.File).filter(
                models.File.project_id == project_id,
                func.lower(models.File.category).in_([
                    "common art", "common_art", "commonart",
                    "template/common art", "template/common_art", "template/commonart",
                    "template_common_art"
                ])
            ).all()
            for db_f in db_files:
                if db_f.path:
                    phys = resolve_physical_file_path(db_f.path, UPLOAD_DIR)
                    if phys and os.path.exists(phys):
                        add_file(phys)
        except Exception:
            pass

    return found_paths


def save_upload_file(upload_file: UploadFile, destination: str):
    try:
        with open(destination, "wb") as buffer:
            shutil.copyfileobj(upload_file.file, buffer)
    finally:
        upload_file.file.close()

def create_file_record(db: Session, project_id: int, file: UploadFile, actor_user_id: int | None = None):
    # Determine local path (mocking S3 for now)
    # Using timestamp to avoid collisions
    timestamp = now_ist_naive().strftime("%Y%m%d%H%M%S")
    filename = f"{project_id}_{timestamp}_{file.filename}"
    path = os.path.join(UPLOAD_DIR, filename)
    
    save_upload_file(file, path)
    
    db_file = models.File(
        project_id=project_id,
        path=path,
        file_type=file.content_type,
        version=1, # Logic for version bumping can be added here
        uploaded_by_id=actor_user_id,
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)
    return db_file


def get_project_and_chapter(db: Session, *, project_id: int, chapter_id: int):
    project = db.query(Project).filter(Project.id == project_id).first()
    chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == chapter_id).first()
    return project, chapter


def upload_chapter_files(
    db: Session,
    *,
    project_id: int,
    chapter_id: int,
    category: str,
    files: list[UploadFile],
    actor_user_id: int,
    upload_dir: str,
):
    project, chapter = get_project_and_chapter(db, project_id=project_id, chapter_id=chapter_id)
    if not project or not chapter:
        return {"project": project, "chapter": chapter, "uploaded": [], "skipped": []}

    uploaded_results = []
    skipped_results = []

    # Normalize category string (e.g., "Final delivery", "misc", "miscellaneous" -> "Misc")
    cat_lower = (category or "").strip().lower()
    if cat_lower in ("misc", "final delivery", "final_delivery", "miscellaneous"):
        normalized_category = "Misc"
    elif cat_lower in ("xml",):
        normalized_category = "XML"
    elif cat_lower in ("proof",):
        normalized_category = "Proof"
    elif cat_lower in ("indesign", "design"):
        normalized_category = "InDesign"
    elif cat_lower in ("manuscript",):
        normalized_category = "Manuscript"
    elif cat_lower in ("art",):
        normalized_category = "Art"
    else:
        normalized_category = category

    for upload in files:
        if not upload.filename:
            continue

        is_delivery_xml = any(upload.filename.lower().endswith(s) for s in ["epub.xml", "_epub.xml", "_final.xml", "_final.log", "_layout.html"])

        if normalized_category in ("Misc", "Proof", "InDesign", "Manuscript", "Art"):
            if is_delivery_xml and normalized_category == "Misc":
                file_category = "Misc"
            elif upload.filename.lower().endswith((".xml", ".log")) and normalized_category not in ("Misc", "Proof", "InDesign"):
                file_category = "XML"
            else:
                file_category = normalized_category
        elif is_delivery_xml:
            file_category = "Misc"
        elif upload.filename.lower().endswith((".xml", ".log")):
            file_category = "XML"
        else:
            file_category = normalized_category

        if upload.filename.lower().endswith(".zip") and any(c in (category or "") for c in ["Design", "Art", "InDesign", "template"]):
            import zipfile
            import io
            try:
                zip_data = upload.file.read()
                upload.file.seek(0)
                with zipfile.ZipFile(io.BytesIO(zip_data)) as z:
                    for member in z.namelist():
                        fname = os.path.basename(member)
                        if not fname or member.endswith("/") or "__MACOSX" in member or fname.startswith("."):
                            continue

                        is_member_delivery = any(fname.lower().endswith(s) for s in ["epub.xml", "_epub.xml", "_final.xml", "_final.log", "_layout.html"])
                        if normalized_category in ("Misc", "Proof", "InDesign"):
                            if is_member_delivery and normalized_category == "Misc":
                                member_category = "Misc"
                            elif fname.lower().endswith((".xml", ".log")) and normalized_category not in ("Misc", "Proof", "InDesign"):
                                member_category = "XML"
                            else:
                                member_category = normalized_category
                        elif is_member_delivery:
                            member_category = "Misc"
                        elif fname.lower().endswith((".xml", ".log")):
                            member_category = "XML"
                        else:
                            member_category = normalized_category

                        member_literal_base = f"{upload_dir}/{project.client_name or 'unknown'}/{project.code}/{chapter.number}/{member_category}"
                        member_safe_cat = member_category.replace(" ", "_")
                        member_safe_base = f"{upload_dir}/{project.client_name or 'unknown'}/{project.code}/{chapter.number}/{member_safe_cat}"
                        if os.path.exists(member_literal_base):
                            member_base_path = member_literal_base
                        elif os.path.exists(member_safe_base):
                            member_base_path = member_safe_base
                        elif os.path.exists(os.path.dirname(member_literal_base)):
                            member_base_path = member_literal_base
                        else:
                            member_base_path = member_safe_base
                        os.makedirs(member_base_path, exist_ok=True)

                        existing_file = db.query(models.File).filter(
                            models.File.project_id == project_id,
                            models.File.chapter_id == chapter_id,
                            func.lower(models.File.filename) == fname.lower(),
                        ).first()

                        if existing_file:
                            if checkout_service.is_locked_by_other(existing_file, actor_user_id):
                                skipped_results.append(
                                    {
                                        "filename": f"{upload.filename} -> {fname}",
                                        "code": "LOCKED_BY_OTHER",
                                        "message": "File is locked by another user.",
                                    }
                                )
                                continue

                            version_entry = version_service.archive_existing_file(
                                db,
                                existing_file=existing_file,
                                base_path=member_base_path,
                                uploaded_by_id=actor_user_id,
                            )

                            existing_file.category = member_category
                            file_path = existing_file.path
                            if not file_path or not os.path.isabs(file_path):
                                file_path = f"{member_base_path}/{fname}"
                                existing_file.path = file_path
                            os.makedirs(os.path.dirname(file_path), exist_ok=True)

                            with z.open(member) as src, open(file_path, "wb") as dst:
                                shutil.copyfileobj(src, dst)

                            existing_file.version = (existing_file.version or 1) + 1
                            existing_file.uploaded_at = now_ist_naive()
                            existing_file.uploaded_by_id = actor_user_id
                            checkout_service.reset_checkout_after_overwrite(existing_file)
                            uploaded_results.append(
                                {
                                    "file": existing_file,
                                    "operation": "replaced",
                                    "archive_entry": version_entry,
                                }
                            )
                        else:
                            file_path = f"{member_base_path}/{fname}"
                            with z.open(member) as src, open(file_path, "wb") as dst:
                                shutil.copyfileobj(src, dst)

                            ext = fname.split(".")[-1].lower() if "." in fname else ""
                            db_file = models.File(
                                project_id=project_id,
                                chapter_id=chapter_id,
                                filename=fname,
                                file_type=ext,
                                category=member_category,
                                path=file_path,
                                version=1,
                                uploaded_by_id=actor_user_id,
                            )
                            db.add(db_file)
                            uploaded_results.append(
                                {
                                    "file": db_file,
                                    "operation": "created",
                                    "archive_entry": None,
                                }
                            )
            except Exception as zip_err:
                skipped_results.append(
                    {
                        "filename": upload.filename,
                        "code": "INVALID_ZIP",
                        "message": f"Failed to extract ZIP: {str(zip_err)}",
                    }
                )
        else:
            file_literal_base = f"{upload_dir}/{project.client_name or 'unknown'}/{project.code}/{chapter.number}/{file_category}"
            file_safe_cat = file_category.replace(" ", "_")
            file_safe_base = f"{upload_dir}/{project.client_name or 'unknown'}/{project.code}/{chapter.number}/{file_safe_cat}"
            if os.path.exists(file_literal_base):
                file_base_path = file_literal_base
            elif os.path.exists(file_safe_base):
                file_base_path = file_safe_base
            elif os.path.exists(os.path.dirname(file_literal_base)):
                file_base_path = file_literal_base
            else:
                file_base_path = file_safe_base
            os.makedirs(file_base_path, exist_ok=True)

            existing_file = db.query(models.File).filter(
                models.File.project_id == project_id,
                models.File.chapter_id == chapter_id,
                func.lower(models.File.filename) == upload.filename.lower(),
            ).first()

            if existing_file:
                if checkout_service.is_locked_by_other(existing_file, actor_user_id):
                    skipped_results.append(
                        {
                            "filename": upload.filename,
                            "code": "LOCKED_BY_OTHER",
                            "message": "File is locked by another user.",
                        }
                    )
                    continue

                version_entry = version_service.archive_existing_file(
                    db,
                    existing_file=existing_file,
                    base_path=file_base_path,
                    uploaded_by_id=actor_user_id,
                )

                existing_file.category = file_category
                file_path = existing_file.path
                if not file_path or not os.path.isabs(file_path):
                    file_path = f"{file_base_path}/{upload.filename}"
                    existing_file.path = file_path
                os.makedirs(os.path.dirname(file_path), exist_ok=True)

                with open(file_path, "wb") as buffer:
                    shutil.copyfileobj(upload.file, buffer)

                existing_file.version = (existing_file.version or 1) + 1
                existing_file.uploaded_at = now_ist_naive()
                existing_file.uploaded_by_id = actor_user_id
                checkout_service.reset_checkout_after_overwrite(existing_file)
                uploaded_results.append(
                    {
                        "file": existing_file,
                        "operation": "replaced",
                        "archive_entry": version_entry,
                    }
                )
            else:
                file_path = f"{file_base_path}/{upload.filename}"
                with open(file_path, "wb") as buffer:
                    shutil.copyfileobj(upload.file, buffer)

                ext = upload.filename.split(".")[-1].lower() if "." in upload.filename else ""
                db_file = models.File(
                    project_id=project_id,
                    chapter_id=chapter_id,
                    filename=upload.filename,
                    file_type=ext,
                    category=file_category,
                    path=file_path,
                    version=1,
                    uploaded_by_id=actor_user_id,
                )
                db.add(db_file)
                uploaded_results.append(
                    {
                        "file": db_file,
                        "operation": "created",
                        "archive_entry": None,
                    }
                )

    db.commit()
    return {
        "project": project,
        "chapter": chapter,
        "uploaded": uploaded_results,
        "skipped": skipped_results,
    }


def get_file_for_download(db: Session, *, file_id: int):
    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record or not file_record.path:
        return None

    # Check if path is already an existing absolute path
    if os.path.isabs(file_record.path) and os.path.exists(file_record.path):
        file_record.physical_path = file_record.path
        return file_record

    # Resolve relative path using UPLOAD_DIR
    from app.domains.processing.service import resolve_physical_file_path
    physical_path = resolve_physical_file_path(file_record.path, UPLOAD_DIR)
    if os.path.exists(physical_path):
        file_record.physical_path = physical_path
        return file_record

    # Additional fallback using project and chapter hierarchy
    project = db.query(models.Project).filter(models.Project.id == file_record.project_id).first() if file_record.project_id else None
    chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == file_record.chapter_id).first() if file_record.chapter_id else None
    if project and chapter:
        for cat in [file_record.category, (file_record.category or '').replace(" ", "_"), (file_record.category or '').capitalize()]:
            candidate = os.path.join(UPLOAD_DIR, project.client_name or 'unknown', project.code, chapter.number or chapter.chapters, cat, file_record.filename)
            if os.path.exists(candidate):
                file_record.physical_path = candidate
                return file_record

    return None


def delete_file_and_capture_context(db: Session, *, file_id: int):
    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        return None

    context = {
        "project_id": file_record.project_id,
        "chapter_id": file_record.chapter_id,
        "category": file_record.category,
    }

    physical_path = file_record.path
    if physical_path and (not os.path.isabs(physical_path) or not os.path.exists(physical_path)):
        from app.domains.processing.service import resolve_physical_file_path
        physical_path = resolve_physical_file_path(physical_path, UPLOAD_DIR)

    if physical_path and os.path.exists(physical_path):
        try:
            # Also clean up the corresponding XHTML file if it exists
            dir_name = os.path.dirname(physical_path)
            base_name = os.path.splitext(os.path.basename(physical_path))[0]
            xhtml_path = os.path.join(dir_name, "xhtml", f"{base_name}.html")
            if os.path.exists(xhtml_path):
                try:
                    os.remove(xhtml_path)
                except Exception as e:
                    print(f"Error deleting associated XHTML file on disk: {e}")

            os.remove(physical_path)
        except Exception as e:
            print(f"Error deleting file on disk: {e}")

    db.delete(file_record)
    db.commit()
    return context


def get_processed_docx_path(db: Session, file_id: int, logger=None):
    from app.domains.review.service import resolve_processed_target
    from fastapi import HTTPException
    try:
        resolved = resolve_processed_target(db, file_id=file_id)
        return resolved["processed_path"]
    except HTTPException:
        return None
    except Exception as e:
        if logger:
            logger.warning(f"Could not resolve processed path for file {file_id}: {e}")
        return None
