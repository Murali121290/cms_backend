import logging
import os
import urllib.parse
from typing import Any, Dict

from fastapi import HTTPException
from sqlalchemy.orm import Session

logger = logging.getLogger("app.domains.review.service")

from app.models import File
from app.processing.docx_to_xhtml import DocxToXhtmlEngine
from app.processing.docx_to_xhtml_runs import DocxToXhtmlRunsEngine
from app.processing.xhtml_to_docx import XhtmlToDocxEngine
from app.processing.xhtml_to_docx_delta import XhtmlToDocxDeltaEngine


ADDITIONAL_REVIEW_STYLES = [
    "ACK1", "ACKTXT", "ANS-NL-FIRST", "ANS-NL-MID", "APX", "APX-TXT", "APX-TXT-FLUSH", "APXAU",
    "APXST", "APXT", "TXT", "TXT-FLUSH",
    "BIB", "BIBH1", "BIBH2", "BL-FIRST", "BL-LAST", "BL-MID", "BL2-MID", "BL3-MID", "BL4-MID", "BL5-MID", "BL6-MID",
    "BX1-BL-FIRST", "BX1-BL-LAST", "BX1-BL-MID", "BX1-BL2-MID", "BX1-EXT-ONLY", "BX1-EQ-FIRST", "BX1-EQ-MID", "BX1-EQ-LAST", "BX1-EQ-ONLY",
    "BX1-FN", "BX1-H1", "BX1-H2", "BX1-H3", "BX1-L1", "BX1-MCUL-FIRST", "BX1-MCUL-LAST", "BX1-MCUL-MID", "BX1-NL-FIRST", "BX1-NL-LAST", "BX1-NL-MID",
    "BX1-OUT1-FIRST", "BX1-OUT1-MID", "BX1-OUT2", "BX1-OUT2-LAST", "BX1-OUT3", "BX1-QUO", "BX1-QUO-AU", "BX1-TTL", "BX1-TXT", "BX1-TXT-DC", "BX1-TXT-FIRST", "BX1-TYPE", "BX1-UL-FIRST", "BX1-UL-LAST", "BX1-UL-MID",
    "CAU", "CHAP", "CN", "COQ", "COQA", "COUT-1", "COUT-2", "COUT-BL", "COUTH1", "COUT-NL-FIRST", "COUT-NL-MID", "CPAU", "CPT", "CST", "CT",
    "DIA-FIRST", "DIA-LAST", "DIA-MID", "EQ-FIRST", "EQ-LAST", "EQ-MID", "EQ-ONLY", "EQN-FIRST", "EQN-LAST", "EQN-MID", "EQN-ONLY",
    "EXT-FIRST", "EXT-LAST", "EXT-MID", "EXT-ONLY", "FIG-CRED", "FIG-LEG", "FN",
    "H1", "H2", "H3", "H4", "H5", "H6",
    "KP1", "KP-BL-FIRST", "KP-BL-LAST", "KP-BL-MID", "KP-NL-FIRST", "KP-NL-LAST", "KP-NL-MID", "KT-BL-FIRST", "KT-NL-FIRST",
]


