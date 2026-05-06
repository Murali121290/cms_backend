import { useQuery } from "@tanstack/react-query";

import { getNotifications } from "@/api/notifications";

export function useNotificationsQuery(limit = 5) {
  return useQuery({
    queryKey: ["notifications", limit],
    queryFn: () => getNotifications(limit),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
