import { Link } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { AdminCreateUserForm } from "@/features/admin/components/AdminCreateUserForm";
import { AdminUsersTable } from "@/features/admin/components/AdminUsersTable";
import { useAdminMutations } from "@/features/admin/useAdminMutations";
import { useAdminUsersQuery } from "@/features/admin/useAdminUsersQuery";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getSsrUrl, ssrPaths, uiPaths } from "@/utils/appPaths";

export function AdminUsersPage() {
  useDocumentTitle("CMS UI Admin Users");
  const usersQuery = useAdminUsersQuery(0, 100);
  const adminMutations = useAdminMutations();

  if (usersQuery.isPending) {
    return (
      <LoadingState
        title="Loading admin users"
        message="Fetching the current /api/v2 admin users contract."
      />
    );
  }

  if (usersQuery.isError) {
    return (
      <ErrorState
        title="Admin users unavailable"
        message={getApiErrorMessage(
          usersQuery.error,
          "The frontend shell could not load the admin users contract.",
        )}
        actions={
          <>
            <button className="button" onClick={() => void usersQuery.refetch()}>
              Retry
            </button>
            <Link className="button button--secondary" to={uiPaths.adminDashboard}>
              Back to admin
            </Link>
            <a className="button button--secondary" href={getSsrUrl(ssrPaths.adminUsers)}>
              Open SSR admin users
            </a>
          </>
        }
      />
    );
  }

  const { users, roles, pagination } = usersQuery.data;

  return (
    <main className="page stack">
      <header className="page-header">
        <h1>Admin users</h1>
        <p>Minimal admin frontend over the existing /api/v2 admin contracts and current backend behavior.</p>
      </header>

      <section className="panel stack">
        <div className="section-title">
          <h2>Overview</h2>
          <div className="upload-actions">
            <Link className="button button--secondary" to={uiPaths.adminDashboard}>
              Back to admin
            </Link>
            <a className="button button--secondary" href={getSsrUrl(ssrPaths.adminUsers)}>
              Open SSR admin users
            </a>
          </div>
        </div>
        <div className="helper-text">
          {pagination.total} user{pagination.total === 1 ? "" : "s"} loaded from /api/v2/admin/users.
        </div>
      </section>

      {adminMutations.status ? (
        <div className={`status-banner status-banner--${adminMutations.status.tone}`}>
          {adminMutations.status.message}
        </div>
      ) : null}

      <AdminCreateUserForm
        isPending={adminMutations.isPending("create")}
        onSubmit={(payload) =>
          adminMutations.createUser({
            username: payload.username,
            email: payload.email,
            password: payload.password,
            role_id: payload.roleId,
          })
        }
        roles={roles}
      />

      {users.length === 0 ? (
        <EmptyState
          title="No users found"
          message="The current admin users contract returned an empty list."
        />
      ) : (
        <AdminUsersTable
          isPending={adminMutations.isPending}
          onDeleteUser={adminMutations.deleteUser}
          onEditUser={adminMutations.editUser}
          onToggleStatus={adminMutations.toggleStatus}
          onUpdatePassword={adminMutations.updatePassword}
          onUpdateRole={adminMutations.updateRole}
          roles={roles}
          users={users}
        />
      )}
    </main>
  );
}
