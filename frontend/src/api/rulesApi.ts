import apiClient from './client'

export type RuleCategory = 'grammar' | 'spelling' | 'sentence' | 'compounds' | 'inclusive' | string
export type RuleSeverity = 'error' | 'warning' | 'suggestion' | string

export interface LanguageRule {
  id: string
  category: RuleCategory
  type?: string
  pattern?: string
  replacement?: string
  message?: string
  severity?: RuleSeverity
  enabled?: boolean
  // Pass-through for any extra engine fields we don't care about in the UI.
  [k: string]: unknown
}

export interface ActiveRulesConfig {
  project_id?: number
  project_code?: string
  profile_key?: string
  profile_keys?: string[]
  name?: string
  description?: string
  rules: LanguageRule[]
  variant_to_canonical?: Record<string, string>
}

export interface AvailableProfiles {
  [profileKey: string]: {
    name?: string
    description?: string
    rules?: LanguageRule[]
    variant_to_canonical?: Record<string, string>
    [k: string]: unknown
  }
}

export interface RulesPayload {
  active_rules: ActiveRulesConfig
  available_profiles: AvailableProfiles
}

export interface SaveRulesBody {
  profile_key?: string
  profile_keys?: string[]
  rules?: LanguageRule[]
  variant_to_canonical?: Record<string, string>
  profile_name?: string
  note?: string
}

export interface RuleHistoryEntry {
  id: number
  changed_at: string | null
  changed_by_id: number | null
  changed_by_username: string | null
  profile_key: string | null
  enabled_rule_ids: string[]
  disabled_rule_ids: string[]
  enabled_count: number
  disabled_count: number
  note: string | null
}

export const rulesApi = {
  get: (projectId: number | string) =>
    apiClient.get<RulesPayload>(`/projects/${projectId}/language-rules`).then((r) => r.data),

  save: (projectId: number | string, body: SaveRulesBody) =>
    apiClient
      .post<{ ok: boolean; rules: ActiveRulesConfig }>(
        `/projects/${projectId}/language-rules`,
        body,
      )
      .then((r) => r.data),

  history: (projectId: number | string, limit = 50) =>
    apiClient
      .get<{ project_id: number; history: RuleHistoryEntry[] }>(
        `/projects/${projectId}/language-rules/history`,
        { params: { limit } },
      )
      .then((r) => r.data),

  /** Fetch the raw stored config as a formatted JSON string (for the View JSON modal). */
  viewJson: (projectId: number | string) =>
    apiClient
      .get<string>(`/projects/${projectId}/language-rules/export`, {
        responseType: 'text',
        transformResponse: (data) => data,
      })
      .then((r) => r.data as unknown as string),

  /** Trigger a browser download of the project's rules JSON. */
  downloadJson: (projectId: number | string, projectCode?: string) =>
    apiClient
      .get<Blob>(`/projects/${projectId}/language-rules/export`, {
        params: { download: true },
        responseType: 'blob',
      })
      .then((r) => {
        const blob = new Blob([r.data], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${projectCode || `project-${projectId}`}_language_rules.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }),

  /** Download the project's rules as an Excel workbook (.xlsx). */
  downloadExcel: (projectId: number | string, projectCode?: string) =>
    apiClient
      .get<Blob>(`/projects/${projectId}/language-rules/export.xlsx`, {
        responseType: 'blob',
      })
      .then((r) => {
        const blob = new Blob([r.data], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${projectCode || `project-${projectId}`}_language_rules.xlsx`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }),
}
