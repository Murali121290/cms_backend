import { apiClient } from "@/api/client";
import type {
  FileCheckoutResponse,
  FileDeleteResponse,
  FileRecord,
  FileUploadResponse,
  FileVersionsResponse,
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
  /** "excel" when an uploaded client workbook drove the output, "images" when the
   *  legacy image-scanning fallback ran. */
  source: "excel" | "images";
  /** Rows parsed from the client workbook (0 on the images path). */
  parsed_row_count: number;
  /** Raw client headers not in the backend alias registry (preserved verbatim
   *  in the output xlsx and in the persisted assessment). */
  unmapped_columns: string[];
  /** Non-fatal parser warnings surfaced to the UI. */
  warnings: string[];
  /** art_assessments.id — present when the Excel path ran. */
  assessment_id: number | null;
}


export interface ParsedAssessmentRow {
  row_index: number;
  /** Canonical field name → verbatim Excel value (null when blank). */
  canonical: Record<string, string | null>;
  /** Raw client header → verbatim Excel value. Preserved even when the header
   *  is not in the backend alias registry. */
  unmapped: Record<string, string | null>;
}

export interface ParseAssessmentExcelResponse {
  status: "ok";
  file_id: number;
  filename: string;
  project_info_sheet: string | null;
  project_info: Record<string, string | null>;
  data_sheet_name: string | null;
  header_row_index: number | null;
  /** canonical field name → raw client header that matched. */
  canonical_columns: Record<string, string>;
  /** raw client headers whose names did not match the alias registry. */
  unmapped_columns: string[];
  rows: ParsedAssessmentRow[];
  warnings: string[];
}


function getDownloadFilename(contentDisposition: string | undefined, fallbackFilename: string) {
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

/**
 * Parse an uploaded Art Assessment workbook (read-only preview).
 *
 * The backend never mutates the file or the DB here — callers use this to
 * show the detected sheet, column mapping, warnings, and figure rows before
 * the user confirms "Generate Assessment" (Phase 4).
 */
export async function parseAssessmentExcel(
  projectId: number,
  chapterId: number,
  fileId: number,
) {
  const response = await apiClient.post<ParseAssessmentExcelResponse>(
    `/projects/${projectId}/chapters/${chapterId}/parse-assessment-excel`,
    undefined,
    { params: { file_id: fileId } },
  );
  return response.data;
}
