import { Link } from "react-router-dom";
import { uiPaths } from "@/utils/appPaths";

type DashboardAdminShortcutsProps = {
  userId: number;
};

const pillCls =
  "text-xs font-medium px-3 py-1 rounded-full border border-border text-muted hover:border-primary hover:text-primary bg-card transition-colors";

export function DashboardAdminShortcuts({ userId: _userId }: DashboardAdminShortcutsProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-6">
      <span className="text-xs font-semibold text-muted mr-1">Admin:</span>
      <Link to={uiPaths.adminUsers} className={pillCls}>Manage Users</Link>
      <Link to="/settings/stages" className={pillCls}>Stages</Link>
      <Link to="/settings/roles" className={pillCls}>Roles</Link>
      <Link to="/settings/workflow" className={pillCls}>Workflows</Link>
      <Link to="/settings/customers" className={pillCls}>Customers</Link>
    </div>
  );
}
