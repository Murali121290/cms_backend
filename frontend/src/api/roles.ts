import api from './client'

export interface Role {
  id: number
  role_name: string
  team: string
  description: string | null
  active_status: boolean
  created_at: string
}

export interface RolePayload {
  role_name: string
  team: string
  description?: string
  active_status?: boolean
}

export const rolesApi = {
  list: () =>
    api.get<Role[]>('/roles/').then(r => r.data),

  listActive: () =>
    api.get<Role[]>('/roles/active').then(r => r.data),

  create: (data: RolePayload) =>
    api.post<Role>('/roles/', data).then(r => r.data),

  update: (id: number, data: Partial<RolePayload>) =>
    api.put<Role>(`/roles/${id}`, data).then(r => r.data),

  setStatus: (id: number, active_status: boolean) =>
    api.patch<Role>(`/roles/${id}/status`, { active_status }).then(r => r.data),

  remove: (id: number) =>
    api.delete(`/roles/${id}`),
}
