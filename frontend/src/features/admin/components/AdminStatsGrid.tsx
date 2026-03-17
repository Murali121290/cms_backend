import type { AdminDashboardStats } from "@/types/api";

interface AdminStatsGridProps {
  stats: AdminDashboardStats;
}

export function AdminStatsGrid({ stats }: AdminStatsGridProps) {
  return (
    <div className="metrics-grid">
      <article className="metric-card">
        <span>Total users</span>
        <strong>{stats.total_users}</strong>
      </article>
      <article className="metric-card">
        <span>Total files</span>
        <strong>{stats.total_files}</strong>
      </article>
      <article className="metric-card">
        <span>Total validations</span>
        <strong>{stats.total_validations}</strong>
      </article>
      <article className="metric-card">
        <span>Total macro</span>
        <strong>{stats.total_macro}</strong>
      </article>
    </div>
  );
}
