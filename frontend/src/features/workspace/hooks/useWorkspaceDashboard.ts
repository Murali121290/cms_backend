import { useQuery } from "@tanstack/react-query";

import { workspaceApi } from "../api";
import { COMPLETED_WINDOW_DAYS, DASHBOARD_QUERY_KEY, REFETCH_INTERVAL_MS } from "../constants";

export const dashboardQueryKey = (completedDays: number) => [DASHBOARD_QUERY_KEY, completedDays] as const;

/** Polls every 60 s while the tab is visible and refetches when the window regains focus. */
export function useWorkspaceDashboard(completedDays: number = COMPLETED_WINDOW_DAYS) {
  return useQuery({
    queryKey: dashboardQueryKey(completedDays),
    queryFn: () => workspaceApi.getDashboard(completedDays),
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}
