import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X, Check } from 'lucide-react'
import { cn } from '@/utils/cn'

type SelectOption = string | { value: string; label: string }

function optVal(o: SelectOption) { return typeof o === 'string' ? o : o.value }
function optLabel(o: SelectOption) { return typeof o === 'string' ? o : o.label }

interface MultiSelectProps {
  label?: string
  options: SelectOption[]
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  error?: string
  required?: boolean
}

export function MultiSelect({ label, options, value, onChange, placeholder = 'Select...', error, required }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  }

  const labelFor = (v: string) => {
    const match = options.find(o => optVal(o) === v)
    return match ? optLabel(match) : v
  }

  return (
    <div className="flex flex-col gap-1" ref={ref}>
      {label && (
        <label className="text-sm font-medium text-text">
          {label}{required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className={cn(
            'w-full min-h-[38px] pl-3 pr-8 py-1.5 text-sm bg-background border rounded-lg text-left flex flex-wrap gap-1 items-center',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all',
            error ? 'border-danger' : 'border-border'
          )}
        >
          {value.length === 0 ? (
            <span className="text-muted">{placeholder}</span>
          ) : (
            value.map(v => (
              <span key={v} className="inline-flex items-center gap-1 bg-accent text-primary text-xs px-2 py-0.5 rounded-md">
                {labelFor(v)}
                <button type="button" onClick={(e) => { e.stopPropagation(); toggle(v) }}>
                  <X size={10} />
                </button>
              </span>
            ))
          )}
          <ChevronDown size={14} className={cn('absolute right-3 top-3 text-muted transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
            {options.map(opt => {
              const v = optVal(opt)
              const l = optLabel(opt)
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => toggle(v)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text hover:bg-background transition-colors"
                >
                  <span className={cn(
                    'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                    value.includes(v) ? 'bg-primary border-primary' : 'border-border'
                  )}>
                    {value.includes(v) && <Check size={10} className="text-white" />}
                  </span>
                  {l}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
