import { useQuery } from "@tanstack/react-query";

import { getDashboard } from "@/api/dashboard";

export function useDashboardQuery() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard(true),
    staleTime: 30_000,
  });
}
