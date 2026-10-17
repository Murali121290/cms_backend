import api from './client'

export interface TemplateVariable {
  key: string
  label: string
  description: string
  sample: string
  category: 'Chapter' | 'Workflow' | 'Project' | 'Contacts' | 'Teams' | string
}

export interface StageEmailConfig {
  enabled?: boolean
  custom_message: string
  to: string[]
  cc: string[]
  subject: string
  body: string
}

export interface CustomerSummary {
  client_code: string
  client_name: string
  is_custom: boolean
  has_file: boolean
  is_in_db?: boolean
  stages_count: number
  last_modified?: string | null
}

export interface StageInfo {
  stage_name: string
  description?: string | null
}

export interface CustomerConfigResponse {
  client_code: string
  client_name: string
  is_custom: boolean
  is_in_db?: boolean
  stages: Record<string, StageEmailConfig>
  all_system_stages: StageInfo[]
}

export interface TestEmailRequest {
  to_email: string
  subject: string
  body: string
  client_code?: string
  stage_name?: string
}

export interface TestEmailResponse {
  success: boolean
  message: string
  rendered_subject: string
  rendered_body: string
}

export const transitionNotificationsApi = {
  getVariables: (): Promise<TemplateVariable[]> =>
    api.get<TemplateVariable[]>('/api/v1/settings/stage-transitions/variables').then(r => r.data),

  listCustomers: (): Promise<CustomerSummary[]> =>
    api.get<CustomerSummary[]>('/api/v1/settings/stage-transitions').then(r => r.data),

  getCustomerConfig: (clientCode: string): Promise<CustomerConfigResponse> =>
    api.get<CustomerConfigResponse>(`/api/v1/settings/stage-transitions/${encodeURIComponent(clientCode)}`).then(r => r.data),

  saveCustomerConfig: (clientCode: string, stages: Record<string, StageEmailConfig>) =>
    api.put<{ success: boolean; message: string; client_code: string; is_custom: boolean }>(
      `/api/v1/settings/stage-transitions/${encodeURIComponent(clientCode)}`,
      { stages }
    ).then(r => r.data),

  initializeCustomerConfig: (clientCode: string) =>
    api.post<{ success: boolean; message: string; client_code: string }>(
      `/api/v1/settings/stage-transitions/${encodeURIComponent(clientCode)}/initialize`
    ).then(r => r.data),

  deleteCustomerConfig: (clientCode: string) =>
    api.delete<{ success: boolean; message: string; client_code: string }>(
      `/api/v1/settings/stage-transitions/${encodeURIComponent(clientCode)}`
    ).then(r => r.data),

  sendTestNotification: (payload: TestEmailRequest): Promise<TestEmailResponse> =>
    api.post<TestEmailResponse>('/api/v1/settings/stage-transitions/send-test', payload).then(r => r.data),

  addStage: (
    clientCode: string,
    payload: { stage_name: string; add_to_system_master?: boolean; enabled?: boolean; custom_message?: string; to?: string[]; cc?: string[]; subject?: string; body?: string }
  ) =>
    api.post<{ success: boolean; message: string; stage_name: string; stage_config: StageEmailConfig }>(
      `/api/v1/settings/stage-transitions/${encodeURIComponent(clientCode)}/stages`,
      payload
    ).then(r => r.data),

  deleteStage: (clientCode: string, stageName: string, disableOnly: boolean = false) =>
    api.delete<{ success: boolean; message: string; stage_name: string; disabled: boolean }>(
      `/api/v1/settings/stage-transitions/${encodeURIComponent(clientCode)}/stages/${encodeURIComponent(stageName)}`,
      { params: { disable_only: disableOnly } }
    ).then(r => r.data),

  syncAllToDb: () =>
    api.post<{ success: boolean; message: string; synced_clients: string[] }>(
      '/api/v1/settings/stage-transitions/sync-all-to-db'
    ).then(r => r.data),
}
