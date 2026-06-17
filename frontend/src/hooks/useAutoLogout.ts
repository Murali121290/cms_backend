import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/useAuthStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { toast } from '@/store/useToastStore'

// Cookie-based auth: session managed server-side. This hook handles 401 responses
// (caught by api/client interceptor) and verifies session on tab focus.
export function useAutoLogout() {
  const isAuthenticated = useSessionStore(state => state.authenticated)
  const clearSession = useSessionStore(state => state.clear)
  const { clearAuth } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const forceLogout = useCallback((reason = 'Your session has expired. Please sign in again.') => {
    authApi.logout().catch(() => null)
    clearAuth()
    clearSession()
    queryClient.clear()
    toast.error(reason)
    navigate('/login', { replace: true })
  }, [clearAuth, clearSession, queryClient, navigate])

  // ── Re-check on window focus (tab switching, wake from sleep) ────────────────
  useEffect(() => {
    if (!isAuthenticated) return

    function onFocus() {
      authApi.me().catch(() => forceLogout())
    }

    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [isAuthenticated, forceLogout])
}
