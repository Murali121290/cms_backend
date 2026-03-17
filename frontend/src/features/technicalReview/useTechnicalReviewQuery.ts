import { useQuery } from "@tanstack/react-query";

import { getTechnicalReview } from "@/api/technicalReview";

export function useTechnicalReviewQuery(fileId: number | null) {
  return useQuery({
    queryKey: ["technical-review", fileId],
    queryFn: () => getTechnicalReview(fileId as number),
    enabled: fileId !== null,
    staleTime: 30_000,
  });
}
