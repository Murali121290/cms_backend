import { useRBAC } from '@/hooks/useRBAC'

interface RoleGuardProps {
  /** Roles that are allowed to see this content. Add any new role here. */
  allowedRoles: string[]
  children:     React.ReactNode
  /** Override the default 403 UI with something custom. */
  fallback?:    React.ReactNode
}

/**
 * Wraps any page or section. If the current user's role is not in `allowedRoles`,
 * renders the 403 page (or a custom fallback).
 *
 * To allow a new role: just add its name to the `allowedRoles` array at the
 * call site — no other code changes needed.
 *
 *   <RoleGuard allowedRoles={['admin', 'manager', 'new_role']}>
 *     <SettingsPage />
 *   </RoleGuard>
 */
export function RoleGuard({ allowedRoles, children, fallback }: RoleGuardProps) {
  const { canAccess } = useRBAC()

  if (!canAccess(allowedRoles)) {
    return fallback ?? <UnauthorizedPage allowedRoles={allowedRoles}/>
  }

  return <>{children}</>
}

// ── Built-in 403 page ─────────────────────────────────────────────────────────

function UnauthorizedPage({ allowedRoles }: { allowedRoles: string[] }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center p-8">
      <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mb-5">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
          strokeLinejoin="round" className="text-red-500">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>

      <h1 className="text-xl font-bold text-text mb-2">Access Restricted</h1>
      <p className="text-sm text-muted max-w-sm mb-1">
        You don't have permission to view this page.
      </p>
      <p className="text-xs text-muted mb-6">
        Required role:{' '}
        <span className="font-semibold text-text">
          {allowedRoles.join(' or ')}
        </span>
      </p>

      <a
        href="/"
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors"
      >
        ← Back to Dashboard
      </a>
    </div>
  )
}
