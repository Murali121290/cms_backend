import apiClient from './client'

export interface TermList {
  id: number
  name: string
  description: string | null
  scope: 'client' | 'generic'
  client_id: number | null
  source_file: string | null
  term_count: number
  is_active: boolean
  created_at: string | null
  updated_at: string | null
  assigned_project_ids?: number[]
}

export interface Term {
  id: number
  term: string
  group_id: number | null
  order_in_group: number
  is_italic: boolean
  is_bold: boolean
  notes: string | null
}

export interface ImportResult {
  term_list_id: number
  inserted: number
  skipped_duplicates_in_file: number
  skipped_already_present: number
  total_in_list: number
  sheets_scanned: string[]
  warnings: string[]
}

export interface ProjectTermListsResponse {
  project_id: number
  assigned: TermList[]
  available: TermList[]
}

export const termListsApi = {
  list: (params?: { scope?: string; client_id?: number; search?: string; include_inactive?: boolean }) =>
    apiClient.get<{ items: TermList[] }>('/term-lists', { params }).then((r) => r.data.items),

  get: (id: number | string) =>
    apiClient.get<TermList>(`/term-lists/${id}`).then((r) => r.data),

  create: (body: { name: string; description?: string; scope: 'client' | 'generic'; client_id?: number }) =>
    apiClient.post<TermList>('/term-lists', body).then((r) => r.data),

  update: (id: number | string, body: Partial<TermList>) =>
    apiClient.put<TermList>(`/term-lists/${id}`, body).then((r) => r.data),

  remove: (id: number | string) =>
    apiClient.delete(`/term-lists/${id}`).then((r) => r.data),

  importExcel: (id: number | string, file: File, replace = false) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient
      .post<ImportResult>(`/term-lists/${id}/import`, form, {
        params: { replace },
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },

  downloadExcel: (id: number | string, filename: string) =>
    apiClient
      .get<Blob>(`/term-lists/${id}/export.xlsx`, { responseType: 'blob' })
      .then((r) => {
        const url = URL.createObjectURL(new Blob([r.data]))
        const a = document.createElement('a')
        a.href = url
        a.download = filename.replace(/\s+/g, '_') + '_terms.xlsx'
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }),

  terms: (id: number | string, params?: { search?: string; limit?: number; offset?: number }) =>
    apiClient
      .get<{ total: number; limit: number; offset: number; items: Term[] }>(`/term-lists/${id}/terms`, { params })
      .then((r) => r.data),

  addTerm: (id: number | string, body: { term: string; is_italic?: boolean; is_bold?: boolean; notes?: string }) =>
    apiClient.post<Term>(`/term-lists/${id}/terms`, body).then((r) => r.data),

  updateTerm: (id: number | string, termId: number, body: Partial<Term>) =>
    apiClient.put<Term>(`/term-lists/${id}/terms/${termId}`, body).then((r) => r.data),

  deleteTerm: (id: number | string, termId: number) =>
    apiClient.delete(`/term-lists/${id}/terms/${termId}`).then((r) => r.data),

  projectAssignment: (projectId: number | string) =>
    apiClient
      .get<ProjectTermListsResponse>(`/projects/${projectId}/term-lists`)
      .then((r) => r.data),

  setProjectAssignment: (projectId: number | string, termListIds: number[]) =>
    apiClient
      .post<{ ok: boolean; project_id: number; assigned_term_list_ids: number[] }>(
        `/projects/${projectId}/term-lists`,
        { term_list_ids: termListIds },
      )
      .then((r) => r.data),

  unassign: (projectId: number | string, termListId: number) =>
    apiClient.delete(`/projects/${projectId}/term-lists/${termListId}`).then((r) => r.data),

  /** Fetch the saved selected_terms.json as a formatted string (for the View JSON modal). */
  viewProjectJson: (projectId: number | string) =>
    apiClient
      .get<string>(`/projects/${projectId}/term-lists/export.json`, {
        responseType: 'text',
        transformResponse: (data) => data,
      })
      .then((r) => r.data as unknown as string),

  /** Trigger a browser download of selected_terms.json. */
  downloadProjectJson: (projectId: number | string, projectCode?: string) =>
    apiClient
      .get<Blob>(`/projects/${projectId}/term-lists/export.json`, {
        params: { download: true },
        responseType: 'blob',
      })
      .then((r) => {
        const url = URL.createObjectURL(new Blob([r.data], { type: 'application/json' }))
        const a = document.createElement('a')
        a.href = url
        a.download = `${projectCode || `project-${projectId}`}_selected_terms.json`
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }),

  /** Download the project's selected term lists as a multi-sheet Excel workbook. */
  downloadProjectExcel: (projectId: number | string, projectCode?: string) =>
    apiClient
      .get<Blob>(`/projects/${projectId}/term-lists/export.xlsx`, { responseType: 'blob' })
      .then((r) => {
        const url = URL.createObjectURL(new Blob([r.data], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }))
        const a = document.createElement('a')
        a.href = url
        a.download = `${projectCode || `project-${projectId}`}_selected_terms.xlsx`
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }),
}
