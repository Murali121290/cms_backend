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
