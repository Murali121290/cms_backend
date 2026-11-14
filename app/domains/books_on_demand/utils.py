import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

def calculate_bod_due_date(
    pdf_type: Optional[str], 
    page_count: Optional[int] = None, 
    from_date: Optional[datetime] = None
) -> datetime:
    """
    Calculate BOD Job due date based on PDF type:
    Text PDF: 3 Days
    Image PDF: 6 Days
    """
    if from_date is None:
        from_date = datetime.now(timezone.utc)

    is_image = bool(pdf_type and "image" in str(pdf_type).lower())
    # days = 6 if is_image else 3
    days = 7 if is_image else 4

    return from_date + timedelta(days=days)


def generate_bod_history_csv(job, target_dir: str) -> str:
    """
    Generates the standard BOD history.csv for the given job in target_dir.
    Format:
    Project,Status,Format,Layout,User,Correction Type,Correction Request,File Size,Conformity level WCAG,Level of Complexity,Non-Accessible Elements,Primary Content Type,Content Type
    {eisbn},y,ePub all,Reflowable,,,,{file_size},A,simple,n,textual,textual visual
    """
    eisbn = ""
    for candidate in (getattr(job, "pdf_filename", None), getattr(job, "epub_filename", None), getattr(job, "project_name", None)):
        if candidate:
            m_isbn = re.search(r'(\d{10,13})', str(candidate))
            if m_isbn:
                eisbn = m_isbn.group(1)
                break

    if not eisbn:
        if getattr(job, "project_name", None):
            eisbn = str(job.project_name).strip()
        elif getattr(job, "epub_filename", None):
            eisbn = job.epub_filename.rsplit('.', 1)[0].strip()

    file_size = 0
    epub_fp = getattr(job, "epub_filepath", None)
    pdf_fp = getattr(job, "pdf_filepath", None)
    if epub_fp and os.path.exists(epub_fp):
        try:
            file_size = os.path.getsize(epub_fp)
        except Exception:
            file_size = 0
    elif pdf_fp and os.path.exists(pdf_fp):
        try:
            file_size = os.path.getsize(pdf_fp)
        except Exception:
            file_size = 0

    file_size_str = str(file_size) if file_size > 0 else "1111"

    # Determine WCAG conformance level from ACE report if available
    wcag_conformance = "A"
    ace_candidates = []
    if getattr(job, "ace_report_filepath", None) and os.path.exists(job.ace_report_filepath):
        ace_candidates.append(job.ace_report_filepath)

    folder_name = getattr(job, "project_name", None) or (job.pdf_filename.rsplit('.', 1)[0] if getattr(job, "pdf_filename", None) else f"bod_job_{getattr(job, 'id', '')}")
    folder_name_clean = re.sub(r'[^a-zA-Z0-9_\-]', '_', folder_name)

    from app.domains.post_prod.epub_validator.services.upload_service import UPLOAD_DIR
    validator_ace_json = os.path.join(UPLOAD_DIR, folder_name_clean, "ace", "report.json")
    if os.path.exists(validator_ace_json):
        ace_candidates.append(validator_ace_json)

    # Also check without regex replacement if different
    if folder_name != folder_name_clean:
        alt_ace_json = os.path.join(UPLOAD_DIR, folder_name, "ace", "report.json")
        if os.path.exists(alt_ace_json):
            ace_candidates.append(alt_ace_json)

    import json
    for ace_p in ace_candidates:
        try:
            with open(ace_p, "r", encoding="utf-8", errors="replace") as f_ace:
                ace_data = json.load(f_ace)
            conf_val = ace_data.get("conformance_level") or ace_data.get("data", {}).get("report", {}).get("conformance_level")
            if conf_val and conf_val.strip().lower() not in ("none", ""):
                wcag_conformance = conf_val.strip()
                break
        except Exception:
            pass

    history_header = "Project,Status,Format,Layout,User,Correction Type,Correction Request,File Size,Conformity level WCAG,Level of Complexity,Non-Accessible Elements,Primary Content Type,Content Type"
    history_row = f"{eisbn},y,ePub all,Reflowable,,,,{file_size_str},{wcag_conformance},simple,n,textual,textual visual"
    history_row_clean = history_row.replace("\r", " ").replace("\n", " ").strip()
    history_csv_content = f"{history_header}\n{history_row_clean}\n"

    os.makedirs(target_dir, exist_ok=True)
    history_csv_filepath = os.path.join(target_dir, "history.csv")
    with open(history_csv_filepath, "w", encoding="utf-8") as f_hist:
        f_hist.write(history_csv_content)

    return history_csv_filepath

