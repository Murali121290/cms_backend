import { AlertTriangle, ArrowUpRight, Clock, FolderOpen, TrendingUp } from "lucide-react";
import type { DashboardStats } from "@/types/api";

interface DashboardStatsGridProps {
  stats: DashboardStats;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  trendText: string;
  icon: React.ReactNode;
  iconBg: string;
}

function MetricCard({ label, value, trendText, icon, iconBg }: MetricCardProps) {
  return (
    <article className="bg-white rounded-lg shadow-card hover:shadow-hover transition-all duration-150 p-5 flex items-start justify-between">
      <div className="min-w-0">
        <p className="text-xs text-navy-500 uppercase tracking-wide font-medium">
          {label}
        </p>
        <p className="text-3xl font-bold text-navy-900 mt-1 font-mono leading-none">
          {value}
        </p>
        <p className="text-xs text-navy-400 mt-2">{trendText}</p>
      </div>
      <div
        className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 ml-3 ${iconBg}`}
      >
        {icon}
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
        trendText={stats.on_time_trend ?? "All time"}
        icon={<FolderOpen className="w-5 h-5 text-gold-600" />}
        iconBg="bg-gold-100"
      />
      <MetricCard
        label="On Time Rate"
        value={`${stats.on_time_rate}%`}
        trendText={stats.on_time_trend ?? "Delivery rate"}
        icon={<TrendingUp className="w-5 h-5 text-success-600" />}
        iconBg="bg-success-100"
      />
      <MetricCard
        label="Avg Days"
        value={stats.avg_days}
        trendText={stats.avg_days_trend ?? "To complete"}
        icon={<Clock className="w-5 h-5 text-info-600" />}
        iconBg="bg-info-100"
      />
      <MetricCard
        label="Delayed"
        value={stats.delayed_count}
        trendText={stats.delayed_trend ?? "Projects behind"}
        icon={<AlertTriangle className="w-5 h-5 text-warning-600" />}
        iconBg="bg-warning-100"
      />
    </div>
  );
}
