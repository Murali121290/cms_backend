import { useEffect } from 'react'
import { AppRouter } from '@/routes'
import { useThemeStore } from '@/store/useThemeStore'
import { applyTheme } from '@/theme/applyTheme'
import { ToastContainer } from '@/components/ui/Toast'

function App() {
  const { theme } = useThemeStore()

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <>
      <AppRouter />
      <ToastContainer />
    </>
  )
}

export default App
