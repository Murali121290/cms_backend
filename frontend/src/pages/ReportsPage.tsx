import { useMemo } from "react";

import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SkeletonCard } from "@/components/ui/SkeletonLoader";
import { DashboardStatsGrid } from "@/features/dashboard/components/DashboardStatsGrid";
import { useReportsActivitiesQuery, useReportsDashboardQuery } from "@/features/reports/useReportsQuery";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { ActivityItem, ProjectSummary } from "@/types/api";

interface Breakdown {
  label: string;
  count: number;
}

function toBreakdown<T>(items: T[], key: (item: T) => string): Breakdown[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const raw = key(item);
    const label = raw && raw.trim() ? raw : "Unspecified";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

interface BreakdownCardProps {
  title: string;
  subtitle: string;
  rows: Breakdown[];
  total: number;
  color?: "navy" | "gold" | "success";
  emptyText: string;
}

function BreakdownCard({ title, subtitle, rows, total, color = "gold", emptyText }: BreakdownCardProps) {
  return (
    <section className="bg-white rounded-lg shadow-card p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        <p className="text-xs text-muted mt-0.5">{subtitle}</p>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">{emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
            return (
              <li key={row.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-text capitalize truncate pr-2">{row.label}</span>
                  <span className="text-xs text-muted tabular-nums shrink-0">
                    {row.count} Â· {pct}%
                  </span>
                </div>
                <ProgressBar value={pct} color={color} size="sm" />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ReportsPage() {
  useDocumentTitle("Reports â€” S4 Carlisle CMS");

  const dashboardQuery = useReportsDashboardQuery();
  const activitiesQuery = useReportsActivitiesQuery();

  const projects: ProjectSummary[] = dashboardQuery.data?.projects ?? [];
  const activities: ActivityItem[] = activitiesQuery.data?.activities ?? [];

  const projectsByStatus = useMemo(
    () => toBreakdown(projects, (p) => p.status),
    [projects],
  );
  const activitiesByType = useMemo(
    () => toBreakdown(activities, (a) => a.type),
    [activities],
  );

  return (
    <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
      <PageHeader
        title="Reports"
        subtitle="Production analytics across all projects"
      />

      <div className="mt-6">
        {dashboardQuery.isPending ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : dashboardQuery.isError ? (
          <div className="bg-white rounded-lg shadow-card p-8 text-center mb-6">
            <p className="text-sm text-muted mb-4">Reports could not be loaded.</p>
            <button
              className="text-sm text-primary hover:text-primary font-medium underline"
              onClick={() => void dashboardQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : (
          dashboardQuery.data && <DashboardStatsGrid stats={dashboardQuery.data.stats} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <BreakdownCard
            title="Projects by Status"
            subtitle={`${projects.length} projects`}
            rows={projectsByStatus}
            total={projects.length}
            color="gold"
            emptyText="No projects yet."
          />
          <BreakdownCard
            title="Recent Activity by Type"
            subtitle={
              activitiesQuery.data
                ? `${activitiesQuery.data.summary.total} activities Â· ${activitiesQuery.data.summary.today} today`
                : "Recent activity"
            }
            rows={activitiesByType}
            total={activities.length}
            color="success"
            emptyText={activitiesQuery.isError ? "Failed to load activity." : "No activity yet."}
          />
        </div>
      </div>
    </main>
  );
}
