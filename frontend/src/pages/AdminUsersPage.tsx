import { useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { Link } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { SkeletonTable } from "@/components/ui/SkeletonLoader";
import { SlideDrawer } from "@/components/ui/SlideDrawer";
import { AdminCreateUserForm } from "@/features/admin/components/AdminCreateUserForm";
import { AdminEditUserForm } from "@/features/admin/components/AdminEditUserForm";
import { AdminPasswordForm } from "@/features/admin/components/AdminPasswordForm";
import { AdminUsersTable } from "@/features/admin/components/AdminUsersTable";
import { useAdminMutations } from "@/features/admin/useAdminMutations";
import { useAdminUsersQuery } from "@/features/admin/useAdminUsersQuery";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { AdminUser } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";

type AdminDrawerState =
  | { kind: "edit"; user: AdminUser }
  | { kind: "password"; user: AdminUser }
  | null;

export function AdminUsersPage() {
  // ── All hooks unconditionally at the top ──────────────────────────────────
  useDocumentTitle("Users — S4 Carlisle CMS");
  const usersQuery = useAdminUsersQuery(0, 100);
  const adminMutations = useAdminMutations();
  const [createOpen, setCreateOpen] = useState(false);
  const [drawerState, setDrawerState] = useState<AdminDrawerState>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // useMemo must be here — before any early returns — to keep hook call order stable
  const users = usersQuery.data?.users ?? [];
  const roles = usersQuery.data?.roles ?? [];
  const pagination = usersQuery.data?.pagination ?? { total: 0 };

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.toLowerCase();
    return users.filter(
      (u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, searchQuery]);

  // ── Early returns AFTER all hooks ────────────────────────────────────────
  if (usersQuery.isPending) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="h-14 skeleton-shimmer rounded-md" aria-hidden="true" />
          <div className="bg-white rounded-lg shadow-card overflow-hidden">
            <SkeletonTable rows={6} cols={5} />
          </div>
        </div>
      </main>
    );
  }

  if (usersQuery.isError) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Admin users unavailable"
            description={getApiErrorMessage(
              usersQuery.error,
              "The frontend shell could not load the admin users contract.",
            )}
          />
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button variant="primary" onClick={() => void usersQuery.refetch()}>
              Retry
            </Button>
            <Link to={uiPaths.adminDashboard}>
              <Button variant="secondary">Back to Admin</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page-enter min-h-screen bg-surface-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Page Header */}
        <PageHeader
          title="Users"
          subtitle={`${pagination.total} user${pagination.total === 1 ? "" : "s"}`}
          primaryAction={
            <Button
              variant="primary"
              leftIcon={<UserPlus />}
              onClick={() => setCreateOpen(true)}
            >
              New User
            </Button>
          }
        />

        {/* Status banner */}
        {adminMutations.status ? (
          <div
            className={`px-4 py-3 rounded-md text-sm font-medium border ${
              adminMutations.status.tone === "success"
                ? "bg-success-100 border-success-100 text-success-600"
                : adminMutations.status.tone === "error"
                  ? "bg-error-100 border-error-100 text-error-600"
                  : "bg-info-100 border-info-100 text-info-600"
            }`}
          >
            {adminMutations.status.message}
          </div>
        ) : null}

        {/* Filter bar */}
        <div className="flex items-center gap-3">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by username or email…"
            className="max-w-xs"
          />
          {searchQuery && (
            <Badge variant="default" size="sm">
              {filteredUsers.length} result{filteredUsers.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>

        {/* Users table */}
        {filteredUsers.length === 0 ? (
          <div className="bg-white rounded-lg shadow-card p-10">
            <EmptyState
              title={searchQuery ? "No users match your search" : "No users found"}
              description={
                searchQuery
                  ? "Try a different username or email address."
                  : "The current admin users contract returned an empty list."
              }
            />
          </div>
        ) : (
          <AdminUsersTable
            isPending={adminMutations.isPending}
            onDeleteUser={adminMutations.deleteUser}
            onOpenEditUser={(user) => setDrawerState({ kind: "edit", user })}
            onOpenPasswordUser={(user) => setDrawerState({ kind: "password", user })}
            onToggleStatus={adminMutations.toggleStatus}
            onUpdateRole={adminMutations.updateRole}
            roles={roles}
            users={filteredUsers}
          />
        )}
      </div>

      {/* Create User Modal */}
      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create New User"
        description="Add a new user account to the system."
        size="md"
      >
        <AdminCreateUserForm
          isPending={adminMutations.isPending("create")}
          onCancel={() => setCreateOpen(false)}
          onSubmit={async (payload) => {
            await adminMutations.createUser({
              username: payload.username,
              email: payload.email,
              password: payload.password,
              role_id: payload.roleId,
            });
            setCreateOpen(false);
          }}
          roles={roles}
        />
      </Modal>

      {/* Edit User — SlideDrawer */}
      <SlideDrawer
        isOpen={drawerState?.kind === "edit"}
        onClose={() => setDrawerState(null)}
        title={drawerState?.kind === "edit" ? `Edit: ${drawerState.user.username}` : "Edit User"}
        description="Update the user's email address."
        width="sm"
      >
        {drawerState?.kind === "edit" ? (
          <AdminEditUserForm
            isPending={adminMutations.isPending("edit", drawerState.user.id)}
            onCancel={() => setDrawerState(null)}
            onSubmit={async (email) => {
              await adminMutations.editUser(
                drawerState.user.id,
                email,
                drawerState.user.username,
              );
              setDrawerState(null);
            }}
            user={drawerState.user}
          />
        ) : null}
      </SlideDrawer>

      {/* Password — SlideDrawer */}
      <SlideDrawer
        isOpen={drawerState?.kind === "password"}
        onClose={() => setDrawerState(null)}
        title={
          drawerState?.kind === "password"
            ? `Change Password: ${drawerState.user.username}`
            : "Change Password"
        }
        description="Set a new password for this user."
        width="sm"
      >
        {drawerState?.kind === "password" ? (
          <AdminPasswordForm
            isPending={adminMutations.isPending("password", drawerState.user.id)}
            onCancel={() => setDrawerState(null)}
            onSubmit={async (password) => {
              await adminMutations.updatePassword(
                drawerState.user.id,
                password,
                drawerState.user.username,
              );
              setDrawerState(null);
            }}
            user={drawerState.user}
          />
        ) : null}
      </SlideDrawer>
    </main>
  );
}
