import os
import json
from pathlib import Path
from collections import defaultdict
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models
from app.processing.manuscript_core.analyzer import analyze_manuscript
from app.processing.manuscript_core.fixer import apply_fixes_targeted, apply_te_highlights_to_docx

# Cache directory inside the app workspace
RESULTS_DIR = Path(__file__).parent.parent.parent / "processing" / "results"

def _map_findings_to_legacy_issues(findings: list[dict]) -> list[dict]:
    """Maps rich occurrences back to legacy issues schema for backward compatibility."""
    grouped = defaultdict(list)
    for f in findings:
        rule_id = f.get("rule_id", "generic")
        grouped[rule_id].append(f)

    issues_list = []
    for rule_id, items in grouped.items():
        first = items[0]
        found_set = set(item.get("surface", "") for item in items if item.get("surface"))
        options_set = set()
        for item in items:
            rep = item.get("replacement")
            if rep:
                options_set.add(rep)
        issues_list.append({
            "key": rule_id,
            "label": first.get("rule_label", rule_id),
            "category": first.get("category", "technical"),
            "count": len(items),
            "found": list(found_set),
            "options": list(options_set) if options_set else [first.get("surface", "")]
        })
    return issues_list

def scan_errors(
    db: Session,
    *,
    file_id: int,
    logger,
    technical_editor_cls,
):
    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        logger.error(f"Scan failed: File ID {file_id} not found in DB")
        raise HTTPException(status_code=404, detail="File not found")

    file_path = os.path.abspath(file_record.path)
    if not os.path.exists(file_path):
        logger.error(f"Scan failed: Physical file missing at {file_path}")
        raise HTTPException(status_code=404, detail=f"Physical file missing: {file_path}")

    # 1. Check Results Cache first to ensure O(1) page loads if file hasn't changed
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = RESULTS_DIR / f"{file_id}_scan.json"
    
    if cache_path.exists():
        try:
            with open(cache_path, "r", encoding="utf-8") as cf:
                cached = json.load(cf)
            cached_file = cached.get("file", {})
            file_mtime = os.path.getmtime(file_path)
            if (cached_file.get("version") == file_record.version and 
                cached_file.get("mtime") == file_mtime):
                logger.info(f"Technical Review Cache HIT for file {file_id}")
                return cached
        except Exception as e:
            logger.warning(f"Failed to read cached scan results for file {file_id}: {e}")

    # 2. Run manuscript_core Analyzer
    try:
        logger.info(f"Running manuscript_core analyzer on file: {file_path}")
        chapters = [
            {
                "index": 1,
                "filename": file_record.filename,
                "path": file_path,
                "client_name": "DefaultClient",
                "project_name": "DefaultProject",
                "role": "PM",
                "ia_mapping_path": ""
            }
        ]
        findings_dict = analyze_manuscript(chapters)
        
        # Populate legacy compatibility issues
        findings = findings_dict.get("findings", [])
        issues_list = _map_findings_to_legacy_issues(findings)
        
        scan_result = {
            "status": "ok",
            "file": {
                "id": file_record.id,
                "project_id": file_record.project_id,
                "chapter_id": file_record.chapter_id,
                "filename": file_record.filename,
                "file_type": file_record.file_type,
                "category": file_record.category,
                "uploaded_at": file_record.uploaded_at.isoformat() if file_record.uploaded_at else None,
                "version": file_record.version,
                "lock": {
                    "is_checked_out": bool(file_record.checked_out_by_id),
                    "checked_out_by_id": file_record.checked_out_by_id,
                    "checked_out_at": file_record.checked_out_at.isoformat() if file_record.checked_out_at else None
                }
            },
            "issues": issues_list,
            "findings": findings,
            "inconsistencies": findings_dict.get("inconsistencies", {}),
            "spelling_summary": findings_dict.get("spelling_summary", {}),
            "ia_report": findings_dict.get("ia_report", {}),
            "stats": {
                "word_count": findings_dict.get("meta", {}).get("total_words"),
                "missing_captions": findings_dict.get("meta", {}).get("total_missing_captions", 0),
                "missing_citations": findings_dict.get("meta", {}).get("total_missing_citations", 0),
            },
            "raw_scan": findings_dict
        }

        # 3. Cache the results
        try:
            scan_result["file"]["mtime"] = os.path.getmtime(file_path)
            cache_path.write_text(json.dumps(scan_result, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            logger.error(f"Failed to cache scan results: {e}")

        return scan_result

    except Exception as exc:
        logger.error(f"Technical Scan Error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


def apply_edits(
    db: Session,
    *,
    file_id: int,
    replacements,
    selected_findings=None,
    highlight_findings=None,
    username: str,
    logger,
    technical_editor_cls,
):
    import shutil
    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    file_path = os.path.abspath(file_record.path)
    output_path = file_path + ".te.tmp"

    # Get user id for archiving
    from app.domains.auth.models import User
    from app.domains.files import version_service
    from app.utils.timezone import now_ist_naive
    user_record = db.query(User).filter(User.username == username).first()
    user_id = user_record.id if user_record else None

    # 1. Archive the existing/old file before modifying it on disk
    base_path = os.path.dirname(file_path)
    try:
        version_service.archive_existing_file(
            db,
            existing_file=file_record,
            base_path=base_path,
            uploaded_by_id=user_id,
        )
    except Exception as e:
        logger.error(f"Failed to archive existing file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to archive the file: {str(e)}")

    try:
        # Check if doing advanced occurrence-level fixes
        if selected_findings is not None or highlight_findings is not None:
            logger.info("Applying targeted occurrence fixes via manuscript_core fixer...")
            
            selected_findings = selected_findings or []
            highlight_findings = highlight_findings or []
            
            # Helper function to construct highlight search regexes (similar to Flask blueprint)
            import re
            hl_texts = []
            seen = set()
            for hf in highlight_findings:
                pat_str = hf.get("search_pattern")
                if not pat_str:
                    surface = hf.get("surface", "")
                    if not surface:
                        continue
                    pat_str = r'\b' + re.escape(surface) + r'\b'
                key = (pat_str, hf.get("region", "body"), hf.get("source", "body"))
                if key not in seen:
                    seen.add(key)
                    hl_texts.append({
                        "pattern":       re.compile(pat_str, re.IGNORECASE),
                        "region":        hf.get("region", "body"),
                        "source_filter": hf.get("source", "body"),
                        "rule_id":       hf.get("rule_id", ""),
                        "surface":       hf.get("surface", ""),
                    })

            # Apply fixes targeted first
            if selected_findings:
                apply_fixes_targeted(Path(file_path), Path(output_path), selected_findings)
            else:
                shutil.copy2(file_path, output_path)

            # Apply highlights next
            if hl_texts:
                apply_te_highlights_to_docx(output_path, output_path, hl_texts)
        else:
            # Fallback to legacy rule-level replace
            logger.info("Applying legacy rule-level edits via TechnicalEditor...")
            editor = technical_editor_cls()
            editor.process(file_path, output_path, replacements or {}, author=username)

        if os.path.exists(output_path):
            # 2. Overwrite original file in-place and increment version
            shutil.move(output_path, file_path)
            file_record.version += 1
            file_record.uploaded_at = now_ist_naive()
            db.commit()

            # Invalidate results cache for this file
            cache_path = RESULTS_DIR / f"{file_id}_scan.json"
            if cache_path.exists():
                try:
                    cache_path.unlink()
                except Exception:
                    pass

            return {"status": "completed", "new_file_id": file_record.id}

        raise HTTPException(status_code=500, detail="Output file generation failed")

    except Exception as exc:
        logger.error(f"Technical Apply Error: {exc}")
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=str(exc))
