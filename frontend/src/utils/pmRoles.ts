/** Roles (User Management "Role") that can be chosen as a project's PM. */
export const PM_ROLES = ["project manager", "senior project manager", "asst general manager", "admin"] as const;

const norm = (v: string) => v.toLowerCase().replace(/[\s-]+/g, " ").trim();

export function isProjectManagerRole(role: string | null | undefined): boolean {
  return Boolean(role) && (PM_ROLES as readonly string[]).includes(norm(role as string));
}

/** Active users who may be a project's PM. */
export function pmCandidates<T extends { role?: string | null; active_status?: boolean | null }>(users: T[]): T[] {
  return users.filter((u) => u.active_status && isProjectManagerRole(u.role));
}
