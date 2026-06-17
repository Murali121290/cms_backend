import { apiClient } from "@/api/client";
import type { ActivitiesResponse } from "@/types/api";

export async function getActivities(limit = 100) {
  const response = await apiClient.get<ActivitiesResponse>("/activities", {
    params: { limit },
  });
  return response.data;
}
