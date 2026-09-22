"""
API router for Ninja Inkflow Language Editing.
Provides endpoints for rule management (CE support JSON sync), job execution, finding reviews, and redlined DOCX export.
"""
import datetime
import logging
import os
import uuid
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.domains.processing.language_edit_models import LanguageEditJob, LanguageEditFinding

from app.processing.language_editing import docx_io, engine, segmenter
from app.processing.language_editing.rules import load_rules_from_dict, load_house_style_from_dict
from app.services.language_rule_service import (
    get_available_style_profiles,
    get_project_language_rules,
    save_project_language_rules,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v2", tags=["Language Editing"])


# ── Pydantic Request Models ──────────────────────────────────────────────────

class SaveRulesRequest(BaseModel):
    profile_key: str = "uk"
    rules: Optional[list[dict[str, Any]]] = None
    variant_to_canonical: Optional[dict[str, str]] = None
    profile_name: Optional[str] = None


class DecisionRequest(BaseModel):
    status: str  # accepted | edited | rejected
    edited_text: Optional[str] = None
    reviewer: Optional[str] = "editor"


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/language-rules")
def get_project_rules(project_id: int, db: Session = Depends(get_db)):
    """Fetch current project language rules from CE support along with available base profiles."""
    active_rules = get_project_language_rules(db, project_id=project_id)
    available_profiles = get_available_style_profiles()
    return {
        "active_rules": active_rules,
        "available_profiles": available_profiles,
    }


@router.post("/projects/{project_id}/language-rules")
def update_project_rules(
    project_id: int,
    body: SaveRulesRequest,
    db: Session = Depends(get_db)
):
    """Save/update project language rules, syncing JSON to project's CE support folder."""
    try:
        updated = save_project_language_rules(
            db,
            project_id=project_id,
            profile_key=body.profile_key,
            rules=body.rules,
            variant_to_canonical=body.variant_to_canonical,
            profile_name=body.profile_name,
        )
        return {"ok": True, "rules": updated}
    except ValueError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except Exception as exc:
        logger.error("Failed to update language rules: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/files/{file_id}/language-edit/analyze")
def start_language_edit_analysis(
    file_id: int,
    db: Session = Depends(get_db)
):
    """Triggers rule engine analysis on target manuscript file using active CE support language rules."""
    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail=f"File ID {file_id} not found.")

    if not file_record.path or not os.path.exists(file_record.path):
        raise HTTPException(status_code=400, detail="Target file does not exist on disk.")

    if not file_record.filename.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Language Editing is only supported for .docx files.")

    # Load project language rules from CE support
    project_rules_cfg = get_project_language_rules(db, project_id=file_record.project_id)
    rules = load_rules_from_dict(project_rules_cfg.get("rules", []))
    dictionary = load_house_style_from_dict(project_rules_cfg.get("variant_to_canonical", {}))

    # Read paragraphs from DOCX
    try:
        _, paragraphs = docx_io.read_paragraphs(file_record.path)
    except Exception as exc:
        logger.error("Failed to read DOCX at %s: %s", file_record.path, exc)
        raise HTTPException(status_code=500, detail="Failed to read target DOCX file.")

    job_uuid = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S_") + str(uuid.uuid4())[:8]
    job = LanguageEditJob(
        job_id=job_uuid,
        file_id=file_record.id,
        project_id=file_record.project_id,
        status="in_review",
        total_findings=0,
    )
    db.add(job)
    db.commit()

    total_findings_count = 0
    findings_to_insert = []

    for para_idx, text in paragraphs:
        sents = segmenter.sentences(text)
        found = engine.analyze(text, rules, dictionary, sents)
        for fd in found:
            total_findings_count += 1
            finding_row = LanguageEditFinding(
                job_id=job_uuid,
                file_id=file_record.id,
                para_index=para_idx,
                start_offset=fd.start,
                end_offset=fd.end,
                rule_id=fd.rule_id,
                category=fd.category,
                severity=fd.severity,
                original_text=fd.original,
                suggestion=fd.suggestion,
                message=fd.message,
                autofixable=fd.autofixable,
                status="pending",
            )
            findings_to_insert.append(finding_row)

    if findings_to_insert:
        db.bulk_save_objects(findings_to_insert)

    job.total_findings = total_findings_count
    db.commit()

    return {
        "ok": True,
        "job_id": job_uuid,
        "total_findings": total_findings_count,
        "file_name": file_record.filename,
    }


@router.get("/language-edit/jobs/{job_id}/findings")
def get_job_findings(job_id: str, db: Session = Depends(get_db)):
    """Returns findings and statistics for a given Language Edit job."""
    job = db.query(LanguageEditJob).filter(LanguageEditJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    findings = (
        db.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job_id)
        .order_by(LanguageEditFinding.para_index, LanguageEditFinding.start_offset)
        .all()
    )

    return {
        "job": {
            "job_id": job.job_id,
            "file_id": job.file_id,
            "project_id": job.project_id,
            "status": job.status,
            "total_findings": job.total_findings,
            "accepted_count": job.accepted_count,
            "edited_count": job.edited_count,
            "rejected_count": job.rejected_count,
        },
        "findings": [
            {
                "id": f.id,
                "para_index": f.para_index,
                "start_offset": f.start_offset,
                "end_offset": f.end_offset,
                "rule_id": f.rule_id,
                "category": f.category,
                "severity": f.severity,
                "original_text": f.original_text,
                "suggestion": f.suggestion,
                "message": f.message,
                "autofixable": f.autofixable,
                "status": f.status,
                "edited_text": f.edited_text,
                "reviewer": f.reviewer,
                "decided_at": f.decided_at.isoformat() if f.decided_at else None,
            }
            for f in findings
        ]
    }


