import { useQuery } from "@tanstack/react-query";

import { getAdminUsers } from "@/api/admin";

export function useAdminUsersQuery(offset = 0, limit = 100) {
  return useQuery({
    queryKey: ["admin-users", offset, limit],
    queryFn: () => getAdminUsers(offset, limit),
    staleTime: 30_000,
  });
}
