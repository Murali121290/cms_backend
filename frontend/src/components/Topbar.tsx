import { useState } from 'react'
import { Bell, Menu } from 'lucide-react'
import { useSidebarStore } from '@/store/useSidebarStore'

export function Topbar() {
  const { toggle }      = useSidebarStore()
  const [notifications] = useState(3)

  return (
    <header className="h-16 bg-card border-b border-border flex items-center px-4 md:px-6 gap-3 flex-shrink-0 sticky top-0 z-30">

      {/* Mobile: sidebar toggle */}
      <button
        onClick={toggle}
        className="md:hidden p-2 rounded-lg text-muted hover:text-text hover:bg-surface transition-colors"
        aria-label="Toggle menu"
      >
        <Menu size={18}/>
      </button>

      <div className="flex items-center gap-2 ml-auto">

        {/* Notifications */}
        <button
          className="relative p-2 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors"
          aria-label="Notifications"
        >
          <Bell size={18}/>
          {notifications > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-danger text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {notifications}
            </span>
          )}
        </button>

      </div>
    </header>
  )
}
