import { useEffect, useRef, useState } from 'react'
import { Palette } from 'lucide-react'
import { themes } from '@/theme/themes'
import { useThemeStore } from '@/store/useThemeStore'
import { cn } from '@/utils/cn'

export function ThemeSwitcher() {
  const { theme, setTheme } = useThemeStore()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-2 rounded-lg hover:bg-white/10 text-sidebar-text transition-colors"
        title="Change theme"
      >
        <Palette size={18} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 flex flex-col gap-1 bg-card border border-border rounded-xl shadow-lg p-2 min-w-[140px] z-50">
          {themes.map((t) => (
            <button
              key={t.name}
              onClick={() => {
                setTheme(t.name)
                setOpen(false)
              }}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text hover:bg-background transition-colors text-left',
                theme.name === t.name && 'bg-accent font-medium'
              )}
            >
              <span
                className="w-3 h-3 rounded-full border border-border flex-shrink-0"
                style={{ background: t.variables['--color-primary'] }}
              />
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
