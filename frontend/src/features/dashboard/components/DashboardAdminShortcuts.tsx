import { BarChart3, Users } from "lucide-react";
import { Link } from "react-router-dom";

import { uiPaths } from "@/utils/appPaths";

type DashboardAdminShortcutsProps = {
  userId: number;
};

export function DashboardAdminShortcuts({ userId: _userId }: DashboardAdminShortcutsProps) {
  return (
    <section className="mb-6">
      <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
        Admin
      </h2>
      <div className="flex flex-wrap gap-3">
        <Link
          className="bg-sidebar/3 border border-border rounded-md p-4 flex items-center gap-3 hover:bg-sidebar/5 transition-colors cursor-pointer min-w-[160px]"
          to={uiPaths.adminUsers}
        >
          <Users className="w-5 h-5 text-text shrink-0" />
          <div>
            <p className="text-sm font-medium text-text">Manage Users</p>
            <p className="text-xs text-muted">Accounts &amp; roles</p>
          </div>
        </Link>

        <Link
          className="bg-sidebar/3 border border-border rounded-md p-4 flex items-center gap-3 hover:bg-sidebar/5 transition-colors cursor-pointer min-w-[160px]"
          to={uiPaths.adminDashboard}
        >
          <BarChart3 className="w-5 h-5 text-text shrink-0" />
          <div>
            <p className="text-sm font-medium text-text">Admin Dashboard</p>
            <p className="text-xs text-muted">System metrics</p>
          </div>
        </Link>
      </div>
    </section>
  );
}
