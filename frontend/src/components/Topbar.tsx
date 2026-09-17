import { Menu } from 'lucide-react'
import { useSidebarStore } from '@/store/useSidebarStore'

export function Topbar() {
  const { toggle } = useSidebarStore()

  // The desktop top bar previously held only a notifications button; with
  // that removed the bar has nothing to show on md+ viewports, so hide it
  // entirely there to avoid reserving an empty strip above content. On
  // small screens the bar still exposes the sidebar toggle.
  return (
    <header className="md:hidden h-16 bg-card border-b border-border flex items-center px-4 gap-3 flex-shrink-0 sticky top-0 z-30">
      <button
        onClick={toggle}
        className="p-2 rounded-lg text-muted hover:text-text hover:bg-surface transition-colors"
        aria-label="Toggle menu"
      >
        <Menu size={18}/>
      </button>
    </header>
  )
}
