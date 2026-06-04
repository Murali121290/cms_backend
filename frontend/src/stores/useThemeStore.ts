import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { themes, defaultTheme, type Theme } from '@/theme/themes'
import { applyTheme } from '@/theme/applyTheme'

interface ThemeStore {
  theme: Theme
  setTheme: (name: string) => void
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: defaultTheme,
      setTheme: (name) => {
        const found = themes.find((t) => t.name === name) ?? defaultTheme
        applyTheme(found)
        set({ theme: found })
      },
    }),
    { name: 'cms-theme' }
  )
)
