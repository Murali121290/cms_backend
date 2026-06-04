import api from './client'

export interface StageActivity {
  id: number
  stage_activity_name: string
  description: string | null
  active_status: boolean
  created_at: string
}

export interface Stage {
  id: number
  stage_name: string
  description: string | null
  stage_activities: StageActivity[]
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
  stage_activities: number[]
  sla_level1?: number
  sla_level2?: number
  sla_level3?: number
  roles?: string[]
  active_status?: boolean
}

export interface StageActivityPayload {
  stage_activity_name: string
  description?: string
  active_status?: boolean
}

export const stagesApi = {
  list: () =>
    api.get<Stage[]>('/stages/').then(r => r.data),

  create: (data: StagePayload) =>
    api.post<Stage>('/stages/', data).then(r => r.data),

  update: (stageName: string, data: Partial<StagePayload>) =>
    api.put<Stage>(`/stages/${encodeURIComponent(stageName)}`, data).then(r => r.data),

  setStatus: (stageName: string, active_status: boolean) =>
    api.patch<Stage>(`/stages/${encodeURIComponent(stageName)}/status`, { active_status }).then(r => r.data),
}

export const activitiesApi = {
  list: () =>
    api.get<StageActivity[]>('/stage-activities/').then(r => r.data),

  create: (data: StageActivityPayload) =>
    api.post<StageActivity>('/stage-activities/', data).then(r => r.data),

  update: (activityName: string, data: Partial<StageActivityPayload>) =>
    api.put<StageActivity>(`/stage-activities/${encodeURIComponent(activityName)}`, data).then(r => r.data),

  setStatus: (activityName: string, active_status: boolean) =>
    api.patch<StageActivity>(`/stage-activities/${encodeURIComponent(activityName)}/status`, { active_status }).then(r => r.data),
}