@router.post("/language-edit/findings/{finding_id}/decide")
def decide_finding(
    finding_id: int,
    body: DecisionRequest,
    db: Session = Depends(get_db)
):
    """Updates editor decision (accepted, edited, rejected, highlighted) for a finding."""
    finding = db.query(LanguageEditFinding).filter(LanguageEditFinding.id == finding_id).first()
    if not finding:
        raise HTTPException(status_code=404, detail=f"Finding ID {finding_id} not found.")

    if body.status not in ("accepted", "edited", "rejected", "highlighted"):
        raise HTTPException(status_code=400, detail="Invalid status. Must be accepted, edited, rejected, or highlighted.")

    old_status = finding.status
    finding.status = body.status
    finding.edited_text = body.edited_text if body.status == "edited" else None
    finding.reviewer = body.reviewer or "editor"
    finding.decided_at = datetime.datetime.utcnow()

    # Update counters on parent job
    job = db.query(LanguageEditJob).filter(LanguageEditJob.job_id == finding.job_id).first()
    if job:
        # Decrement old counter if replacing decision
        if old_status == "accepted":
            job.accepted_count = max(0, job.accepted_count - 1)
        elif old_status == "edited":
            job.edited_count = max(0, job.edited_count - 1)
        elif old_status == "rejected":
            job.rejected_count = max(0, job.rejected_count - 1)

        # Increment new counter
        if body.status == "accepted":
            job.accepted_count += 1
        elif body.status == "edited":
            job.edited_count += 1
        elif body.status == "rejected":
            job.rejected_count += 1

    db.commit()
    return {"ok": True, "finding_id": finding.id, "status": finding.status}


@router.post("/language-edit/jobs/{job_id}/export")
def export_redlined_docx(
    job_id: str,
    db: Session = Depends(get_db)
):
    """Exports redlined DOCX with Word Tracked Changes and XML highlights, saving it in the same location as a new version."""
    job = db.query(LanguageEditJob).filter(LanguageEditJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    file_record = db.query(models.File).filter(models.File.id == job.file_id).first()
    if not file_record or not os.path.exists(file_record.path):
        raise HTTPException(status_code=404, detail="Source DOCX file not found.")

    active_findings = (
        db.query(LanguageEditFinding)
        .filter(
            LanguageEditFinding.job_id == job_id,
            LanguageEditFinding.status.in_(["accepted", "edited", "highlighted"])
        )
        .order_by(LanguageEditFinding.para_index, LanguageEditFinding.start_offset.desc())
        .all()
    )

    doc, _ = docx_io.read_paragraphs(file_record.path)

    # Apply right-to-left within each paragraph so offsets remain valid
    for f in active_findings:
        if 0 <= f.para_index < len(doc.paragraphs):
            para = doc.paragraphs[f.para_index]
            if f.status == "highlighted":
                color = "cyan" if f.category == "spelling" else "magenta" if f.category == "sentence" else "yellow"
                docx_io.apply_highlight_change(para, start=f.start_offset, end=f.end_offset, color=color)
            else:
                target_text = f.edited_text if f.status == "edited" and f.edited_text else f.suggestion
                docx_io.apply_tracked_change(
                    para,
                    start=f.start_offset,
                    end=f.end_offset,
                    new_text=target_text,
                    author="LangQA"
                )

    # 1. Archive previous file version in Archive/ folder before overwriting
    from app.domains.files import version_service
    base_path = os.path.dirname(file_record.path)
    try:
        version_service.archive_existing_file(
            db,
            existing_file=file_record,
            base_path=base_path,
            uploaded_by_id=None,
            reason="Language Edit review completed"
        )
    except Exception as err:
        logger.warning(f"Failed to archive previous file version: {err}")

    # 2. Save redlined DOCX to the exact same location as the new file version
    doc.save(file_record.path)

    # 3. Increment file record version and update timestamp
    file_record.version = (file_record.version or 1) + 1
    file_record.updated_at = datetime.datetime.utcnow()

    # Save export copy for download response
    out_dir = os.path.join(base_path, "jobs")
    os.makedirs(out_dir, exist_ok=True)
    filename_stem = os.path.splitext(file_record.filename)[0]
    out_path = os.path.join(out_dir, f"{filename_stem}_redline.docx")
    doc.save(out_path)

    job.status = "completed"
    db.commit()

    headers = {
        "X-File-Id": str(file_record.id),
        "X-File-Version": str(file_record.version),
        "Access-Control-Expose-Headers": "X-File-Id, X-File-Version"
    }

    return FileResponse(
        out_path,
        filename=f"{filename_stem}_redline.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers=headers
    )



@router.get("/medical/umls-search")
def search_medical_term_umls(
    term: str,
    api_key: Optional[str] = None
):
    """
    Search medical and pharmaceutical terms using NLM UMLS Terminology Services API.
    Returns matched concepts, canonical names, and CUIs.
    """
    if not term or not term.strip():
        raise HTTPException(status_code=400, detail="Query term parameter is required.")

    from app.services.umls_service import validate_medical_term
    result = validate_medical_term(term, api_key=api_key)
    return {"ok": True, "data": result}

