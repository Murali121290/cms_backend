import os

WEBDAV_BASE_URL = os.environ.get("WEBDAV_BASE_URL", "http://localhost:8000")
WEBDAV_TOKEN_EXPIRE_MINUTES = int(os.environ.get("WEBDAV_TOKEN_EXPIRE_MINUTES", "120"))
