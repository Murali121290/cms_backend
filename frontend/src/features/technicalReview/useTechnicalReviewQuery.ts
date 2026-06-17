import { useQuery } from "@tanstack/react-query";

import { getTechnicalReview } from "@/api/technicalReview";

export function useTechnicalReviewQuery(fileId: number | null, stylesheetId?: number | null) {
  return useQuery({
    queryKey: ["technical-review", fileId, stylesheetId ?? null],
    queryFn: () => getTechnicalReview(fileId as number, stylesheetId ?? undefined),
    enabled: fileId !== null,
    staleTime: 0,
    gcTime: 0,
  });
}
