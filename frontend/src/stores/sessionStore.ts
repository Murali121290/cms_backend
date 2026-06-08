import type { Viewer, SessionGetResponse } from '@/types/api'

export interface SessionStore {
  // State
  authenticated: boolean
  viewer: Viewer | null
  loading: boolean
  error: string | null
  handoffStarted: boolean

  // Actions
  setAuthenticated: (session: SessionGetResponse) => void
  setLoading: (loading: boolean) => void
  setAnonymous: () => void
  setError: (error: string | null) => void
  clear: () => void
}

// Zustand store that bridges WMS session features to cms_backend auth
import { create } from 'zustand'

export const useSessionStore = create<SessionStore>((set) => ({
  // Initial state
  authenticated: false,
  viewer: null,
  loading: false,
  error: null,
  handoffStarted: false,

  // Actions
  setAuthenticated: (session: SessionGetResponse) => {
    set({
      authenticated: true,
      viewer: session.viewer,
      loading: false,
      error: null,
    })
  },

  setLoading: (loading: boolean) => set({ loading }),

  setAnonymous: () => set({
    authenticated: false,
    viewer: null,
    error: null,
  }),

  setError: (error: string | null) => set({ error }),

  clear: () => {
    set({
      authenticated: false,
      viewer: null,
      loading: false,
      error: null,
    })
  },
}))
