from fastapi import status
from fastapi.responses import RedirectResponse
import os

ACCESS_TOKEN_COOKIE_NAME = "access_token"
ACCESS_TOKEN_COOKIE_PREFIX = "Bearer "


def get_home_redirect_response(user):
    if user:
        return RedirectResponse(url="/dashboard", status_code=status.HTTP_302_FOUND)
    return RedirectResponse(url="/login", status_code=status.HTTP_302_FOUND)


def redirect_to_login_response():
    return RedirectResponse(url="/login", status_code=status.HTTP_302_FOUND)


def format_access_token_cookie_value(access_token: str):
    # Store raw token without Bearer prefix to avoid quoted cookie values
    return access_token


def build_login_redirect_response(access_token: str):
    response = RedirectResponse(url="/dashboard", status_code=status.HTTP_302_FOUND)
    set_access_token_cookie(response, access_token)
    return response


def build_logout_response():
    response = redirect_to_login_response()
    clear_access_token_cookie(response)
    return response


def build_registration_success_response():
    return RedirectResponse(
        url="/login?msg=Registration successful! Please login.",
        status_code=status.HTTP_302_FOUND,
    )


def build_user_context(user, *, include_email: bool = False):
    data = {
        "username": user.username,
        "roles": [role.name for role in user.roles],
        "id": user.id,
    }
    if include_email:
        data["email"] = user.email
    return data


def set_access_token_cookie(response, access_token: str):
    # Allow explicit override via COOKIE_SECURE env var. If not set,
    # default to secure cookies in production/staging environments.
    env = os.getenv("ENVIRONMENT", "development").lower()
    cookie_secure_env = os.getenv("COOKIE_SECURE")
    if cookie_secure_env is not None:
        secure_cookie = cookie_secure_env.lower() in ("1", "true", "yes")
    else:
        secure_cookie = env in ("production", "staging")
    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE_NAME,
        value=format_access_token_cookie_value(access_token),
        httponly=True,
        secure=secure_cookie,
        samesite="lax",
        path="/",
        domain=None,  # Let browser use the request domain (localhost or production domain)
    )


def clear_access_token_cookie(response):
    response.delete_cookie(ACCESS_TOKEN_COOKIE_NAME)
