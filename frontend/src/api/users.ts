import api from './client'

export interface User {
  id: number
  user_name: string
  email: string
  active_status: boolean
  role: string
  team: string
  customer_access: string[]
}

export interface CreateUserPayload {
  user_name: string
  email: string
  password: string
  role: string
  team: string
  customer_access: string[]
  active_status?: boolean
}

export interface UpdateUserPayload {
  role?: string
  password?: string
  customer_access?: string[]
  team?: string
  active_status?: boolean
}

const mapUser = (u: any): User => ({
  id: u.id,
  user_name: u.username,
  email: u.email,
  active_status: u.is_active,
  role: u.roles?.[0]?.name ?? '',
  team: u.team ?? '',
  customer_access: u.customer_access ?? [],
})

export const usersApi = {
  list: (skip = 0, limit = 100) =>
    api.get<{ users: any[] }>('/admin/users', { params: { skip, limit } })
      .then(r => r.data.users.map(mapUser)),

  create: async (data: CreateUserPayload) => {
    const response = await api.post<any>('/users', {
      username: data.user_name,
      email: data.email,
      password: data.password,
      role: data.role,
      team: data.team,
      customer_access: data.customer_access,
      active_status: data.active_status ?? true,
    })
    return mapUser(response.data)
  },

  update: async (id: number, data: UpdateUserPayload) => {
    const payload: any = {}
    if (data.role) payload.role = data.role
    if (data.team) payload.team = data.team
    if (data.password) payload.password = data.password
    if (data.customer_access !== undefined) payload.customer_access = data.customer_access
    if (data.active_status !== undefined) payload.active_status = data.active_status

    const response = await api.put<any>(`/users/${id}`, payload)
    return mapUser(response.data)
  },

  setStatus: async (id: number, active_status: boolean) => {
    const response = await api.patch<any>(`/users/${id}/status`, { active_status })
    return mapUser(response.data)
  },

}
