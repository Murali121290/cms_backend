import { BarChart3, Users } from "lucide-react";
import { Link } from "react-router-dom";

import { uiPaths } from "@/utils/appPaths";

type DashboardAdminShortcutsProps = {
  userId: number;
};

export function DashboardAdminShortcuts({ userId: _userId }: DashboardAdminShortcutsProps) {
  return (
    <section className="mb-6">
      <h2 className="text-xs font-medium text-navy-500 uppercase tracking-wide mb-3">
        Admin
      </h2>
      <div className="flex flex-wrap gap-3">
        <Link
          className="bg-navy-50 border border-navy-100 rounded-md p-4 flex items-center gap-3 hover:bg-navy-100 transition-colors cursor-pointer min-w-[160px]"
          to={uiPaths.adminUsers}
        >
          <Users className="w-5 h-5 text-navy-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-navy-800">Manage Users</p>
            <p className="text-xs text-navy-500">Accounts &amp; roles</p>
          </div>
        </Link>

        <Link
          className="bg-navy-50 border border-navy-100 rounded-md p-4 flex items-center gap-3 hover:bg-navy-100 transition-colors cursor-pointer min-w-[160px]"
          to={uiPaths.adminDashboard}
        >
          <BarChart3 className="w-5 h-5 text-navy-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-navy-800">Admin Dashboard</p>
            <p className="text-xs text-navy-500">System metrics</p>
          </div>
        </Link>
      </div>
    </section>
  );
}
