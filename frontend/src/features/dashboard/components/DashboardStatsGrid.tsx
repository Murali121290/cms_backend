import type { DashboardStats } from "@/types/api";

interface DashboardStatsGridProps {
  stats: DashboardStats;
}

export function DashboardStatsGrid({ stats }: DashboardStatsGridProps) {
  return (
    <div className="metrics-grid">
      <article className="metric-card">
        <span className="helper-text">Total projects</span>
        <strong>{stats.total_projects}</strong>
      </article>
      <article className="metric-card">
        <span className="helper-text">On-time rate</span>
        <strong>{stats.on_time_rate}%</strong>
      </article>
      <article className="metric-card">
        <span className="helper-text">Average days</span>
        <strong>{stats.avg_days}</strong>
      </article>
      <article className="metric-card">
        <span className="helper-text">Delayed count</span>
        <strong>{stats.delayed_count}</strong>
      </article>
    </div>
  );
}
