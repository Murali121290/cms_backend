import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, CheckCircle2, Search } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface DropdownOption {
  value: string
  label: React.ReactNode
}

export interface DropdownProps {
  options: DropdownOption[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  dropdownClassName?: string
  icon?: React.ReactNode
  variant?: 'default' | 'inline'
  searchable?: boolean
  searchPlaceholder?: string
  disabled?: boolean
}

export function Dropdown({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  className,
  dropdownClassName,
  icon,
  variant = 'default',
  searchable = false,
  searchPlaceholder = 'Search...',
  disabled = false,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)

  const isInline = variant === 'inline'
  const selectedOpt = options.find(o => o.value === value)

  const updatePosition = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const menuHeight = 280
    const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow

    const top = placeAbove
      ? Math.max(10, rect.top - Math.min(spaceAbove - 10, menuHeight) - 4)
      : rect.bottom + 4

    const maxHeight = placeAbove
      ? Math.min(menuHeight, spaceAbove - 20)
      : Math.min(menuHeight, spaceBelow - 20)

    const minWidth = Math.max(200, rect.width)
    let left = rect.left
    if (left + minWidth > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - minWidth - 10)
    }

    setCoords({
      top,
      left,
      width: minWidth,
      maxHeight,
    })
  }

  useLayoutEffect(() => {
    if (open) {
      updatePosition()
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setSearchQuery('')
      return
    }

    const handleScrollOrResize = () => {
      updatePosition()
    }

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }

    window.addEventListener('resize', handleScrollOrResize)
    window.addEventListener('scroll', handleScrollOrResize, true)
    document.addEventListener('mousedown', handleOutsideClick)

    return () => {
      window.removeEventListener('resize', handleScrollOrResize)
      window.removeEventListener('scroll', handleScrollOrResize, true)
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [open])

  // Extract unassigned option if searchable
  const unassignedOpt = searchable
    ? options.find(o => o.value === '' || (typeof o.label === 'string' && o.label.toLowerCase().includes('unassigned')))
    : null

  const regularOptions = unassignedOpt
    ? options.filter(o => o !== unassignedOpt)
    : options

  const filteredOptions = searchQuery
    ? regularOptions.filter(opt => {
        const text = typeof opt.label === 'string' ? opt.label.toLowerCase() : String(opt.value).toLowerCase()
        return text.includes(searchQuery.toLowerCase())
      })
    : regularOptions

  return (
    <div className={cn("relative inline-block text-left", className?.includes('w-') ? '' : 'w-full')}>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (!disabled) setOpen(prev => !prev)
        }}
        disabled={disabled}
        className={cn(
          'flex items-center justify-between w-full focus:outline-none transition-colors cursor-pointer',
          isInline
            ? 'bg-transparent border-0 p-0 text-text hover:text-primary ' + (open ? 'text-primary' : '')
            : 'bg-card border border-border rounded-lg px-3 py-2 text-xs text-text focus:border-primary',
          className
        )}
        title={typeof selectedOpt?.label === 'string' ? selectedOpt.label : undefined}
      >
        <span className="flex items-center gap-1.5 truncate">
          {icon}
          {selectedOpt ? (
            <span className="truncate">{selectedOpt.label}</span>
          ) : (
            <span className="text-muted truncate">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          size={12}
          className={cn(
            'transition-transform duration-200 ml-1.5 shrink-0',
            open && 'rotate-180',
            isInline ? 'text-current' : 'text-muted'
          )}
        />
      </button>

      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            minWidth: Math.max(200, coords.width),
            maxHeight: coords.maxHeight,
            zIndex: 99999,
          }}
          className={cn(
            "w-max max-w-[280px] bg-card border border-border shadow-[0_12px_40px_-8px_rgba(0,0,0,0.18)] rounded-xl py-1.5 flex flex-col backdrop-blur-3xl ring-1 ring-black/5 animate-in fade-in duration-150 text-text font-sans",
            dropdownClassName
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {searchable && (
            <div className="px-2 pb-1.5 mb-1 border-b border-border/60 shrink-0 space-y-1">
              <div className="relative flex items-center gap-1.5 bg-muted/40 border border-border/50 rounded-lg px-2 py-1">
                <Search size={12} className="text-muted shrink-0" />
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  className="w-full bg-transparent border-none text-[11px] text-text placeholder:text-muted focus:outline-none p-0"
                  autoFocus
                />
              </div>

              {unassignedOpt && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange(unassignedOpt.value)
                    setOpen(false)
                  }}
                  className={cn(
                    "w-full text-left px-2.5 py-1.5 text-[11px] rounded-md transition-all flex items-center gap-2 group cursor-pointer",
                    value === unassignedOpt.value
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted hover:bg-muted/40 hover:text-text"
                  )}
                >
                  <div className={cn(
                    "w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors",
                    value === unassignedOpt.value ? "text-primary" : "text-transparent"
                  )}>
                    {value === unassignedOpt.value && <CheckCircle2 size={12} strokeWidth={2.5} />}
                  </div>
                  <span className="truncate group-hover:translate-x-0.5 transition-transform duration-200">
                    {unassignedOpt.label}
                  </span>
                </button>
              )}
            </div>
          )}

          <div className="px-1.5 flex flex-col gap-0.5 overflow-y-auto custom-scrollbar flex-1">
            {filteredOptions.length === 0 ? (
              <div className="text-[11px] text-muted px-2.5 py-3 text-center">No results found</div>
            ) : (
              filteredOptions.map(opt => {
                const isSelected = value === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onChange(opt.value)
                      setOpen(false)
                    }}
                    className={cn(
                      "w-full text-left px-2.5 py-1.5 text-[11px] transition-all rounded-md flex items-center gap-2 group cursor-pointer",
                      isSelected
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-text hover:bg-muted/40 hover:text-primary"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors",
                      isSelected ? "text-primary" : "text-transparent"
                    )}>
                      {isSelected && <CheckCircle2 size={12} strokeWidth={2.5} />}
                    </div>
                    <span className={cn(
                      "truncate transition-transform duration-200",
                      !isSelected && "group-hover:translate-x-0.5"
                    )}>
                      {opt.label}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
