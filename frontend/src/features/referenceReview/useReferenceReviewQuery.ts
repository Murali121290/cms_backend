import { useQuery } from "@tanstack/react-query";
import { getReferenceReview } from "@/api/referenceReview";

export function useReferenceReviewQuery(fileId: number | null, style?: string) {
  return useQuery({
    queryKey: ["reference-review", fileId, style],
    queryFn: () => getReferenceReview(fileId as number, style),
    enabled: fileId !== null,
    staleTime: 0,  // Always refetch on explicit refetch() — data changes after each validate
  });
}
