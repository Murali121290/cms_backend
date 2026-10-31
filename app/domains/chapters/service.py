import os
import shutil

from sqlalchemy.orm import Session

from app import models
from app.domains.projects.models import Project


_CHAPTER_CATEGORIES = ["Manuscript", "Art", "InDesign", "Proof", "XML", "Backup"]


def create_chapter(db: Session, *, project_id: int, number: str, title: str, upload_dir: str, status: str = "In-progress", workflow_name: str | None = None):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return {"project": None, "chapter": None}

    from app.routers.api_v2 import resolve_track_workflow
    wf_name, first_stage = resolve_track_workflow(db, project, number, requested_wf=workflow_name)

    new_chapter = models.ChapterInfo(
        client=project.division_code or "",
        project=project.project_code or "",
        chapters=number,
        chapter_title=title,
        status=status,
        stage_name=first_stage,
        workflow=wf_name or "Workflow1",
        priority=getattr(project, "priority", None) or "Normal",
        complexity_level=getattr(project, "composition", None) or "Medium",
        project_manager_name=getattr(project, "project_manager", None) or None,
    )
    db.add(new_chapter)

    if project.chapter_count is not None:
        project.chapter_count += 1
    else:
        project.chapter_count = 1

    db.commit()
    db.refresh(new_chapter)
    db.refresh(project)

    chapter_base_dir = f"{upload_dir}/{project.client_name or 'unknown'}/{project.code}/{number}"
    for category in _CHAPTER_CATEGORIES:
        os.makedirs(os.path.join(chapter_base_dir, category), exist_ok=True)

    return {"project": project, "chapter": new_chapter}


def reset_chapter_for_revision(
    db: Session,
    *,
    project_id: int,
    chapter_id: int,
    upload_dir: str,
    title: str | None = None,
    workflow_name: str | None = None,
):
    from app.domains.workflow.models import ChapterInfo, StageDetail
    from app.routers.api_v2 import resolve_track_workflow

    project = db.query(Project).filter(Project.id == project_id).first()
    chapter = db.query(ChapterInfo).filter(ChapterInfo.id == chapter_id).first()
    if not project or not chapter:
        return {"project": project, "chapter": chapter}

    old_rev = chapter.revision or 1
    new_rev = old_rev + 1

    # 1. Archive/Backup current chapter folder to _old_v{old_rev}
    chapter_base_dir = f"{upload_dir}/{project.client_name or 'unknown'}/{project.code}/{chapter.chapters}"
    backup_cat_dir = os.path.join(chapter_base_dir, "Backup")
    os.makedirs(backup_cat_dir, exist_ok=True)

    if os.path.exists(chapter_base_dir):
        backup_dir = f"{chapter_base_dir}_old_v{old_rev}"
        try:
            # If target backup_dir already exists, remove or merge
            if os.path.exists(backup_dir):
                shutil.rmtree(backup_dir, ignore_errors=True)
            shutil.copytree(chapter_base_dir, backup_dir)
        except Exception:
            pass

    # 2. Re-point existing active files to Backup category with rev tag
    existing_files = db.query(models.File).filter(
        models.File.chapter_id == chapter.id,
        models.File.category != "Backup"
    ).all()

    for ef in existing_files:
        try:
            old_path = ef.path
            fname = ef.filename
            name_parts = fname.rsplit(".", 1)
            ext = f".{name_parts[1]}" if len(name_parts) > 1 else ""
            base = name_parts[0]
            backup_fname = f"{base}_rev{old_rev}{ext}"
            new_dest_path = os.path.join(backup_cat_dir, backup_fname)

            if old_path and os.path.exists(old_path):
                shutil.copy2(old_path, new_dest_path)
                ef.path = new_dest_path
            ef.filename = backup_fname
            ef.category = "Backup"
            ef.version = old_rev
        except Exception:
            pass

    # 3. Clean active category directories (Manuscript, Art, InDesign, Proof, XML) for the new revision
    for category in ["Manuscript", "Art", "InDesign", "Proof", "XML"]:
        cat_dir = os.path.join(chapter_base_dir, category)
        if os.path.exists(cat_dir):
            shutil.rmtree(cat_dir, ignore_errors=True)
        os.makedirs(cat_dir, exist_ok=True)

    # 4. Resolve starting stage & workflow
    wf_name, first_stage = resolve_track_workflow(db, project, chapter.chapters, requested_wf=workflow_name)

    # 5. Remove existing stages_details so chapter appears in Planning as pending approval
    db.query(StageDetail).filter(
        StageDetail.project == (project.project_code or ""),
        StageDetail.chapters == chapter.chapters,
    ).delete(synchronize_session=False)

    # 6. Reset chapter state
    from app.utils.timezone import now_ist_naive
    chapter.revision = new_rev
    chapter.status = "Received"
    chapter.stage_name = first_stage
    chapter.due_date = None
    chapter.current_assignee_name = None
    chapter.delayed_stages = None
    chapter.workflow = wf_name or chapter.workflow or "Workflow1"
    chapter.updated_at = now_ist_naive()
    if title:
        chapter.chapter_title = title

    db.commit()
    db.refresh(chapter)
    db.refresh(project)

    # 7. Sync any existing physical backups into models.File
    try:
        sync_chapter_backup_files(db, project=project, chapter=chapter, upload_dir=upload_dir)
    except Exception:
        pass

    return {"project": project, "chapter": chapter}


