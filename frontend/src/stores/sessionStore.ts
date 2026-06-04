import { useAuthStore } from '@/store/useAuthStore'

interface Viewer {
  username: string
  roles: Array<{ name: string } | string>
}

interface SessionStore {
  viewer: Viewer | null
}

// Bridge from WMS useAuthStore to cms_backend useSessionStore interface
// Review pages use useSessionStore((s) => s.viewer) to get the current user
export const useSessionStore = <T>(
  selector: (s: SessionStore) => T
): T => {
  const user = useAuthStore((s) => s.user)

  const sessionStore: SessionStore = {
    viewer: user
      ? {
          username: user.username || user.email || 'User',
          roles: user.roles || [],
        }
      : null,
  }

  return selector(sessionStore)
}
