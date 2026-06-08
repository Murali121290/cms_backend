import { useEffect } from 'react'
import { AppRouter } from '@/routes'
import { useThemeStore } from '@/store/useThemeStore'
import { applyTheme } from '@/theme/applyTheme'
import { ToastContainer } from '@/components/ui/Toast'
import { useSessionBootstrap } from '@/features/session/useSessionBootstrap'

function AppWithSession() {
  const sessionQuery = useSessionBootstrap()

  return <AppRouter />
}

function App() {
  const { theme } = useThemeStore()

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <>
      <AppWithSession />
      <ToastContainer />
    </>
  )
}

export default App
