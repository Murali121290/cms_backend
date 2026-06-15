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
    const systemRoles = await api.get<{ roles: { id: number; name: string }[] }>('/admin/roles').then(r => r.data.roles)
    let systemRoleName = 'Editor'
    const teamRole = data.role.toLowerCase()
    if (teamRole === 'admin') {
      systemRoleName = 'Admin'
    } else if (teamRole === 'manager' || teamRole === 'operations_manager') {
      systemRoleName = 'ProjectManager'
    }
    const matched = systemRoles.find(r => r.name.toLowerCase() === systemRoleName.toLowerCase())
    const roleId = matched ? matched.id : (systemRoles[0]?.id ?? 3)

    const response = await api.post<{ user: any }>('/admin/users', {
      username: data.user_name,
      email: data.email,
      password: data.password,
      role_id: roleId,
      team_name: data.team,
      customer_access: data.customer_access,
    })
    return mapUser(response.data.user)
  },

  update: async (id: number, data: UpdateUserPayload) => {
    let updatedUser: any = null

    if (data.active_status !== undefined) {
      const res = await api.put<{ user: any }>(`/admin/users/${id}/status`, { is_active: data.active_status })
      updatedUser = res.data.user
    }

    if (data.password) {
      await api.put(`/admin/users/${id}/password`, { new_password: data.password })
    }

    if (data.customer_access !== undefined) {
      const res = await api.patch<{ user: any }>(`/admin/users/${id}`, { customer_access: data.customer_access })
      updatedUser = res.data.user
    }

    if (data.role || data.team) {
      const systemRoles = await api.get<{ roles: { id: number; name: string }[] }>('/admin/roles').then(r => r.data.roles)
      let systemRoleName = 'Editor'
      const teamRole = data.role?.toLowerCase() ?? ''
      if (teamRole === 'admin') {
        systemRoleName = 'Admin'
      } else if (teamRole === 'manager' || teamRole === 'operations_manager') {
        systemRoleName = 'ProjectManager'
      }
      const matched = systemRoles.find(r => r.name.toLowerCase() === systemRoleName.toLowerCase())
      const roleId = matched ? matched.id : (systemRoles[0]?.id ?? 3)

      const res = await api.put<{ user: any }>(`/admin/users/${id}/role`, {
        role_id: roleId,
        team_name: data.team,
      })
      updatedUser = res.data.user
    }

    if (!updatedUser) {
      const usersRes = await api.get<{ users: any[] }>('/admin/users')
      const matched = usersRes.data.users.find((u: any) => u.id === id)
      if (matched) {
        updatedUser = matched
      }
    }

    return mapUser(updatedUser)
  },

  setStatus: async (id: number, active_status: boolean) => {
    await api.put(`/admin/users/${id}/status`, { is_active: active_status })
    const usersRes = await api.get<{ users: any[] }>('/admin/users')
    const matched = usersRes.data.users.find((u: any) => u.id === id)
    if (!matched) {
      throw new Error('User not found after status update')
    }
    return mapUser(matched)
  },
}
