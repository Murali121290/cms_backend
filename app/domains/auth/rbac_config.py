import os
import json

_dir = os.path.dirname(os.path.abspath(__file__))
_json_path = os.path.join(_dir, "rbac_config.json")
try:
    with open(_json_path, "r") as _f:
        ROLE_PERMISSIONS = json.load(_f)
except Exception:
    ROLE_PERMISSIONS = {}

def get_user_access_level(user) -> str:
    if not user:
        return "Employee"
    acc_lvl = getattr(user, "access_level", None)
    if acc_lvl and isinstance(acc_lvl, str) and acc_lvl.strip():
        val = acc_lvl.strip().lower().replace(" ", "").replace("-", "")
        if "admin" in val:
            return "Admin"
        elif "manager" in val or "gm" in val:
            return "Manager"
        elif "teamlead" in val or "lead" in val:
            return "TeamLead"
        elif "employee" in val:
            return "Employee"

    roles_to_check = []
    if hasattr(user, "roles"):
        roles_to_check.extend([r.name for r in user.roles])
    if hasattr(user, "role") and user.role:
        roles_to_check.append(user.role)
    if hasattr(user, "designation") and user.designation:
        roles_to_check.append(user.designation)

    for r in roles_to_check:
        if not r:
            continue
        val = r.lower().replace(" ", "").replace("-", "")
        if "admin" in val:
            return "Admin"
        if "manager" in val or "gm" in val:
            return "Manager"
        if "teamlead" in val or "lead" in val:
            return "TeamLead"

    return "Employee"

def has_permission(user, permission_name: str) -> bool:
    if not user:
        return False

    level = get_user_access_level(user)

    if level == "Admin":
        return True
    elif level == "Manager":
        if permission_name in ("view_all_projects", "view_all_chapters", "edit_assignee"):
            return True
    elif level == "TeamLead":
        if permission_name in ("edit_assignee", "view_all_chapters"):
            return True

    allowed_roles = ROLE_PERMISSIONS.get(permission_name, [])
    user_role_names = [role.name.lower().replace(" ", "") for role in getattr(user, "roles", [])]
    if hasattr(user, "role") and user.role:
        user_role_names.append(user.role.lower().replace(" ", ""))
    if hasattr(user, "designation") and user.designation:
        user_role_names.append(user.designation.lower().replace(" ", ""))

    return any(allowed.lower().replace(" ", "") in user_role_names for allowed in allowed_roles)

def has_post_prod_access(user) -> bool:
    if not user:
        return False
    return has_permission(user, "access_post_production") or getattr(user, "team", "") == "Accessibility Team"
