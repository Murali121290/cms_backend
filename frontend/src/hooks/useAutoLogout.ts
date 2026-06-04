import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, getTokenExpiryMs, isTokenExpired } from '@/store/useAuthStore'
import { authApi } from '@/api/auth'
import { toast } from '@/store/useToastStore'

export function useAutoLogout() {
  const { token, isAuthenticated, clearAuth } = useAuthStore()
  const navigate = useNavigate()

  const forceLogout = useCallback((reason = 'Your session has expired. Please sign in again.') => {
    authApi.logout().catch(() => null)
    clearAuth()
    toast.error(reason)
    navigate('/login', { replace: true })
  }, [clearAuth, navigate])

  // ── Auto-logout when token expires ───────────────────────────────────────────
  useEffect(() => {
    if (!token || !isAuthenticated) return

    // Already expired on mount
    if (isTokenExpired(token)) {
      forceLogout()
      return
    }

    const expiryMs = getTokenExpiryMs(token)
    if (!expiryMs) return

    const delay = expiryMs - Date.now()
    const timer = setTimeout(() => forceLogout(), delay)

    return () => clearTimeout(timer)
  }, [token, isAuthenticated, forceLogout])

  // ── Re-check on window focus (tab switching, wake from sleep) ────────────────
  useEffect(() => {
    if (!isAuthenticated) return

    function onFocus() {
      const { token } = useAuthStore.getState()
      if (token && isTokenExpired(token)) {
        forceLogout()
      }
    }

    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [isAuthenticated, forceLogout])
}
