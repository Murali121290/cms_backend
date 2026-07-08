import os
import json

_dir = os.path.dirname(os.path.abspath(__file__))
_json_path = os.path.join(_dir, "rbac_config.json")
try:
    with open(_json_path, "r") as _f:
        ROLE_PERMISSIONS = json.load(_f)
except Exception:
    ROLE_PERMISSIONS = {}

def has_permission(user, permission_name: str) -> bool:
    if not user:
        return False
    allowed_roles = ROLE_PERMISSIONS.get(permission_name, [])
    user_role_names = [role.name.lower().replace(" ", "") for role in user.roles]
    return any(allowed.lower().replace(" ", "") in user_role_names for allowed in allowed_roles)

def has_post_prod_access(user) -> bool:
    if not user:
        return False
    return has_permission(user, "access_post_production") or getattr(user, "team", "") == "Accessibility Team"
