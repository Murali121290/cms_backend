import { DashboardProjectGrid } from "@/features/dashboard/components/DashboardProjectGrid";
import { DashboardStatsGrid } from "@/features/dashboard/components/DashboardStatsGrid";
import { useDashboardQuery } from "@/features/dashboard/useDashboardQuery";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getSsrUrl, ssrPaths } from "@/utils/appPaths";

function getGreeting(): { timeOfDay: string; dayOfWeek: string; formattedDate: string } {
  const now = new Date();
  const hour = now.getHours();
  const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const dayOfWeek = now.toLocaleDateString("en-GB", { weekday: "long" });
  const formattedDate = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return { timeOfDay, dayOfWeek, formattedDate };
}

export function DashboardPage() {
  useDocumentTitle("S4Carlisle Production Suite");
  const dashboardQuery = useDashboardQuery();

  if (dashboardQuery.isPending) {
    return (
      <main className="page dashboard-page dashboard-page--state">
        <section className="panel dashboard-state-card">
          <div className="dashboard-state-card__icon">◌</div>
          <h1 className="dashboard-state-card__title">Loading dashboard</h1>
          <p className="dashboard-state-card__message">
            Fetching the dashboard summary and project cards from /api/v2/dashboard.
          </p>
        </section>
      </main>
    );
  }

  if (dashboardQuery.isError) {
    return (
      <main className="page dashboard-page dashboard-page--state">
        <section className="panel dashboard-state-card dashboard-state-card--error">
          <div className="dashboard-state-card__icon">!</div>
          <h1 className="dashboard-state-card__title">Dashboard unavailable</h1>
          <p className="dashboard-state-card__message">
            The frontend shell could not load the dashboard contract.
          </p>
          <div className="dashboard-state-card__actions">
            <button className="button" onClick={() => dashboardQuery.refetch()}>
              Retry
            </button>
            <a className="button button--secondary" href={getSsrUrl(ssrPaths.dashboard)}>
              Open SSR dashboard
            </a>
          </div>
        </section>
      </main>
    );
  }

  const { projects, stats, viewer } = dashboardQuery.data;
  const { timeOfDay, dayOfWeek, formattedDate } = getGreeting();

  return (
    <main className="page dashboard-page">
      {/* Hero banner */}
      <div
        className="relative rounded-2xl overflow-hidden mb-6"
        style={{
          background: "linear-gradient(135deg, #0f2d5c 0%, #1a5276 35%, #C9821A 80%, #e6952a 100%)",
          minHeight: "140px",
        }}
      >
        {/* Decorative circles */}
        <div
          className="absolute -top-8 -right-8 w-48 h-48 rounded-full opacity-10"
          style={{ background: "rgba(255,255,255,0.3)" }}
        />
        <div
          className="absolute -bottom-12 right-24 w-64 h-64 rounded-full opacity-10"
          style={{ background: "rgba(255,255,255,0.2)" }}
        />
        <div
          className="absolute top-4 right-64 w-16 h-16 rounded-full opacity-20"
          style={{ background: "rgba(255,255,255,0.4)" }}
        />

        <div className="relative z-10 flex items-center justify-between px-8 py-7">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-white tracking-tight">
                S4Carlisle Production Suite
              </h1>
            </div>
            <p className="text-white/70 text-sm font-medium">
              {dayOfWeek}, {formattedDate}
            </p>
            <p className="text-white text-base font-semibold mt-1">
              Good {timeOfDay}, {viewer.username} 👋
            </p>
          </div>

          <div className="text-right hidden sm:block">
            <div className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">
              Publishing Production
            </div>
            <div className="text-white text-4xl font-bold font-mono leading-none">
              {projects.length}
            </div>
            <div className="text-white/70 text-xs mt-1">Active Projects</div>
          </div>
        </div>
      </div>

      <DashboardStatsGrid stats={stats} />

      <section className="dashboard-projects panel mt-6">
        <div className="dashboard-section-title">
          <div>
            <h2 className="dashboard-section-heading">Projects</h2>
            <p className="dashboard-section-copy">
              {projects.length} active project{projects.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="dashboard-empty">
            <div className="dashboard-empty__icon">📘</div>
            <p className="dashboard-empty__title">No projects yet</p>
            <p className="dashboard-empty__copy">
              Project summaries will appear here once books are created through the current backend flows.
            </p>
            <div className="dashboard-empty__actions">
              <a className="button" href={getSsrUrl(ssrPaths.projectCreate)}>
                Open SSR project creation
              </a>
            </div>
          </div>
        ) : (
          <DashboardProjectGrid projects={projects} />
        )}
      </section>
    </main>
  );
}
