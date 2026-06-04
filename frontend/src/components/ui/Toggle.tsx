import { cn } from '@/utils/cn'

interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
}

export function Toggle({ checked, onChange, disabled = false, size = 'md' }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary/30',
        size === 'md' ? 'w-11 h-6' : 'w-8 h-4',
        checked ? 'bg-primary' : 'bg-border',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <span className={cn(
        'pointer-events-none inline-block rounded-full bg-white shadow transform transition-transform duration-200 ease-in-out',
        size === 'md' ? 'w-5 h-5' : 'w-3 h-3',
        checked
          ? (size === 'md' ? 'translate-x-5' : 'translate-x-4')
          : 'translate-x-0'
      )} />
    </button>
  )
}
