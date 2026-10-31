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
    days = 6 if is_image else 3

    return from_date + timedelta(days=days)
