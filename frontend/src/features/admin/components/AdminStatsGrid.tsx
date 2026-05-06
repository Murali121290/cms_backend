import { CheckSquare, FileText, Users, Zap } from "lucide-react";

import type { AdminDashboardStats } from "@/types/api";

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
}

function StatCard({ label, value, icon: Icon, iconBg, iconColor }: StatCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-card p-5 flex items-start justify-between hover:shadow-hover transition-all duration-150">
      <div>
        <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide">{label}</p>
        <p className="text-3xl font-bold text-navy-900 mt-1 font-mono">{value}</p>
      </div>
      <div className={`w-10 h-10 rounded-md flex items-center justify-center ${iconBg}`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
    </div>
  );
}

interface AdminStatsGridProps {
  stats: AdminDashboardStats;
}

export function AdminStatsGrid({ stats }: AdminStatsGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <StatCard
        label="Total Users"
        value={stats.total_users}
        icon={Users}
        iconBg="bg-navy-100"
        iconColor="text-navy-700"
      />
      <StatCard
        label="Total Files"
        value={stats.total_files}
        icon={FileText}
        iconBg="bg-gold-100"
        iconColor="text-gold-600"
      />
      <StatCard
        label="Validations Run"
        value={stats.total_validations}
        icon={CheckSquare}
        iconBg="bg-success-100"
        iconColor="text-success-600"
      />
      <StatCard
        label="Macro Jobs"
        value={stats.total_macro}
        icon={Zap}
        iconBg="bg-info-100"
        iconColor="text-info-600"
      />
    </div>
  );
}
