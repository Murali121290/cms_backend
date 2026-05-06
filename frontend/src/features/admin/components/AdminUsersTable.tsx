import { useState } from "react";
import { Edit2, KeyRound, Trash2, UserCheck, UserX } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/utils/cn";
import type { AdminRole, AdminUser } from "@/types/api";

type AdminActionKind = "create" | "role" | "status" | "edit" | "password" | "delete";

interface AdminUsersTableProps {
  users: AdminUser[];
  roles: AdminRole[];
  isPending: (action: AdminActionKind, userId?: number | null) => boolean;
  onUpdateRole: (userId: number, roleId: number, username: string) => Promise<unknown>;
  onToggleStatus: (userId: number, isActive: boolean, username: string) => Promise<unknown>;
  onDeleteUser: (userId: number, username: string) => Promise<unknown>;
  onOpenEditUser: (user: AdminUser) => void;
  onOpenPasswordUser: (user: AdminUser) => void;
}

/** Deterministic avatar background + text color from username */
const AVATAR_PALETTES = [
  { bg: "bg-blue-100", text: "text-blue-700" },
  { bg: "bg-purple-100", text: "text-purple-700" },
  { bg: "bg-green-100", text: "text-green-700" },
  { bg: "bg-amber-100", text: "text-amber-700" },
  { bg: "bg-rose-100", text: "text-rose-700" },
  { bg: "bg-teal-100", text: "text-teal-700" },
  { bg: "bg-indigo-100", text: "text-indigo-700" },
];

function avatarPalette(username: string) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
}

function initials(value: string) {
  return value.trim().slice(0, 2).toUpperCase();
}

/** Map role name → Badge variant */
function roleBadgeVariant(roleName: string): "error" | "info" | "default" {
  const lower = roleName.toLowerCase();
  if (lower === "admin") return "error";
  if (lower === "editor") return "info";
  return "default";
}

