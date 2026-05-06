import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  createAdminUser,
  deleteAdminUser,
  editAdminUser,
  updateAdminUserPassword,
  updateAdminUserRole,
  updateAdminUserStatus,
} from "@/api/admin";
import { getApiErrorMessage } from "@/api/client";
import type { AdminCreateUserRequest } from "@/types/api";

type AdminActionKind =
  | "create"
  | "role"
  | "status"
  | "edit"
  | "password"
  | "delete";

type AdminActionTone = "pending" | "success" | "error";

interface AdminActionStatus {
  tone: AdminActionTone;
  action: AdminActionKind;
  userId?: number | null;
  message: string;
}

export function useAdminMutations() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AdminActionStatus | null>(null);
  const [activeAction, setActiveAction] = useState<{
    action: AdminActionKind;
    userId?: number | null;
  } | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: AdminCreateUserRequest) => createAdminUser(payload),
  });
  const roleMutation = useMutation({
    mutationFn: ({ userId, roleId }: { userId: number; roleId: number }) =>
      updateAdminUserRole(userId, { role_id: roleId }),
  });
  const statusMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: number; isActive: boolean }) =>
      updateAdminUserStatus(userId, { is_active: isActive }),
  });
  const editMutation = useMutation({
    mutationFn: ({ userId, email }: { userId: number; email: string }) =>
      editAdminUser(userId, { email }),
  });
  const passwordMutation = useMutation({
    mutationFn: ({ userId, newPassword }: { userId: number; newPassword: string }) =>
      updateAdminUserPassword(userId, { new_password: newPassword }),
  });
  const deleteMutation = useMutation({
    mutationFn: (userId: number) => deleteAdminUser(userId),
  });

  async function refreshAdminState() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
      queryClient.invalidateQueries({ queryKey: ["session"] }),
    ]);
  }

  function isPending(action: AdminActionKind, userId?: number | null) {
    return activeAction?.action === action && activeAction?.userId === (userId ?? null);
  }

  async function runAction<T>({
    action,
    userId,
    pendingMessage,
    successMessage,
    execute,
  }: {
    action: AdminActionKind;
    userId?: number | null;
    pendingMessage: string;
    successMessage: string;
    execute: () => Promise<T>;
  }) {
    setActiveAction({ action, userId: userId ?? null });
    setStatus({
      tone: "pending",
      action,
      userId,
      message: pendingMessage,
    });

    try {
      const response = await execute();
      await refreshAdminState();
      setStatus({
        tone: "success",
        action,
        userId,
        message: successMessage,
      });
      return response;
    } catch (error) {
      setStatus({
        tone: "error",
        action,
        userId,
        message: getApiErrorMessage(error, `Failed to perform admin ${action} action.`),
      });
      throw error;
    } finally {
      setActiveAction(null);
    }
  }

  return {
    status,
    isPending,
    clearStatus: () => setStatus(null),
    createUser: (payload: AdminCreateUserRequest) =>
      runAction({
        action: "create",
        pendingMessage: `Creating ${payload.username}...`,
        successMessage: `Created ${payload.username}.`,
        execute: () => createMutation.mutateAsync(payload),
      }),
    updateRole: (userId: number, roleId: number, username: string) =>
      runAction({
        action: "role",
        userId,
        pendingMessage: `Updating role for ${username}...`,
        successMessage: `Updated role for ${username}.`,
        execute: () => roleMutation.mutateAsync({ userId, roleId }),
      }),
    toggleStatus: (userId: number, isActive: boolean, username: string) =>
      runAction({
        action: "status",
        userId,
        pendingMessage: `${isActive ? "Enabling" : "Disabling"} ${username}...`,
        successMessage: `${isActive ? "Enabled" : "Disabled"} ${username}.`,
        execute: () => statusMutation.mutateAsync({ userId, isActive }),
      }),
    editUser: (userId: number, email: string, username: string) =>
      runAction({
        action: "edit",
        userId,
        pendingMessage: `Updating ${username}...`,
        successMessage: `Updated ${username}.`,
        execute: () => editMutation.mutateAsync({ userId, email }),
      }),
    updatePassword: (userId: number, newPassword: string, username: string) =>
      runAction({
        action: "password",
        userId,
        pendingMessage: `Updating password for ${username}...`,
        successMessage: `Password updated for ${username}.`,
        execute: () => passwordMutation.mutateAsync({ userId, newPassword }),
      }),
    deleteUser: (userId: number, username: string) =>
      runAction({
        action: "delete",
        userId,
        pendingMessage: `Deleting ${username}...`,
        successMessage: `Deleted ${username}.`,
        execute: () => deleteMutation.mutateAsync(userId),
      }),
  };
}