def sync_chapter_backup_files(db: Session, *, project: Project, chapter: models.ChapterInfo, upload_dir: str):
    """
    Scans the disk for previous revision folders (_old_v*) and Backup/ folder
    for the chapter, ensuring corresponding models.File(category='Backup') exist.
    """
    import glob
    import re
    from datetime import datetime

    client_folder = project.client_name or "unknown"
    project_code = project.code or ""
    ch_num = chapter.chapters
    base_dir = f"{upload_dir}/{client_folder}/{project_code}"
    chapter_dir = f"{base_dir}/{ch_num}"
    backup_cat_dir = os.path.join(chapter_dir, "Backup")

    # 1. Scan {ch}_old_v{rev} directories
    old_dirs = glob.glob(f"{base_dir}/{ch_num}_old_v*")
    synced_filenames = set()
    for old_dir in sorted(old_dirs):
        m = re.search(r"_old_v(\d+)$", old_dir)
        rev_num = int(m.group(1)) if m else 1
        for root, dirs, files in os.walk(old_dir):
            if "backup" in root.lower():
                continue
            for fname in files:
                if fname.startswith("."):
                    continue
                file_disk_path = os.path.join(root, fname)
                name_parts = fname.rsplit(".", 1)
                ext = f".{name_parts[1]}" if len(name_parts) > 1 else ""
                base_name = name_parts[0]
                backup_display_name = f"{base_name}_rev{rev_num}{ext}"

                if backup_display_name in synced_filenames:
                    continue
                synced_filenames.add(backup_display_name)

                # Check if this backup file is already recorded in models.File
                existing = db.query(models.File).filter(
                    models.File.chapter_id == chapter.id,
                    models.File.category == "Backup",
                    models.File.filename == backup_display_name,
                ).first()

                # Also ensure physical copy in chapter/Backup
                os.makedirs(backup_cat_dir, exist_ok=True)
                canonical_path = os.path.join(backup_cat_dir, backup_display_name)
                if not os.path.exists(canonical_path):
                    try:
                        shutil.copy2(file_disk_path, canonical_path)
                    except Exception:
                        canonical_path = file_disk_path

                if not existing:
                    mtime = os.path.getmtime(file_disk_path) if os.path.exists(file_disk_path) else None
                    up_at = datetime.fromtimestamp(mtime) if mtime else None

                    new_file = models.File(
                        project_id=project.id,
                        chapter_id=chapter.id,
                        category="Backup",
                        filename=backup_display_name,
                        path=canonical_path,
                        file_type=ext.lstrip(".").lower() if ext else "",
                        version=rev_num,
                        is_original=True,
                        uploaded_at=up_at,
                    )
                    db.add(new_file)

    # 2. Also scan {chapter}/Backup folder directly for any files already in Backup
    if os.path.exists(backup_cat_dir):
        for fname in os.listdir(backup_cat_dir):
            if fname.startswith(".") or fname in synced_filenames:
                continue
            file_disk_path = os.path.join(backup_cat_dir, fname)
            if not os.path.isfile(file_disk_path):
                continue
            existing = db.query(models.File).filter(
                models.File.chapter_id == chapter.id,
                models.File.category == "Backup",
                models.File.filename == fname,
            ).first()
            if not existing:
                m = re.search(r"_rev(\d+)", fname)
                rev_num = int(m.group(1)) if m else 1
                name_parts = fname.rsplit(".", 1)
                ext = f".{name_parts[1]}" if len(name_parts) > 1 else ""
                mtime = os.path.getmtime(file_disk_path)
                up_at = datetime.fromtimestamp(mtime) if mtime else None

                new_file = models.File(
                    project_id=project.id,
                    chapter_id=chapter.id,
                    category="Backup",
                    filename=fname,
                    path=file_disk_path,
                    file_type=ext.lstrip(".").lower() if ext else "",
                    version=rev_num,
                    is_original=True,
                    uploaded_at=up_at,
                )
                db.add(new_file)

    db.commit()


