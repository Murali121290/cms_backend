import { DashboardProjectGrid } from "@/features/dashboard/components/DashboardProjectGrid";
import { DashboardStatsGrid } from "@/features/dashboard/components/DashboardStatsGrid";
import { useDashboardQuery } from "@/features/dashboard/useDashboardQuery";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getSsrUrl, ssrPaths } from "@/utils/appPaths";

import { BookOpen } from "lucide-react";

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
      <div className="relative rounded-2xl overflow-hidden mb-6 bg-sidebar min-h-[140px]">
        {/* Warm Gold Radial Glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(900px 300px at 85% -20%, rgba(200,132,28,0.30), transparent 60%)" }}
        />

        <div className="relative z-10 flex items-end justify-between px-8 py-7 flex-wrap gap-4">
          <div>
            <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 px-3 py-1 rounded-full mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span className="text-[10px] font-bold tracking-wider text-primary uppercase">
                {dayOfWeek} · {formattedDate}
              </span>
            </div>
            <h1 className="text-3xl font-serif font-medium text-[#FBF9F4] tracking-tight leading-none mb-2">
              Good {timeOfDay}, {viewer.username}.
            </h1>
            <p className="text-white/60 text-sm mt-1">
              You have <strong className="text-primary font-bold">{projects.length} active</strong> project{projects.length !== 1 ? "s" : ""} in progress.
            </p>
          </div>

          <div className="text-right hidden sm:block">
            <div className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1.5">
              Active Titles
            </div>
            <div className="text-white text-5xl font-bold font-serif leading-none">
              {projects.length}
            </div>
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
          <div className="flex flex-col items-center justify-center text-center p-12 bg-gradient-to-br from-card to-background border border-border rounded-2xl shadow-subtle min-h-[300px] mt-6">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-6 animate-pulse">
              <BookOpen size={32} />
            </div>
            <h3 className="text-xl font-bold text-text mb-2">No Projects Assigned</h3>
          </div>
        ) : (
          <DashboardProjectGrid projects={projects} />
        )}
      </section>
    </main>
  );
}
