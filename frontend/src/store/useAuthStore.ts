import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AuthUser } from '@/api/auth'

interface AuthState {
  user:            AuthUser | null
  isAuthenticated: boolean
  isLoggingOut:    boolean
  setAuth:      (user: AuthUser) => void
  clearAuth:    () => void
  setLoggingOut:(v: boolean) => void
}

// ── Storage: uses sessionStorage only (auth managed by server cookies) ──────

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user:            null,
      isAuthenticated: false,
      isLoggingOut:    false,

      setAuth: (user) =>
        set({ user, isAuthenticated: true, isLoggingOut: false }),

      setLoggingOut: (v) => set({ isLoggingOut: v }),

      clearAuth: () => {
        localStorage.removeItem('cms-auth')
        sessionStorage.removeItem('cms-auth')
        set({
          user:            null,
          isAuthenticated: false,
          isLoggingOut:    false,
        })
      },
    }),
    {
      name:    'cms-auth',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        user:            s.user,
        isAuthenticated: s.isAuthenticated,
      }),
    }
  )
)
