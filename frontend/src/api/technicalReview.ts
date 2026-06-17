import { apiClient } from "@/api/client";
import type { TechnicalApplyResponse, TechnicalScanResponse, XhtmlSaveResponse } from "@/types/api";

export async function getTechnicalReview(fileId: number, stylesheetId?: number) {
  const params = stylesheetId ? `?stylesheet_id=${stylesheetId}` : "";
  const response = await apiClient.get<TechnicalScanResponse>(`/files/${fileId}/technical-review${params}`);
  return response.data;
}

export async function applyTechnicalReview(
  fileId: number,
  replacements: Record<string, string> | null,
  selectedFindings?: any[],
  highlightFindings?: any[]
) {
  const response = await apiClient.post<TechnicalApplyResponse>(
    `/files/${fileId}/technical-review/apply`,
    {
      replacements,
      selected_findings: selectedFindings,
      highlight_findings: highlightFindings
    },
  );
  return response.data;
}

export async function getFileXhtml(fileId: number) {
  const response = await apiClient.get<{ content: string; filename: string }>(
    `/files/${fileId}/xhtml`
  );
  return response.data;
}

export async function saveFileXhtml(fileId: number, htmlContent: string) {
  const response = await apiClient.post<XhtmlSaveResponse>(
    `/files/${fileId}/xhtml/save`,
    { html_content: htmlContent }
  );
  return response.data;
}

/** Run-anchored XHTML for the formatting-preserving WYSIWYG editor. */
export async function getFileXhtmlRuns(fileId: number) {
  const response = await apiClient.get<{ content: string; filename: string }>(
    `/files/${fileId}/xhtml-runs`
  );
  return response.data;
}

/** Delta-patch save: applies only changed runs/marks back into a new DOCX version. */
export async function saveFileXhtmlRuns(fileId: number, htmlContent: string) {
  const response = await apiClient.post<XhtmlSaveResponse>(
    `/files/${fileId}/xhtml-runs/save`,
    { html_content: htmlContent }
  );
  return response.data;
}

