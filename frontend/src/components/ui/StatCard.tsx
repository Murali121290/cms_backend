import type { LucideIcon } from 'lucide-react'
import { cn } from '@/utils/cn'

interface StatCardProps {
  title: string
  value: string | number
  change?: string
  changeType?: 'up' | 'down' | 'neutral'
  icon: LucideIcon
  iconColor?: string
  iconBg?: string
}

export function StatCard({ title, value, change, changeType = 'neutral', icon: Icon, iconColor, iconBg }: StatCardProps) {
  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted mb-1">{title}</p>
          <p className="text-3xl font-bold text-text">{value}</p>
          {change && (
            <p className={cn('text-xs mt-2 font-medium',
              changeType === 'up'   ? 'text-success' :
              changeType === 'down' ? 'text-danger'  : 'text-muted'
            )}>
              {change}
            </p>
          )}
        </div>
        <div className={cn('p-3 rounded-xl', iconBg ?? 'bg-accent')}>
          <Icon size={22} className={iconColor ?? 'text-primary'} />
        </div>
      </div>
    </div>
  )
}
