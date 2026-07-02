import { useQuery } from "@tanstack/react-query";
import { getReferenceReview } from "@/api/referenceReview";

export function useReferenceReviewQuery(fileId: number | null, style?: string, citationFormat?: string) {
  return useQuery({
    queryKey: ["reference-review", fileId, style, citationFormat],
    queryFn: () => getReferenceReview(fileId as number, style, citationFormat),
    enabled: fileId !== null,
    staleTime: 0,  // Always refetch on explicit refetch() — data changes after each validate
  });
}
