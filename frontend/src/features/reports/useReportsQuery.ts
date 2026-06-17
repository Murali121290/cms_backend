import { useQuery } from "@tanstack/react-query";

import { getActivities } from "@/api/activities";
import { getDashboard } from "@/api/dashboard";

export function useReportsDashboardQuery() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard(true),
    staleTime: 30_000,
  });
}

export function useReportsActivitiesQuery() {
  return useQuery({
    queryKey: ["activities", 100],
    queryFn: () => getActivities(100),
    staleTime: 30_000,
  });
}
