import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import './styles/globals.css'
import App from './App'
import { themes, defaultTheme } from '@/theme/themes'
import { applyTheme } from '@/theme/applyTheme'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'

// Apply persisted theme synchronously before first paint — prevents flash of wrong theme
;(() => {
  try {
    const saved  = JSON.parse(localStorage.getItem('wms-theme') ?? '{}')
    const theme  = saved?.state?.theme ?? defaultTheme
    applyTheme(theme)
  } catch {
    applyTheme(defaultTheme)
  }
})()

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
)
