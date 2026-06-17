import { useQuery } from "@tanstack/react-query";

import { getChapterFiles } from "@/api/projects";

export function useChapterFilesQuery(projectId: number | null, chapterId: number | null) {
  return useQuery({
    queryKey: ["chapter-files", projectId, chapterId],
    queryFn: () => getChapterFiles(projectId as number, chapterId as number),
    enabled: projectId !== null && chapterId !== null,
    staleTime: 30_000,
    // Auto-poll every 5s while any file is processing (is_checked_out=true)
    refetchInterval: (query) => {
      const files = query.state.data?.files ?? [];
      const anyProcessing = files.some((f) => f.lock?.is_checked_out);
      return anyProcessing ? 5_000 : false;
    },
  });
}
