import { useState, useRef, useEffect } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, BarChart3,
  Settings, ChevronLeft, ChevronRight, Layers, Briefcase, LogOut, Loader2
} from 'lucide-react'
import { useSidebarStore } from '@/store/useSidebarStore'
import { useAuthStore } from '@/store/useAuthStore'
import { authApi } from '@/api/auth'
import { toast } from '@/store/useToastStore'
import { useQueryClient } from '@tanstack/react-query'
import { useSessionStore } from '@/stores/sessionStore'
import { useRBAC } from '@/hooks/useRBAC'
import { ROLE_PERMISSIONS } from '@/config/rbacConfig'
import { ThemeSwitcher } from './ThemeSwitcher'
import { cn } from '@/utils/cn'

export function Sidebar() {
  const { collapsed, toggle } = useSidebarStore()
  const { canAccess, viewer } = useRBAC()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { clearAuth, isLoggingOut, setLoggingOut } = useAuthStore()
  
  const [logoError, setLogoError] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close popover on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
      }
    }
    if (popoverOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [popoverOpen])

  async function handleLogout() {
    if (isLoggingOut) return
    setLoggingOut(true)
    setPopoverOpen(false)
    try {
      await authApi.logout()
    } catch { /* ignore best-effort */ }
    clearAuth()
    useSessionStore.getState().clear()
    queryClient.clear()
    toast.success('Signed out successfully')
    navigate('/login', { replace: true })
  }

  const fullName = (viewer?.first_name || viewer?.last_name)
    ? `${viewer.first_name ?? ''} ${viewer.last_name ?? ''}`.trim()
    : (viewer?.username ?? 'User')

  const initials = (viewer?.first_name || viewer?.last_name)
    ? `${viewer.first_name?.[0] ?? ''}${viewer.last_name?.[0] ?? ''}`.toUpperCase()
    : viewer?.username ? viewer.username.slice(0, 2).toUpperCase() : 'A'

  const getFirstRole = () => {
    if (!viewer?.roles?.length) return ''
    const role = viewer.roles[0] as any
    return typeof role === 'string' ? role : (role?.name ?? '')
  }

  const navItems = [
    ...(viewer?.team !== 'Accessibility Team'
      ? [{ to: '/', icon: LayoutDashboard, label: 'Dashboard' }]
      : []),
    ...(viewer?.team !== 'Accessibility Team'
      ? [{ to: '/workspace', icon: Briefcase, label: 'My Workspace' }]
      : []),
    ...(viewer?.team !== 'Accessibility Team'
      ? [{ to: '/clients', icon: Users, label: 'Clients' }]
      : []),
    ...((canAccess(ROLE_PERMISSIONS.access_post_production) || viewer?.team === 'Accessibility Team')
      ? [{ to: '/post-production', icon: Layers, label: 'Backlist' }]
      : []),
    { to: '/bod/internal', icon: Layers, label: 'Book on Demand' },
    { to: '/bod/report', icon: BarChart3, label: 'BOD Report (Customer)' },
    { to: '/reports', icon: BarChart3, label: 'Reports' },
    ...(canAccess(ROLE_PERMISSIONS.access_settings)
      ? [{ to: '/settings', icon: Settings, label: 'Settings' }]
      : []),
  ]

  return (
    <aside className={cn(
      'flex flex-col h-screen bg-sidebar border-r border-white/5 transition-all duration-300 ease-in-out flex-shrink-0 relative z-20',
      collapsed ? 'w-16' : 'w-60'
    )}>
      {/* Logo */}
      <div className={cn(
        'flex items-center h-16 px-3 border-b border-white/5 flex-shrink-0',
        collapsed ? 'justify-center' : 'gap-2'
      )}>
        {collapsed ? (
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0 text-sidebar font-bold text-[14px] font-serif">
            S4C
          </div>
        ) : !logoError ? (
          <img
            src="/logo.png"
            alt="S4Carlisle"
            className="h-10 w-auto object-contain"
            onError={() => setLogoError(true)}
          />
        ) : (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0 text-sidebar font-bold text-[14px] font-serif">
              S4C
            </div>
            <div className="leading-tight">
              <p className="text-white font-semibold text-[15px] font-serif tracking-tight">S4Carlisle</p>
              <p className="text-sidebar-text/60 text-[9px] font-bold uppercase tracking-widest mt-0.5">Production Suite</p>
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className={cn(
        'flex-1 py-4',
        collapsed ? 'overflow-visible' : 'overflow-y-auto overflow-x-hidden'
      )}>
        {!collapsed && (
          <p className="px-4 mb-2 text-[10px] font-bold uppercase tracking-widest text-sidebar-text/50">
            Main Menu
          </p>
        )}
        <ul className="space-y-0.5 px-2">
          {navItems.map(({ to, icon: Icon, label }) => {
            const active = to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(to)
            return (
              <li key={to}>
                <NavLink
                  to={to}
                  className={cn(
                    'flex items-center rounded-lg transition-all duration-150 group relative',
                    collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',
                    active
                      ? 'bg-primary text-sidebar font-semibold'
                      : 'text-sidebar-text hover:bg-white/8 hover:text-white'
                  )}
                >
                  <Icon size={18} className="flex-shrink-0" />
                  {!collapsed ? (
                    <span className="text-sm font-medium">{label}</span>
                  ) : (
                    <span className="absolute left-16 bg-zinc-900 border border-white/10 text-white text-xs font-medium px-2.5 py-1.5 rounded-md opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 transition-all duration-150 shadow-lg z-50 whitespace-nowrap">
                      {label}
                    </span>
                  )}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer — User profile card & Sign out */}
      <div className="px-2 py-3 border-t border-white/5 space-y-2 relative" ref={popoverRef}>
        
        {/* Popover Menu (when avatar card clicked) */}
        {popoverOpen && (
          <div className={cn(
            'absolute bottom-full mb-2 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 p-2.5 text-white',
            collapsed ? 'left-14 w-52' : 'left-2 right-2'
          )}>
            <div className="px-2 py-1.5 border-b border-white/10 mb-1.5">
              <p className="text-xs font-bold text-white truncate">{fullName}</p>
              <p className="text-[10px] text-zinc-400 truncate">{viewer?.email ?? ''}</p>
              <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[9px] font-semibold capitalize">
                {getFirstRole()}
              </span>
            </div>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
            >
              {isLoggingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
              {isLoggingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        )}

        {/* User Card */}
        <div
          onClick={() => setPopoverOpen(p => !p)}
          className={cn(
            'flex items-center gap-2.5 p-2 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all cursor-pointer group',
            collapsed ? 'justify-center' : 'justify-between'
          )}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 font-bold text-[12px] text-sidebar shadow-md">
              {initials}
            </div>
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <p className="text-xs font-semibold text-white truncate group-hover:text-primary transition-colors">
                  {fullName}
                </p>
                <p className="text-[10px] text-sidebar-text/70 truncate capitalize">
                  {getFirstRole()}
                </p>
              </div>
            )}
          </div>

          {!collapsed && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleLogout()
              }}
              disabled={isLoggingOut}
              className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors flex-shrink-0"
              title="Sign out"
            >
              {isLoggingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
            </button>
          )}
        </div>

        {/* Collapse toggle + theme */}
        <div className="flex items-center justify-between px-1 pt-1">
          {!collapsed && <ThemeSwitcher />}
          <button
            onClick={toggle}
            className={cn(
              'p-2 rounded-lg text-sidebar-text hover:bg-white/10 hover:text-white transition-colors',
              collapsed && 'mx-auto'
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </div>
    </aside>
  )
}
