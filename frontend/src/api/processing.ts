import { apiClient } from "@/api/client";
import type { ProcessingStartResponse, ProcessingStatusResponse } from "@/types/api";

export async function startProcessingJob(fileId: number, processType = "structuring", mode = "style") {
  const response = await apiClient.post<ProcessingStartResponse>(`/files/${fileId}/processing-jobs`, {
    process_type: processType,
    mode,
  });
  return response.data;
}

export async function getProcessingStatus(fileId: number, processType = "structuring") {
  const response = await apiClient.get<ProcessingStatusResponse>(`/files/${fileId}/processing-status`, {
    params: { process_type: processType },
  });
  return response.data;
}
