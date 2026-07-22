import axios from 'axios';
import api, { getApiErrorMessage } from './client';
import type { Book, FilesResponse, UploadResponse, ValidationApiResponse } from '../types/epubValidator';

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
      timeout: 10 * 60 * 1000,
    });
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Validation failed'));
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
      timeout: 10 * 60 * 1000,
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

export async function getBooks(): Promise<Book[]> {
  try {
    const { data } = await api.get<Book[]>('/post-prod/epub-validator/books');
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to load books'));
  }
}

export async function deleteBook(folderName: string): Promise<void> {
  try {
    await api.delete(`/post-prod/epub-validator/books/${folderName}`);
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to delete book'));
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
): Promise<ExportConfirmResponse | Blob> {
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
    return response.data as Blob;
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
