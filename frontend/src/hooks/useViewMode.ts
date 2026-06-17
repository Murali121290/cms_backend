import { useState } from 'react'

export type ViewMode = 'large' | 'medium' | 'list' | 'details'

export function useViewMode(key: string, defaultMode: ViewMode = 'large') {
  const [mode, setMode] = useState<ViewMode>(() =>
    (localStorage.getItem(key) as ViewMode | null) ?? defaultMode
  )
  function change(v: ViewMode) {
    setMode(v)
    localStorage.setItem(key, v)
  }
  return [mode, change] as const
}
