import api from './client'

export interface Project {
  id: number
  client_id: number | null
  project_code: string | null
  customer_name: string | null
  division_code: string | null
  customer_contact: string | null
  category: string | null
  composition: string | null
  workflow_name: string | null
  status: string | null
  project_manager: string | null
  sales_person: string | null
  priority: string | null
  project_title: string | null
  edition: string | null
  color: string | null
  trim_size: string | null
  copyright_year: number | null
  manuscript_pages: number | null
  estimated_pages: number | null
  actual_pages: number
  chapter_count: number | null
  isbn_no: string | null
  billing_location: string | null
  due_date: string | null
  file_details: Record<string, unknown> | null
  created_at: string
  updated_at: string
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

export const projectsApi = {
  list: () =>
    api.get<Project[]>('/projects/').then(r => r.data),

  getByClient: (clientId: number) =>
    api.get<Project[]>(`/projects/client/${clientId}`).then(r => r.data),

  getById: (id: number) =>
    api.get<Project>(`/projects/${id}`).then(r => r.data),

  create: (data: ProjectCreate) =>
    api.post<Project>('/projects/', data).then(r => r.data),

  update: (id: number, data: ProjectUpdate) =>
    api.put<Project>(`/projects/${id}`, data).then(r => r.data),
}
