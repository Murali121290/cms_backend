import { apiClient } from "@/api/client";
import type {
  AdminCreateUserRequest,
  AdminCreateUserResponse,
  AdminDashboardResponse,
  AdminEditUserRequest,
  AdminEditUserResponse,
  AdminPasswordUpdateRequest,
  AdminPasswordUpdateResponse,
  AdminRolesResponse,
  AdminUpdateRoleRequest,
  AdminUpdateRoleResponse,
  AdminUpdateStatusRequest,
  AdminUpdateStatusResponse,
  AdminUsersResponse,
  AdminDeleteUserResponse,
} from "@/types/api";

export async function getAdminDashboard() {
  const response = await apiClient.get<AdminDashboardResponse>("/admin/dashboard");
  return response.data;
}

export async function getAdminUsers(offset = 0, limit = 100) {
  const response = await apiClient.get<AdminUsersResponse>("/admin/users", {
    params: { offset, limit },
  });
  return response.data;
}

export async function getAdminRoles() {
  const response = await apiClient.get<AdminRolesResponse>("/admin/roles");
  return response.data;
}

export async function createAdminUser(payload: AdminCreateUserRequest) {
  const response = await apiClient.post<AdminCreateUserResponse>("/admin/users", payload);
  return response.data;
}

export async function updateAdminUserRole(userId: number, payload: AdminUpdateRoleRequest) {
  const response = await apiClient.put<AdminUpdateRoleResponse>(`/admin/users/${userId}/role`, payload);
  return response.data;
}

export async function updateAdminUserStatus(userId: number, payload: AdminUpdateStatusRequest) {
  const response = await apiClient.put<AdminUpdateStatusResponse>(`/admin/users/${userId}/status`, payload);
  return response.data;
}

export async function editAdminUser(userId: number, payload: AdminEditUserRequest) {
  const response = await apiClient.patch<AdminEditUserResponse>(`/admin/users/${userId}`, payload);
  return response.data;
}

export async function updateAdminUserPassword(userId: number, payload: AdminPasswordUpdateRequest) {
  const response = await apiClient.put<AdminPasswordUpdateResponse>(
    `/admin/users/${userId}/password`,
    payload,
  );
  return response.data;
}

export async function deleteAdminUser(userId: number) {
  const response = await apiClient.delete<AdminDeleteUserResponse>(`/admin/users/${userId}`);
  return response.data;
}
