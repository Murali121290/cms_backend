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

export interface TrimConfig {
  mode: string;
  margins?: number[];
  standardize_size: boolean;
  remove_marks: boolean;
}

export async function trimProjectPDF(projectId: number, config: TrimConfig): Promise<{ message: string; trimmed_path: string }> {
  try {
    const { data } = await api.post<{ message: string; trimmed_path: string }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/trim`,
      config,
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to trim PDF file'));
  }
}

export async function generateBookmarks(projectId: number, includeSubheadings: boolean = true): Promise<any> {
  try {
    const { data } = await api.post(`/post-prod/web-pdf-processor/projects/${projectId}/generate-bookmarks?include_subheadings=${includeSubheadings}`);
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate bookmarks'));
  }
}

export interface BookmarkItem {
  level: number;
  title: string;
  page: number;
}

export async function getBookmarks(projectId: number): Promise<BookmarkItem[]> {
  try {
    const { data } = await api.get<{ bookmarks: BookmarkItem[] }>(`/post-prod/web-pdf-processor/projects/${projectId}/bookmarks`);
    return data.bookmarks;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to fetch bookmarks'));
  }
}

export async function updateBookmarks(projectId: number, bookmarks: BookmarkItem[]): Promise<void> {
  try {
    await api.put(`/post-prod/web-pdf-processor/projects/${projectId}/bookmarks`, bookmarks);
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to update bookmarks'));
  }
}

export async function generateLinks(
  projectId: number,
  linkType: 'one_way' | 'two_way',
  analyzeOnly: boolean = false
): Promise<{ 
  success: boolean; 
  total_links: number; 
  one_way_links: number; 
  two_way_links: number;
  details?: { type: string; title: string; source_page: number; target_page: number; is_linked: boolean; rect_found?: boolean }[];
}> {
  try {
    const { data } = await api.post<{ 
      success: boolean; 
      total_links: number; 
      one_way_links: number; 
      two_way_links: number;
      details?: { type: string; title: string; source_page: number; target_page: number; is_linked: boolean; rect_found?: boolean }[];
    }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-links`,
      { link_type: linkType, analyze_only: analyzeOnly },
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate links'));
  }
}

export async function generateLinkManual(
  projectId: number,
  type: string,
  title: string,
  sourcePage: number,
  targetPage: number
): Promise<{ success: boolean }> {
  try {
    const { data } = await api.post<{ success: boolean }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-links/manual`,
      { type, title, source_page: sourcePage, target_page: targetPage }
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to manually create link'));
  }
}

export interface UrlLinkDetail {
  url: string;
  display_text: string;
  page: number;
  is_linked: boolean;
  rect: number[] | null;
  http_status: number | null;
  http_description: string;
  http_ok: boolean;
}

export async function generateUrlLinks(
  projectId: number,
  analyzeOnly: boolean = true
): Promise<{
  success: boolean;
  total_urls: number;
  already_linked: number;
  not_linked: number;
  details: UrlLinkDetail[];
}> {
  try {
    const { data } = await api.post(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-url-links`,
      { analyze_only: analyzeOnly }
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate URL links'));
  }
}

export interface EmailLinkDetail {
  email: string;
  page: number;
  is_linked: boolean;
  rect: number[] | null;
}

export async function generateEmailLinks(
  projectId: number,
  analyzeOnly: boolean = true
): Promise<{
  success: boolean;
  total_emails: number;
  already_linked: number;
  not_linked: number;
  details: EmailLinkDetail[];
}> {
  try {
    const { data } = await api.post(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-email-links`,
      { analyze_only: analyzeOnly }
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate email links'));
  }
}
