import axios from "axios";

import { apiClient } from "@/api/client";
import type { ProcessingStartResponse, ProcessingStatusResponse } from "@/types/api";

export async function startProcessingJob(fileId: number, processType = "structuring", mode = "style") {
  const response = await apiClient.post<ProcessingStartResponse>(`/files/${fileId}/processing-jobs`, {
    process_type: processType,
    mode,
    options: {},
  });
  return response.data;
}

export async function getProcessingStatus(fileId: number, processType = "structuring") {
  const response = await apiClient.get<ProcessingStatusResponse>(`/files/${fileId}/processing-status`, {
    params: { process_type: processType },
  });
  return response.data;
}

/**
 * Fires a processing job via the legacy v1 endpoint.
 * Supports: language, reference_validation, ppd, permissions,
 *           credit_extractor_ai, bias_scan, word_to_xml, etc.
 * The v1 prefix /api/v1/processing is NOT the same base as apiClient (/api/v2),
 * so we use a raw axios call with the absolute path.
 */
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
