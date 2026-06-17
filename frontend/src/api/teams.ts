import api from './client'

export interface Team {
  id: number
  name: string
  description: string | null
  owner_id: number | null
}

export interface TeamPayload {
  name: string
  description?: string
}

export const teamsApi = {
  list: () =>
    api.get<Team[]>('/api/v1/teams/').then(r => r.data),

  create: (data: TeamPayload) =>
    api.post<Team>('/api/v1/teams/', data).then(r => r.data),
}
