import { apiClient } from "@/api/client";
import type { TechnicalApplyResponse, TechnicalScanResponse } from "@/types/api";

export async function getTechnicalReview(fileId: number) {
  const response = await apiClient.get<TechnicalScanResponse>(`/files/${fileId}/technical-review`);
  return response.data;
}

export async function applyTechnicalReview(fileId: number, replacements: Record<string, string>) {
  const response = await apiClient.post<TechnicalApplyResponse>(
    `/files/${fileId}/technical-review/apply`,
    { replacements },
  );
  return response.data;
}
