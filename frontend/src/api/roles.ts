import api from './client'

export interface Role {
  id: number
  name: string
  description: string | null
}

export interface RolePayload {
  name: string
  description?: string
}

interface AdminRolesResponse {
  roles: Role[]
}

export const rolesApi = {
  list: () =>
    api.get<AdminRolesResponse>('/admin/roles').then(r => r.data.roles),

  listActive: () =>
    api.get<AdminRolesResponse>('/admin/roles').then(r => r.data.roles),

  create: (data: RolePayload) =>
    api.post<AdminRolesResponse>('/admin/roles', data).then(r => r.data.roles[0]),

  update: (id: number, data: Partial<RolePayload>) =>
    api.put<AdminRolesResponse>(`/admin/roles/${id}`, data).then(r => r.data.roles[0]),

  setStatus: (id: number, active_status: boolean) =>
    api.patch<AdminRolesResponse>(`/admin/roles/${id}/status`, { active_status }).then(r => r.data.roles[0]),

  remove: (id: number) =>
    api.delete(`/admin/roles/${id}`),
}
