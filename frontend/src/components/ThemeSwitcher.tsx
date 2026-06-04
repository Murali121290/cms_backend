import { Palette } from 'lucide-react'
import { themes } from '@/theme/themes'
import { useThemeStore } from '@/stores/useThemeStore'
import { cn } from '@/utils/cn'

export function ThemeSwitcher() {
  const { theme, setTheme } = useThemeStore()

  return (
    <div className="relative group">
      <button className="p-2 rounded-lg hover:bg-white/10 text-sidebar-text transition-colors" title="Change theme">
        <Palette size={18} />
      </button>
      <div className="absolute bottom-full left-0 mb-2 hidden group-hover:flex flex-col gap-1 bg-card border border-border rounded-xl shadow-lg p-2 min-w-[140px] z-50">
        {themes.map((t) => (
          <button
            key={t.name}
            onClick={() => setTheme(t.name)}
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
    </div>
  )
}
