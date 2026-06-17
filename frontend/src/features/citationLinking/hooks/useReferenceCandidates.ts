import { useQuery } from "@tanstack/react-query";
import { getReferenceCandidates } from "@/api/referenceReview";

export function useReferenceCandidates(
  fileId: number,
  refText: string,
  refIdx?: number
) {
  return useQuery({
    queryKey: ["referenceCandidates", fileId, refText, refIdx],
    queryFn: () => getReferenceCandidates(fileId, refText, refIdx),
    enabled: !!refText && fileId > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
