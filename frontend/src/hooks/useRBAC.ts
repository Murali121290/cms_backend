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

  // Determine normalized accessLevel: Admin | Manager | TeamLead | Employee
  const rawLevel = (viewer as any)?.access_level || (roles[0] ?? (viewer as any)?.designation ?? '')
  const val = String(rawLevel).toLowerCase().replace(/[\s-]/g, '')

  let accessLevel: 'Admin' | 'Manager' | 'TeamLead' | 'Employee' = 'Employee'
  if (val.includes('admin')) accessLevel = 'Admin'
  else if (val.includes('manager') || val.includes('gm')) accessLevel = 'Manager'
  else if (val.includes('teamlead') || val.includes('lead')) accessLevel = 'TeamLead'

  /** True if the current user has any of the given roles or matching access level. */
  function canAccess(allowedRoles: string[]): boolean {
    if (!allowedRoles || !allowedRoles.length) return true
    if (accessLevel === 'Admin') return true

    const allowed = allowedRoles.map(r => r.toLowerCase().replace(/[\s-]/g, ''))
    
    if (accessLevel === 'Manager' && (allowed.includes('manager') || allowed.includes('projectmanager') || allowed.includes('view_all_projects') || allowed.includes('view_all_chapters'))) {
      return true
    }
    if (accessLevel === 'TeamLead' && (allowed.includes('teamlead') || allowed.includes('edit_assignee') || allowed.includes('view_all_chapters'))) {
      return true
    }

    return roles.some(r => allowed.includes(r.toLowerCase().replace(/[\s-]/g, '')))
  }

  /** True if the user has this role or access level. */
  function hasRole(r: string): boolean {
    const target = r.toLowerCase().replace(/[\s-]/g, '')
    if (target === accessLevel.toLowerCase()) return true
    return roles.map(x => x.toLowerCase().replace(/[\s-]/g, '')).includes(target)
  }

  return {
    viewer,
    roles,
    accessLevel,
    canAccess,
    hasRole,
    isAdmin:    accessLevel === 'Admin' || hasRole('admin'),
    isManager:  accessLevel === 'Admin' || accessLevel === 'Manager' || hasRole('manager'),
    isTeamLead: accessLevel === 'Admin' || accessLevel === 'Manager' || accessLevel === 'TeamLead' || hasRole('teamlead'),
  }
}
