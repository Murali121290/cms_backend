import { useQuery } from "@tanstack/react-query";

import { getChapterFiles } from "@/api/projects";

export function useChapterFilesQuery(projectId: number | null, chapterId: number | null) {
  return useQuery({
    queryKey: ["chapter-files", projectId, chapterId],
    queryFn: () => getChapterFiles(projectId as number, chapterId as number),
    enabled: projectId !== null && chapterId !== null,
    staleTime: 30_000,
  });
}
