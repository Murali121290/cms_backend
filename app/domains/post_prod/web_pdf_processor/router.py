import os
import shutil
import fitz
from typing import Optional, Any, List, Dict
from fastapi import APIRouter, Depends, Form, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from app.database import get_db
from app.core.config import get_settings
from app.domains.auth.security import get_current_user_from_cookie, get_user_full_name
from app.domains.auth.rbac_config import has_post_prod_access

def _actor_name(u: Any) -> Optional[str]:
    return get_user_full_name(u) or (getattr(u, "username", None) if u else None)

from .models import WebPdfProject
from .services import web_pdf_projects_db, font_service, security_service
from .services.upload_service import process_upload
from .services.merge_service import categorize_file, merge_pdfs
from .services.trim_service import trim_crop_engine
from .services import toc_service
from .services import url_service
from .services import email_service
from .services import endnote_service
from .services import reference_citation_service
from .services import crossref_service
from .services import index_service
from .services import glossary_service
from .services import validation_diff_service


def check_post_prod_access(user=Depends(get_current_user_from_cookie)):
    if not user or not has_post_prod_access(user):
        raise HTTPException(
            status_code=403, detail="Access denied to Post Production / Backlist."
        )
    return user


def update_validation_status(project_obj: WebPdfProject):
    """Update validation_status based on workflow progress."""
    if not project_obj.status:
        project_obj.validation_status = "Yet to start"
    elif project_obj.status in ("Crossref Linked", "Index Linked", "Glossary Linked"):
        project_obj.validation_status = "Completed"
    else:
        project_obj.validation_status = "In-Progress"


router = APIRouter(
    prefix="/post-prod/web-pdf-processor",
    tags=["Web PDF Processor"],
)


@router.get("/health")
def health_check():
    return {"status": "healthy"}