def resolve_processed_target(db: Session, *, file_id: int):
    file_record = db.query(File).filter(File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    original_path = file_record.path
    if original_path.endswith("_Processed.docx"):
        processed_path = original_path
        processed_filename = os.path.basename(original_path)
    else:
        dir_name = os.path.dirname(original_path)
        base_name = os.path.basename(original_path)
        name_only = os.path.splitext(base_name)[0]
        processed_filename = f"{name_only}_Processed.docx"
        processed_path = os.path.join(dir_name, processed_filename)

        # Fallback if _Processed.docx does not exist but the original file has been processed in-place
        if not os.path.exists(processed_path) and os.path.exists(original_path):
            has_history = file_record.version > 1 or (file_record.versions and len(file_record.versions) > 0)
            if has_history:
                processed_path = original_path

    return {
        "file_record": file_record,
        "processed_path": processed_path,
        "processed_filename": processed_filename,
    }


def build_review_page_state(
    db: Session,
    *,
    file_id: int,
    collabora_public_url: str,
    wopi_base_url: str,
    extract_document_structure_func,
    get_rules_loader_func,
):
    resolved = resolve_processed_target(db, file_id=file_id)
    processed_path = resolved["processed_path"]
    processed_filename = resolved["processed_filename"]

    if not os.path.exists(processed_path):
        return {
            "status": "error",
            "error_message": "Processed file not found. Please run Structuring process first.",
        }

    # Keep current side effect/validation behavior: structure extraction runs even
    # though the template does not currently consume the result directly.
    extract_document_structure_func(processed_path)

    # Derive the paragraph styles ACTUALLY applied in this Word document so the
    # "Styles Applied" list reflects the real DOCX, not the static rules catalogue
    # (which returns the same list for every file). Falls back to the catalogue
    # if the document cannot be read or no styles are found.
    applied_styles: set[str] = set()
    try:
        from docx import Document

        doc = Document(processed_path)

        def _collect(paragraphs):
            for para in paragraphs:
                name = getattr(getattr(para, "style", None), "name", None)
                if name:
                    applied_styles.add(name)

        _collect(doc.paragraphs)
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    _collect(cell.paragraphs)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Could not read applied styles from %s: %s", processed_path, exc)

    if applied_styles:
        style_list = sorted(applied_styles)
    else:
        # Fallback: static rules catalogue
        styles = set()
        for rule in get_rules_loader_func().get_paragraphs():
            if "style" in rule:
                styles.add(rule["style"])
        styles.add("Normal")
        styles.add("Body Text")
        styles.update(ADDITIONAL_REVIEW_STYLES)
        style_list = sorted(styles)

    wopi_src = f"{wopi_base_url}/wopi/files/{file_id}/structuring"
    wopi_src_encoded = urllib.parse.quote(wopi_src, safe="")
    collabora_url = (
        f"{collabora_public_url}/browser/dist/cool.html"
        f"?WOPISrc={wopi_src_encoded}"
        f"&lang=en"
    )

    return {
        "status": "ok",
        "file": resolved["file_record"],
        "filename": processed_filename,
        "collabora_url": collabora_url,
        "styles": style_list,
    }


def save_changes(
    db: Session,
    *,
    file_id: int,
    changes: Dict[str, Any],
    update_document_structure_func,
    logger,
):
    from docx import Document

    resolved = resolve_processed_target(db, file_id=file_id)
    processed_path = resolved["processed_path"]
    processed_filename = resolved["processed_filename"]

    if not os.path.exists(processed_path):
        logger.warning(f"Save failed: Processed file not found at {processed_path}")
        raise HTTPException(status_code=404, detail="Processed file not found")

    modifications = changes.get("changes", {})

    # Handle paragraph_styles changes (from new WYSIWYG editor)
    if "paragraph_styles" in modifications:
        try:
            doc = Document(processed_path)
            style_changes = modifications["paragraph_styles"]

            block_idx = 0
            for elem in doc.element.body:
                from lxml import etree
                tag = etree.QName(elem.tag).localname

                if tag == "p":
                    # Find matching change for this paragraph block
                    for change in style_changes:
                        if change["para_index"] == block_idx:
                            new_style = change["style_name"]
                            para = doc.paragraphs[block_idx]
                            try:
                                para.style = new_style
                            except Exception as e:
                                logger.warning(f"Could not apply style '{new_style}' to paragraph: {e}")
                            break
                    block_idx += 1
                elif tag == "tbl":
                    # Tables count as a block index
                    for change in style_changes:
                        if change["para_index"] == block_idx:
                            # Table styling is limited; skip for now
                            break
                    block_idx += 1

            file_record = resolved["file_record"]
            try:
                from app.domains.files import version_service as vs
                vs.archive_existing_file(
                    db,
                    existing_file=file_record,
                    base_path=os.path.dirname(processed_path),
                    uploaded_by_id=None,
                    source_path=processed_path,
                )
                file_record.version += 1
            except Exception as _e:
                logger.warning(f"Version archive failed (non-fatal): {_e}")

            doc.save(processed_path)
            db.commit()
            logger.info(f"Successfully updated paragraph styles for {processed_filename}")
            return {"status": "success"}
        except Exception as exc:
            logger.error(f"Error saving paragraph styles: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Failed to save changes: {str(exc)}")

    # Handle legacy XHTML-based structure updates
    try:
        file_record = resolved["file_record"]
        try:
            from app.domains.files import version_service as vs
            vs.archive_existing_file(
                db,
                existing_file=file_record,
                base_path=os.path.dirname(processed_path),
                uploaded_by_id=None,
                source_path=processed_path,
            )
            file_record.version += 1
        except Exception as _e:
            logger.warning(f"Version archive failed (non-fatal): {_e}")

        success = update_document_structure_func(processed_path, processed_path, modifications)
        if success:
            db.commit()
            logger.info(f"Successfully updated structure for {processed_filename}")
            return {"status": "success"}
        raise Exception("update_document_structure returned False")
    except Exception as exc:
        logger.error(f"Error saving changes: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to save changes: {str(exc)}")


def get_export_payload(db: Session, *, file_id: int, logger):
    resolved = resolve_processed_target(db, file_id=file_id)
    processed_path = resolved["processed_path"]
    processed_filename = resolved["processed_filename"]

    if not os.path.exists(processed_path):
        logger.warning(f"Export failed: Processed file not found at {processed_path}")
        raise HTTPException(status_code=404, detail="Processed file not found")

    return {
        "path": processed_path,
        "filename": processed_filename,
    }


def _get_xhtml_path(processed_path: str) -> str:
    """Derive XHTML path from processed DOCX path."""
    dir_name = os.path.dirname(processed_path)
    base_name = os.path.splitext(os.path.basename(processed_path))[0]
    xhtml_dir = os.path.join(dir_name, "xhtml")
    return os.path.join(xhtml_dir, f"{base_name}.html")


def get_xhtml_content(db: Session, *, file_id: int) -> Dict[str, Any]:
    """
    Get XHTML content for a file.

    Returns: {"content": str, "exists": bool, "mtime": float, "xhtml_path": str}
    """
    resolved = resolve_processed_target(db, file_id=file_id)
    processed_path = resolved["processed_path"]

    if not os.path.exists(processed_path):
        raise HTTPException(status_code=404, detail="Processed DOCX file not found")

    xhtml_path = _get_xhtml_path(processed_path)

    # Always force a fresh conversion to ensure the editor shows the latest text/styles in all stages
    try:
        os.makedirs(os.path.dirname(xhtml_path), exist_ok=True)
        engine = DocxToXhtmlEngine()
        engine.convert(processed_path, xhtml_path)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Failed to force-convert XHTML in get_xhtml_content: {e}")

    if not os.path.exists(xhtml_path):
        return {
            "content": "",
            "exists": False,
            "mtime": None,
            "xhtml_path": xhtml_path,
        }

    try:
        with open(xhtml_path, "r", encoding="utf-8") as f:
            content = f.read()
        mtime = os.path.getmtime(xhtml_path)
        return {
            "content": content,
            "exists": True,
            "mtime": mtime,
            "xhtml_path": xhtml_path,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read XHTML: {str(e)}")


def generate_xhtml(db: Session, *, file_id: int, logger) -> Dict[str, Any]:
    """
    Generate XHTML from processed DOCX.

    Returns: {"status": str, "xhtml_path": str}
    """
    resolved = resolve_processed_target(db, file_id=file_id)
    processed_path = resolved["processed_path"]

    if not os.path.exists(processed_path):
        raise HTTPException(status_code=404, detail="Processed DOCX file not found")

    xhtml_path = _get_xhtml_path(processed_path)

    try:
        os.makedirs(os.path.dirname(xhtml_path), exist_ok=True)
        engine = DocxToXhtmlEngine()
        result_path = engine.convert(processed_path, xhtml_path)
        logger.info(f"Generated XHTML: {result_path}")
        return {
            "status": "ok",
            "xhtml_path": result_path,
        }
    except Exception as e:
        logger.error(f"XHTML generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"XHTML generation failed: {str(e)}")


def save_xhtml_and_convert(
    db: Session,
    *,
    file_id: int,
    html_content: str,
    username: str = "WYSIWYG Editor",
    logger,
) -> Dict[str, Any]:
    """
    Save edited XHTML and apply paragraph style and format changes back to the
    existing processed DOCX in-place, incrementing version and archiving the old file.

    Returns: {"status": str, "file_id": int}
    """
    resolved = resolve_processed_target(db, file_id=file_id)
    file_record = resolved["file_record"]
    processed_path = resolved["processed_path"]

    if not os.path.exists(processed_path):
        raise HTTPException(status_code=404, detail="Processed DOCX file not found")

    # Check if there are actual changes made to the XHTML content
    xhtml_path_existing = _get_xhtml_path(processed_path)
    if os.path.exists(xhtml_path_existing):
        try:
            with open(xhtml_path_existing, "r", encoding="utf-8") as f:
                current_xhtml = f.read()
            if current_xhtml.strip() == html_content.strip():
                logger.info(f"No changes detected in edited HTML for file {file_id}. Version bump skipped.")
                return {"status": "ok", "file_id": file_id}
        except Exception as e:
            logger.warning(f"Failed to read existing XHTML to check for changes: {e}")

    # Get user id for archiving
    from app.models import User
    user_record = db.query(User).filter(User.username == username).first()
    user_id = user_record.id if user_record else None

    # 1. Archive the existing/old file before modifying it on disk
    from app.domains.files import version_service
    base_path = os.path.dirname(processed_path)
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

    xhtml_path = _get_xhtml_path(processed_path)
    tmp_docx = processed_path + ".tmp"

    try:
        # 2. Write XHTML to disk
        os.makedirs(os.path.dirname(xhtml_path), exist_ok=True)
        with open(xhtml_path, "w", encoding="utf-8") as f:
            f.write(html_content)
        logger.info(f"Saved XHTML: {xhtml_path}")

        # 3. Patch in-place directly on the existing file path!
        engine = XhtmlToDocxEngine()
        engine.convert(xhtml_path, processed_path, username=username)
        logger.info(f"Style-patched DOCX version {file_record.version + 1} in-place: {processed_path}")

        # 4. Update the existing file record version and timestamp in-place
        from app.utils.timezone import now_ist_naive
        file_record.version += 1
        file_record.uploaded_at = now_ist_naive()
        db.commit()

        # Invalidate results cache for the file
        from app.domains.processing.technical_editor_service import RESULTS_DIR
        cache_path = RESULTS_DIR / f"{file_id}_scan.json"
        if cache_path.exists():
            try:
                cache_path.unlink()
            except Exception:
                pass

        return {
            "status": "ok",
            "file_id": file_record.id,
        }

    except Exception as e:
        logger.error(f"XHTML save/convert failed: {e}", exc_info=True)
        if os.path.exists(tmp_docx):
            try:
                os.remove(tmp_docx)
            except Exception:
                pass
        raise HTTPException(
            status_code=500, detail=f"XHTML save/convert failed: {str(e)}"
        )


def get_file_xhtml_runs(db: Session, *, file_id: int, logger) -> Dict[str, Any]:
    """
    Build run-anchored XHTML (every run carries its original w:rPr as data-rpr) for the
    formatting-preserving WYSIWYG editor.

    Returns: {"content": str, "filename": str}
    """
    resolved = resolve_processed_target(db, file_id=file_id)
    file_record = resolved["file_record"]
    processed_path = resolved["processed_path"]

    # Fall back to the original upload if no processed copy exists yet.
    source_path = processed_path if os.path.exists(processed_path) else file_record.path
    if not os.path.exists(source_path):
        raise HTTPException(status_code=404, detail="Physical file missing on disk")

    try:
        content = DocxToXhtmlRunsEngine().convert(source_path, file_id=file_id)
    except Exception as e:
        logger.error(f"Run-anchored XHTML generation failed for file {file_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate editor content: {str(e)}")

    return {"content": content, "filename": file_record.filename}


def save_xhtml_delta_and_convert(
    db: Session,
    *,
    file_id: int,
    html_content: str,
    username: str = "WYSIWYG Editor",
    logger,
) -> Dict[str, Any]:
    """
    Save edited run-anchored XHTML and apply ONLY the changed runs/marks back to the
    existing processed DOCX in-place, incrementing version and archiving the old file.

    Returns: {"status": str, "file_id": int}
    """
    resolved = resolve_processed_target(db, file_id=file_id)
    file_record = resolved["file_record"]
    processed_path = resolved["processed_path"]

    # Delta patch requires an existing DOCX to patch; fall back to the original upload.
    source_path = processed_path if os.path.exists(processed_path) else file_record.path
    if not os.path.exists(source_path):
        raise HTTPException(status_code=404, detail="Processed DOCX file not found")

    # Get user id for archiving
    from app.models import User
    user_record = db.query(User).filter(User.username == username).first()
    user_id = user_record.id if user_record else None

    # 1. Archive the existing/old file before modifying it on disk
    from app.domains.files import version_service
    base_path = os.path.dirname(source_path)
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

    xhtml_path = _get_xhtml_path(source_path)

    try:
        os.makedirs(os.path.dirname(xhtml_path), exist_ok=True)
        with open(xhtml_path, "w", encoding="utf-8") as f:
            f.write(html_content)

        # 2. Patch in-place directly on the existing file path!
        XhtmlToDocxDeltaEngine().convert(xhtml_path, source_path, username=username)
        logger.info(f"Delta-patched DOCX version {file_record.version + 1} in-place: {source_path}")

        # 3. Update the existing file record version and timestamp in-place
        from app.utils.timezone import now_ist_naive
        file_record.version += 1
        file_record.uploaded_at = now_ist_naive()
        db.commit()

        # Invalidate cache for the file
        from app.domains.processing.technical_editor_service import RESULTS_DIR
        cache_path = RESULTS_DIR / f"{file_id}_scan.json"
        if cache_path.exists():
            try:
                cache_path.unlink()
            except Exception:
                pass

        return {"status": "ok", "file_id": file_record.id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"XHTML delta save/convert failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"XHTML delta save/convert failed: {str(e)}")


def _ref_review_cache_path(processed_path: str) -> str:
    """Derive a sidecar cache file path for the reference review."""
    dir_name = os.path.dirname(processed_path)
    base_name = os.path.splitext(os.path.basename(processed_path))[0]
    return os.path.join(dir_name, f".{base_name}.refcache.json")


def build_reference_review_page_state(db: Session, *, file_id: int, logger) -> Dict[str, Any]:
    import json
    resolved = resolve_processed_target(db, file_id=file_id)
    file_record = resolved["file_record"]
    processed_path = resolved["processed_path"]

    if not os.path.exists(processed_path):
        raise HTTPException(
            status_code=404,
            detail="Processed reference file not found on disk."
        )

    docx_mtime = os.path.getmtime(processed_path)
    cache_path = _ref_review_cache_path(processed_path)

    # ── Fast path: serve from cache if the DOCX hasn't been modified ──────────
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as cf:
                cached = json.load(cf)
            if cached.get("mtime") == docx_mtime:
                logger.info(f"Reference review cache HIT for file {file_id}")
                # Styles list (static, cheap to rebuild)
                styles = _ref_review_styles()
                return {
                    "status": "ok",
                    "file": file_record,
                    "filename": cached["filename"],
                    "content": cached["content"],
                    "styles": styles,
                    "validation_logs": cached["validation_logs"],
                }
        except Exception as e:
            logger.warning(f"Reference review cache read failed (will regenerate): {e}")

    logger.info(f"Reference review cache MISS for file {file_id} — regenerating…")

    # 1. Load run-anchored XHTML
    try:
        xhtml_data = get_file_xhtml_runs(db, file_id=file_id, logger=logger)
        content = xhtml_data["content"]
        filename = xhtml_data["filename"]
    except Exception as e:
        logger.error(f"Failed to convert references doc to XHTML: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load document content: {str(e)}"
        )


    # 2. Extract live stats and validation issues using PPH scripts
    validation_logs = {
        "stats": {},
        "total_refs": 0,
        "total_cites": 0,
        "issues": [],
        "renumbering_map": {},
        "duplicates": [],
        "sequence_issues": [],
        "missing_references": [],
        "unused_references": [],
    }

    try:
        from docx import Document
        doc = Document(processed_path)
        
        # Detect the style based on paragraph style names
        is_ama = False
        is_apa = False
        for p in doc.paragraphs:
            style_name = (p.style.name or "") if p.style else ""
            if "REF-N" in style_name:
                is_ama = True
            elif "REF-U" in style_name:
                is_apa = True

        detected_style = "AMA"
        if is_apa and not is_ama:
            detected_style = "APA"
            
        validation_logs["detected_style"] = detected_style
        
        if detected_style == "AMA":
            # A. Numerical/Sequence Validation (AMA 11th Edition / Vancouver)
            from app.processing.legacy.Referencenumvalidation import ReferenceProcessor
            ref_proc = ReferenceProcessor(doc)
            num_stats = ref_proc.get_validation_stats()
            
            validation_logs["total_refs"] = num_stats.get("total_references", 0)
            validation_logs["total_cites"] = num_stats.get("total_citations", 0)
            validation_logs["duplicates"] = num_stats.get("duplicate_references", [])
            validation_logs["sequence_issues"] = num_stats.get("sequence_issues", [])
            
            # Map numerical missing/unused references to issues list
            for missing_num in num_stats.get("missing_references", []):
                msg = f"Numerical citation [{missing_num}] has no matching reference entry."
                issue_item = {
                    "type": "missing",
                    "para_idx": -1,
                    "message": msg,
                    "citation": f"[{missing_num}]"
                }
                validation_logs["issues"].append(issue_item)
                validation_logs["missing_references"].append(issue_item)
                
            for unused_num in num_stats.get("unused_references", []):
                msg = f"Reference [{unused_num}] is in bibliography but never cited."
                issue_item = {
                    "type": "unused",
                    "para_idx": -1,
                    "message": msg,
                    "citation": f"[{unused_num}]"
                }
                validation_logs["issues"].append(issue_item)
                validation_logs["unused_references"].append(issue_item)
                
            # Build citation_pairs and reference_entries
            refs_found, ref_objects = ref_proc.get_references_in_bibliography()
            all_cited_ids, appearance_order = ref_proc.get_citations_in_text()
            cited_set = set(all_cited_ids)

            # Build citation_pairs: one entry per unique cited number, in appearance order
            ref_text_map = {obj["id"]: obj["para"].text.strip() for obj in ref_objects}
            citation_pairs = []
            for num in appearance_order:
                citation_pairs.append({
                    "citation": str(num),
                    "ref_number": num,
                    "ref_text": ref_text_map.get(num, ""),
                    "status": "ok" if num in refs_found else "missing",
                })
            # Add unused entries (in bibliography but never cited)
            for obj in ref_objects:
                if obj["id"] not in cited_set:
                    citation_pairs.append({
                        "citation": None,
                        "ref_number": obj["id"],
                        "ref_text": obj["para"].text.strip(),
                        "status": "unused",
                    })

            # Build reference_entries: all bibliography paragraphs in order
            reference_entries = []
            for i, obj in enumerate(ref_objects):
                reference_entries.append({
                    "number": obj["id"],
                    "text": obj["para"].text.strip(),
                    "style": "REF-N",
                    "is_cited": obj["id"] in cited_set,
                    "para_idx": i,   # approximate; sufficient for editor focus
                })

            validation_logs["citation_pairs"] = citation_pairs
            validation_logs["reference_entries"] = reference_entries
        else:
            # B. APA Name & Year Validation (APA 7th Edition)
            from app.processing.legacy.validation_core import CitationProcessor
            cite_proc = CitationProcessor(processed_path)
            report = cite_proc.run()
            
            validation_logs["stats"] = dict(report.stats)
            validation_logs["total_refs"] = dict(report.stats).get("Total bibliography entries", 0)
            validation_logs["total_cites"] = dict(report.stats).get("Total in-text citations", 0)
            
            # Collect Name & Year issues
            for issue in report.issues:
                issue_copy = {k: v for k, v in issue.items() if k != "para"}
                validation_logs["issues"].append(issue_copy)
                
                # Map into categories
                itype = issue_copy.get("type")
                if itype == "missing":
                    validation_logs["missing_references"].append(issue_copy)
                elif itype == "unused":
                    validation_logs["unused_references"].append(issue_copy)

            # Build citation_pairs and reference_entries
            bib_items = list(getattr(cite_proc, "_bib_ordered", []) or cite_proc.bibliography.values())
            cited_keys = getattr(cite_proc, "_cited_keys", set())

            citation_pairs = []
            for issue in report.issues:
                if issue.get("type") in ("missing", "unused", "duplicate_entry"):
                    pass  # these go to reference_entries only

            # Iterate bib in document order to build pairs
            for entry in bib_items:
                status = "ok" if entry.get("cited") else "unused"
                citation_pairs.append({
                    "citation": f"({entry.get('display', '')}, {entry.get('year', '')})",
                    "author": entry.get("display", ""),
                    "year": entry.get("year", ""),
                    "ref_text": entry.get("raw", ""),
                    "status": status,
                    "para_idx": entry.get("para_idx", -1),
                })

            # Add missing citations (cited in text but no bib entry)
            for issue in report.issues:
                if issue.get("type") == "missing":
                    citation_pairs.append({
                        "citation": issue.get("raw", issue.get("citation", "")),
                        "author": "",
                        "year": "",
                        "ref_text": "",
                        "status": "missing",
                        "para_idx": issue.get("para_idx", -1),
                    })

            reference_entries = []
            for i, entry in enumerate(bib_items):
                reference_entries.append({
                    "number": None,
                    "text": entry.get("raw", ""),
                    "style": "REF-U",
                    "is_cited": entry.get("cited", False),
                    "para_idx": entry.get("para_idx", -1),
                })

            validation_logs["citation_pairs"] = citation_pairs
            validation_logs["reference_entries"] = reference_entries

    except Exception as e:
        logger.error(f"Error computing live validation stats: {e}", exc_info=True)

    # 3. Read log file if it exists
    try:
        base_dir = os.path.dirname(file_record.path)
        filename_base = os.path.splitext(file_record.filename)[0]
        clean_base = filename_base.replace("_Processed", "").replace("_Structured", "")
        log_filename = f"{clean_base}_log.txt"
        log_path = os.path.join(base_dir, log_filename)
        
        if os.path.exists(log_path):
            with open(log_path, "r", encoding="utf-8") as lf:
                raw_log = lf.read()
            validation_logs["raw_log"] = raw_log
    except Exception as e:
        logger.warning(f"Could not read raw log file: {e}")

    styles = _ref_review_styles()

    # ── Write cache so the next page load is instant ──────────────────────────
    try:
        import json
        with open(cache_path, "w", encoding="utf-8") as cf:
            json.dump(
                {"mtime": docx_mtime, "filename": filename, "content": content, "validation_logs": validation_logs},
                cf,
                ensure_ascii=False,
            )
        logger.info(f"Reference review cache written for file {file_id}")
    except Exception as e:
        logger.warning(f"Reference review cache write failed (non-fatal): {e}")

    return {
        "status": "ok",
        "file": file_record,
        "filename": filename,
        "content": content,
        "styles": styles,
        "validation_logs": validation_logs
    }


def run_validation_only(db: Session, *, file_id: int, logger=None) -> Dict[str, Any]:
    """
    Run validation-only (no XHTML conversion, no re-structuring).
    Returns only validation_logs and detected_style.
    This is fast and doesn't reload editor content.
    """
    resolved = resolve_processed_target(db, file_id=file_id)
    file_record = resolved["file_record"]
    processed_path = resolved["processed_path"]

    if not os.path.exists(processed_path):
        raise HTTPException(status_code=404, detail="Processed reference file not found.")

    validation_logs = {
        "stats": {},
        "total_refs": 0,
        "total_cites": 0,
        "issues": [],
        "renumbering_map": {},
        "duplicates": [],
        "sequence_issues": [],
        "missing_references": [],
        "unused_references": [],
    }

    try:
        from docx import Document
        doc = Document(processed_path)

        # Detect style: REF-N -> AMA, REF-U -> APA
        is_ama = False
        is_apa = False
        for p in doc.paragraphs:
            style_name = (p.style.name or "") if p.style else ""
            if "REF-N" in style_name:
                is_ama = True
            elif "REF-U" in style_name:
                is_apa = True

        detected_style = "AMA" if is_ama and not is_apa else ("APA" if is_apa else "AMA")
        validation_logs["detected_style"] = detected_style

        if detected_style == "AMA":
            # Numerical/Sequence Validation (AMA)
            from app.processing.legacy.Referencenumvalidation import ReferenceProcessor
            ref_proc = ReferenceProcessor(doc)
            num_stats = ref_proc.get_validation_stats()

            validation_logs["total_refs"] = num_stats.get("total_references", 0)
            validation_logs["total_cites"] = num_stats.get("total_citations", 0)
            validation_logs["duplicates"] = num_stats.get("duplicate_references", [])
            validation_logs["sequence_issues"] = num_stats.get("sequence_issues", [])

            # Map missing/unused references to issues list
            for missing_num in num_stats.get("missing_references", []):
                issue_item = {
                    "type": "missing",
                    "para_idx": -1,
                    "message": f"Numerical citation [{missing_num}] has no matching reference entry.",
                    "citation": f"[{missing_num}]"
                }
                validation_logs["issues"].append(issue_item)
                validation_logs["missing_references"].append(issue_item)

            for unused_num in num_stats.get("unused_references", []):
                issue_item = {
                    "type": "unused",
                    "para_idx": -1,
                    "message": f"Reference [{unused_num}] is in bibliography but never cited.",
                    "citation": f"[{unused_num}]"
                }
                validation_logs["issues"].append(issue_item)
                validation_logs["unused_references"].append(issue_item)

            # Build citation_pairs and reference_entries
            refs_found, ref_objects = ref_proc.get_references_in_bibliography()
            all_cited_ids, appearance_order = ref_proc.get_citations_in_text()
            cited_set = set(all_cited_ids)

            ref_text_map = {obj["id"]: obj["para"].text.strip() for obj in ref_objects}
            citation_pairs = []
            for num in appearance_order:
                citation_pairs.append({
                    "citation": str(num),
                    "ref_number": num,
                    "ref_text": ref_text_map.get(num, ""),
                    "status": "ok" if num in refs_found else "missing",
                    "para_idx": -1,  # Will be set from global document index below
                })
            for obj in ref_objects:
                if obj["id"] not in cited_set:
                    citation_pairs.append({
                        "citation": None,
                        "ref_number": obj["id"],
                        "ref_text": obj["para"].text.strip(),
                        "status": "unused",
                        "para_idx": -1,
                    })

            # Build reference_entries with global para_idx
            reference_entries = []
            para_count = 0
            for p in doc.paragraphs:
                style_name = (p.style.name or "") if p.style else ""
                if "REF-N" in style_name:
                    # This is a bibliography paragraph
                    ref_num = None
                    for obj in ref_objects:
                        if obj["para"] == p:
                            ref_num = obj["id"]
                            break

                    if ref_num is not None:
                        # Update citation_pairs with global para_idx
                        for pair in citation_pairs:
                            if pair.get("ref_number") == ref_num:
                                pair["para_idx"] = para_count

                        reference_entries.append({
                            "number": ref_num,
                            "text": p.text.strip(),
                            "style": "REF-N",
                            "is_cited": ref_num in cited_set,
                            "para_idx": para_count,
                        })
                para_count += 1

            validation_logs["citation_pairs"] = citation_pairs
            validation_logs["reference_entries"] = reference_entries
        else:
            # APA Name & Year Validation
            from app.processing.legacy.validation_core import CitationProcessor
            cite_proc = CitationProcessor(processed_path)
            report = cite_proc.run()

            validation_logs["stats"] = dict(report.stats)
            validation_logs["total_refs"] = dict(report.stats).get("Total bibliography entries", 0)
            validation_logs["total_cites"] = dict(report.stats).get("Total in-text citations", 0)

            # Collect Name & Year issues
            for issue in report.issues:
                issue_copy = {k: v for k, v in issue.items() if k != "para"}
                validation_logs["issues"].append(issue_copy)

                itype = issue_copy.get("type")
                if itype == "missing":
                    validation_logs["missing_references"].append(issue_copy)
                elif itype == "unused":
                    validation_logs["unused_references"].append(issue_copy)

            # Build citation_pairs and reference_entries
            bib_items = list(getattr(cite_proc, "_bib_ordered", []) or cite_proc.bibliography.values())

            citation_pairs = []
            for entry in bib_items:
                status = "ok" if entry.get("cited") else "unused"
                citation_pairs.append({
                    "citation": f"({entry.get('display', '')}, {entry.get('year', '')})",
                    "author": entry.get("display", ""),
                    "year": entry.get("year", ""),
                    "ref_text": entry.get("raw", ""),
                    "status": status,
                    "para_idx": entry.get("para_idx", -1),
                })

            # Add missing citations
            for issue in report.issues:
                if issue.get("type") == "missing":
                    citation_pairs.append({
                        "citation": issue.get("raw", issue.get("citation", "")),
                        "author": "",
                        "year": "",
                        "ref_text": "",
                        "status": "missing",
                        "para_idx": issue.get("para_idx", -1),
                    })

            reference_entries = []
            for i, entry in enumerate(bib_items):
                reference_entries.append({
                    "number": None,
                    "text": entry.get("raw", ""),
                    "style": "REF-U",
                    "is_cited": entry.get("cited", False),
                    "para_idx": entry.get("para_idx", -1),
                })

            validation_logs["citation_pairs"] = citation_pairs
            validation_logs["reference_entries"] = reference_entries

    except Exception as e:
        if logger:
            logger.error(f"Error computing validation stats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Validation failed: {str(e)}")

    return {
        "validation_logs": validation_logs,
        "detected_style": validation_logs.get("detected_style", "AMA"),
    }


def _ref_review_styles() -> list:
    """Static list of bibliography and citation character styles."""
    return [
        # bibliography character styles
        "bib_alt-year", "bib_article", "bib_base", "bib_book", "bib_chapterno", "bib_chaptertitle",
        "bib_comment", "bib_confacronym", "bib_confdate", "bib_conference", "bib_conflocation",
        "bib_confpaper", "bib_confproceedings", "bib_day", "bib_deg", "bib_doi", "bib_ed-etal",
        "bib_ed-fname", "bib_ed-organization", "bib_ed-suffix", "bib_ed-surname", "bib_editionno",
        "bib_etal", "bib_extlink", "bib_fname", "bib_fpage", "bib_institution", "bib_isbn",
        "bib_issue", "bib_journal", "bib_location", "bib_lpage", "bib_medline", "bib_month",
        "bib_number", "bib_organization", "bib_pagecount", "bib_papernumber", "bib_patent",
        "bib_publisher", "bib_reportnum", "bib_school", "bib_season", "bib_series", "bib_seriesno",
        "bib_suffix", "bib_suppl", "bib_surname", "bib_title", "bib_trans", "bib_unpubl",
        "bib_url", "bib_volcount", "bib_volume", "bib_year",
        # citation styles
        "cite_app", "cite_bib", "cite_eq", "cite_fig", "cite_fn", "cite_sec", "cite_tbl",
        "cite_tfn", "cite_base", "cite_box"
    ]


def invalidate_ref_review_cache(processed_path: str, logger=None) -> None:
    """Delete the reference review sidecar cache so the next load regenerates it."""
    cache_path = _ref_review_cache_path(processed_path)
    if os.path.exists(cache_path):
        try:
            os.remove(cache_path)
            if logger:
                logger.info(f"Reference review cache invalidated: {cache_path}")
        except Exception as e:
            if logger:
                logger.warning(f"Failed to remove ref review cache: {e}")
