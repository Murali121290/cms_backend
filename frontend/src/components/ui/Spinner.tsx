import { cn } from '@/utils/cn'

interface SpinnerProps { size?: 'sm' | 'md' | 'lg'; className?: string }

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <div className={cn(
      'animate-spin rounded-full border-2 border-border border-t-primary flex-shrink-0',
      size === 'sm' && 'w-4 h-4',
      size === 'md' && 'w-6 h-6',
      size === 'lg' && 'w-10 h-10',
      className
    )} />
  )
}

export function FullPageSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Spinner size="lg" />
    </div>
  )
}
