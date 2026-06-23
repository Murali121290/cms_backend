from datetime import datetime
import pytz
from app.core.config import get_settings

def get_app_timezone():
    """Resolve the timezone dynamically from Settings, default to Asia/Kolkata."""
    try:
        settings = get_settings()
        tz_name = getattr(settings, "APP_TIMEZONE", "Asia/Kolkata")
        return pytz.timezone(tz_name)
    except Exception:
        return pytz.timezone("Asia/Kolkata")

def now_ist():
    """Return current datetime in the configured timezone."""
    tz = get_app_timezone()
    return datetime.now(tz)

def now_ist_naive():
    """Return current configured timezone datetime without tzinfo (for DB columns without timezone)."""
    tz = get_app_timezone()
    return datetime.now(tz).replace(tzinfo=None)
