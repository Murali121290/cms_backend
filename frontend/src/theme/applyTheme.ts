import type { Theme } from './themes'

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  Object.entries(theme.variables).forEach(([key, value]) => {
    root.style.setProperty(key, value)
  })
  root.setAttribute('data-theme', theme.name)
}
