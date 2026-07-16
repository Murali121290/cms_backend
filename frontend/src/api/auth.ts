import api from './client'

export interface AuthUser {
  id:       number
  username: string
  email:    string
  roles:    Array<{ name: string } | string>
}

export interface LoginPayload {
  username: string
  password: string
}

export interface LoginResponse {
  user: AuthUser
}

export const authApi = {
  login: (payload: { username: string; password: string }) =>
    api.post<LoginResponse>('/session/login', payload).then(r => r.data),

  me: () =>
    api.get<AuthUser>('/session').then(r => r.data),

  logout: () =>
    api.delete('/session').catch(() => null),

  refresh: () =>
    api.post<LoginResponse>('/session/refresh').then(r => r.data),

  checkActiveLocks: () =>
    api.get<{ has_active_locks: boolean }>('/session/active-locks').then(r => r.data),
}
