import { forwardRef, useState, useRef, useEffect } from 'react'
import { ChevronDown, CheckCircle2, Search } from 'lucide-react'
import { cn } from '@/utils/cn'

interface SelectOption { value: string; label: string }

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string
  error?: string
  options: SelectOption[]
  placeholder?: string
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, id, value, onChange, disabled, required, name, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    const [isOpen, setIsOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const popoverRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      function onClickOutside(e: MouseEvent) {
        if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
          setIsOpen(false)
        }
      }
      if (isOpen) document.addEventListener('mousedown', onClickOutside)
      if (!isOpen) setSearchQuery('')
      return () => document.removeEventListener('mousedown', onClickOutside)
    }, [isOpen])

    const filteredOptions = options.filter(o => {
      if (!searchQuery) return true
      return o.label.toLowerCase().includes(searchQuery.toLowerCase())
    })

    const currentDisplay = options.find(o => o.value === value)?.label || placeholder || 'Select...'

    // We keep a hidden native select so that refs and native form submissions still work
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-text">
            {label}
            {required && <span className="text-danger ml-0.5">*</span>}
          </label>
        )}
        
        <div className="relative flex items-center" ref={popoverRef}>
          <select
            ref={ref}
            id={selectId}
            name={name}
            value={value}
            onChange={onChange}
            disabled={disabled}
            required={required}
            className="hidden"
            {...props}
          >
            {placeholder && <option value="">{placeholder}</option>}
            {options.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (!disabled) setIsOpen(prev => !prev)
            }}
            disabled={disabled}
            className={cn(
              'flex items-center justify-between w-full pl-3 pr-8 py-2 text-sm bg-background border rounded-lg text-text focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors shadow-sm hover:shadow-md cursor-pointer',
              isOpen ? 'border-primary ring-1 ring-primary/40' : (error ? 'border-danger' : 'border-border'),
              !value && 'text-muted',
              disabled && 'opacity-60 cursor-not-allowed',
              className
            )}
            title={currentDisplay}
          >
            <span className="flex items-center flex-1 min-w-0 overflow-hidden">
              <span className="truncate leading-tight block w-full text-left">{currentDisplay}</span>
            </span>
            <span 
              className="pointer-events-none absolute right-2.5 text-muted transition-transform duration-200 flex-shrink-0" 
              style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
            >
              <ChevronDown size={14} />
            </span>
          </button>

          {isOpen && (
            <div className="absolute top-[calc(100%+8px)] left-0 w-full min-w-[200px] bg-card border border-border shadow-[0_12px_40px_-8px_rgba(0,0,0,0.15)] rounded-xl py-1.5 z-[100] max-h-72 flex flex-col backdrop-blur-3xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2 duration-200">
              {options.length > 5 && (
                <div className="px-1.5 pb-1 mb-1 border-b border-border/50 shrink-0 space-y-1">
                  <div className="relative px-1 pt-1 pb-1">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search options..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      className="w-full bg-muted/50 border-none text-[11px] rounded-md pl-6 pr-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                </div>
              )}
              
              <div className="px-1.5 flex flex-col gap-0.5 overflow-y-auto">
                {placeholder && (
                  <button
                    type="button"
                    className="w-full text-left px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground rounded-md transition-all flex items-center gap-2 group"
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsOpen(false)
                      if (value !== '' && onChange) {
                        onChange({ target: { value: '', name: name || selectId } } as any)
                      }
                    }}
                  >
                    <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${!value ? 'text-primary' : 'text-transparent'}`}>
                      {!value && <CheckCircle2 size={12} strokeWidth={3} />}
                    </div>
                    <span className="group-hover:translate-x-0.5 transition-transform duration-200">{placeholder}</span>
                  </button>
                )}

                {filteredOptions.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground px-2.5 py-3 text-center">No results found</div>
                ) : (
                  filteredOptions.map(o => {
                    const isSelected = value === o.value
                    return (
                      <button
                        key={o.value}
                        type="button"
                        className={cn(
                          "w-full text-left px-2.5 py-1.5 text-xs transition-all rounded-md flex items-center gap-2 group",
                          isSelected 
                            ? 'bg-primary/10 text-primary font-medium' 
                            : 'text-foreground hover:bg-muted/40'
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          setIsOpen(false)
                          if (value !== o.value && onChange) {
                            onChange({ target: { value: o.value, name: name || selectId } } as any)
                          }
                        }}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors",
                          isSelected ? 'text-primary' : 'text-transparent'
                        )}>
                          {isSelected && <CheckCircle2 size={12} strokeWidth={3} />}
                        </div>
                        <span className={cn("truncate transition-transform duration-200", !isSelected && "group-hover:translate-x-0.5")}>{o.label}</span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    )
  }
)
Select.displayName = 'Select'
