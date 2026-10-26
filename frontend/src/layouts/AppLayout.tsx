import { useEffect } from 'react'
import { Outlet, useLocation, Navigate } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'
import { useSidebarStore } from '@/store/useSidebarStore'
import { useAutoLogout } from '@/hooks/useAutoLogout'
import { useRBAC } from '@/hooks/useRBAC'
import { Modal } from '@/components/ui/Modal'

const VIEW_RE = /^\/clients\/\d+\/projects\/\d+\/chapters\/\d+\/view(\/.*)?$/

export function AppLayout() {
  const { pathname } = useLocation()
  const { setCollapsed } = useSidebarStore()
  const { viewer, hasPermission } = useRBAC()
  const { showWarning, extendSession, forceLogout } = useAutoLogout()

  // If user does not have permission to view books dashboard or production,
  // redirect them to their primary accessible hub (e.g. Backlist Hub, BOD Report)
  const isBookProductionRoute = pathname === '/' || pathname === '/dashboard' || pathname === '/workspace' || pathname === '/clients'
  if (isBookProductionRoute && !hasPermission('view_books_dashboard') && !hasPermission('access_books_production')) {
    if (hasPermission('access_post_production')) {
      return <Navigate to="/post-production" replace />
    }
    if (hasPermission('access_bod')) {
      return <Navigate to="/bod/report" replace />
    }
  }

  // Keep sidebar expanded only on the root page (/), collapse on all other pages
  useEffect(() => {
    if (pathname === '/' || pathname === '/dashboard') {
      setCollapsed(false)
    } else {
      setCollapsed(true)
    }
  }, [pathname, setCollapsed])

  // Full-screen for the file viewer/editor (no sidebar or topbar)
  if (VIEW_RE.test(pathname)) {
    return (
      <div className="h-screen overflow-hidden bg-background">
        <Outlet />
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      <Modal
        isOpen={showWarning}
        onClose={() => forceLogout('You have been logged out due to inactivity.')}
        onConfirm={extendSession}
        title="Session Expiring"
        confirmLabel="Stay Logged In"
      >
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your session will expire in 5 minutes due to inactivity. Would you like to extend your session and stay logged in?
        </p>
      </Modal>
    </div>
  )
}
