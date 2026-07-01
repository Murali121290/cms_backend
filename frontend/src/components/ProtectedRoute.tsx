import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useSessionStore } from '@/stores/sessionStore'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useSessionStore(s => s.authenticated)
  const isLoading       = useSessionStore(s => s.loading)
  const navigate        = useNavigate()
  const location        = useLocation()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/portal', { state: { from: location }, replace: true })
    }
  }, [isAuthenticated, isLoading, navigate, location])

  // Show nothing while loading or redirecting
  if (isLoading || !isAuthenticated) return null

  return <>{children}</>
}
