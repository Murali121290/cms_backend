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

    history_header = "Project,Status,Format,Layout,User,Correction Type,Correction Request,File Size,Conformity level WCAG,Level of Complexity,Non-Accessible Elements,Primary Content Type,Content Type"
    history_row = f"{eisbn},y,ePub all,Reflowable,,,,{file_size_str},A,simple,n,textual,textual visual"
    history_row_clean = history_row.replace("\r", " ").replace("\n", " ").strip()
    history_csv_content = f"{history_header}\n{history_row_clean}\n"

    os.makedirs(target_dir, exist_ok=True)
    history_csv_filepath = os.path.join(target_dir, "history.csv")
    with open(history_csv_filepath, "w", encoding="utf-8") as f_hist:
        f_hist.write(history_csv_content)

    return history_csv_filepath

