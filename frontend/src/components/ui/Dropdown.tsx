import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/utils/cn'

interface DropdownOption {
  value: string
  label: React.ReactNode
}

interface DropdownProps {
  options: DropdownOption[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  dropdownClassName?: string
  icon?: React.ReactNode
  variant?: 'default' | 'inline'
  searchable?: boolean
}

export function Dropdown({ options, value, onChange, placeholder = 'Select...', className, dropdownClassName, icon, variant = 'default', searchable = false }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open && listRef.current && !searchQuery) {
      const selectedEl = listRef.current.querySelector('[data-selected="true"]') as HTMLElement
      if (selectedEl) {
        setTimeout(() => selectedEl.scrollIntoView({ block: 'nearest' }), 0)
      }
    }
    if (!open) {
      setSearchQuery('')
    }
  }, [open, searchQuery])

  const selectedOpt = options.find(o => o.value === value)
  const isInline = variant === 'inline'

  const filteredOptions = searchQuery 
    ? options.filter(opt => {
        const text = typeof opt.label === 'string' ? opt.label.toLowerCase() : String(opt.value).toLowerCase()
        return text.includes(searchQuery.toLowerCase())
      })
    : options

  return (
    <div className={cn("relative inline-block text-left", className?.includes('w-') ? '' : 'w-full')} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center justify-between w-full focus:outline-none transition-colors cursor-pointer',
          isInline 
            ? 'bg-transparent border-0 p-0 text-text hover:text-primary ' + (open ? 'text-primary' : '') 
            : 'bg-card border border-border rounded-lg px-3 py-2 text-xs text-text focus:border-primary',
          className
        )}
      >
        <span className="flex items-center gap-1.5 truncate">
          {icon}
          {selectedOpt ? selectedOpt.label : <span className="text-muted">{placeholder}</span>}
        </span>
        <ChevronDown size={14} className={cn('transition-transform ml-2 shrink-0', open && 'rotate-180', isInline ? 'text-current' : 'text-muted')} />
      </button>

      {open && (
        <div 
          ref={listRef}
          className={cn(
          'absolute z-50 mt-1 min-w-[140px] bg-card border border-border rounded-xl shadow-lg max-h-60 overflow-y-auto p-2 flex flex-col gap-1',
          dropdownClassName
        )}>
          {searchable && (
            <div className="pb-1.5 mb-1 border-b border-border sticky top-0 bg-card z-10 -mx-1 px-1">
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onClick={e => e.stopPropagation()}
                className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-text focus:outline-none focus:border-primary transition-colors"
                autoFocus
              />
            </div>
          )}
          
          {filteredOptions.length === 0 ? (
            <div className="text-xs text-muted py-3 text-center">No results found</div>
          ) : (
            filteredOptions.map(opt => {
              const isSelected = value === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-selected={isSelected}
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-xs rounded-md transition-colors text-left shrink-0",
                    isSelected 
                      ? "bg-primary/10 text-primary font-medium" 
                      : "text-text hover:bg-accent/70 hover:text-primary"
                  )}
                >
                  {!isInline && (
                    <span className={cn("w-3 flex justify-center shrink-0", isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-50")}>
                      <Check size={14} className={isSelected ? "text-primary" : "text-muted"} />
                    </span>
                  )}
                  <span className="truncate">{opt.label}</span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
