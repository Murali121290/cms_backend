import { useQuery } from "@tanstack/react-query";

import { getTechnicalReview } from "@/api/technicalReview";

/**
 * Runs the technical-review scan for a single file, on demand.
 * Disabled until a file is selected.
 */
export function useQualityReviewQuery(fileId: number | null) {
  return useQuery({
    queryKey: ["quality-review", fileId],
    queryFn: () => getTechnicalReview(fileId as number),
    enabled: fileId !== null,
    staleTime: 30_000,
    retry: false,
  });
}
