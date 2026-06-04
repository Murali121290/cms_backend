import { useMutation, useQueryClient } from "@tanstack/react-query";
import { linkCitationToReference, type LinkCitationRequest } from "@/api/referenceReview";

export function useCitationLinking(fileId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (linkData: LinkCitationRequest) =>
      linkCitationToReference(fileId, linkData),
    onSuccess: () => {
      // Invalidate related queries to refresh data
      queryClient.invalidateQueries({
        queryKey: ["citationComments", fileId],
      });
      queryClient.invalidateQueries({
        queryKey: ["reference-review", fileId],
      });
    },
  });
}
