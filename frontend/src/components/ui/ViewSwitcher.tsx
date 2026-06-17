import { LayoutGrid, List, Table2 } from 'lucide-react'
import type { ViewMode } from '@/hooks/useViewMode'
import { cn } from '@/utils/cn'

interface Props {
  mode: ViewMode
  onChange: (m: ViewMode) => void
}

const MODES: { value: ViewMode; Icon: React.ElementType; label: string }[] = [
  { value: 'large',   Icon: LayoutGrid,            label: 'Large'   },
  { value: 'medium',  Icon: () => (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="4" height="4" rx="0.75" fill="currentColor"/>
        <rect x="6" y="1" width="4" height="4" rx="0.75" fill="currentColor"/>
        <rect x="11" y="1" width="4" height="4" rx="0.75" fill="currentColor"/>
        <rect x="1" y="6" width="4" height="4" rx="0.75" fill="currentColor"/>
        <rect x="6" y="6" width="4" height="4" rx="0.75" fill="currentColor"/>
        <rect x="11" y="6" width="4" height="4" rx="0.75" fill="currentColor"/>
        <rect x="1" y="11" width="4" height="4" rx="0.75" fill="currentColor"/>
        <rect x="6" y="11" width="4" height="4" rx="0.75" fill="currentColor"/>
        <rect x="11" y="11" width="4" height="4" rx="0.75" fill="currentColor"/>
      </svg>
    ), label: 'Medium' },
  { value: 'list',    Icon: List,                  label: 'List'    },
  { value: 'details', Icon: Table2,                label: 'Details' },
]

export function ViewSwitcher({ mode, onChange }: Props) {
  return (
    <div className="flex rounded-lg border border-border overflow-hidden divide-x divide-border bg-card shadow-sm">
      {MODES.map(({ value, Icon, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          title={label}
          aria-label={label}
          aria-pressed={mode === value}
          className={cn(
            'flex items-center justify-center w-8 h-8 transition-colors duration-100',
            mode === value
              ? 'bg-primary text-white'
              : 'text-muted hover:text-text hover:bg-surface'
          )}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  )
}
