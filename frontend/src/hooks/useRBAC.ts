import { useSessionStore } from '@/stores/sessionStore'

/**
 * Role-Based Access Control hook.
 *
 * Roles are checked dynamically against the user's role from the session store —
 * no hardcoded role lists here. Allowed roles per route/page are defined at
 * the call site (e.g. in routes or RoleGuard), so adding a new role in the DB
 * never requires changing this file.
 *
 * Usage:
 *   const { hasRole, canAccess } = useRBAC()
 *   canAccess(['admin', 'manager'])  // true if user role is in that list
 */
export function useRBAC() {
  const viewer = useSessionStore(s => s.viewer)
  const roleArray = viewer?.roles ?? []

  // Normalize roles: convert {name: string} | string to string[]
  const roles = roleArray.map((r: any) => typeof r === 'string' ? r : r.name).filter(Boolean)

  /** True if the current user has any of the given roles (case-insensitive). */
  function canAccess(allowedRoles: string[]): boolean {
    if (!roles.length) return false
    const allowed = allowedRoles.map(r => r.toLowerCase())
    return roles.some(r => allowed.includes(r.toLowerCase()))
  }

  /** True if the user has this role. */
  function hasRole(r: string): boolean {
    return roles.map(x => x.toLowerCase()).includes(r.toLowerCase())
  }

  return {
    viewer,
    roles,
    canAccess,
    hasRole,
    isAdmin:   hasRole('admin'),
    isManager: hasRole('manager'),
  }
}
