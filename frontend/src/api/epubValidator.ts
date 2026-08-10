import axios from 'axios';
import api, { getApiErrorMessage } from './client';
import type { AceReport, Book, FilesResponse, UploadResponse, ValidationApiResponse } from '../types/epubValidator';

export async function uploadFile(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', file);

  try {
    const { data } = await api.post<UploadResponse>('/post-prod/epub-validator/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (e.total && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    });
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Upload failed'));
  }
}

export async function getFiles(folderName: string): Promise<FilesResponse> {
  try {
    const { data } = await api.get<FilesResponse>(`/post-prod/epub-validator/file-data/${folderName}`);
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to list files'));
  }
}

export async function validateFolder(folderName: string): Promise<ValidationApiResponse> {
  try {
    const { data } = await api.get<ValidationApiResponse>(`/post-prod/epub-validator/validate/${folderName}`, {
      timeout: 30 * 60 * 1000,
    });
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Validation failed'));
  }
}

export async function getLatestValidation(folderName: string): Promise<ValidationApiResponse | null> {
  try {
    const { data } = await api.get<ValidationApiResponse | { status: false }>(
      `/post-prod/epub-validator/validate/${folderName}/latest`,
    );
    if ('status' in data && data.status === false) return null;
    return data as ValidationApiResponse;
  } catch {
    return null;
  }
}

export async function getFileContent(folderName: string, filePath: string): Promise<string> {
  try {
    const encoded = filePath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
    const { data } = await api.get<string>(`/post-prod/epub-validator/file-data/${folderName}/${encoded}`, {
      responseType: 'text',
    });
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to load file content'));
  }
}

export async function saveFileContent(
  folderName: string,
  filePath: string,
  content: string,
): Promise<void> {
  const encoded = filePath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
  try {
    await api.put(`/post-prod/epub-validator/file-data/${folderName}/${encoded}`, { content });
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to save file content'));
  }
}

export async function validateFile(
  folderName: string,
  fileName: string,
): Promise<ValidationApiResponse> {
  try {
    const { data } = await api.get<ValidationApiResponse>(`/post-prod/epub-validator/validate/${folderName}`, {
      params: { file: fileName },
      timeout: 30 * 60 * 1000,
    });
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Validation failed'));
  }
}

export async function getPdfPage(
  folderName: string,
  fileName: string,
): Promise<{ page: number; end_page: number; total_pages: number }> {
  try {
    const { data } = await api.get<{ page: number; end_page: number; total_pages: number }>(
      `/post-prod/epub-validator/pdf/${folderName}/page`,
      { params: { file: fileName } },
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to determine PDF page'));
  }
}

// ─── Project-based CRUD (new pattern matching Word Conversion) ───────────────

export interface EvProject {
  id: number;
  client: string;
  client_code: string | null;
  project_name: string;
  folder_name: string;
  epub_path: string;
  total_files: number;
  status: string;
  validation_status: string | null;
  assignee: string | null;
  eisbn?: string | null;
  copyright_year?: string | null;
  uploaded_by_id: number | null;
  uploaded_at: string;
  updated_at: string;
}

export async function listProjects(): Promise<EvProject[]> {
  try {
    const { data } = await api.get<EvProject[]>('/post-prod/epub-validator/projects');
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to load projects'));
  }
}

export async function createProject(formData: FormData): Promise<{ message: string; project: EvProject }> {
  try {
    const { data } = await api.post<{ message: string; project: EvProject }>(
      '/post-prod/epub-validator/projects',
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
  payload: { assignee?: string; eisbn?: string; copyright_year?: string },
): Promise<EvProject> {
  try {
    const { data } = await api.put<EvProject>(`/post-prod/epub-validator/projects/${projectId}`, payload);
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to update project'));
  }
}

export async function deleteProject(projectId: number): Promise<void> {
  try {
    await api.delete(`/post-prod/epub-validator/projects/${projectId}`);
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to delete project'));
  }
}

export interface ExportConfirmResponse {
  status: 'confirm';
  message: string;
}

export async function exportEpub(
  folderName: string,
  stats: { failed: number; warnings: number; pending: number },
  force = false,
): Promise<ExportConfirmResponse | { blob: Blob; filename: string }> {
  try {
    const response = await api.post(
      `/post-prod/epub-validator/export/${folderName}`,
      { ...stats, force },
      { responseType: 'blob', timeout: 60_000 },
    );
    const contentType = (response.headers['content-type'] as string) ?? '';
    if (contentType.includes('application/json')) {
      const text = await (response.data as Blob).text();
      return JSON.parse(text) as ExportConfirmResponse;
    }

    // Extract filename from Content-Disposition header
    const contentDisposition = response.headers['content-disposition'] as string ?? '';
    let filename = folderName + '.epub';
    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
    if (filenameMatch && filenameMatch[1]) {
      filename = filenameMatch[1];
    }

    return { blob: response.data as Blob, filename };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
      let parsed: { detail?: string; message?: string } | null = null;
      try {
        const text = await err.response.data.text();
        parsed = JSON.parse(text);
      } catch { /* not JSON */ }
      if (parsed) throw new Error(parsed.detail ?? parsed.message ?? 'Export failed');
    }
    throw new Error(getApiErrorMessage(err, 'Export failed'));
  }
}

export async function getCachedAceReport(folderName: string): Promise<AceReport | null> {
  try {
    const { data } = await api.get<{ status: boolean; report?: AceReport; message?: string }>(
      `/post-prod/epub-validator/ace/${encodeURIComponent(folderName)}`,
    );
    return data.status ? data.report ?? null : null;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to load accessibility report'));
  }
}

export async function runAceReport(folderName: string): Promise<AceReport> {
  try {
    const { data } = await api.post<{ status: boolean; report: AceReport; message?: string }>(
      `/post-prod/epub-validator/ace/${encodeURIComponent(folderName)}`,
    );
    if (!data.status) {
      throw new Error(data.message || 'Accessibility check failed');
    }
    return data.report;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Accessibility check failed'));
  }
}

export function getAceReportZipUrl(folderName: string): string {
  return `/api/v2/post-prod/epub-validator/ace/${encodeURIComponent(folderName)}/download-zip`;
}


export interface EpubCheckMessage {
  id: string;
  message: string;
  category: 'Error' | 'Warning' | 'Info';
  severity: string;
  file_path?: string | null;
  line_number?: number | null;
  column_number?: number | null;
}

export interface EpubCheckReport {
  status: 'pass' | 'fail';
  ran_at: string;
  duration_seconds: number;
  totals: {
    error: number;
    warning: number;
    info: number;
    total: number;
  };
  messages: EpubCheckMessage[];
}

export async function getCachedEpubCheckReport(folderName: string): Promise<EpubCheckReport | null> {
  try {
    const { data } = await api.get<{ status: boolean; report?: EpubCheckReport; message?: string }>(
      `/post-prod/epub-validator/epubcheck/${encodeURIComponent(folderName)}`,
    );
    return data.status ? data.report ?? null : null;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to load EPUBCheck report'));
  }
}

export async function runEpubCheckReport(folderName: string): Promise<EpubCheckReport> {
  try {
    const { data } = await api.post<{ status: boolean; report: EpubCheckReport; message?: string }>(
      `/post-prod/epub-validator/epubcheck/${encodeURIComponent(folderName)}`,
    );
    if (!data.status) {
      throw new Error(data.message || 'EPUBCheck failed');
    }
    return data.report;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'EPUBCheck failed'));
  }
}

/** Derive folder_name from the upload response, falling back to the filename. */
export function resolveFolderName(response: UploadResponse, file: File): string {
  if (!response.status) return file.name.replace(/\.[^.]+$/, '');
  if (response.folder_name) return response.folder_name;
  if (response.extract_folder) {
    const parts = response.extract_folder.replace(/\\/g, '/').split('/');
    if (parts.length >= 2 && parts[1]) return parts[1];
  }
  return file.name.replace(/\.[^.]+$/, '');
}
