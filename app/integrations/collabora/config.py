import os

COLLABORA_BASE_URL = os.environ.get("COLLABORA_URL", "http://127.0.0.1:9980")
COLLABORA_PUBLIC_URL = os.environ.get("COLLABORA_PUBLIC_URL", COLLABORA_BASE_URL)
WOPI_BASE_URL = os.environ.get("WOPI_BASE_URL", "http://host.docker.internal:8000")

__all__ = [
    "COLLABORA_BASE_URL",
    "COLLABORA_PUBLIC_URL",
    "WOPI_BASE_URL",
]
