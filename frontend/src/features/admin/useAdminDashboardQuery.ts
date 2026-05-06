import { useQuery } from "@tanstack/react-query";

import { getAdminDashboard } from "@/api/admin";

export function useAdminDashboardQuery() {
  return useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: getAdminDashboard,
    staleTime: 30_000,
  });
}
