import { useMutation } from "@tanstack/react-query";
import { validateReferenceOnly, ReferenceValidateOnlyResponse } from "@/api/referenceReview";

export function useReferenceValidateOnly(fileId: number) {
  return useMutation<ReferenceValidateOnlyResponse, Error, string | undefined>({
    mutationFn: (style?: string) => validateReferenceOnly(fileId, style),
  });
}
