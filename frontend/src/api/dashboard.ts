import { apiClient } from "@/api/client";
import type { DashboardResponse } from "@/types/api";

export async function getDashboard(includeProjects = true) {
  const response = await apiClient.get<DashboardResponse>("/dashboard", {
    params: { include_projects: includeProjects },
  });
  return response.data;
}
