import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Users, BarChart3,
  Settings, ChevronLeft, ChevronRight, GitBranch,
} from 'lucide-react'
import { useSidebarStore } from '@/store/useSidebarStore'
import { useRBAC } from '@/hooks/useRBAC'
import { ThemeSwitcher } from './ThemeSwitcher'
import { cn } from '@/utils/cn'

export function Sidebar() {
  const { collapsed, toggle } = useSidebarStore()
  const { canAccess }         = useRBAC()
  const location              = useLocation()

  const navItems = [
    { to: '/',         icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/clients',  icon: Users,           label: 'Clients'   },
    { to: '/reports',  icon: BarChart3,       label: 'Reports'   },
    // Settings visible only to admin and manager — add more roles here as needed
    ...(canAccess(['admin', 'manager'])
      ? [{ to: '/settings', icon: Settings, label: 'Settings' }]
      : []),
  ]

  return (
    <aside className={cn(
      'flex flex-col h-screen bg-sidebar border-r border-white/5 transition-all duration-300 ease-in-out flex-shrink-0',
      collapsed ? 'w-16' : 'w-60'
    )}>
      {/* Logo */}
      <div className={cn(
        'flex items-center h-16 px-4 border-b border-white/5 flex-shrink-0',
        collapsed ? 'justify-center' : 'gap-3'
      )}>
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
          <GitBranch size={16} className="text-white" />
        </div>
        {!collapsed && (
          <span className="text-white font-semibold text-sm tracking-wide">WMS</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
        {!collapsed && (
          <p className="px-4 mb-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-text/50">
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
                    'flex items-center rounded-lg transition-all duration-150 group',
                    collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',
                    active
                      ? 'bg-primary text-white'
                      : 'text-sidebar-text hover:bg-white/8 hover:text-white'
                  )}
                  title={collapsed ? label : undefined}
                >
                  <Icon size={18} className="flex-shrink-0" />
                  {!collapsed && <span className="text-sm font-medium">{label}</span>}
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
