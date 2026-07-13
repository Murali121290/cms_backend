import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Users, BarChart3,
  Settings, ChevronLeft, ChevronRight, Layers,
} from 'lucide-react'
import { useSidebarStore } from '@/store/useSidebarStore'
import { useRBAC } from '@/hooks/useRBAC'
import { ROLE_PERMISSIONS } from '@/config/rbacConfig'
import { ThemeSwitcher } from './ThemeSwitcher'
import { cn } from '@/utils/cn'

export function Sidebar() {
  const { collapsed, toggle } = useSidebarStore()
  const { canAccess, viewer } = useRBAC()
  const location = useLocation()
  const [logoError, setLogoError] = useState(false)

  const navItems = [
    ...(viewer?.team !== 'Accessibility Team'
      ? [{ to: '/', icon: LayoutDashboard, label: 'Dashboard' }]
      : []),
    ...(viewer?.team !== 'Accessibility Team'
      ? [{ to: '/clients', icon: Users, label: 'Clients' }]
      : []),
    ...((canAccess(ROLE_PERMISSIONS.access_post_production) || viewer?.team === 'Accessibility Team')
      ? [{ to: '/post-production', icon: Layers, label: 'Backlist' }]
      : []),
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

      {/* Footer — user info + collapse toggle */}
      <div className="px-2 py-3 border-t border-white/5 space-y-1">
        {/* Collapse toggle + theme */}
        <div className="flex items-center justify-between px-1">
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
