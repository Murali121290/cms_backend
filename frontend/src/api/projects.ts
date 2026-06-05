import api from './client'
import {
  ProjectsListResponse,
  ProjectDetailResponse,
  ProjectChaptersResponse,
  ProjectBootstrapResponse,
  ChapterCreateResponse,
  ChapterRenameResponse,
  ChapterDeleteResponse,
  ChapterDetailResponse,
  ChapterFilesResponse,
  ProjectSummary,
  ChapterSummary,
  FileRecord
} from '@/types/api'

export interface Project extends ProjectSummary {
  // WMS compatibility fields
  client_id: number | null
  project_code?: string | null
  customer_name?: string | null
  division_code?: string | null
  customer_contact?: string | null
  category?: string | null
  composition?: string | null
  workflow_name?: string | null
  project_manager?: string | null
  sales_person?: string | null
  priority?: string | null
  project_title?: string | null
  edition?: string | null
  color?: string | null
  trim_size?: string | null
  copyright_year?: number | null
  manuscript_pages?: number | null
  estimated_pages?: number | null
  actual_pages?: number
  isbn_no?: string | null
  billing_location?: string | null
  due_date?: string | null
  file_details?: Record<string, unknown> | null
  created_at?: string
  updated_at?: string
}

export interface ProjectCreate {
  client_id?: number | null
  project_code?: string | null
  customer_name?: string | null
  division_code?: string | null
  customer_contact?: string | null
  category?: string | null
  composition?: string | null
  workflow_name?: string | null
  status?: string | null
  project_manager?: string | null
  sales_person?: string | null
  priority?: string | null
  project_title?: string | null
  edition?: string | null
  color?: string | null
  trim_size?: string | null
  copyright_year?: number | null
  manuscript_pages?: number | null
  estimated_pages?: number | null
  actual_pages?: number
  chapter_count?: number | null
  isbn_no?: string | null
  billing_location?: string | null
  due_date?: string | null
  xml_standard?: string | null
}

export interface ProjectUpdate {
  project_manager?: string | null
  priority?: string | null
  status?: string | null
  composition?: string | null
  workflow_name?: string | null
  edition?: string | null
  color?: string | null
  trim_size?: string | null
  copyright_year?: number | null
  actual_pages?: number
  due_date?: string | null
}

export interface Chapter extends ChapterSummary {
  // WMS compatibility fields
  chapter_name: string
  file_count: number
  status: string
}

export interface ChapterDetail extends Chapter {
  files?: unknown[]
}

export interface ChapterFile extends FileRecord {
  // WMS compatibility fields
  file_name: string
  subfolder: string
  status: string
}

export const projectsApi = {
  list: (offset = 0, limit = 100) =>
    api.get<ProjectsListResponse>('/projects', { params: { offset, limit } }).then(r => r.data),

  getByClient: (clientId: number) =>
    api.get<ProjectsListResponse>('/projects', { params: { offset: 0, limit: 1000 } })
      .then(r => (r.data.projects as unknown as Project[]).filter(p => p.client_id === clientId)),

  getById: (id: number) =>
    api.get<ProjectDetailResponse>(`/projects/${id}`).then(r => r.data),

  create: (formData: FormData) =>
    api.post<ProjectBootstrapResponse>('/projects/bootstrap', formData).then(r => r.data),

  update: (id: number, data: ProjectUpdate) =>
    api.put<Project>(`/projects/${id}`, data).then(r => r.data),

  // Chapter operations
  getProjectChapters: (projectId: number) =>
    api.get<ProjectChaptersResponse>(`/projects/${projectId}/chapters`).then(r => r.data),

  getChapterDetail: (projectId: number, chapterId: number) =>
    api.get<ChapterDetailResponse>(`/projects/${projectId}/chapters/${chapterId}`).then(r => r.data),

  getChapterFiles: (projectId: number, chapterId: number) =>
    api.get<ChapterFilesResponse>(`/projects/${projectId}/chapters/${chapterId}/files`).then(r => r.data),

  createChapter: (projectId: number, data: { number: string; title: string }) =>
    api.post<ChapterCreateResponse>(`/projects/${projectId}/chapters`, data).then(r => r.data),

  renameChapter: (projectId: number, chapterId: number, data: { number: string; title: string }) =>
    api.patch<ChapterRenameResponse>(`/projects/${projectId}/chapters/${chapterId}`, data).then(r => r.data),

  deleteChapter: (projectId: number, chapterId: number) =>
    api.delete<ChapterDeleteResponse>(`/projects/${projectId}/chapters/${chapterId}`).then(r => r.data),

  // Workflow operations
  updateProjectWorkflow: (projectId: number, data: unknown) =>
    api.put(`/projects/${projectId}/workflow`, data),

  // Cleanup placeholder for delete project
  deleteProject: (id: number) =>
    api.delete(`/projects/${id}`),
}

// Named exports for WMS features
export const getProjectChapters = projectsApi.getProjectChapters
export const getChapterDetail = projectsApi.getChapterDetail
export const getChapterFiles = projectsApi.getChapterFiles
export const createChapter = projectsApi.createChapter
export const renameChapter = projectsApi.renameChapter
export const deleteChapter = projectsApi.deleteChapter
export const updateProjectWorkflow = projectsApi.updateProjectWorkflow
export const deleteProject = projectsApi.deleteProject
export const createProject = projectsApi.create
export const getProjects = projectsApi.list
export const getProjectDetail = projectsApi.getById
