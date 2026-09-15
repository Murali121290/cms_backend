import api from './client'

export interface User {
  id: number
  user_name: string
  email: string
  first_name?: string
  last_name?: string
  active_status: boolean
  role: string
  designation: string
  team: string
  customer_access: string[]
  access_level?: string
}

export interface CreateUserPayload {
  user_name: string
  email: string
  first_name?: string
  last_name?: string
  password: string
  role?: string
  designation?: string
  team: string
  customer_access: string[]
  active_status?: boolean
  access_level?: string
}

export interface UpdateUserPayload {
  role?: string
  designation?: string
  first_name?: string
  last_name?: string
  password?: string
  customer_access?: string[]
  team?: string
  active_status?: boolean
  access_level?: string
}

const mapUser = (u: any): User => {
  const roleVal = u.role || ''
  let lvl = u.access_level || ''
  if (roleVal) {
    const l = roleVal.toLowerCase().replace(/[\s-]/g, '')
    if (l.includes('admin')) lvl = 'Admin'
    else if (l.includes('manager') || l.includes('gm')) lvl = 'Manager'
    else if (l.includes('teamlead') || l.includes('lead')) lvl = 'TeamLead'
    else lvl = 'Employee'
  } else {
    lvl = ''
  }
  return {
    id: u.id,
    user_name: u.username,
    email: u.email,
    first_name: u.first_name ?? '',
    last_name: u.last_name ?? '',
    active_status: u.is_active,
    role: roleVal,
    designation: u.designation ?? '',
    team: u.team ?? '',
    customer_access: u.customer_access ?? [],
    access_level: lvl,
  }
}

export const usersApi = {
  list: (skip = 0, limit = 1000) =>
    api.get<{ users: any[] }>('/admin/users', { params: { skip, limit } })
      .then(r => r.data.users.map(mapUser)),

  create: async (data: CreateUserPayload) => {
    const response = await api.post<any>('/users', {
      username: data.user_name,
      email: data.email,
      password: data.password,
      role: data.role,
      designation: data.designation,
      team: data.team,
      customer_access: data.customer_access,
      active_status: data.active_status ?? true,
    })
    return mapUser(response.data)
  },

  update: async (id: number, data: UpdateUserPayload) => {
    const payload: any = {}
    if (data.role !== undefined) payload.role = data.role
    if (data.designation !== undefined) payload.designation = data.designation
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
