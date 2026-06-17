import { useQuery } from "@tanstack/react-query";

import { getFileXhtmlRuns } from "@/api/technicalReview";

/** Fetches run-anchored XHTML (the delta-patch-compatible representation). */
export function useFileXhtmlRunsQuery(fileId: number | null) {
  return useQuery({
    queryKey: ["file-xhtml-runs", fileId],
    queryFn: () => getFileXhtmlRuns(fileId as number),
    enabled: fileId !== null,
    staleTime: 60_000,
  });
}
