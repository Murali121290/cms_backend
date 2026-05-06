import { useQuery } from "@tanstack/react-query";

import { getStructuringReview } from "@/api/structuringReview";

export function useStructuringReviewQuery(fileId: number | null) {
  return useQuery({
    queryKey: ["structuring-review", fileId],
    queryFn: () => getStructuringReview(fileId as number),
    enabled: fileId !== null,
    staleTime: 30_000,
  });
}