def rename_chapter(
    db: Session,
    *,
    project_id: int,
    chapter_id: int,
    number: str,
    title: str,
    upload_dir: str,
):
    chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == chapter_id).first()
    project = db.query(Project).filter(Project.id == project_id).first()

    if not chapter or not project:
        return {"project": project, "chapter": chapter}

    old_number = chapter.chapters
    chapter.chapters = number
    chapter.chapter_title = title
    db.commit()

    if old_number != number:
        old_dir = f"{upload_dir}/{project.client_name or 'unknown'}/{project.code}/{old_number}"
        new_dir = f"{upload_dir}/{project.client_name or 'unknown'}/{project.code}/{number}"
        if os.path.exists(old_dir):
            os.rename(old_dir, new_dir)

    return {"project": project, "chapter": chapter}


def delete_chapter_primary(db: Session, *, project_id: int, chapter_id: int, upload_dir: str):
    chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == chapter_id).first()
    project = db.query(Project).filter(Project.id == project_id).first()

    if not chapter or not project:
        return {"project": project, "chapter": chapter}

    # 1. Clean up physical files on disk for all files belonging to this chapter
    from app.domains.processing.service import resolve_physical_file_path
    from app.domains.workflow.models import StageDetail
    from app.models import File, ProcessingJob

    files = db.query(File).filter(File.chapter_id == chapter.id).all()
    for f in files:
        phys_path = f.path
        if phys_path:
            if not os.path.isabs(phys_path) or not os.path.exists(phys_path):
                phys_path = resolve_physical_file_path(phys_path, upload_dir)
            if phys_path and os.path.exists(phys_path):
                try:
                    dir_name = os.path.dirname(phys_path)
                    base_name = os.path.splitext(os.path.basename(phys_path))[0]
                    xhtml_path = os.path.join(dir_name, "xhtml", f"{base_name}.html")
                    if os.path.exists(xhtml_path):
                        try:
                            os.remove(xhtml_path)
                        except Exception:
                            pass
                    if os.path.isfile(phys_path):
                        os.remove(phys_path)
                except Exception:
                    pass

    # Also remove chapter directory if it exists
    chapter_dir = f"{upload_dir}/{project.client_name or 'unknown'}/{project.code}/{chapter.chapters}"
    if os.path.exists(chapter_dir):
        shutil.rmtree(chapter_dir, ignore_errors=True)

    # 2. Delete non-FK workflow stage details for this project & chapter
    db.query(StageDetail).filter(
        StageDetail.project == (project.project_code or project.code or ""),
        StageDetail.chapters == chapter.chapters,
    ).delete(synchronize_session=False)

    # 3. Clean up any ProcessingJob entries associated with this project and chapter
    db.query(ProcessingJob).filter(
        ProcessingJob.project_code == (project.project_code or project.code or ""),
        ProcessingJob.chapter_number == chapter.chapters,
    ).delete(synchronize_session=False)

    # 4. Delete the chapter (CASCADE will delete File rows, FileVersion, Comments, etc.)
    db.delete(chapter)
    if project.chapter_count is not None and project.chapter_count > 0:
        project.chapter_count -= 1

    # 5. Check if project has any remaining manuscript chapters.
    # If no chapters remain, remove any leftover mapping zip so it doesn't resurrect deleted chapter files in mapping.
    remaining_chapters = db.query(models.ChapterInfo).filter(
        models.ChapterInfo.project == (project.project_code or project.code or ""),
        models.ChapterInfo.id != chapter.id
    ).all()
    non_virtual = [c for c in remaining_chapters if c.chapters not in ("Design", "CE support")]
    if len(non_virtual) == 0:
        proj_dir = f"{upload_dir}/{project.client_name or 'unknown'}/{project.code}"
        mapping_zip = os.path.join(proj_dir, f"{project.code}_mapping.zip")
        if os.path.exists(mapping_zip):
            try:
                os.remove(mapping_zip)
            except Exception:
                pass

    db.commit()
    db.refresh(project)
    return {"project": project, "chapter": chapter}


def delete_chapter_secondary(db: Session, *, project_id: int, chapter_id: int, upload_dir: str):
    return delete_chapter_primary(db, project_id=project_id, chapter_id=chapter_id, upload_dir=upload_dir)

