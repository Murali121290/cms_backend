import { useNavigate } from 'react-router-dom'
import { Card, CardBody } from '@/components/ui/Card'
import { FolderSearch, FileText, CalendarDays, ArrowRight } from 'lucide-react'

export function ReportsPage() {
  const navigate = useNavigate()

  const reportCards = [
    {
      title: 'Project Info & Timeline Tracker',
      description: 'Search, filter, and track detailed project progress with timeline details and status indicators.',
      icon: FolderSearch,
      path: '/reports/project-schedule',
      color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/30',
    },
    {
      title: 'Schedules Report & Exporter',
      description: 'Comprehensive operational reporting dashboard featuring charting, Excel exporting, and PDF generation.',
      icon: FileText,
      path: '/reports/schedule',
      color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30',
    },
    {
      title: 'Daily Operations Dashboard',
      description: "Day-to-day team schedules and stage-wise workload tracking tailored for today's active tasks.",
      icon: CalendarDays,
      path: '/reports/today-schedule',
      color: 'text-violet-500 bg-violet-50 dark:bg-violet-950/30',
    },
  ]

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight text-text">Reports Dashboard</h1>
        <p className="text-sm text-muted">
          Select a report below to analyze project schedules, track daily workloads, or export data.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {reportCards.map((card) => {
          const Icon = card.icon
          return (
            <Card
              key={card.path}
              className="cursor-pointer group hover:border-primary/50 transition-all duration-200"
              onClick={() => navigate(card.path)}
            >
              <CardBody className="flex flex-col h-full justify-between p-6 gap-6">
                <div className="space-y-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${card.color}`}>
                    <Icon size={24} />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-text group-hover:text-primary transition-colors">
                      {card.title}
                    </h3>
                    <p className="text-sm text-muted leading-relaxed">
                      {card.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs font-semibold text-primary group-hover:translate-x-1 transition-transform">
                  <span>Open Report</span>
                  <ArrowRight size={14} />
                </div>
              </CardBody>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
