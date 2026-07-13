import api from './client'

export interface Stage {
  id: number
  stage_name: string
  description: string | null
  sla_level1: number | null
  sla_level2: number | null
  sla_level3: number | null
  roles: string[]
  active_status: boolean
  created_at: string
}

export interface StagePayload {
  stage_name: string
  description?: string
  sla_level1?: number
  sla_level2?: number
  sla_level3?: number
  roles?: string[]
  active_status?: boolean
}

export const stagesApi = {
  list: () =>
    api.get<Stage[]>('/api/v1/stages').then(r => r.data),

  create: (data: StagePayload) =>
    api.post<Stage>('/api/v1/stages', data).then(r => r.data),

  update: (stageName: string, data: Partial<StagePayload>) =>
    api.put<Stage>(`/api/v1/stages/${encodeURIComponent(stageName)}`, data).then(r => r.data),

  setStatus: (stageName: string, active_status: boolean) =>
    api.patch<Stage>(`/api/v1/stages/${encodeURIComponent(stageName)}/status`, { active_status }).then(r => r.data),
}
