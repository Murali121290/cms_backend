import { apiClient } from "@/api/client";
import type {
  AnalyzeFilesForStylesheetResponse,
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
