import logging
import os

logger = logging.getLogger("app.integrations.webdav.config")

WEBDAV_BASE_URL = os.environ.get("WEBDAV_BASE_URL", "http://localhost:8000")
WEBDAV_TOKEN_EXPIRE_MINUTES = int(os.environ.get("WEBDAV_TOKEN_EXPIRE_MINUTES", "120"))

# Mac Word's "open for edit" flow refuses non-SSL WebDAV origins outright, so
# WEBDAV_BASE_URL must be an https:// origin (with a cert trusted by client
# machines) in any deployment where Mac users need "Open in MSWord". This is
# a visibility warning only, not a hard failure — Windows-only deployments
# over plain HTTP/localhost are unaffected.
if not WEBDAV_BASE_URL.startswith("https://") and "localhost" not in WEBDAV_BASE_URL and "127.0.0.1" not in WEBDAV_BASE_URL:
    logger.warning(
        "WEBDAV_BASE_URL=%s is not HTTPS — \"Open in MSWord\" will not work for Mac clients "
        "(Mac Word requires an SSL WebDAV origin for the open-for-edit flow).",
        WEBDAV_BASE_URL,
    )
