import { useQuery } from "@tanstack/react-query";

import { getProjects } from "@/api/projects";

export function useProjectsQuery(offset = 0, limit = 100) {
  return useQuery({
    queryKey: ["projects", offset, limit],
    queryFn: () => getProjects(offset, limit),
    staleTime: 30_000,
  });
}
