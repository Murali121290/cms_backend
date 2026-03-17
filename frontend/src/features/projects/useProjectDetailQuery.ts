import { useQuery } from "@tanstack/react-query";

import { getProjectDetail } from "@/api/projects";

export function useProjectDetailQuery(projectId: number | null) {
  return useQuery({
    queryKey: ["project-detail", projectId],
    queryFn: () => getProjectDetail(projectId as number),
    enabled: projectId !== null,
    staleTime: 30_000,
  });
}
