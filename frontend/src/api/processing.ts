import axios from "axios";

import { apiClient } from "@/api/client";
import type { ProcessingStartResponse, ProcessingStatusResponse } from "@/types/api";

// ── Generic base functions ──────────────────────────────────────────────────

export async function startProcessingJob(
  fileId: number,
  processType = "structuring",
  mode = "style",
  options: Record<string, unknown> = {},
) {
  const response = await apiClient.post<ProcessingStartResponse>(`/files/${fileId}/processing-jobs`, {
    process_type: processType,
    mode,
    options,
  });
  return response.data;
}

export async function getProcessingStatus(fileId: number, processType = "structuring") {
  const response = await apiClient.get<ProcessingStatusResponse>(`/files/${fileId}/processing-status`, {
    params: { process_type: processType },
  });
  return response.data;
}

export interface TagSetOption {
  key: string;
  label: string;
}

export async function getTagSets(): Promise<TagSetOption[]> {
  const response = await apiClient.get<{ tag_sets: TagSetOption[] }>("/tag-sets");
  return response.data.tag_sets;
}

// v1 endpoint — absolute path, different base from apiClient (/api/v2)
export async function startV1ProcessingJob(
  fileId: number,
  processType: string,
): Promise<{ message: string; status: string }> {
  const response = await axios.post<{ message: string; status: string }>(
    `/api/v1/processing/files/${fileId}/process/${processType}`,
    null,
    { withCredentials: true, headers: { Accept: "application/json" } },
  );
  return response.data;
}

// ── Named wrappers — one per processing action ──────────────────────────────
// v2: POST /api/v2/files/{id}/processing-jobs
// v1: POST /api/v1/processing/files/{id}/process/{type}

export const startStructuring = (fileId: number, tagSet?: string) =>
  startProcessingJob(fileId, "structuring", "style", {
    structuring_method: "manual",
    ...(tagSet && tagSet !== "lww" ? { tag_set: tagSet } : {}),
  });

// Language edit is not yet implemented in v2 — use v1 endpoint
export const startLanguageEdit = (fileId: number) =>
  startV1ProcessingJob(fileId, "language");

// Reference validation is v1 only
export const startReferenceCheck = (fileId: number) =>
  startV1ProcessingJob(fileId, "reference_validation");

export const startPpdGeneration = (fileId: number) =>
  startProcessingJob(fileId, "ppd", "style");

// Permissions has no PPH endpoint — stays on v1 local
export const startPermissionsCheck = (fileId: number) =>
  startV1ProcessingJob(fileId, "permissions");

export const startCreditExtraction = (fileId: number) =>
  startProcessingJob(fileId, "credit_extractor_ai", "style");

export const startBiasScan = (fileId: number) =>
  startProcessingJob(fileId, "bias_scan", "style");

export const startWordToXml = (fileId: number) =>
  startProcessingJob(fileId, "word_to_xml", "style");
