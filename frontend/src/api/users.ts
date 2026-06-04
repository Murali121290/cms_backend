import api from './client'

export interface User {
  id: number
  user_name: string
  email: string
  role: string
  team: string
  customer_access: string[]
  active_status: boolean
  created_at: string
  updated_at: string
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

export const usersApi = {
  list: (skip = 0, limit = 100) =>
    api.get<User[]>('/users/', { params: { skip, limit } }).then(r => r.data),

  create: (data: CreateUserPayload) =>
    api.post<User>('/users/', data).then(r => r.data),

  update: (id: number, data: UpdateUserPayload) =>
    api.put<User>(`/users/${id}`, data).then(r => r.data),

  setStatus: (id: number, active_status: boolean) =>
    api.patch<User>(`/users/${id}/status`, { active_status }).then(r => r.data),
}
