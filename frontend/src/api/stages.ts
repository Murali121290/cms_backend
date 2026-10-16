import api from './client'

export interface Stage {
  id: number
  stage_name: string
  description: string | null
  sla_level1: number | null
  sla_level2: number | null
  sla_level3: number | null
  pages_level1: number | null
  pages_level2: number | null
  pages_level3: number | null
  roles: string[]
  processing_actions: string[]
  active_status: boolean
  created_at: string
}

export interface StagePayload {
  stage_name: string
  description?: string
  sla_level1?: number | null
  sla_level2?: number | null
  sla_level3?: number | null
  pages_level1?: number | null
  pages_level2?: number | null
  pages_level3?: number | null
  roles?: string[]
  processing_actions?: string[]
  active_status?: boolean
}

export interface ProcessingActionDefinition {
  key: string
  label: string
  description: string
  icon: string
  category?: string
}

export interface ProcessingActionsMappingResponse {
  definitions: ProcessingActionDefinition[]
  mapping: Record<string, string[]>
  stages: { id: number; stage_name: string; active_status: boolean; processing_actions: string[] }[]
  success?: boolean
  message?: string
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

  getDefinitions: () =>
    api.get<ProcessingActionDefinition[]>('/api/v1/stages/processing-actions/definitions').then(r => r.data),

  getMapping: () =>
    api.get<ProcessingActionsMappingResponse>('/api/v1/stages/processing-actions/mapping').then(r => r.data),

  updateMapping: (mapping: Record<string, string[]>) =>
    api.put<ProcessingActionsMappingResponse>('/api/v1/stages/processing-actions/mapping', { mapping }).then(r => r.data),
}