@router.get("/projects")
def list_projects(
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """List all non-deleted Web PDF projects."""
    return web_pdf_projects_db.list_projects(db)


@router.post("/projects")
async def create_project(
    client: str = Form(...),
    client_code: str = Form(""),
    project_name: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    # Check if an active project with the same name already exists
    existing = web_pdf_projects_db.get_project_by_folder(db, project_name.strip())
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Project name '{project_name.strip()}' is already taken."
        )

    result = await process_upload(
        file=file,
        client_code=client_code,
        project_name=project_name,
    )

    if not result.get("status"):
        raise HTTPException(status_code=400, detail=result.get("message", "Upload failed"))

    project = web_pdf_projects_db.create_project(
        db,
        client=client,
        client_code=client_code or None,
        project_name=project_name,
        folder_name=result["folder_name"],
        pdf_path=result["pdf_path"],
        total_files=result.get("total_files", 0),
        user_id=user.id if user else None,
        assignee=None,
    )
    return {"message": "Project created successfully", "project": project}


class ProjectUpdateRequest(BaseModel):
    assignee: Optional[str] = None


@router.put("/projects/{project_id}")
def update_project(
    project_id: int,
    body: ProjectUpdateRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    updated = web_pdf_projects_db.update_project(
        db,
        project_id,
        assignee=body.assignee,
        user_id=user.id if user else None,
        username=_actor_name(user),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    return updated


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Delete project folder from disk
    folder = project.get("folder_name") if isinstance(project, dict) else getattr(project, "folder_name", None)
    if folder and os.path.exists(folder):
        try:
            shutil.rmtree(folder)
        except Exception as e:
            print(f"Warning: Could not delete project folder {folder}: {e}")

    # Hard delete DB record
    success = web_pdf_projects_db.hard_delete_project(db, project_id=project_id)
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"message": "Project deleted successfully"}


@router.get("/projects/{project_id}/files")
def get_project_files(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    extract_dir = os.path.join(project["folder_name"], "extract")
    if not os.path.isdir(extract_dir):
        return []
        
    from .models import WebPdfHistory
    latest_merge = (
        db.query(WebPdfHistory)
        .filter(
            WebPdfHistory.project_id == project_id,
            WebPdfHistory.result_type == "merge",
            WebPdfHistory.merge_status == "success"
        )
        .order_by(WebPdfHistory.created_at.desc())
        .first()
    )
    
    merged_files_map = {}
    if latest_merge and latest_merge.merged_files:
        for index, item in enumerate(latest_merge.merged_files):
            merged_files_map[item.get('filename')] = {
                'category': item.get('category'),
                'order': index
            }
    
    files_list = []
    for root, _, files in os.walk(extract_dir):
        for f in files:
            if f.lower().endswith((".pdf", ".jpg", ".jpeg", ".png")) and not f.startswith("._"):
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, extract_dir)
                
                if f in merged_files_map:
                    category = merged_files_map[f]['category']
                    order = merged_files_map[f]['order']
                else:
                    category, order_guess = categorize_file(full_path)
                    order = 9999 + order_guess if merged_files_map else order_guess
                
                files_list.append({
                    "filename": f,
                    "relative_path": rel_path,
                    "absolute_path": full_path,
                    "category": category,
                    "order": order,
                    "size": os.path.getsize(full_path)
                })
                
    # Sort by suggested order
    files_list.sort(key=lambda x: (x["order"], x["filename"]))
    return files_list


class MergeFile(BaseModel):
    filename: str
    absolute_path: str
    category: str


class MergeRequest(BaseModel):
    files: list[MergeFile]

class LinkRequest(BaseModel):
    link_type: str = "one_way"
    analyze_only: bool = False
    preserve_existing: bool = True

class ManualLinkRequest(BaseModel):
    type: str
    title: str
    source_page: int
    target_page: int


class TrimRequest(BaseModel):
    mode: str
    margins: Optional[list[float]] = None
    standardize_size: bool = False
    remove_marks: bool = False


class BookmarkItem(BaseModel):
    level: int
    title: str
    page: int


@router.post("/projects/{project_id}/merge")
def merge_project_files(
    project_id: int,
    body: MergeRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    project_obj = db.query(WebPdfProject).filter(
        WebPdfProject.id == project_id,
        WebPdfProject.is_deleted.is_(False)
    ).first()
    if not project_obj:
        raise HTTPException(status_code=404, detail="Project not found")

    # Extract absolute paths and categories for merge operation
    input_files_data = [{"absolute_path": f.absolute_path, "category": f.category} for f in body.files]
    merged_output_path = os.path.join(project_obj.folder_name, "output.pdf")

    # Perform merge
    result = merge_pdfs(input_files_data, merged_output_path)

    # Record merge history
    merged_files_data = [
        {"filename": f.filename, "category": f.category, "absolute_path": f.absolute_path}
        for f in body.files
    ]

    if result['success']:
        # Automatically trim to PDF TrimBox by default upon merge
        trim_success, trim_msg = trim_crop_engine(
            pdf_path=merged_output_path,
            mode="trimbox",
            output_path=merged_output_path
        )
        if trim_success:
            project_obj.status = "Trimmed"
            web_pdf_projects_db.record_step_completion(
                db, project_id=project_id, step_name="trim",
                user_id=user.id if user else None,
                username=_actor_name(user),
                details={"mode": "trimbox", "message": "Auto-trimmed to TrimBox on merge", "output": trim_msg}
            )
        else:
            project_obj.status = "Merged"

        # Preserve baseline copy for final comparison validation (AFTER TRIM so margins & coordinates match)
        baseline_path = os.path.join(project_obj.folder_name, "output_baseline.pdf")
        try:
            shutil.copy2(merged_output_path, baseline_path)
        except Exception:
            pass

        web_pdf_projects_db.record_merge_history(
            db,
            project_id=project_id,
            user_id=user.id if user else None,
            username=_actor_name(user),
            merged_files=merged_files_data,
            merged_output_path=merged_output_path,
            total_pages=result['total_pages'],
            merge_status="success",
            details={"auto_trim": "trimbox" if trim_success else f"failed: {trim_msg}"},
        )
        update_validation_status(project_obj)
        db.commit()
        return {"message": "PDF files merged and auto-trimmed successfully", "output_path": merged_output_path}
    else:
        web_pdf_projects_db.record_merge_history(
            db,
            project_id=project_id,
            user_id=user.id if user else None,
            username=_actor_name(user),
            merged_files=merged_files_data,
            merged_output_path=merged_output_path,
            total_pages=0,
            merge_status="failed",
            details={"error": result.get('error')},
        )
        raise HTTPException(status_code=500, detail=f"Failed to merge PDF files: {result.get('error', 'Unknown error')}")


@router.post("/projects/{project_id}/trim")
def trim_project_pdf(
    project_id: int,
    body: TrimRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    output_pdf = os.path.join(project["folder_name"], "output.pdf")
    if not os.path.exists(output_pdf):
        raise HTTPException(status_code=400, detail="Output PDF not found. Please merge files first.")

    success, result_msg = trim_crop_engine(
        pdf_path=output_pdf,
        mode=body.mode,
        margins=body.margins,
        standardize_size=body.standardize_size,
        remove_marks=body.remove_marks,
        output_path=output_pdf
    )
    
    if not success:
        raise HTTPException(status_code=500, detail=f"Trim failed: {result_msg}")

    # Keep baseline synchronized with trimmed dimensions so validation compares equivalent page boxes
    baseline_path = os.path.join(project["folder_name"], "output_baseline.pdf")
    if os.path.exists(baseline_path):
        try:
            trim_crop_engine(
                pdf_path=baseline_path,
                mode=body.mode,
                margins=body.margins,
                standardize_size=body.standardize_size,
                remove_marks=body.remove_marks,
                output_path=baseline_path
            )
        except Exception:
            pass
        
    project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
    if project_obj:
        project_obj.status = "Trimmed"
        update_validation_status(project_obj)
        db.commit()
        web_pdf_projects_db.record_step_completion(
            db, project_id=project_id, step_name="trim",
            user_id=user.id if user else None,
            username=_actor_name(user),
            details={"mode": body.mode, "message": result_msg}
        )

    return {"message": "PDF trimmed successfully", "output_path": output_pdf}


@router.get("/projects/{project_id}/final-pdf")
def get_merged_pdf(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Serve the correct version based on project status
    if project.get("status") == "Bookmarked":
        pdf_path = os.path.join(project["folder_name"], "output.pdf")
    elif project.get("status") == "Trimmed":
        pdf_path = os.path.join(project["folder_name"], "output.pdf")
    else:
        pdf_path = os.path.join(project["folder_name"], "output.pdf")
        
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF not found. Please merge files first.")

    # Determine desired download filename: <project_file_name>.WebPdf.pdf
    source_base = None
    extract_dir = os.path.join(project["folder_name"], "extract")
    if os.path.exists(extract_dir):
        for root, dirs, files in os.walk(extract_dir):
            pdf_files = [f for f in files if f.lower().endswith(".pdf")]
            if len(pdf_files) == 1:
                source_base = os.path.splitext(pdf_files[0])[0]
                break
            elif len(pdf_files) > 1:
                # If multiple PDFs (e.g. chapters), check for main project zip name
                pass

    if not source_base and project.get("pdf_path"):
        source_base = os.path.splitext(os.path.basename(project["pdf_path"]))[0]

    if not source_base:
        source_base = project.get("project_name") or f"project_{project_id}"

    download_filename = f"{source_base}.WebPdf.pdf"

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=download_filename,
        content_disposition_type="inline"
    )


class PageDimensionUpdate(BaseModel):
    page: Optional[int] = None
    width: float = 0.0
    height: float = 0.0
    unit: str = "in"  # 'in', 'mm', 'pt'
    mode: str = "scale"  # 'scale' | 'crop'
    crop_rect: Optional[List[float]] = None  # [x0, y0, x1, y1] in PyMuPDF top-left points


class PageLabelUpdate(BaseModel):
    subset: str = "all"  # 'all' | 'selected' | 'range'
    pages: Optional[str] = None  # e.g. '1-12' or '5, 7-10' (1-based)
    style: str = "D"  # 'D' | 'r' | 'R' | 'a' | 'A' | '' (None)
    prefix: str = ""
    start: int = 1


@router.get("/projects/{project_id}/page-dimensions")
def get_page_dimensions(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Return width and height dimensions for each page in the output PDF."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    pdf_path = os.path.join(project["folder_name"], "output.pdf")
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF not found. Please merge files first.")

    try:
        doc = fitz.open(pdf_path)
        pages_data = []
        for idx, page in enumerate(doc):
            rect = page.rect
            width_pt = round(rect.width, 2)
            height_pt = round(rect.height, 2)
            width_in = round(width_pt / 72.0, 2)
            height_in = round(height_pt / 72.0, 2)
            width_mm = round(width_pt * 25.4 / 72.0, 2)
            height_mm = round(height_pt * 25.4 / 72.0, 2)

            pages_data.append({
                "page": idx + 1,
                "width_pt": width_pt,
                "height_pt": height_pt,
                "width_in": width_in,
                "height_in": height_in,
                "width_mm": width_mm,
                "height_mm": height_mm,
            })
        doc.close()
        return {
            "total_pages": len(pages_data),
            "pages": pages_data,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/projects/{project_id}/page-dimensions")
def update_page_dimensions(
    project_id: int,
    payload: PageDimensionUpdate,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Update page dimensions (cropbox/mediabox) for a single page or all pages."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    pdf_path = os.path.join(project["folder_name"], "output.pdf")
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF not found. Please merge files first.")

    # Convert given width & height to points (pt)
    unit = payload.unit.lower()
    if unit == "in":
        target_w_pt = payload.width * 72.0
        target_h_pt = payload.height * 72.0
    elif unit == "mm":
        target_w_pt = (payload.width / 25.4) * 72.0
        target_h_pt = (payload.height / 25.4) * 72.0
    else:
        target_w_pt = payload.width
        target_h_pt = payload.height

    try:
        doc = fitz.open(pdf_path)
        if payload.page is not None and 1 <= payload.page <= len(doc):
            pages_to_update = [payload.page - 1]
        else:
            pages_to_update = list(range(len(doc)))

        _push_undo_snapshot(project["folder_name"])

        mode = (payload.mode or "scale").lower()
        if mode == "crop":
            for p_idx in pages_to_update:
                page = doc[p_idx]
                cur_rect = page.rect
                mb = page.mediabox
                if payload.crop_rect and len(payload.crop_rect) == 4:
                    cx0, cy0, cx1, cy1 = payload.crop_rect
                    new_rect = fitz.Rect(min(cx0, cx1), min(cy0, cy1), max(cx0, cx1), max(cy0, cy1))
                    new_rect = fitz.Rect(
                        max(mb.x0, new_rect.x0),
                        max(mb.y0, new_rect.y0),
                        min(mb.x1, new_rect.x1),
                        min(mb.y1, new_rect.y1),
                    )
                else:
                    cx = (cur_rect.x0 + cur_rect.x1) / 2.0
                    cy = (cur_rect.y0 + cur_rect.y1) / 2.0
                    new_rect = fitz.Rect(
                        cx - target_w_pt / 2.0,
                        cy - target_h_pt / 2.0,
                        cx + target_w_pt / 2.0,
                        cy + target_h_pt / 2.0,
                    )
                    if (
                        new_rect.x0 < mb.x0
                        or new_rect.y0 < mb.y0
                        or new_rect.x1 > mb.x1
                        or new_rect.y1 > mb.y1
                    ):
                        expanded = mb | new_rect
                        page.set_mediabox(expanded)
                        mb = page.mediabox
                        new_rect = fitz.Rect(
                            max(mb.x0, new_rect.x0),
                            max(mb.y0, new_rect.y0),
                            min(mb.x1, new_rect.x1),
                            min(mb.y1, new_rect.y1),
                        )
                if new_rect.is_empty or new_rect.width < 5 or new_rect.height < 5:
                    doc.close()
                    raise HTTPException(status_code=400, detail="Crop area is too small or outside page bounds")
                page.set_cropbox(new_rect)
        else:
            if target_w_pt <= 0 or target_h_pt <= 0:
                doc.close()
                raise HTTPException(status_code=400, detail="Width and height must be positive")
            toc = doc.get_toc(simple=False)
            labels = doc.get_page_labels()
            meta = doc.metadata
            total_pages = len(doc)
            target_set = set(pages_to_update)
            out_doc = fitz.open()
            scaled_links_per_page: list[tuple[int, list[dict]]] = []

            for p_idx in range(total_pages):
                if p_idx in target_set:
                    orig_page = doc[p_idx]
                    orig_rect = orig_page.rect
                    orig_links = orig_page.get_links()
                    s = min(target_w_pt / orig_rect.width, target_h_pt / orig_rect.height)
                    dx = (target_w_pt - orig_rect.width * s) / 2.0
                    dy = (target_h_pt - orig_rect.height * s) / 2.0
                    dest_rect = fitz.Rect(dx, dy, dx + orig_rect.width * s, dy + orig_rect.height * s)

                    new_p = out_doc.new_page(width=target_w_pt, height=target_h_pt)
                    new_p.show_pdf_page(dest_rect, doc, p_idx, keep_proportion=True)
                    transformed = []
                    for l in orig_links:
                        r = l.get("from")
                        if not r:
                            continue
                        nl = {k: v for k, v in l.items() if k not in ("xref", "id")}
                        nl["from"] = fitz.Rect(
                            dx + (r.x0 - orig_rect.x0) * s,
                            dy + (r.y0 - orig_rect.y0) * s,
                            dx + (r.x1 - orig_rect.x0) * s,
                            dy + (r.y1 - orig_rect.y0) * s,
                        )
                        transformed.append(nl)
                    scaled_links_per_page.append((p_idx, transformed))
                else:
                    out_doc.insert_pdf(doc, from_page=p_idx, to_page=p_idx)

            for p_idx, transformed in scaled_links_per_page:
                for nl in transformed:
                    out_doc[p_idx].insert_link(nl)

            if toc:
                out_doc.set_toc(toc)
            if labels:
                out_doc.set_page_labels(labels)
            if meta:
                out_doc.set_metadata(meta)
            doc.close()
            doc = out_doc

        temp_path = pdf_path.replace(".pdf", "_temp_dim.pdf")
        doc.save(temp_path, incremental=False, deflate=True)
        doc.close()
        os.replace(temp_path, pdf_path)

        action_label = "Cropped" if mode == "crop" else "Scaled"
        size_label = "selected area" if (mode == "crop" and payload.crop_rect) else f"{payload.width} x {payload.height} {payload.unit}"
        return {
            "success": True,
            "message": f"{action_label} ({size_label}) for {'page ' + str(payload.page) if payload.page else 'all pages'}",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _parse_page_range_string(pages_str: str, total_pages: int) -> list[int]:
    """Parse 1-based page range string like '1-12, 15' into sorted 0-based page indices."""
    indices: list[int] = []
    seen: set[int] = set()
    for part in (pages_str or "").split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            bounds = part.split("-", 1)
            try:
                s = max(1, int(bounds[0].strip()))
                e = min(total_pages, int(bounds[1].strip()))
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid page range: '{part}'")
            if s > e:
                s, e = e, s
            for p in range(s - 1, e):
                if p not in seen:
                    seen.add(p)
                    indices.append(p)
        else:
            try:
                p = int(part)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid page number: '{part}'")
            if 1 <= p <= total_pages and (p - 1) not in seen:
                seen.add(p - 1)
                indices.append(p - 1)
    return sorted(indices)


@router.put("/projects/{project_id}/page-labels")
def update_page_labels(
    project_id: int,
    payload: PageLabelUpdate,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Update PDF Page Labels for all pages, selected page, or a custom page range."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    pdf_path = os.path.join(project["folder_name"], "output.pdf")
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF not found. Please merge files first.")

    allowed_styles = {"D", "r", "R", "a", "A", ""}
    if payload.style not in allowed_styles:
        raise HTTPException(status_code=400, detail=f"Unsupported label style: '{payload.style}'")
    if payload.start < 1:
        raise HTTPException(status_code=400, detail="Start page number must be >= 1")

    try:
        doc = fitz.open(pdf_path)
        total_pages = len(doc)
        if total_pages == 0:
            doc.close()
            raise HTTPException(status_code=400, detail="PDF has no pages")

        if payload.subset == "all":
            target_indices = list(range(total_pages))
        else:
            target_indices = _parse_page_range_string(payload.pages or "", total_pages)
            if not target_indices:
                doc.close()
                raise HTTPException(status_code=400, detail="No valid pages specified in page range.")

        # Expand existing page label rules into per-page (style, prefix, number)
        existing_rules = sorted(
            doc.get_page_labels() or [{"startpage": 0, "style": "D", "prefix": "", "firstpagenum": 1}],
            key=lambda r: r.get("startpage", 0),
        )
        per_page: list[tuple[str, str, int]] = []
        rule_idx = 0
        for p_idx in range(total_pages):
            while rule_idx + 1 < len(existing_rules) and existing_rules[rule_idx + 1].get("startpage", 0) <= p_idx:
                rule_idx += 1
            rule = existing_rules[rule_idx]
            r_start = rule.get("startpage", 0)
            r_style = rule.get("style", "") or ""
            r_prefix = rule.get("prefix", "") or ""
            r_first = rule.get("firstpagenum", 1) or 1
            num = r_first + (p_idx - r_start) if r_style else 1
            per_page.append((r_style, r_prefix, num))

        # Apply new label settings to target pages
        for offset, p_idx in enumerate(target_indices):
            num = payload.start + offset if payload.style else 1
            per_page[p_idx] = (payload.style, payload.prefix or "", num)

        # Compress per-page entries back into PyMuPDF page label rules
        compressed: list[dict] = []
        for p_idx, (st, pref, num) in enumerate(per_page):
            need_new_rule = (
                not compressed
                or st != compressed[-1].get("style", "")
                or pref != compressed[-1].get("prefix", "")
                or (st != "" and num != compressed[-1]["firstpagenum"] + (p_idx - compressed[-1]["startpage"]))
            )
            if need_new_rule:
                entry: dict[str, Any] = {
                    "startpage": p_idx,
                    "prefix": pref,
                    "firstpagenum": num,
                }
                if st:
                    entry["style"] = st
                compressed.append(entry)

        doc.set_page_labels(compressed)
        _push_undo_snapshot(project["folder_name"])
        temp_path = pdf_path.replace(".pdf", "_temp_lbl.pdf")
        doc.save(temp_path, incremental=False, deflate=True)
        doc.close()
        os.replace(temp_path, pdf_path)

        return {
            "success": True,
            "message": f"Updated page labels for {len(target_indices)} page(s)",
            "page_labels": compressed,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class PageLinkEditRequest(BaseModel):
    action: str = "update"  # 'update' | 'create' | 'delete'
    page: int  # 1-based page number where the link annotation lives
    xref: Optional[int] = None
    link_index: Optional[int] = None
    rect: Optional[List[float]] = None  # [x0, y0, x1, y1] in PyMuPDF top-left points
    kind: Optional[str] = None  # 'goto' | 'uri'
    target_page: Optional[int] = None  # 1-based destination page for 'goto'
    uri: Optional[str] = None  # destination URL for 'uri'


def _serialize_page_links(page_obj: fitz.Page) -> list[dict]:
    items = []
    for idx, l in enumerate(page_obj.get_links()):
        r = l.get("from")
        if not r:
            continue
        kind_num = l.get("kind")
        kind_str = "goto" if kind_num == fitz.LINK_GOTO else ("uri" if kind_num == fitz.LINK_URI else "other")
        items.append({
            "link_index": idx,
            "xref": l.get("xref"),
            "rect": [round(float(r.x0), 2), round(float(r.y0), 2), round(float(r.x1), 2), round(float(r.y1), 2)],
            "kind": kind_str,
            "target_page": (l["page"] + 1) if l.get("page") is not None else None,
            "uri": l.get("uri"),
        })
    return items


@router.get("/projects/{project_id}/page-links")
def get_page_links(
    project_id: int,
    page: int = Query(1, ge=1),
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Return all link annotations and page dimensions (in pt) for a 1-based page."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    pdf_path = os.path.join(project["folder_name"], "output.pdf")
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF not found. Please merge files first.")

    try:
        doc = fitz.open(pdf_path)
        if page < 1 or page > len(doc):
            total = len(doc)
            doc.close()
            raise HTTPException(status_code=400, detail=f"Page {page} out of range (1-{total})")
        p = doc[page - 1]
        links = _serialize_page_links(p)
        res = {
            "page": page,
            "total_pages": len(doc),
            "width_pt": round(float(p.rect.width), 2),
            "height_pt": round(float(p.rect.height), 2),
            "links": links,
        }
        doc.close()
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/projects/{project_id}/page-links")
def update_page_link(
    project_id: int,
    payload: PageLinkEditRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Create, resize/move/edit, or delete a link annotation on a PDF page."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    pdf_path = os.path.join(project["folder_name"], "output.pdf")
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF not found. Please merge files first.")

    try:
        doc = fitz.open(pdf_path)
        total = len(doc)
        if payload.page < 1 or payload.page > total:
            doc.close()
            raise HTTPException(status_code=400, detail=f"Page {payload.page} out of range (1-{total})")

        p = doc[payload.page - 1]
        existing = p.get_links()

        def _find_target_link():
            if payload.xref is not None:
                for l in existing:
                    if l.get("xref") == payload.xref:
                        return l
            if payload.link_index is not None and 0 <= payload.link_index < len(existing):
                return existing[payload.link_index]
            return None

        if payload.action == "delete":
            target = _find_target_link()
            if not target:
                doc.close()
                raise HTTPException(status_code=404, detail="Link annotation not found")
            p.delete_link(target)
        elif payload.action == "update":
            target = _find_target_link()
            if not target:
                doc.close()
                raise HTTPException(status_code=404, detail="Link annotation not found")
            if not payload.rect or len(payload.rect) != 4:
                doc.close()
                raise HTTPException(status_code=400, detail="rect [x0, y0, x1, y1] is required")
            new_link = dict(target)
            new_link["from"] = fitz.Rect(*payload.rect)
            if payload.kind == "uri" or (payload.uri is not None and payload.kind != "goto"):
                new_link["kind"] = fitz.LINK_URI
                new_link["uri"] = payload.uri or target.get("uri") or ""
                new_link.pop("page", None)
                new_link.pop("to", None)
            elif payload.target_page is not None:
                if payload.target_page < 1 or payload.target_page > total:
                    doc.close()
                    raise HTTPException(status_code=400, detail=f"Target page {payload.target_page} out of range")
                new_link["kind"] = fitz.LINK_GOTO
                new_link["page"] = payload.target_page - 1
                new_link.pop("uri", None)
            p.delete_link(target)
            p.insert_link(new_link)
        elif payload.action == "create":
            if not payload.rect or len(payload.rect) != 4:
                doc.close()
                raise HTTPException(status_code=400, detail="rect [x0, y0, x1, y1] is required")
            new_link: dict[str, Any] = {"from": fitz.Rect(*payload.rect)}
            if payload.kind == "uri" or (payload.uri and payload.kind != "goto"):
                new_link["kind"] = fitz.LINK_URI
                new_link["uri"] = payload.uri or ""
            else:
                tp = payload.target_page or 1
                if tp < 1 or tp > total:
                    doc.close()
                    raise HTTPException(status_code=400, detail=f"Target page {tp} out of range")
                new_link["kind"] = fitz.LINK_GOTO
                new_link["page"] = tp - 1
            p.insert_link(new_link)
        else:
            doc.close()
            raise HTTPException(status_code=400, detail=f"Unsupported action: {payload.action}")

        _push_undo_snapshot(project["folder_name"])
        if doc.can_save_incrementally():
            doc.saveIncr()
            links_after = _serialize_page_links(doc[payload.page - 1])
            doc.close()
        else:
            temp_path = pdf_path.replace(".pdf", "_temp_lnk.pdf")
            doc.save(temp_path, incremental=False, deflate=True)
            doc.close()
            os.replace(temp_path, pdf_path)
            doc2 = fitz.open(pdf_path)
            links_after = _serialize_page_links(doc2[payload.page - 1])
            doc2.close()

        return {
            "success": True,
            "message": f"Link {payload.action}d on page {payload.page}",
            "links": links_after,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class DocumentPropertiesUpdate(BaseModel):
    title: str = ""
    author: str = ""
    subject: str = ""
    keywords: str = ""
    creator: str = ""
    producer: str = ""


@router.get("/projects/{project_id}/document-properties")
def get_document_properties(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Return editable PDF metadata and read-only document properties."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    pdf_path = os.path.join(project["folder_name"], "output.pdf")
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF not found. Please merge files first.")

    try:
        doc = fitz.open(pdf_path)
        meta = doc.metadata or {}
        page_count = len(doc)
        page_size = ""
        if page_count > 0:
            r = doc[0].rect
            w_in = round(r.width / 72.0, 2)
            h_in = round(r.height / 72.0, 2)
            orient = "portrait" if h_in >= w_in else "landscape"
            page_size = f"{w_in} × {h_in} in ({orient})"
        doc.close()
        return {
            "file_size_bytes": os.path.getsize(pdf_path),
            "pdf_version": (meta.get("format") or "PDF 1.7").replace("PDF ", ""),
            "page_count": page_count,
            "page_size": page_size,
            "title": meta.get("title") or "",
            "author": meta.get("author") or "",
            "subject": meta.get("subject") or "",
            "keywords": meta.get("keywords") or "",
            "creator": meta.get("creator") or "",
            "producer": meta.get("producer") or "",
            "creation_date": meta.get("creationDate") or "",
            "mod_date": meta.get("modDate") or "",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/projects/{project_id}/document-properties")
def update_document_properties(
    project_id: int,
    payload: DocumentPropertiesUpdate,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Update PDF metadata properties (Title, Author, Subject, Keywords, Creator, Producer)."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    pdf_path = os.path.join(project["folder_name"], "output.pdf")
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF not found. Please merge files first.")

    try:
        doc = fitz.open(pdf_path)
        meta = dict(doc.metadata or {})
        meta.update({
            "title": payload.title,
            "author": payload.author,
            "subject": payload.subject,
            "keywords": payload.keywords,
            "creator": payload.creator,
            "producer": payload.producer,
        })
        doc.set_metadata(meta)
        _push_undo_snapshot(project["folder_name"])
        if doc.can_save_incrementally():
            doc.saveIncr()
            doc.close()
        else:
            temp_path = pdf_path.replace(".pdf", "_temp_meta.pdf")
            doc.save(temp_path, incremental=False, deflate=True)
            doc.close()
            os.replace(temp_path, pdf_path)

        return {"success": True, "message": "Document properties updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


_MAX_PDF_UNDO = 10


def _history_paths(folder_name: str):
    import json as _json
    hist_dir = os.path.join(folder_name, ".pdf_history")
    os.makedirs(hist_dir, exist_ok=True)
    idx_file = os.path.join(hist_dir, "stack.json")
    if os.path.exists(idx_file):
        try:
            with open(idx_file, "r", encoding="utf-8") as f:
                data = _json.load(f)
                return hist_dir, idx_file, {
                    "undo": [p for p in data.get("undo", []) if os.path.exists(p)],
                    "redo": [p for p in data.get("redo", []) if os.path.exists(p)],
                }
        except Exception:
            pass
    return hist_dir, idx_file, {"undo": [], "redo": []}


def _save_history_index(idx_file: str, data: dict):
    import json as _json
    with open(idx_file, "w", encoding="utf-8") as f:
        _json.dump(data, f)


def _push_undo_snapshot(folder_name: str):
    import time as _time
    pdf_path = os.path.join(folder_name, "output.pdf")
    if not os.path.exists(pdf_path):
        return
    hist_dir, idx_file, data = _history_paths(folder_name)
    snap_path = os.path.join(hist_dir, f"snap_{int(_time.time() * 1000)}_{len(data['undo'])}.pdf")
    shutil.copy2(pdf_path, snap_path)
    data["undo"].append(snap_path)
    while len(data["undo"]) > _MAX_PDF_UNDO:
        old = data["undo"].pop(0)
        try:
            if os.path.exists(old):
                os.remove(old)
        except Exception:
            pass
    for rp in data["redo"]:
        try:
            if os.path.exists(rp):
                os.remove(rp)
        except Exception:
            pass
    data["redo"] = []
    _save_history_index(idx_file, data)


@router.get("/projects/{project_id}/pdf-history-status")
def get_pdf_history_status(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _, _, data = _history_paths(project["folder_name"])
    return {
        "can_undo": len(data["undo"]) > 0,
        "can_redo": len(data["redo"]) > 0,
        "undo_count": len(data["undo"]),
        "redo_count": len(data["redo"]),
    }


@router.post("/projects/{project_id}/pdf-undo")
def undo_pdf_edit(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    import time as _time
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    folder = project["folder_name"]
    pdf_path = os.path.join(folder, "output.pdf")
    hist_dir, idx_file, data = _history_paths(folder)
    if not data["undo"]:
        raise HTTPException(status_code=400, detail="Nothing to undo")

    prev_snap = data["undo"].pop()
    if os.path.exists(pdf_path):
        redo_snap = os.path.join(hist_dir, f"redo_{int(_time.time() * 1000)}.pdf")
        shutil.copy2(pdf_path, redo_snap)
        data["redo"].append(redo_snap)
    shutil.copy2(prev_snap, pdf_path)
    try:
        os.remove(prev_snap)
    except Exception:
        pass
    _save_history_index(idx_file, data)
    return {
        "success": True,
        "message": "Undid last PDF edit",
        "can_undo": len(data["undo"]) > 0,
        "can_redo": len(data["redo"]) > 0,
    }


@router.post("/projects/{project_id}/pdf-redo")
def redo_pdf_edit(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    import time as _time
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    folder = project["folder_name"]
    pdf_path = os.path.join(folder, "output.pdf")
    hist_dir, idx_file, data = _history_paths(folder)
    if not data["redo"]:
        raise HTTPException(status_code=400, detail="Nothing to redo")

    next_snap = data["redo"].pop()
    if os.path.exists(pdf_path):
        undo_snap = os.path.join(hist_dir, f"snap_{int(_time.time() * 1000)}.pdf")
        shutil.copy2(pdf_path, undo_snap)
        data["undo"].append(undo_snap)
    shutil.copy2(next_snap, pdf_path)
    try:
        os.remove(next_snap)
    except Exception:
        pass
    _save_history_index(idx_file, data)
    return {
        "success": True,
        "message": "Redid PDF edit",
        "can_undo": len(data["undo"]) > 0,
        "can_redo": len(data["redo"]) > 0,
    }


def _serialize_history(h: Any) -> dict:
    created_str = None
    if h.created_at:
        if h.created_at.tzinfo is None:
            created_str = h.created_at.replace(tzinfo=timezone.utc).isoformat()
        else:
            created_str = h.created_at.astimezone(timezone.utc).isoformat()

    return {
        "id": h.id,
        "project_id": h.project_id,
        "changed_by_id": h.changed_by_id,
        "changed_by_username": h.changed_by_username,
        "old_assignee": h.old_assignee,
        "new_assignee": h.new_assignee,
        "result_type": h.result_type,
        "created_at": created_str,
        "merged_files": h.merged_files,
        "merged_output_path": h.merged_output_path,
        "total_pages": h.total_pages,
        "merge_status": h.merge_status,
        "details": h.details,
    }


@router.get("/projects/{project_id}/merge-history")
def get_merge_history(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Get all merge history records for a project."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    from .models import WebPdfHistory
    history_rows = (
        db.query(WebPdfHistory)
        .filter(WebPdfHistory.project_id == project_id, WebPdfHistory.result_type == "merge")
        .order_by(WebPdfHistory.created_at.desc())
        .all()
    )
    return [_serialize_history(h) for h in history_rows]


@router.get("/projects/{project_id}/step-analysis/{step_name}")
def get_latest_step_analysis(
    project_id: int,
    step_name: str,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Get the latest analysis for a specific step."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    from .models import WebPdfHistory
    latest = (
        db.query(WebPdfHistory)
        .filter(WebPdfHistory.project_id == project_id, WebPdfHistory.result_type == step_name)
        .order_by(WebPdfHistory.created_at.desc())
        .first()
    )

    if not latest:
        return None

    return latest.details


@router.get("/projects/{project_id}/fonts-status")
def check_fonts_status(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Check if all fonts in the current PDF are fully embedded."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    settings = get_settings()
    base_dir = project["folder_name"]
    
    output_pdf = os.path.join(base_dir, "output.pdf")

    if not os.path.exists(output_pdf):
        raise HTTPException(status_code=404, detail="Output PDF not found. Please merge files first.")

    try:
        font_status = font_service.check_fonts_embedded(output_pdf)
        # Update project status
        project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
        if project_obj:
            project_obj.status = "Fonts Checked"
            update_validation_status(project_obj)
            db.commit()
            web_pdf_projects_db.record_step_completion(
                db, project_id=project_id, step_name="fonts_check",
                user_id=user.id if user else None,
                username=_actor_name(user),
                details=font_status
            )
        return font_status
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/projects/{project_id}/fix-fonts")
def fix_fonts_endpoint(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Embed all missing fonts into the current PDF using Ghostscript."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    output_pdf = os.path.join(base_dir, "output.pdf")

    if not os.path.exists(output_pdf):
        raise HTTPException(status_code=404, detail="Output PDF not found. Please merge files first.")

    try:
        fix_result = font_service.fix_embed_fonts(output_pdf)
        if not fix_result.get("success"):
            raise HTTPException(status_code=500, detail=fix_result.get("error", "Failed to embed fonts"))

        font_status = fix_result["status"]
        project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
        if project_obj:
            project_obj.status = "Fonts Checked"
            update_validation_status(project_obj)
            db.commit()
            web_pdf_projects_db.record_step_completion(
                db, project_id=project_id, step_name="fonts_check",
                user_id=user.id if user else None,
                username=_actor_name(user),
                details=font_status
            )
            web_pdf_projects_db.record_step_completion(
                db, project_id=project_id, step_name="fonts_fixed",
                user_id=user.id if user else None,
                username=_actor_name(user),
                details=font_status
            )
        return font_status
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/projects/{project_id}/security-status")
def check_security_status(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Check if the current PDF is free of password protection."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    settings = get_settings()
    base_dir = project["folder_name"]
    
    
    output_pdf = os.path.join(base_dir, "output.pdf")
    if not os.path.exists(output_pdf):
        raise HTTPException(status_code=404, detail="Output PDF not found. Please merge files first.")

    try:
        security_status = security_service.check_pdf_security(output_pdf)
        # Update project status
        project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
        if project_obj:
            project_obj.status = "Security Checked"
            update_validation_status(project_obj)
            db.commit()
            web_pdf_projects_db.record_step_completion(
                db, project_id=project_id, step_name="security_check",
                user_id=user.id if user else None,
                username=_actor_name(user),
                details=security_status
            )
        return security_status
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


from .services import toc_service

@router.get("/projects/{project_id}/bookmarks-info")
def get_existing_bookmarks_info(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Check if the current project PDF already contains existing bookmarks."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    pdf_candidates = [
        os.path.join(base_dir, "output.pdf"),
        os.path.join(base_dir, "output_secured.pdf"),
        os.path.join(base_dir, "output_bookmarked.pdf"),
    ]
    pdf_path = next((p for p in pdf_candidates if os.path.exists(p)), None)
    if not pdf_path:
        return {"has_existing_bookmarks": False, "count": 0, "sample_titles": []}

    try:
        doc = fitz.open(pdf_path)
        toc = doc.get_toc()
        doc.close()
        sample_titles = [item[1] for item in toc[:5]]
        return {
            "has_existing_bookmarks": len(toc) > 0,
            "count": len(toc),
            "sample_titles": sample_titles,
        }
    except Exception:
        return {"has_existing_bookmarks": False, "count": 0, "sample_titles": []}


@router.post("/projects/{project_id}/accept-existing-bookmarks")
def accept_existing_bookmarks(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Accept and lock in the existing bookmarks already present in the PDF as default."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    output_pdf = os.path.join(base_dir, "output.pdf")
    bookmarked_pdf = os.path.join(base_dir, "output_bookmarked.pdf")

    if not os.path.exists(output_pdf):
        raise HTTPException(status_code=404, detail="Output PDF not found. Please merge files first.")

    try:
        doc = fitz.open(output_pdf)
        toc = doc.get_toc()
        doc.close()

        # Preserve copy as output_bookmarked.pdf if needed
        if not os.path.exists(bookmarked_pdf):
            try:
                shutil.copy2(output_pdf, bookmarked_pdf)
            except Exception:
                pass

        result = {
            "success": True,
            "toc_entries_detected": len(toc),
            "bookmarks_generated": len(toc),
            "kept_existing": True,
        }

        project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
        if project_obj:
            project_obj.status = "Bookmarked"
            update_validation_status(project_obj)
            db.commit()
            web_pdf_projects_db.record_step_completion(
                db, project_id=project_id, step_name="bookmarks",
                user_id=user.id if user else None,
                username=_actor_name(user),
                details=result
            )

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/generate-bookmarks")
def generate_bookmarks(
    project_id: int,
    include_subheadings: bool = Query(True),
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Generate Bookmarks based on TOC and subheadings."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    
    output_pdf = os.path.join(base_dir, "output.pdf")

    if not os.path.exists(output_pdf):
        raise HTTPException(status_code=404, detail="Output PDF not found. Please merge files first.")

    try:
        result = toc_service.generate_bookmarks_for_pdf(output_pdf, output_pdf, include_subheadings=include_subheadings)
        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error", "Unknown error generating bookmarks"))

        # Update project status
        project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
        if project_obj:
            project_obj.status = "Bookmarked"
            update_validation_status(project_obj)
            db.commit()
            web_pdf_projects_db.record_step_completion(
                db, project_id=project_id, step_name="bookmarks",
                user_id=user.id if user else None,
                username=_actor_name(user),
                details=result
            )

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/projects/{project_id}/bookmarks")
def get_bookmarks(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Get current bookmarks from the bookmarked PDF."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    base_dir = project["folder_name"]
    bookmarked_pdf_path = os.path.join(base_dir, "output.pdf")
    
    if not os.path.exists(bookmarked_pdf_path):
        raise HTTPException(status_code=404, detail="Bookmarked PDF not found")
        
    bookmarks = toc_service.get_bookmarks_from_pdf(bookmarked_pdf_path)
    return {"bookmarks": bookmarks}

@router.put("/projects/{project_id}/bookmarks")
def update_bookmarks(
    project_id: int,
    bookmarks: list[BookmarkItem],
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Update bookmarks in the bookmarked PDF."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    base_dir = project["folder_name"]
    bookmarked_pdf_path = os.path.join(base_dir, "output.pdf")
    
    if not os.path.exists(bookmarked_pdf_path):
        raise HTTPException(status_code=404, detail="Bookmarked PDF not found")
        
    bookmarks_dict = [b.dict() for b in bookmarks]
    success = toc_service.update_bookmarks_in_pdf(bookmarked_pdf_path, bookmarks_dict)
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update bookmarks in PDF")
        
    return {"success": True, "message": "Bookmarks updated successfully"}


@router.get("/projects/{project_id}/toc-links-info")
def get_existing_toc_links_info(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Check if the current project PDF already contains existing TOC links."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    output_pdf = os.path.join(base_dir, "output.pdf")
    if not os.path.exists(output_pdf):
        return {"has_existing_links": False, "count": 0}

    try:
        doc = fitz.open(output_pdf)
        goto_links = 0
        for page in doc:
            for link in page.get_links():
                if link.get("kind") == fitz.LINK_GOTO:
                    goto_links += 1
        doc.close()
        return {"has_existing_links": goto_links > 0, "count": goto_links}
    except Exception:
        return {"has_existing_links": False, "count": 0}


@router.post("/projects/{project_id}/accept-existing-toc-links")
def accept_existing_toc_links(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Accept and keep existing TOC links."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    output_pdf = os.path.join(base_dir, "output.pdf")
    if not os.path.exists(output_pdf):
        raise HTTPException(status_code=404, detail="Output PDF not found")

    try:
        doc = fitz.open(output_pdf)
        goto_links = 0
        for page in doc:
            for link in page.get_links():
                if link.get("kind") == fitz.LINK_GOTO:
                    goto_links += 1
        doc.close()

        project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
        if project_obj:
            project_obj.status = "TOC Linked"
            update_validation_status(project_obj)
            db.commit()
            web_pdf_projects_db.record_step_completion(
                db, project_id=project_id, step_name="toc_links",
                user_id=user.id if user else None,
                username=_actor_name(user),
                details={"total_links": goto_links, "kept_existing": True}
            )

        return {"success": True, "total_links": goto_links, "kept_existing": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/generate-links")
def generate_links(
    project_id: int,
    request: LinkRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Generate internal links (TOC -> Chapter)"""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    output_pdf = os.path.join(base_dir, "output.pdf")

    if not os.path.exists(output_pdf):
        raise HTTPException(status_code=404, detail="Output PDF not found. Please merge files first.")
            
    try:
        result = toc_service.create_links_in_pdf(
            output_pdf,
            request.link_type,
            request.analyze_only,
            preserve_existing=request.preserve_existing
        )
        if not request.analyze_only:
            project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
            if project_obj:
                project_obj.status = "TOC Linked"
                update_validation_status(project_obj)
                db.commit()
                web_pdf_projects_db.record_step_completion(
                    db, project_id=project_id, step_name="toc_links",
                    user_id=user.id if user else None,
                    username=_actor_name(user),
                    details=result
                )
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/projects/{project_id}/generate-links/manual")
def generate_link_manual(
    project_id: int,
    request: ManualLinkRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Manually create a single link"""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    bookmarked_pdf_path = os.path.join(base_dir, "output.pdf")
    
    if not os.path.exists(bookmarked_pdf_path):
        trimmed_pdf_path = os.path.join(base_dir, "output.pdf")
        merged_pdf_path = os.path.join(base_dir, "output.pdf")
        if os.path.exists(trimmed_pdf_path):
            bookmarked_pdf_path = trimmed_pdf_path
        elif os.path.exists(merged_pdf_path):
            bookmarked_pdf_path = merged_pdf_path
        else:
            raise HTTPException(status_code=404, detail="No PDF file available to link.")
            
    try:
        success = toc_service.create_manual_link(
            bookmarked_pdf_path, 
            request.source_page, 
            request.target_page
        )
        if not success:
            raise HTTPException(status_code=400, detail="Invalid page numbers")
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class UrlLinkRequest(BaseModel):
    analyze_only: bool = True
    color_urls: bool = False
    fix_multiline: bool = True
    fix_missing: bool = True
    fix_malformed: bool = True
    remove_duplicates: bool = True
    custom_details: Optional[List[Dict[str, Any]]] = None


@router.post("/projects/{project_id}/generate-url-links")
def generate_url_links(
    project_id: int,
    request: UrlLinkRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Scan PDF for plain-text URLs and optionally hyperlink them."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    bookmarked_pdf_path = os.path.join(base_dir, "output.pdf")

    if not os.path.exists(bookmarked_pdf_path):
        trimmed_pdf_path = os.path.join(base_dir, "output.pdf")
        merged_pdf_path = os.path.join(base_dir, "output.pdf")
        if os.path.exists(trimmed_pdf_path):
            bookmarked_pdf_path = trimmed_pdf_path
        elif os.path.exists(merged_pdf_path):
            bookmarked_pdf_path = merged_pdf_path
        else:
            raise HTTPException(status_code=404, detail="No PDF file available.")

    try:
        result = url_service.find_urls_in_pdf(
            bookmarked_pdf_path,
            analyze_only=request.analyze_only,
            color_urls=request.color_urls,
            fix_multiline=request.fix_multiline,
            fix_missing=request.fix_missing,
            fix_malformed=request.fix_malformed,
            remove_duplicates=request.remove_duplicates,
            custom_details=request.custom_details,
        )

        # Always record the analysis
        web_pdf_projects_db.record_step_completion(
            db, project_id=project_id, step_name="url_links",
            user_id=user.id if user else None,
            username=_actor_name(user),
            details=result
        )

        # Mark as complete if: applying changes, OR analysis found nothing to fix
        should_mark_complete = (not request.analyze_only) or (result.get('not_linked', 0) == 0)
        if should_mark_complete:
            project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
            if project_obj:
                project_obj.status = "URL Linked"
                update_validation_status(project_obj)
                db.commit()

        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class EmailLinkRequest(BaseModel):
    analyze_only: bool = True
    color_emails: bool = False


@router.post("/projects/{project_id}/generate-email-links")
def generate_email_links(
    project_id: int,
    request: EmailLinkRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Scan PDF for plain-text email addresses and optionally hyperlink them."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    bookmarked_pdf_path = os.path.join(base_dir, "output.pdf")

    if not os.path.exists(bookmarked_pdf_path):
        trimmed_pdf_path = os.path.join(base_dir, "output.pdf")
        merged_pdf_path = os.path.join(base_dir, "output.pdf")
        if os.path.exists(trimmed_pdf_path):
            bookmarked_pdf_path = trimmed_pdf_path
        elif os.path.exists(merged_pdf_path):
            bookmarked_pdf_path = merged_pdf_path
        else:
            raise HTTPException(status_code=404, detail="No PDF file available.")

    try:
        result = email_service.find_emails_in_pdf(
            bookmarked_pdf_path,
            analyze_only=request.analyze_only,
            color_emails=request.color_emails
        )

        # Always record the analysis
        web_pdf_projects_db.record_step_completion(
            db, project_id=project_id, step_name="email_links",
            user_id=user.id if user else None,
            username=_actor_name(user),
            details=result
        )

        # Mark as complete if: applying changes, OR analysis found nothing to fix
        should_mark_complete = (not request.analyze_only) or (result.get('not_linked', 0) == 0)
        if should_mark_complete:
            project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
            if project_obj:
                project_obj.status = "Email Linked"
                update_validation_status(project_obj)
                db.commit()

        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class EndnoteRequest(BaseModel):
    analyze_only: bool = True
    custom_details: Optional[List[Dict[str, Any]]] = None


class CrossrefRequest(BaseModel):
    analyze_only: bool = True


class IndexLinkRequest(BaseModel):
    analyze_only: bool = True


class GlossaryLinkRequest(BaseModel):
    analyze_only: bool = True


@router.post("/projects/{project_id}/generate-endnote-links")
def generate_endnote_links(
    project_id: int,
    request: EndnoteRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Scan PDF for superscript note references and link them to endnotes."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    bookmarked_pdf_path = os.path.join(base_dir, "output.pdf")

    if not os.path.exists(bookmarked_pdf_path):
        trimmed_pdf_path = os.path.join(base_dir, "output.pdf")
        merged_pdf_path = os.path.join(base_dir, "output.pdf")
        if os.path.exists(trimmed_pdf_path):
            bookmarked_pdf_path = trimmed_pdf_path
        elif os.path.exists(merged_pdf_path):
            bookmarked_pdf_path = merged_pdf_path
        else:
            raise HTTPException(status_code=404, detail="No PDF file available.")

    try:
        result = endnote_service.find_endnotes_in_pdf(bookmarked_pdf_path, request.analyze_only, request.custom_details)

        # Always record the analysis
        web_pdf_projects_db.record_step_completion(
            db, project_id=project_id, step_name="endnote_links",
            user_id=user.id if user else None,
            username=_actor_name(user),
            details=result
        )

        # Mark as complete if: applying changes, OR analysis found nothing to fix
        should_mark_complete = (not request.analyze_only) or (result.get('not_linked', 0) == 0)
        if should_mark_complete:
            project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
            if project_obj:
                project_obj.status = "Endnote Linked"
                update_validation_status(project_obj)
                db.commit()

        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/generate-reference-citation-links")
def generate_reference_citation_links(
    project_id: int,
    request: EndnoteRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Scan PDF for Author-Year (APA/Harvard) citations and link them to References."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    bookmarked_pdf_path = os.path.join(base_dir, "output.pdf")

    if not os.path.exists(bookmarked_pdf_path):
        trimmed_pdf_path = os.path.join(base_dir, "output.pdf")
        merged_pdf_path = os.path.join(base_dir, "output.pdf")
        if os.path.exists(trimmed_pdf_path):
            bookmarked_pdf_path = trimmed_pdf_path
        elif os.path.exists(merged_pdf_path):
            bookmarked_pdf_path = merged_pdf_path
        else:
            raise HTTPException(status_code=404, detail="No PDF file available.")

    try:
        result = reference_citation_service.find_reference_citations_in_pdf(bookmarked_pdf_path, request.analyze_only)

        web_pdf_projects_db.record_step_completion(
            db, project_id=project_id, step_name="reference_citation_links",
            user_id=user.id if user else None,
            username=_actor_name(user),
            details=result
        )

        should_mark_complete = (not request.analyze_only) or (result.get('not_linked', 0) == 0)
        if should_mark_complete:
            project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
            if project_obj:
                project_obj.status = "Endnote Linked"
                update_validation_status(project_obj)
                db.commit()

        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/generate-crossref-links")
def generate_crossref_links(
    project_id: int,
    request: CrossrefRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Scan PDF for cross-references (Figures, Tables, Chapters, Pages) and link them."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    bookmarked_pdf_path = os.path.join(base_dir, "output.pdf")

    if not os.path.exists(bookmarked_pdf_path):
        trimmed_pdf_path = os.path.join(base_dir, "output.pdf")
        merged_pdf_path = os.path.join(base_dir, "output.pdf")
        if os.path.exists(trimmed_pdf_path):
            bookmarked_pdf_path = trimmed_pdf_path
        elif os.path.exists(merged_pdf_path):
            bookmarked_pdf_path = merged_pdf_path
        else:
            raise HTTPException(status_code=404, detail="No PDF file available.")

    try:
        result = crossref_service.find_crossrefs_in_pdf(bookmarked_pdf_path, request.analyze_only)

        # Always record the analysis
        web_pdf_projects_db.record_step_completion(
            db, project_id=project_id, step_name="crossref_links",
            user_id=user.id if user else None,
            username=_actor_name(user),
            details=result
        )

        # Mark as complete if: applying changes, OR analysis found nothing to fix
        should_mark_complete = (not request.analyze_only) or (result.get('not_linked', 0) == 0)
        if should_mark_complete:
            project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
            if project_obj:
                project_obj.status = "Crossref Linked"
                update_validation_status(project_obj)
                db.commit()

        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/generate-index-links")
def generate_index_links(
    project_id: int,
    request: IndexLinkRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Scan PDF for Index page numbers and ranges and link them to target pages."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    bookmarked_pdf_path = os.path.join(base_dir, "output.pdf")

    if not os.path.exists(bookmarked_pdf_path):
        raise HTTPException(status_code=404, detail="No PDF file available.")

    try:
        result = index_service.find_index_links_in_pdf(bookmarked_pdf_path, request.analyze_only)

        # Always record the analysis
        web_pdf_projects_db.record_step_completion(
            db, project_id=project_id, step_name="index_links",
            user_id=user.id if user else None,
            username=_actor_name(user),
            details=result
        )

        # Mark as complete if: applying changes, OR analysis found nothing to fix
        should_mark_complete = (not request.analyze_only) or (result.get('not_linked', 0) == 0)
        if should_mark_complete:
            project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
            if project_obj:
                project_obj.status = "Index Linked"
                update_validation_status(project_obj)
                db.commit()

        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/generate-glossary-links")
def generate_glossary_links(
    project_id: int,
    request: GlossaryLinkRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Scan PDF for body occurrences of terms defined in Glossary and link them to definition."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    bookmarked_pdf_path = os.path.join(base_dir, "output.pdf")

    if not os.path.exists(bookmarked_pdf_path):
        raise HTTPException(status_code=404, detail="No PDF file available.")

    try:
        result = glossary_service.find_glossary_terms_in_pdf(bookmarked_pdf_path, request.analyze_only)

        # Always record the step completion / analysis
        web_pdf_projects_db.record_step_completion(
            db, project_id=project_id, step_name="glossary_links",
            user_id=user.id if user else None,
            username=_actor_name(user),
            details=result
        )

        # Mark as complete if: applying changes, OR analysis found nothing to fix
        should_mark_complete = (not request.analyze_only) or (result.get('not_linked', 0) == 0)
        if should_mark_complete:
            project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
            if project_obj:
                project_obj.status = "Glossary Linked"
                update_validation_status(project_obj)
                db.commit()

        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/validation-diff")
def get_validation_diff(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """
    Compare the baseline merged PDF against the final processed PDF
    to verify text, font, and alignment integrity.
    """
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    base_dir = project["folder_name"]
    final_pdf_path = os.path.join(base_dir, "output.pdf")
    baseline_pdf_path = os.path.join(base_dir, "output_baseline.pdf")

    if not os.path.exists(final_pdf_path):
        raise HTTPException(status_code=404, detail="No output PDF available for validation.")

    # If baseline does not exist yet (e.g. created earlier), copy final as fallback baseline
    if not os.path.exists(baseline_pdf_path):
        try:
            shutil.copy2(final_pdf_path, baseline_pdf_path)
        except Exception:
            pass

    try:
        report = validation_diff_service.compare_pdfs(baseline_pdf_path, final_pdf_path)
        
        # Update project validation status
        project_obj = db.query(WebPdfProject).filter(WebPdfProject.id == project_id).first()
        if project_obj and report.get("success"):
            if report.get("status") == "passed":
                project_obj.validation_status = "Passed"
                project_obj.status = "Validated"
            elif report.get("status") == "warnings":
                project_obj.validation_status = "Passed"
                project_obj.status = "Validated"
            else:
                project_obj.validation_status = "Failed"
            db.commit()

            web_pdf_projects_db.record_step_completion(
                db, project_id=project_id, step_name="final_validation",
                user_id=user.id if user else None,
                username=_actor_name(user),
                details=report
            )

        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

