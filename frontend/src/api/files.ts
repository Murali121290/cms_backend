import { apiClient } from "@/api/client";
import type {
  ChapterTimeReport,
  FileCheckoutResponse,
  FileDeleteResponse,
  FileLockActionResponse,
  FileLockSession,
  FileRecord,
  FileUploadResponse,
  FileVersionsResponse,
  LockState,
} from "@/types/api";

export interface GenerateFigurePdfResponse {
  status: "ok";
  file: FileRecord;
  figures_included: number;
}

export interface GenerateFigureAssessmentResponse {
  status: "ok";
  file: FileRecord;
  figures_included: number;
}


export function getDownloadFilename(contentDisposition: string | undefined, fallbackFilename: string) {
  if (!contentDisposition) {
    return fallbackFilename;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const basicMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  if (basicMatch?.[1]) {
    return basicMatch[1];
  }

  return fallbackFilename;
}

export interface BulkDownloadProjectFilesPayload {
  chapter_ids: number[];
  categories: string[];
}

export async function bulkDownloadProjectFiles(
  projectId: number,
  payload: BulkDownloadProjectFilesPayload
) {
  const response = await apiClient.post<Blob>(
    `/projects/${projectId}/bulk-download`,
    payload,
    {
      responseType: "blob",
    }
  );

  const fallbackFilename = `project_${projectId}_bulk.zip`;
  const filename = getDownloadFilename(response.headers["content-disposition"], fallbackFilename);
  const rawMissing = response.headers["x-missing-count"];
  const missingCount = rawMissing ? parseInt(rawMissing, 10) : 0;

  return {
    blob: response.data,
    filename,
    missingCount,
  };
}

export async function downloadFile(fileId: number, fallbackFilename: string) {
  const response = await apiClient.get<Blob>(`/files/${fileId}/download`, {
    responseType: "blob",
  });

  return {
    blob: response.data,
    filename: getDownloadFilename(response.headers["content-disposition"], fallbackFilename),
  };
}

export async function checkoutFile(fileId: number) {
  const response = await apiClient.post<FileCheckoutResponse>(`/files/${fileId}/checkout`);
  return response.data;
}

export async function cancelCheckout(fileId: number) {
  const response = await apiClient.delete<FileCheckoutResponse>(`/files/${fileId}/checkout`);
  return response.data;
}

// ── File locks: download with lock / check-in / admin release / time log ────

/** Take a download lock, then fetch the file. Throws (409) when someone else holds it. */
export async function downloadWithLock(fileId: number, fallbackFilename: string) {
  const lock = await apiClient.post<FileLockActionResponse>(`/files/${fileId}/download-with-lock`);
  const file = await downloadFile(fileId, fallbackFilename);
  return { ...file, lock: lock.data };
}

/** Upload the new version of a file you hold; releases the lock and records the time taken. */
export async function checkinFile(fileId: number, file: File, note?: string) {
  const formData = new FormData();
  formData.append("file", file);
  if (note) formData.append("note", note);
  const response = await apiClient.post<FileLockActionResponse>(`/files/${fileId}/checkin`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function cancelFileLock(fileId: number) {
  const response = await apiClient.post<FileLockActionResponse>(`/files/${fileId}/lock/cancel`);
  return response.data;
}

export async function forceReleaseFileLock(fileId: number, note: string) {
  const response = await apiClient.post<FileLockActionResponse>(`/files/${fileId}/lock/force-release`, { note });
  return response.data;
}

export async function getFileLockSessions(fileId: number) {
  const response = await apiClient.get<{
    file_id: number;
    filename: string;
    version: number;
    lock: LockState;
    sessions: FileLockSession[];
  }>(`/files/${fileId}/lock-sessions`);
  return response.data;
}

export async function getChapterTimeReport(projectId: number, chapterId: number) {
  const response = await apiClient.get<ChapterTimeReport>(`/projects/${projectId}/chapters/${chapterId}/time-report`);
  return response.data;
}

export async function getActiveFileLocks(params?: { project_id?: number; chapter_id?: number }) {
  const response = await apiClient.get<{ is_admin: boolean; locks: FileLockSession[] }>(`/file-locks`, { params });
  return response.data;
}

export async function deleteFile(fileId: number) {
  const response = await apiClient.delete<FileDeleteResponse>(`/files/${fileId}`);
  return response.data;
}

export async function uploadChapterFiles({
  projectId,
  chapterId,
  category,
  files,
}: {
  projectId: number;
  chapterId: number;
  category: string;
  files: File[];
}) {
  const formData = new FormData();
  formData.append("category", category);
  files.forEach((file) => {
    formData.append("files", file);
  });

  const response = await apiClient.post<FileUploadResponse>(
    `/projects/${projectId}/chapters/${chapterId}/files/upload`,
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    },
  );
  return response.data;
}

export async function getFileVersions(fileId: number, limit = 50) {
  const response = await apiClient.get<FileVersionsResponse>(`/files/${fileId}/versions`, {
    params: { limit },
  });
  return response.data;
}


export async function downloadFileVersion(fileId: number, versionId: number, fallbackFilename: string) {
  const response = await apiClient.get<Blob>(`/files/${fileId}/versions/${versionId}/download`, {
    responseType: "blob",
  });

  return {
    blob: response.data,
    filename: getDownloadFilename(response.headers["content-disposition"], fallbackFilename),
  };
}

export async function generateFigurePdf(projectId: number, chapterId: number, fileId?: number) {
  const response = await apiClient.post<GenerateFigurePdfResponse>(
    `/projects/${projectId}/chapters/${chapterId}/generate-figure-pdf`,
    undefined,
    fileId != null ? { params: { file_id: fileId } } : undefined,
  );
  return response.data;
}

export async function generateFigureAssessment(projectId: number, chapterId: number, fileId?: number) {
  const response = await apiClient.post<GenerateFigureAssessmentResponse>(
    `/projects/${projectId}/chapters/${chapterId}/generate-figure-assessment`,
    undefined,
    fileId != null ? { params: { file_id: fileId } } : undefined,
  );
  return response.data;
}