function AdminUserRow({
  user,
  roles,
  isPending,
  onUpdateRole,
  onToggleStatus,
  onDeleteUser,
  onOpenEditUser,
  onOpenPasswordUser,
}: {
  user: AdminUser;
  roles: AdminRole[];
  isPending: AdminUsersTableProps["isPending"];
  onUpdateRole: AdminUsersTableProps["onUpdateRole"];
  onToggleStatus: AdminUsersTableProps["onToggleStatus"];
  onDeleteUser: AdminUsersTableProps["onDeleteUser"];
  onOpenEditUser: AdminUsersTableProps["onOpenEditUser"];
  onOpenPasswordUser: AdminUsersTableProps["onOpenPasswordUser"];
}) {
  const [selectedRoleId, setSelectedRoleId] = useState<number>(
    user.roles[0]?.id ?? roles[0]?.id ?? 0,
  );
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteEmailInput, setDeleteEmailInput] = useState("");

  const palette = avatarPalette(user.username);

  return (
    <>
      <tr className="border-b border-surface-300 hover:bg-surface-100 transition-colors duration-100">
        {/* User cell */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0",
                palette.bg,
                palette.text,
              )}
            >
              {initials(user.username)}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-navy-900 truncate">{user.username}</div>
              <div className="text-xs text-navy-400">ID {user.id}</div>
            </div>
          </div>
        </td>

        {/* Email cell */}
        <td className="px-4 py-3">
          <span className="text-sm text-navy-600">{user.email}</span>
        </td>

        {/* Role cell */}
        <td className="px-4 py-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap gap-1">
              {user.roles.length > 0 ? (
                user.roles.map((role) => (
                  <Badge
                    key={`${user.id}-${role.id}`}
                    variant={roleBadgeVariant(role.name)}
                    size="sm"
                  >
                    {role.name}
                  </Badge>
                ))
              ) : (
                <Badge variant="outline" size="sm">
                  No roles
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <select
                className="text-xs border border-surface-400 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-gold-600 disabled:opacity-50"
                disabled={isPending("role", user.id)}
                value={selectedRoleId}
                onChange={(e) => setSelectedRoleId(Number.parseInt(e.target.value, 10))}
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <button
                className="text-xs px-2 py-1 border border-surface-400 rounded hover:bg-surface-200 disabled:opacity-50 text-navy-700 transition-colors"
                disabled={isPending("role", user.id)}
                type="button"
                onClick={() => void onUpdateRole(user.id, selectedRoleId, user.username)}
              >
                {isPending("role", user.id) ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </td>

        {/* Status cell */}
        <td className="px-4 py-3">
          <Badge variant={user.is_active ? "success" : "default"} size="sm">
            {user.is_active ? "Active" : "Inactive"}
          </Badge>
        </td>

        {/* Actions cell */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            {/* Edit email */}
            <button
              aria-label={`Edit ${user.username}`}
              className="p-1.5 rounded hover:bg-surface-200 text-navy-500 hover:text-navy-900 transition-colors"
              type="button"
              onClick={() => onOpenEditUser(user)}
            >
              <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            {/* Change password */}
            <button
              aria-label={`Change password for ${user.username}`}
              className="p-1.5 rounded hover:bg-surface-200 text-navy-500 hover:text-navy-900 transition-colors"
              type="button"
              onClick={() => onOpenPasswordUser(user)}
            >
              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            {/* Toggle status */}
            <button
              aria-label={`${user.is_active ? "Disable" : "Enable"} ${user.username}`}
              className="p-1.5 rounded hover:bg-surface-200 text-navy-500 hover:text-navy-900 transition-colors disabled:opacity-50"
              disabled={isPending("status", user.id)}
              type="button"
              onClick={() => setConfirmToggle(true)}
            >
              {user.is_active ? (
                <UserX className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>

            {/* Delete */}
            <button
              aria-label={`Delete ${user.username}`}
              className="p-1.5 rounded hover:bg-error-100 text-navy-400 hover:text-error-600 transition-colors disabled:opacity-50"
              disabled={isPending("delete", user.id)}
              type="button"
              onClick={() => {
                setDeleteEmailInput("");
                setConfirmDelete(true);
              }}
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </td>
      </tr>

      {/* Toggle confirm */}
      <ConfirmDialog
        isOpen={confirmToggle}
        onClose={() => setConfirmToggle(false)}
        onConfirm={() => {
          setConfirmToggle(false);
          void onToggleStatus(user.id, !user.is_active, user.username);
        }}
        title={user.is_active ? `Disable ${user.username}?` : `Enable ${user.username}?`}
        description={
          user.is_active
            ? `This will prevent ${user.username} from logging in.`
            : `This will allow ${user.username} to log in again.`
        }
        confirmLabel={user.is_active ? "Disable" : "Enable"}
        variant={user.is_active ? "warning" : "warning"}
        isLoading={isPending("status", user.id)}
      />

      {/* Delete confirm — requires email typing */}
      <Modal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${user.username}?`}
        description={`This action cannot be undone. Type the user's email address to confirm.`}
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="ghost" type="button" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              type="button"
              disabled={deleteEmailInput.trim() !== user.email || isPending("delete", user.id)}
              isLoading={isPending("delete", user.id)}
              onClick={() => {
                setConfirmDelete(false);
                void onDeleteUser(user.id, user.username);
              }}
            >
              Delete user
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-navy-600">
            You are about to permanently delete{" "}
            <span className="font-semibold text-navy-900">{user.username}</span>{" "}
            (<span className="font-mono text-xs">{user.email}</span>).
          </p>
          <div>
            <label className="block text-xs font-medium text-navy-700 mb-1.5">
              Type <span className="font-mono font-semibold">{user.email}</span> to confirm
            </label>
            <input
              type="email"
              className="w-full border border-surface-400 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-error-500 focus:border-transparent"
              placeholder={user.email}
              value={deleteEmailInput}
              autoComplete="off"
              onChange={(e) => setDeleteEmailInput(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}

export function AdminUsersTable({
  users,
  roles,
  isPending,
  onUpdateRole,
  onToggleStatus,
  onDeleteUser,
  onOpenEditUser,
  onOpenPasswordUser,
}: AdminUsersTableProps) {
  return (
    <div className="bg-white rounded-lg shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface-100 border-b border-surface-400">
              <th className="px-4 py-3 text-xs font-semibold text-navy-500 uppercase tracking-wide">
                User
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-navy-500 uppercase tracking-wide">
                Email
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-navy-500 uppercase tracking-wide">
                Role
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-navy-500 uppercase tracking-wide">
                Status
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-navy-500 uppercase tracking-wide text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <AdminUserRow
                isPending={isPending}
                key={user.id}
                onDeleteUser={onDeleteUser}
                onOpenEditUser={onOpenEditUser}
                onOpenPasswordUser={onOpenPasswordUser}
                onToggleStatus={onToggleStatus}
                onUpdateRole={onUpdateRole}
                roles={roles}
                user={user}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
