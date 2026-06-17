from jose import jwt
from app.integrations.onlyoffice.config import ONLYOFFICE_JWT_SECRET, ONLYOFFICE_JWT_ENABLED

def sign_config(payload: dict) -> str:
    """Sign the OnlyOffice config payload using HS256 algorithm."""
    return jwt.encode(payload, ONLYOFFICE_JWT_SECRET, algorithm="HS256")

def verify_token(token: str) -> dict | None:
    """Decode and verify OnlyOffice JWT token."""
    try:
        return jwt.decode(token, ONLYOFFICE_JWT_SECRET, algorithms=["HS256"])
    except Exception:
        return None

def verify_callback_token(headers: dict, body: dict) -> dict | None:
    """
    Verify callback token from OnlyOffice.
    Supports token inside Authorization header or request body.
    """
    if not ONLYOFFICE_JWT_ENABLED:
        return body

    token = None
    
    # 1. Check Authorization header
    auth_header = headers.get("Authorization") or headers.get("authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]

    # 2. Check token in body
    if not token and isinstance(body, dict):
        token = body.get("token")

    if not token:
        return None

    decoded = verify_token(token)
    if not decoded:
        return None

    # OnlyOffice wraps actual callback body in "payload" key
    if "payload" in decoded:
        return decoded["payload"]
    return decoded
