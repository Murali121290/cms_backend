import { apiClient } from "./client";
import type { StructuredContentResponse } from "@/types/api";

export async function getStructuredContent(fileId: number): Promise<StructuredContentResponse> {
  const response = await apiClient.get(`/files/${fileId}/structured-content`);
  return response.data;
}
