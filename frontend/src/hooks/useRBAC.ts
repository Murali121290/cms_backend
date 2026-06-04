import { useAuthStore } from '@/store/useAuthStore'

/**
 * Role-Based Access Control hook.
 *
 * Roles are checked dynamically against the user's role from the auth store —
 * no hardcoded role lists here. Allowed roles per route/page are defined at
 * the call site (e.g. in routes or RoleGuard), so adding a new role in the DB
 * never requires changing this file.
 *
 * Usage:
 *   const { hasRole, canAccess } = useRBAC()
 *   canAccess(['admin', 'manager'])  // true if user role is in that list
 */
export function useRBAC() {
  const user = useAuthStore(s => s.user)
  const role = user?.role?.toLowerCase() ?? null

  /** True if the current user's role matches any of the given roles (case-insensitive). */
  function canAccess(allowedRoles: string[]): boolean {
    if (!role) return false
    return allowedRoles.map(r => r.toLowerCase()).includes(role)
  }

  /** True if the user has exactly this single role. */
  function hasRole(r: string): boolean {
    return role === r.toLowerCase()
  }

  return {
    user,
    role,
    canAccess,
    hasRole,
    isAdmin:   hasRole('admin'),
    isManager: hasRole('manager'),
  }
}
