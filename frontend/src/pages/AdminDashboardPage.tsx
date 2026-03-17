import { Link } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { AdminStatsGrid } from "@/features/admin/components/AdminStatsGrid";
import { useAdminDashboardQuery } from "@/features/admin/useAdminDashboardQuery";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getSsrUrl, ssrPaths, uiPaths } from "@/utils/appPaths";

export function AdminDashboardPage() {
  useDocumentTitle("CMS UI Admin");
  const dashboardQuery = useAdminDashboardQuery();

  if (dashboardQuery.isPending) {
    return (
      <LoadingState
        title="Loading admin dashboard"
        message="Fetching the current /api/v2 admin dashboard contract."
      />
    );
  }

  if (dashboardQuery.isError) {
    return (
      <ErrorState
        title="Admin dashboard unavailable"
        message={getApiErrorMessage(
          dashboardQuery.error,
          "The frontend shell could not load the admin dashboard contract.",
        )}
        actions={
          <>
            <button className="button" onClick={() => void dashboardQuery.refetch()}>
              Retry
            </button>
            <a className="button button--secondary" href={getSsrUrl(ssrPaths.adminDashboard)}>
              Open SSR admin dashboard
            </a>
          </>
        }
      />
    );
  }

  const dashboard = dashboardQuery.data;

  return (
    <main className="page stack">
      <header className="page-header">
        <h1>Admin dashboard</h1>
        <p>Frontend shell using the existing /api/v2 admin dashboard contract.</p>
      </header>

      <AdminStatsGrid stats={dashboard.stats} />

      <section className="panel stack">
        <div className="section-title">
          <h2>Admin navigation</h2>
          <span className="helper-text">Viewer: {dashboard.viewer.username}</span>
        </div>
        <div className="upload-actions">
          <Link className="button" to={uiPaths.adminUsers}>
            Manage users
          </Link>
          <a className="button button--secondary" href={getSsrUrl(ssrPaths.adminUsers)}>
            Open SSR admin users
          </a>
        </div>
      </section>
    </main>
  );
}
