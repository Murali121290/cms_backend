import { useQuery } from "@tanstack/react-query";
import { getCitationComments } from "@/api/referenceReview";

export function useCitationComments(fileId: number) {
  return useQuery({
    queryKey: ["citationComments", fileId],
    queryFn: () => getCitationComments(fileId),
    enabled: fileId > 0,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}
