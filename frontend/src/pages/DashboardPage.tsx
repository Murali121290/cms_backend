import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { DashboardProjectGrid } from "@/features/dashboard/components/DashboardProjectGrid";
import { DashboardStatsGrid } from "@/features/dashboard/components/DashboardStatsGrid";
import { useDashboardQuery } from "@/features/dashboard/useDashboardQuery";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getSsrUrl, ssrPaths } from "@/utils/appPaths";

export function DashboardPage() {
  useDocumentTitle("CMS UI Dashboard");
  const dashboardQuery = useDashboardQuery();

  if (dashboardQuery.isPending) {
    return (
      <LoadingState
        title="Loading dashboard"
        message="Fetching the dashboard summary and project cards from /api/v2/dashboard."
      />
    );
  }

  if (dashboardQuery.isError) {
    return (
      <ErrorState
        title="Dashboard unavailable"
        message="The frontend shell could not load the dashboard contract."
        actions={
          <>
            <button className="button" onClick={() => dashboardQuery.refetch()}>
              Retry
            </button>
            <a className="button button--secondary" href={getSsrUrl(ssrPaths.dashboard)}>
              Open SSR dashboard
            </a>
          </>
        }
      />
    );
  }

  if (dashboardQuery.data.projects.length === 0) {
    return (
      <main className="page stack">
        <header className="page-header">
          <h1>Dashboard</h1>
          <p>Frontend shell bootstrapped from the current /api/v2 contracts.</p>
        </header>
        <DashboardStatsGrid stats={dashboardQuery.data.stats} />
        <EmptyState
          title="No projects yet"
          message="Project summaries will appear here once books are created through the current backend flows."
          actions={
            <a className="button" href={getSsrUrl(ssrPaths.projectCreate)}>
              Open SSR project creation
            </a>
          }
        />
      </main>
    );
  }

  return (
    <main className="page stack">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p>Frontend foundation consuming the existing dashboard and notification contracts.</p>
      </header>
      <DashboardStatsGrid stats={dashboardQuery.data.stats} />
      <section className="panel">
        <div className="section-title">
          <h2>Projects</h2>
          <span className="helper-text">{dashboardQuery.data.projects.length} loaded from /api/v2/dashboard</span>
        </div>
        <DashboardProjectGrid projects={dashboardQuery.data.projects} />
      </section>
    </main>
  );
}
