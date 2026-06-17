import { Link } from 'react-router-dom'
import { DashboardAdminShortcuts } from '@/features/dashboard/components/DashboardAdminShortcuts'
import { DashboardProjectGrid } from '@/features/dashboard/components/DashboardProjectGrid'
import { DashboardStatsGrid } from '@/features/dashboard/components/DashboardStatsGrid'
import { useDashboardQuery } from '@/features/dashboard/useDashboardQuery'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { getSsrUrl, ssrPaths, uiPaths } from '@/utils/appPaths'
import { FullPageSpinner } from '@/components/ui/Spinner'

export function Dashboard() {
  useDocumentTitle('CMS UI Dashboard')
  const dashboardQuery = useDashboardQuery()

  if (dashboardQuery.isPending) {
    return <FullPageSpinner />
  }

  if (dashboardQuery.isError) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold text-red-600 mb-2">Dashboard Unavailable</h2>
          <p className="text-gray-600 mb-4">Failed to load dashboard from /api/v2/dashboard</p>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => dashboardQuery.refetch()}
              className="px-4 py-2 bg-primary text-white rounded hover:opacity-90"
            >
              Retry
            </button>
            <a
              href={getSsrUrl(ssrPaths.dashboard)}
              className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:opacity-90"
            >
              Open SSR Dashboard
            </a>
          </div>
        </div>
      </div>
    )
  }

  const { projects, stats, viewer } = dashboardQuery.data
  const isAdmin = viewer.roles.includes('Admin')

  return (
    <main className="space-y-6">
      <header className="dashboard-hero">
        <h1 className="text-3xl font-bold text-text">S4 Carlisle Production Dashboard</h1>
        <p className="text-muted mt-1">Publishing Production Overview - Live Data from /api/v2</p>
      </header>

      <DashboardStatsGrid stats={stats} />

      {isAdmin ? <DashboardAdminShortcuts userId={viewer.id} /> : null}

      <section className="bg-card border border-border rounded-lg p-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-xl font-bold text-text">Projects</h2>
            <p className="text-sm text-muted mt-1">
              {projects.length} loaded from /api/v2/dashboard endpoint
            </p>
          </div>
          <Link to={uiPaths.projects} className="px-4 py-2 bg-primary text-white rounded hover:opacity-90">
            View All Projects
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-lg text-muted mb-4">No projects yet</p>
            <p className="text-sm text-muted mb-6">Project summaries will appear here once books are created</p>
            <a
              href={getSsrUrl(ssrPaths.projectCreate)}
              className="inline-block px-4 py-2 bg-primary text-white rounded hover:opacity-90"
            >
              Create First Project
            </a>
          </div>
        ) : (
          <DashboardProjectGrid projects={projects} />
        )}
      </section>
    </main>
  )
}
