import { useEffect, useCallback, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/useAuthStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { toast } from '@/store/useToastStore'

// Cookie-based auth: session managed server-side. This hook handles 401 responses
// (caught by api/client interceptor), verifies session on tab focus, and monitors
// local user activity or WebDAV locks to prevent timeout.
export function useAutoLogout() {
  const isAuthenticated = useSessionStore(state => state.authenticated)
  const clearSession = useSessionStore(state => state.clear)
  const { clearAuth } = useAuthStore()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const queryClient = useQueryClient()

  const [showWarning, setShowWarning] = useState(false)
  const lastActivityRef = useRef(Date.now())

  const forceLogout = useCallback((reason = 'Your session has expired. Please sign in again.') => {
    authApi.logout().catch(() => null)
    clearAuth()
    clearSession()
    queryClient.clear()
    toast.error(reason)
    setShowWarning(false)
    navigate('/login', { replace: true })
  }, [clearAuth, clearSession, queryClient, navigate])

  const extendSession = useCallback(async () => {
    try {
      await authApi.refresh()
      lastActivityRef.current = Date.now()
      setShowWarning(false)
    } catch {
      forceLogout()
    }
  }, [forceLogout])

  // ── Re-check on window focus (tab switching, wake from sleep) ────────────────
  useEffect(() => {
    if (!isAuthenticated) return

    function onFocus() {
      authApi.me().catch(() => forceLogout())
    }

    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [isAuthenticated, forceLogout])

  // ── Track DOM activity to update lastActivityRef ─────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return

    function updateActivity() {
      lastActivityRef.current = Date.now()
    }

    window.addEventListener('mousedown', updateActivity)
    window.addEventListener('keydown', updateActivity)
    window.addEventListener('scroll', updateActivity)

    return () => {
      window.removeEventListener('mousedown', updateActivity)
      window.removeEventListener('keydown', updateActivity)
      window.removeEventListener('scroll', updateActivity)
    }
  }, [isAuthenticated])

  // ── Background Keep-Alive / Warning loop (runs every 1 minute) ───────────────
  useEffect(() => {
    if (!isAuthenticated) return

    const interval = setInterval(async () => {
      const timeSinceLastActivity = Date.now() - lastActivityRef.current

      // Check if page pathname is an active editor route (OnlyOffice or WYSIWYG)
      const isEditorOpen = /(\/edit|\/wysiwyg|structuring-review|technical-review|technical-editor|reference-review|image-review|stylesheets)/.test(pathname)

      // 1. If user has been active locally in the last 5 minutes OR is in an editor route, refresh session
      if (timeSinceLastActivity < 5 * 60 * 1000 || isEditorOpen) {
        try {
          await authApi.refresh()
          lastActivityRef.current = Date.now()
          setShowWarning(false)
        } catch {
          forceLogout()
        }
        return
      }

      // 2. Otherwise, check if user has active WebDAV locks (e.g. editing in Word)
      try {
        const { has_active_locks } = await authApi.checkActiveLocks()
        if (has_active_locks) {
          lastActivityRef.current = Date.now()
          setShowWarning(false)
          return
        }
      } catch {
        // If check fails, ignore and check inactivity timeout
      }

      // 3. Expiration warning dialog trigger at 55 minutes of complete inactivity
      if (timeSinceLastActivity >= 55 * 60 * 1000 && timeSinceLastActivity < 60 * 60 * 1000) {
        setShowWarning(true)
      } else if (timeSinceLastActivity >= 60 * 60 * 1000) {
        forceLogout('Your session has timed out due to inactivity.')
      }
    }, 60000) // 1 minute interval

    return () => clearInterval(interval)
  }, [isAuthenticated, pathname, forceLogout])

  return { showWarning, extendSession, forceLogout }
}
