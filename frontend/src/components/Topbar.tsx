import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, LogOut, Loader2, Menu, User } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { useSidebarStore } from '@/store/useSidebarStore'
import { authApi } from '@/api/auth'
import { toast } from '@/store/useToastStore'
import { cn } from '@/utils/cn'

export function Topbar() {
  const navigate                       = useNavigate()
  const { user, clearAuth, isLoggingOut, setLoggingOut } = useAuthStore()
  const { toggle }                     = useSidebarStore()
  const [notifications]                = useState(3)
  const [open, setOpen]                = useState(false)
  const dropdownRef                    = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  // Close dropdown on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function handleLogout() {
    if (isLoggingOut) return          // prevent double-click
    setLoggingOut(true)
    setOpen(false)
    try {
      await authApi.logout()
    } catch { /* ignore — backend logout is best-effort */ }
    clearAuth()
    toast.success('Signed out successfully')
    navigate('/login', { replace: true })
  }

  const initials = user?.user_name
    ? user.user_name.slice(0, 2).toUpperCase()
    : 'A'

  return (
    <header className="h-16 bg-card border-b border-border flex items-center px-4 md:px-6 gap-3 flex-shrink-0 sticky top-0 z-30">

      {/* Mobile: sidebar toggle */}
      <button
        onClick={toggle}
        className="md:hidden p-2 rounded-lg text-muted hover:text-text hover:bg-surface transition-colors"
        aria-label="Toggle menu"
      >
        <Menu size={18}/>
      </button>

      <div className="flex items-center gap-2 ml-auto">

        {/* Notifications */}
        <button className="relative p-2 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors">
          <Bell size={18}/>
          {notifications > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-danger text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {notifications}
            </span>
          )}
        </button>

        <div className="w-px h-6 bg-border mx-1"/>

        {/* User button + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setOpen(p => !p)}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors',
              open ? 'bg-surface' : 'hover:bg-surface'
            )}
            aria-expanded={open}
            aria-haspopup="true"
          >
            {/* Avatar */}
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
              {isLoggingOut
                ? <Loader2 size={13} className="text-white animate-spin"/>
                : <span className="text-[11px] font-bold text-white">{initials}</span>
              }
            </div>
            {/* Name + team */}
            <div className="hidden md:block text-left">
              <p className="text-xs font-semibold text-text leading-tight">
                {user?.user_name ?? 'User'}
              </p>
              <p className="text-[10px] text-muted leading-tight capitalize">
                {user?.team ?? user?.role ?? ''}
              </p>
            </div>
            <ChevronDown
              size={13}
              className={cn(
                'text-muted hidden md:block transition-transform duration-200',
                open && 'rotate-180'
              )}
            />
          </button>

          {/* Dropdown panel */}
          {open && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-50">

              {/* User info */}
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-white">{initials}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text truncate">
                      {user?.user_name ?? 'User'}
                    </p>
                    <p className="text-[11px] text-muted truncate">{user?.email ?? ''}</p>
                    <p className="text-[10px] text-muted capitalize mt-0.5">
                      {user?.role ?? ''} · {user?.team ?? ''}
                    </p>
                  </div>
                </div>
              </div>

              {/* Logout */}
              <div className="p-1.5">
                <button
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoggingOut
                    ? <Loader2 size={14} className="animate-spin text-red-400"/>
                    : <LogOut  size={14} className="text-red-400"/>
                  }
                  {isLoggingOut ? 'Signing out…' : 'Sign out'}
                </button>
              </div>

            </div>
          )}
        </div>
      </div>
    </header>
  )
}
