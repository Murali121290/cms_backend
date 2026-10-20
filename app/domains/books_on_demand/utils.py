from datetime import datetime, timedelta, timezone
from typing import Optional

def calculate_bod_due_date(
    pdf_type: Optional[str], 
    page_count: Optional[int], 
    from_date: Optional[datetime] = None
) -> datetime:
    """
    Calculate BOD Job due date based on PDF type and page count:
    Text:
      - <= 250 pages: 3 Days
      - >= 251 pages: 4 Days
    Image:
      - <= 250 pages: 5 Days
      - >= 251 pages: 7 Days
    """
    if from_date is None:
        from_date = datetime.now(timezone.utc)

    is_image = bool(pdf_type and "image" in str(pdf_type).lower())
    pages = page_count or 0

    if is_image:
        days = 7 if pages > 250 else 5
    else:
        days = 4 if pages > 250 else 3

    return from_date + timedelta(days=days)
