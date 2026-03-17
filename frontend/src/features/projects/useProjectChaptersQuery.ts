import { useQuery } from "@tanstack/react-query";

import { getProjectChapters } from "@/api/projects";

export function useProjectChaptersQuery(projectId: number | null) {
  return useQuery({
    queryKey: ["project-chapters", projectId],
    queryFn: () => getProjectChapters(projectId as number),
    enabled: projectId !== null,
    staleTime: 30_000,
  });
}
