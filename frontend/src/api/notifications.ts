import { apiClient } from "@/api/client";
import type { NotificationsResponse } from "@/types/api";

export async function getNotifications(limit = 5) {
  const response = await apiClient.get<NotificationsResponse>("/notifications", {
    params: { limit },
  });
  return response.data;
}
