/** Roles (User Management "Role") that can be chosen as a project's PM. */
export const PM_ROLES = ["project manager", "senior project manager", "admin"] as const;

const norm = (v: string) => v.toLowerCase().replace(/[\s-]+/g, " ").trim();

export function isProjectManagerRole(role: string | null | undefined): boolean {
  return Boolean(role) && (PM_ROLES as readonly string[]).includes(norm(role as string));
}

/** Check whether a user is eligible to be a PM based on primary role or additional_roles. */
export function isUserEligibleForPm(user: {
  role?: string | null;
  additional_roles?: string[] | null;
  active_status?: boolean | null;
}): boolean {
  if (!user.active_status) return false;

  // Check primary role
  if (isProjectManagerRole(user.role)) return true;

  // Check additional roles if present
  if (user.additional_roles && Array.isArray(user.additional_roles)) {
    return user.additional_roles.some((r) => isProjectManagerRole(r));
  }

  return false;
}

/** Active users who may be a project's PM (via primary role or additional roles). */
export function pmCandidates<T extends { role?: string | null; additional_roles?: string[] | null; active_status?: boolean | null }>(users: T[]): T[] {
  return users.filter(isUserEligibleForPm);
}

