import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import './styles/globals.css'
import App from './App'
import { themes, defaultTheme } from '@/theme/themes'
import { applyTheme } from '@/theme/applyTheme'

// Apply persisted theme synchronously before first paint — prevents flash of wrong theme
;(() => {
  try {
    const saved  = JSON.parse(localStorage.getItem('cms-theme') ?? '{}')
    const name   = saved?.state?.theme?.name
    const found  = themes.find(t => t.name === name)
    applyTheme(found ?? defaultTheme)
  } catch {
    applyTheme(defaultTheme)
  }
})()

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
