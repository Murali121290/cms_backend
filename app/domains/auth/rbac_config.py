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
    if hasattr(user, "additional_roles") and user.additional_roles and isinstance(user.additional_roles, list):
        for ar in user.additional_roles:
            if ar and isinstance(ar, str):
                user_role_names.append(ar.lower().replace(" ", ""))

    return any(allowed.lower().replace(" ", "") in user_role_names for allowed in allowed_roles)

def has_post_prod_access(user) -> bool:
    if not user:
        return False
    user_teams = []
    if getattr(user, "team", None):
        user_teams.append(getattr(user, "team"))
    if hasattr(user, "additional_teams") and getattr(user, "additional_teams", None):
        extra = getattr(user, "additional_teams")
        if isinstance(extra, list):
            user_teams.extend(extra)

    is_accessibility_team = any(t == "Accessibility Team" for t in user_teams)
    return has_permission(user, "access_post_production") or is_accessibility_team

def get_user_permissions(user) -> list[str]:
    if not user:
        return []

    level = get_user_access_level(user)
    if level == "Admin":
        return list(ROLE_PERMISSIONS.keys()) + [
            "view_books_dashboard",
            "view_workspace",
            "access_books_production",
            "access_journal_production",
            "access_bod",
            "access_post_production",
            "access_settings",
        ]

    user_teams = []
    if getattr(user, "team", None):
        user_teams.append(getattr(user, "team"))
    if hasattr(user, "additional_teams") and getattr(user, "additional_teams", None):
        extra = getattr(user, "additional_teams")
        if isinstance(extra, list):
            user_teams.extend(extra)

    user_roles = []
    if hasattr(user, "role") and user.role:
        user_roles.append(user.role)
    if hasattr(user, "designation") and user.designation:
        user_roles.append(user.designation)
    if hasattr(user, "additional_roles") and getattr(user, "additional_roles", None):
        extra_roles = getattr(user, "additional_roles")
        if isinstance(extra_roles, list):
            user_roles.extend(extra_roles)

    perms = set()
    for perm_name in ROLE_PERMISSIONS:
        if has_permission(user, perm_name):
            perms.add(perm_name)

    is_customer = "Customer Team" in user_teams or any("customer" in r.lower() for r in user_roles)
    is_accessibility_team = any("accessibility" in t.lower() for t in user_teams) or any("accessibility" in r.lower() for r in user_roles)
    has_bod_access = (
        "BOD" in (getattr(user, "customer_access", None) or []) or
        any("bod" in t.lower() for t in user_teams) or
        any("bod" in r.lower() for r in user_roles)
    )

    # Standard internal book workflow permission
    has_regular_production_role = (
        level in ("Manager", "TeamLead") or
        any(
            not any(ex in t.lower() for ex in ["customer", "accessibility"])
            for t in user_teams
        ) or
        any(
            not any(ex in r.lower() for ex in ["customer", "accessibility", "viewer"])
            for r in user_roles
        )
    )

    if has_regular_production_role and not is_customer:
        perms.add("view_books_dashboard")
        perms.add("view_workspace")
        perms.add("access_books_production")
        perms.add("access_journal_production")

    if is_accessibility_team or has_post_prod_access(user):
        perms.add("access_post_production")

    if has_bod_access:
        perms.add("access_bod")

    return sorted(list(perms))
