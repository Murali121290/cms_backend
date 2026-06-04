import api from './client'

export interface WorkflowStage {
  id: number
  workflow_name: string
  stage_name: string
  previous_stage: string | null
  next_stage: string | null
  description: string | null
  active_status: boolean
  created_at: string
  updated_at: string
}

export interface StageEntry {
  stage_name: string
  previous_stage: string | null
  next_stage: string | null
}

export interface WorkflowCreate {
  workflow_name: string
  description?: string | null
  active_status?: boolean
  stages: StageEntry[]
}

export interface WorkflowUpdate {
  workflow_name?: string
  description?: string | null
  active_status?: boolean
  stages: StageEntry[]
}

export const workflowsApi = {
  listNames: () =>
    api.get<string[]>('/workflows/').then(r => r.data),

  getAllStages: () =>
    api.get<WorkflowStage[]>('/workflows/all').then(r => r.data),

  getWorkflow: (workflowName: string) =>
    api.get<WorkflowStage[]>(`/workflows/${encodeURIComponent(workflowName)}`).then(r => r.data),

  create: (data: WorkflowCreate) =>
    api.post<WorkflowStage[]>('/workflows/', data).then(r => r.data),

  update: (workflowName: string, data: WorkflowUpdate) =>
    api.put<WorkflowStage[]>(`/workflows/${encodeURIComponent(workflowName)}`, data).then(r => r.data),

  delete: (workflowName: string) =>
    api.delete(`/workflows/${encodeURIComponent(workflowName)}`),

  getNextStage: (workflowName: string, stageName: string) =>
    api.get<{ next_stage: string | null }>(
      `/workflows/${encodeURIComponent(workflowName)}/next/${encodeURIComponent(stageName)}`
    ).then(r => r.data),

  getPreviousStage: (workflowName: string, stageName: string) =>
    api.get<{ previous_stage: string | null }>(
      `/workflows/${encodeURIComponent(workflowName)}/previous/${encodeURIComponent(stageName)}`
    ).then(r => r.data),
}
