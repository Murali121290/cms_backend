import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'
import { useSidebarStore } from '@/store/useSidebarStore'
import { useAutoLogout } from '@/hooks/useAutoLogout'

const CHAPTER_RE = /\/chapters\/\d+/
const VIEW_RE    = /^\/clients\/\d+\/projects\/\d+\/chapters\/\d+\/view(\/.*)?$/

export function AppLayout() {
  const { pathname } = useLocation()
  const { setCollapsed } = useSidebarStore()
  useAutoLogout()

  // Auto-collapse sidebar on chapter pages; restore when leaving
  useEffect(() => {
    if (CHAPTER_RE.test(pathname)) {
      setCollapsed(true)
    } else {
      setCollapsed(false)
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
    </div>
  )
}
