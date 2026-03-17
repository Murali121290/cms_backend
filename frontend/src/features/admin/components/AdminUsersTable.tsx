import { useState } from "react";

import type { AdminRole, AdminUser } from "@/types/api";

type AdminActionKind = "create" | "role" | "status" | "edit" | "password" | "delete";

interface AdminUsersTableProps {
  users: AdminUser[];
  roles: AdminRole[];
  isPending: (action: AdminActionKind, userId?: number | null) => boolean;
  onUpdateRole: (userId: number, roleId: number, username: string) => Promise<unknown>;
  onToggleStatus: (userId: number, isActive: boolean, username: string) => Promise<unknown>;
  onEditUser: (userId: number, email: string, username: string) => Promise<unknown>;
  onUpdatePassword: (userId: number, password: string, username: string) => Promise<unknown>;
  onDeleteUser: (userId: number, username: string) => Promise<unknown>;
}

function AdminUserRow({
  user,
  roles,
  isPending,
  onUpdateRole,
  onToggleStatus,
  onEditUser,
  onUpdatePassword,
  onDeleteUser,
}: {
  user: AdminUser;
  roles: AdminRole[];
  isPending: AdminUsersTableProps["isPending"];
  onUpdateRole: AdminUsersTableProps["onUpdateRole"];
  onToggleStatus: AdminUsersTableProps["onToggleStatus"];
  onEditUser: AdminUsersTableProps["onEditUser"];
  onUpdatePassword: AdminUsersTableProps["onUpdatePassword"];
  onDeleteUser: AdminUsersTableProps["onDeleteUser"];
}) {
  const [selectedRoleId, setSelectedRoleId] = useState<number>(user.roles[0]?.id ?? roles[0]?.id ?? 0);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");

  return (
    <tr>
      <td>{user.username}</td>
      <td>
        <input
          className="table-input"
          disabled={isPending("edit", user.id)}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </td>
      <td>{user.roles.map((role) => role.name).join(", ")}</td>
      <td>{user.is_active ? "Active" : "Inactive"}</td>
      <td>
        <div className="table-actions">
          <select
            className="select-input table-select"
            disabled={isPending("role", user.id)}
            value={selectedRoleId}
            onChange={(event) => setSelectedRoleId(Number.parseInt(event.target.value, 10))}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          <button
            className="button button--secondary button--small"
            disabled={isPending("role", user.id)}
            type="button"
            onClick={() => void onUpdateRole(user.id, selectedRoleId, user.username)}
          >
            {isPending("role", user.id) ? "Updating..." : "Update role"}
          </button>
          <button
            className="button button--secondary button--small"
            disabled={isPending("status", user.id)}
            type="button"
            onClick={() => void onToggleStatus(user.id, !user.is_active, user.username)}
          >
            {isPending("status", user.id)
              ? "Updating..."
              : user.is_active
                ? "Disable"
                : "Enable"}
          </button>
          <button
            className="button button--secondary button--small"
            disabled={isPending("edit", user.id)}
            type="button"
            onClick={() => void onEditUser(user.id, email, user.username)}
          >
            {isPending("edit", user.id) ? "Saving..." : "Save email"}
          </button>
          <input
            className="table-input"
            disabled={isPending("password", user.id)}
            placeholder="New password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            className="button button--secondary button--small"
            disabled={isPending("password", user.id) || password.length === 0}
            type="button"
            onClick={async () => {
              await onUpdatePassword(user.id, password, user.username);
              setPassword("");
            }}
          >
            {isPending("password", user.id) ? "Updating..." : "Update password"}
          </button>
          <button
            className="button button--secondary button--small"
            disabled={isPending("delete", user.id)}
            type="button"
            onClick={() => void onDeleteUser(user.id, user.username)}
          >
            {isPending("delete", user.id) ? "Deleting..." : "Delete"}
          </button>
        </div>
      </td>
    </tr>
  );
}

export function AdminUsersTable({
  users,
  roles,
  isPending,
  onUpdateRole,
  onToggleStatus,
  onEditUser,
  onUpdatePassword,
  onDeleteUser,
}: AdminUsersTableProps) {
  return (
    <div className="panel">
      <table className="list-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Email</th>
            <th>Roles</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <AdminUserRow
              isPending={isPending}
              key={user.id}
              onDeleteUser={onDeleteUser}
              onEditUser={onEditUser}
              onToggleStatus={onToggleStatus}
              onUpdatePassword={onUpdatePassword}
              onUpdateRole={onUpdateRole}
              roles={roles}
              user={user}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
