import { apiClient } from "@/api/client";
import type {
  AnalyzeFilesForStylesheetResponse,
  DocxStylesheetParseResponse,
  DocxImportApplyRequest,
  DocxImportApplyResponse,
  DocxImportPendingItem,
  DocxImportPreviewResponse,
  CERulesResponse,
  IATemplateResponse,
  StylesheetActivateResponse,
  StylesheetCreateRequest,
  StylesheetCreateResponse,
  StylesheetDeleteResponse,
  StylesheetUpdateRequest,
  StylesheetUpdateResponse,
  StylesheetsListResponse,
} from "@/types/api";

export async function getIATemplate() {
  const response = await apiClient.get<IATemplateResponse>("/ia-template");
  return response.data;
}

export async function getCeRules() {
  const response = await apiClient.get<CERulesResponse>("/ce-rules");
  return response.data;
}

export async function getProjectStylesheets(projectId: number) {
  const response = await apiClient.get<StylesheetsListResponse>(
    `/projects/${projectId}/stylesheets`,
  );
  return response.data;
}

export async function createStylesheet(
  projectId: number,
  payload: StylesheetCreateRequest,
) {
  const response = await apiClient.post<StylesheetCreateResponse>(
    `/projects/${projectId}/stylesheets`,
    payload,
  );
  return response.data;
}

export async function updateStylesheet(
  projectId: number,
  stylesheetId: number,
  payload: StylesheetUpdateRequest,
) {
  const response = await apiClient.patch<StylesheetUpdateResponse>(
    `/projects/${projectId}/stylesheets/${stylesheetId}`,
    payload,
  );
  return response.data;
}

export async function deleteStylesheet(projectId: number, stylesheetId: number) {
  const response = await apiClient.delete<StylesheetDeleteResponse>(
    `/projects/${projectId}/stylesheets/${stylesheetId}`,
  );
  return response.data;
}

export async function activateStylesheet(
  projectId: number,
  stylesheetId: number,
) {
  const response = await apiClient.post<StylesheetActivateResponse>(
    `/projects/${projectId}/stylesheets/${stylesheetId}/activate`,
  );
  return response.data;
}

export async function analyzeFilesForStylesheet(
  projectId: number,
  fileIds: number[],
) {
  const response = await apiClient.post<AnalyzeFilesForStylesheetResponse>(
    `/projects/${projectId}/analyze-files-for-stylesheet`,
    { file_ids: fileIds },
  );
  return response.data;
}

export async function parseDocxStylesheet(
  projectId: number,
  file: File,
) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiClient.post<DocxStylesheetParseResponse>(
    `/projects/${projectId}/stylesheets/parse-docx`,
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    },
  );
  return response.data;
}

// --- Import edits from the Editorial Style Sheet (.docx) ---
export async function previewDocxImportUpload(projectId: number, stylesheetId: number, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("source", "upload");
  const response = await apiClient.post<DocxImportPreviewResponse>(
    `/projects/${projectId}/stylesheets/${stylesheetId}/docx-import/preview`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return response.data;
}

export async function previewDocxImportCeSupport(projectId: number, stylesheetId: number, filename: string) {
  const formData = new FormData();
  formData.append("source", "ce_support");
  formData.append("filename", filename);
  const response = await apiClient.post<DocxImportPreviewResponse>(
    `/projects/${projectId}/stylesheets/${stylesheetId}/docx-import/preview`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return response.data;
}

export async function applyDocxImport(projectId: number, stylesheetId: number, payload: DocxImportApplyRequest) {
  const response = await apiClient.post<DocxImportApplyResponse>(
    `/projects/${projectId}/stylesheets/${stylesheetId}/docx-import/apply`,
    payload,
  );
  return response.data;
}

export async function dismissDocxImport(projectId: number, stylesheetId: number, filename: string) {
  await apiClient.post(`/projects/${projectId}/stylesheets/${stylesheetId}/docx-import/dismiss`, { filename });
}

export async function getDocxImportPending(projectId: number) {
  const response = await apiClient.get<{ items: DocxImportPendingItem[] }>(
    `/projects/${projectId}/stylesheets/docx-import/pending`,
  );
  return response.data.items;
}

export async function getSpringerPreset(
  bookType: string = "standard",
  listStyle: string = "narrative",
) {
  const response = await apiClient.get<any>("/stylesheets/presets/springer", {
    params: { book_type: bookType, list_style: listStyle },
  });
  return response.data;
}
