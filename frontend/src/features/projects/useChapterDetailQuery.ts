import { useQuery } from "@tanstack/react-query";

import { getChapterDetail } from "@/api/projects";

export function useChapterDetailQuery(projectId: number | null, chapterId: number | null) {
  return useQuery({
    queryKey: ["chapter-detail", projectId, chapterId],
    queryFn: () => getChapterDetail(projectId as number, chapterId as number),
    enabled: projectId !== null && chapterId !== null,
    staleTime: 30_000,
  });
}
