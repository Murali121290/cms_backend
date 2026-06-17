import os

ONLYOFFICE_INTERNAL_URL = os.environ.get("ONLYOFFICE_INTERNAL_URL", "http://onlyoffice:80")
ONLYOFFICE_PUBLIC_URL = os.environ.get("ONLYOFFICE_PUBLIC_URL", "http://localhost:8080")
ONLYOFFICE_JWT_SECRET = os.environ.get("ONLYOFFICE_JWT_SECRET", "secret")
ONLYOFFICE_JWT_ENABLED = os.environ.get("ONLYOFFICE_JWT_ENABLED", "true").lower() in ("true", "1", "yes")
WOPI_BASE_URL = os.environ.get("WOPI_BASE_URL", "http://host.docker.internal:8000")

__all__ = [
    "ONLYOFFICE_INTERNAL_URL",
    "ONLYOFFICE_PUBLIC_URL",
    "ONLYOFFICE_JWT_SECRET",
    "ONLYOFFICE_JWT_ENABLED",
    "WOPI_BASE_URL",
]
