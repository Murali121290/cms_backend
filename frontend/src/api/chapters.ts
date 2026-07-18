import api from './client'

export interface Chapter {
  id: number
  client: string
  project: string
  chapters: string
  chapter_title: string | null
  project_manager_name: string | null
  due_date: string | null
  stage_name: string | null
  current_assignee_name: string | null
  status: string
  complexity_level: string
  stage_level: number
  workflow: string
  published_status: string
  remarks: string | null
  manuscript_pages: number | null
  word_count: number | null
  art_count?: number | null
  priority: string
  delayed_stages: Record<string, number> | null
  created_at: string
  updated_at: string
}

export interface ChapterUpdate {
  stage_name?:             string | null
  current_assignee_name?:  string | null
  status?:                 string | null
  priority?:               string | null
  remarks?:                string | null
  manuscript_pages?:       number | null
  due_date?:               string | null
  published_status?:       string | null
  complexity_level?:       string | null
  delayed_stages?:         Record<string, number> | null
}

export interface ChapterZipSkippedItem {
  filename: string
  reason: string
}

export interface ChapterZipUploadResponse {
  created: Chapter[]
  skipped: ChapterZipSkippedItem[]
}

export const chaptersApi = {
  list: () =>
    api.get<Chapter[]>('/chapters/').then(r => r.data),

  getById: (id: number) =>
    api.get<Chapter>(`/chapters/${id}`).then(r => r.data),

  getByProject: (project: string) =>
    api.get<Chapter[]>(`/chapters/project/${encodeURIComponent(project)}`).then(r => r.data),

  getByClient: (client: string) =>
    api.get<Chapter[]>(`/chapters/client/${encodeURIComponent(client)}`).then(r => r.data),

  update: (id: number, data: ChapterUpdate) =>
    api.put<Chapter>(`/chapters/${id}`, data).then(r => r.data),

  bulkUpdatePriority: (project: string, priority: string) =>
    api.put<{ updated: number }>(`/chapters/project/${encodeURIComponent(project)}/priority`, { priority }).then(r => r.data),

  bulkUpdateStatus: (project: string, status: string) =>
    api.put<{ updated: number }>(`/chapters/project/${encodeURIComponent(project)}/status`, { status }).then(r => r.data),

  createWithManuscript: (projectId: number, number: string, file: File) => {
    const formData = new FormData()
    formData.append('number', number)
    formData.append('file', file)
    return api.post<Chapter>(`/projects/${projectId}/chapters/create-with-manuscript`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  createManuscriptChaptersFromZip: (projectId: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<ChapterZipUploadResponse>(`/projects/${projectId}/chapters/create-with-manuscript-zip`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  createArtChapter: (projectId: number, number: string, file: File) => {
    const formData = new FormData()
    formData.append('number', number)
    formData.append('file', file)
    return api.post<Chapter>(`/projects/${projectId}/chapters/create-with-art`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  createArtChaptersFromZip: (projectId: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<ChapterZipUploadResponse>(`/projects/${projectId}/chapters/create-with-art-zip`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
}
