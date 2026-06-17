import { AlertTriangle, Clock, FolderOpen, TrendingUp } from "lucide-react";
import type { DashboardStats } from "@/types/api";

interface DashboardStatsGridProps {
  stats: DashboardStats;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  trendText: string;
  trendDirection?: "up" | "down" | "neutral";
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
}

function MetricCard({ label, value, trendText, trendDirection = "neutral", icon, iconBg, iconColor }: MetricCardProps) {
  const trendBadge = trendDirection === "up"
    ? "bg-emerald-50 text-emerald-700"
    : trendDirection === "down"
    ? "bg-red-50 text-red-700"
    : "bg-surface text-muted";

  const trendArrow = trendDirection === "up" ? "↑ " : trendDirection === "down" ? "↓ " : "";

  return (
    <article className="bg-card border border-border rounded-xl p-5 hover:shadow-md transition-all duration-150 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconBg}`}>
          <span className={iconColor}>{icon}</span>
        </div>
        {trendText && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${trendBadge}`}>
            {trendArrow}{trendText}
          </span>
        )}
      </div>
      <div>
        <p className="text-3xl font-bold text-text font-mono leading-none">{value}</p>
        <p className="text-xs text-muted mt-1 font-medium uppercase tracking-wide">{label}</p>
      </div>
    </article>
  );
}

export function DashboardStatsGrid({ stats }: DashboardStatsGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <MetricCard
        label="Total Projects"
        value={stats.total_projects}
        trendText="All time"
        trendDirection="neutral"
        icon={<FolderOpen className="w-4 h-4" />}
        iconBg="bg-blue-50"
        iconColor="text-blue-600"
      />
      <MetricCard
        label="On Time Rate"
        value={`${stats.on_time_rate}%`}
        trendText={stats.on_time_trend ?? "Delivery rate"}
        trendDirection="up"
        icon={<TrendingUp className="w-4 h-4" />}
        iconBg="bg-emerald-50"
        iconColor="text-emerald-600"
      />
      <MetricCard
        label="Avg Days"
        value={stats.avg_days}
        trendText={stats.avg_days_trend ?? "To complete"}
        trendDirection="neutral"
        icon={<Clock className="w-4 h-4" />}
        iconBg="bg-amber-50"
        iconColor="text-amber-600"
      />
      <MetricCard
        label="Delayed"
        value={stats.delayed_count}
        trendText={stats.delayed_trend ?? "Projects behind"}
        trendDirection={stats.delayed_count > 0 ? "down" : "neutral"}
        icon={<AlertTriangle className="w-4 h-4" />}
        iconBg="bg-red-50"
        iconColor="text-red-600"
      />
    </div>
  );
}
