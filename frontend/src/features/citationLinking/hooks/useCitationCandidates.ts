import { useQuery } from "@tanstack/react-query";
import { getCitationCandidates } from "@/api/referenceReview";

export function useCitationCandidates(
  fileId: number,
  citationText: string,
  author?: string,
  year?: string
) {
  return useQuery({
    queryKey: ["citationCandidates", fileId, citationText, author, year],
    queryFn: () => getCitationCandidates(fileId, citationText, author, year),
    enabled: !!citationText && fileId > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
