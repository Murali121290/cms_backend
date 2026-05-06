import os
import urllib.parse
from typing import Any, Dict

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import File


ADDITIONAL_REVIEW_STYLES = [
    "ACK1", "ACKTXT", "ANS-NL-FIRST", "ANS-NL-MID", "APX", "APX-TXT", "APX-TXT-FLUSH", "APXAU",
    "Î‘Î¡Î§Î—1", "Î‘Î¡Î§Î—3", "Î‘Î¡Î§Î", "APXST", "APXT", "TXT", "TXT-FLUSH",
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

    rules_loader = get_rules_loader_func()
    styles = set()
    for rule in rules_loader.get_paragraphs():
        if "style" in rule:
            styles.add(rule["style"])

    styles.add("Normal")
    styles.add("Body Text")
    styles.update(ADDITIONAL_REVIEW_STYLES)
    style_list = sorted(list(styles))

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
    resolved = resolve_processed_target(db, file_id=file_id)
    processed_path = resolved["processed_path"]
    processed_filename = resolved["processed_filename"]

    if not os.path.exists(processed_path):
        logger.warning(f"Save failed: Processed file not found at {processed_path}")
        raise HTTPException(status_code=404, detail="Processed file not found")

    modifications = changes.get("changes", {})

    try:
        success = update_document_structure_func(processed_path, processed_path, modifications)
        if success:
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
