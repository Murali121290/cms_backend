import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addCitationComment, type AddCommentRequest } from "@/api/referenceReview";

export function useAddCitationComment(fileId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentData: AddCommentRequest) =>
      addCitationComment(fileId, commentData),
    onSuccess: () => {
      // Invalidate comments query to refresh
      queryClient.invalidateQueries({
        queryKey: ["citationComments", fileId],
      });
    },
  });
}
