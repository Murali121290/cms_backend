import { apiClient } from "./client";

// Clients
export interface Client {
  id: number;
  category_type: string;
  contact_type: string;
  first_name: string | null;
  surname: string | null;
  name_company: string | null;
  company: string | null;
  division: string | null;
  designation: string | null;
  department: string | null;
  email: string | null;
  website: string | null;
  vendor_number: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  zip_code: string | null;
  sub_specialisation: string | null;
  working_hours: string | null;
  contact_hours: string | null;
  phone_main: string | null;
  phone_additional: string | null;
  active_status: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ClientPayload {
  category_type: string;
  contact_type: string;
  first_name?: string;
  surname?: string;
  name_company?: string;
  company: string;
  division: string;
  designation?: string;
  department?: string;
  email: string;
  website?: string;
  vendor_number?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  country?: string;
  zip_code?: string;
  sub_specialisation?: string;
  working_hours?: string;
  contact_hours?: string;
  phone_main?: string;
  phone_additional?: string;
  active_status?: boolean;
}

// Workflow models
export interface RolesMaster {
  id: number;
  role_name: string;
  team: string;
  description?: string;
  active_status: boolean;
  created_at: string;
}

export interface StageMaster {
  id: number;
  stage_name: string;
  description?: string;
  sla_level1?: number;
  sla_level2?: number;
  sla_level3?: number;
  roles: string[];
  active_status: boolean;
  created_at: string;
}

export interface StageDetail {
  id: number;
  client: string;
  project: string;
  chapters: string;
  project_manager_name?: string;
  assignee_name?: string;
  planned_start_date?: string;
  planned_end_date?: string;
  actual_start_date?: string;
  actual_end_date?: string;
  stage_name: string;
  workflow: string;
  complexity_level?: string;
  stage_level?: number;
  sla?: number;
  stage_status: string;
  delayed: boolean;
  delay_days?: number;
  remarks?: string;
  total_time_taken?: number;
  created_at: string;
  updated_at: string;
}

export interface ChapterInfo {
  id: number;
  client: string;
  project: string;
  chapters: string;
  chapter_title?: string;
  project_manager_name?: string;
  due_date?: string;
  stage_name?: string;
  current_assignee_name?: string;
  status: string;
  complexity_level: string;
  stage_level: number;
  workflow: string;
  published_status: string;
  remarks?: string;
  manuscript_pages?: number;
  priority: string;
  delayed_stages?: Record<string, number>;
  created_at: string;
  updated_at: string;
}

// Clients API — re-exported from clients.ts for backward compatibility
export { clientsApi } from "./clients";

// Roles API
export const rolesApi = {
  list: () =>
    apiClient.get<RolesMaster[]>("/api/v1/roles-master").then((r) => r.data),

  listActive: () =>
    apiClient.get<RolesMaster[]>("/api/v1/roles-master").then((r) => r.data.filter((x) => x.active_status)),

  getById: (id: number) =>
    apiClient.get<RolesMaster>(`/api/v1/roles-master/${id}`).then((r) => r.data),

  create: (data: Omit<RolesMaster, "id" | "created_at">) =>
    apiClient.post<RolesMaster>("/api/v1/roles-master", data).then((r) => r.data),

  update: (id: number, data: Partial<Omit<RolesMaster, "id" | "created_at">>) =>
    apiClient.put<RolesMaster>(`/api/v1/roles-master/${id}`, data).then((r) => r.data),

  setStatus: (id: number, active_status: boolean) =>
    apiClient.put<RolesMaster>(`/api/v1/roles-master/${id}`, { active_status }).then((r) => r.data),

  delete: (id: number) =>
    apiClient.delete(`/api/v1/roles-master/${id}`),
};

// Stages API
export const stagesApi = {
  list: () =>
    apiClient.get<StageMaster[]>("/api/v1/stages").then((r) => r.data),

  getById: (id: number) =>
    apiClient.get<StageMaster>(`/api/v1/stages/${id}`).then((r) => r.data),

  create: (data: Omit<StageMaster, "id" | "created_at">) =>
    apiClient.post<StageMaster>("/api/v1/stages", data).then((r) => r.data),

  update: (id: number, data: Partial<Omit<StageMaster, "id" | "created_at">>) =>
    apiClient.put<StageMaster>(`/api/v1/stages/${id}`, data).then((r) => r.data),

  delete: (id: number) =>
    apiClient.delete(`/api/v1/stages/${id}`),
};

// Stage Details API
export const stageDetailsApi = {
  list: () =>
    apiClient.get<StageDetail[]>("/api/v1/stage-details").then((r) => r.data),

  getById: (id: number) =>
    apiClient.get<StageDetail>(`/api/v1/stage-details/${id}`).then((r) => r.data),

  byProject: (project: string) =>
    apiClient.get<StageDetail[]>("/api/v1/stage-details", { params: { project } }).then((r) => r.data),

  create: (data: Omit<StageDetail, "id" | "created_at" | "updated_at">) =>
    apiClient.post<StageDetail>("/api/v1/stage-details", data).then((r) => r.data),

  update: (id: number, data: Partial<Omit<StageDetail, "id" | "created_at" | "updated_at">>) =>
    apiClient.put<StageDetail>(`/api/v1/stage-details/${id}`, data).then((r) => r.data),

  delete: (id: number) =>
    apiClient.delete(`/api/v1/stage-details/${id}`),
};

// Chapter Info API
export const chapterInfoApi = {
  list: () =>
    apiClient.get<ChapterInfo[]>("/api/v1/chapter-infos").then((r) => r.data),

  getById: (id: number) =>
    apiClient.get<ChapterInfo>(`/api/v1/chapter-infos/${id}`).then((r) => r.data),

  byProject: (project: string) =>
    apiClient.get<ChapterInfo[]>("/api/v1/chapter-infos", { params: { project } }).then((r) => r.data),

  create: (data: Omit<ChapterInfo, "id" | "created_at" | "updated_at">) =>
    apiClient.post<ChapterInfo>("/api/v1/chapter-infos", data).then((r) => r.data),

  update: (id: number, data: Partial<Omit<ChapterInfo, "id" | "created_at" | "updated_at">>) =>
    apiClient.put<ChapterInfo>(`/api/v1/chapter-infos/${id}`, data).then((r) => r.data),

  delete: (id: number) =>
    apiClient.delete(`/api/v1/chapter-infos/${id}`),
};
