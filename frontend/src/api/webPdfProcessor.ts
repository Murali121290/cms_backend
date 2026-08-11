import api, { getApiErrorMessage } from './client';

export interface WebPdfProject {
  id: number;
  client: string;
  client_code: string;
  project_name: string;
  folder_name: string;
  pdf_path: string;
  total_files: number;
  status: string;
  validation_status: string;
  latest_validation_file?: string;
  assignee?: string;
  uploaded_by_id?: number;
  uploaded_at: string;
  updated_at: string;
}

export async function listProjects(): Promise<WebPdfProject[]> {
  try {
    const { data } = await api.get<WebPdfProject[]>('/post-prod/web-pdf-processor/projects');
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to load projects'));
  }
}

export async function createProject(formData: FormData): Promise<{ message: string; project: WebPdfProject }> {
  try {
    const { data } = await api.post<{ message: string; project: WebPdfProject }>(
      '/post-prod/web-pdf-processor/projects',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to create project'));
  }
}

export async function updateProject(
  projectId: number,
  payload: { assignee?: string },
): Promise<WebPdfProject> {
  try {
    const { data } = await api.put<WebPdfProject>(`/post-prod/web-pdf-processor/projects/${projectId}`, payload);
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to update project'));
  }
}

export async function deleteProject(projectId: number): Promise<void> {
  try {
    await api.delete(`/post-prod/web-pdf-processor/projects/${projectId}`);
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to delete project'));
  }
}

export interface ProjectFile {
  filename: string;
  relative_path: string;
  absolute_path: string;
  category: 'FC' | 'FM' | 'TEXT' | 'BM' | 'BC';
  order: number;
  size: number;
}

export async function listProjectFiles(projectId: number): Promise<ProjectFile[]> {
  try {
    const { data } = await api.get<ProjectFile[]>(`/post-prod/web-pdf-processor/projects/${projectId}/files`);
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to list project files'));
  }
}

export interface MergeFile {
  filename: string;
  absolute_path: string;
  category: string;
}

export async function mergeProjectFiles(projectId: number, files: MergeFile[]): Promise<{ message: string; merged_path: string }> {
  try {
    const { data } = await api.post<{ message: string; merged_path: string }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/merge`,
      { files },
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to merge PDF files'));
  }
}

