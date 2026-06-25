import { useMutation } from "@tanstack/react-query";
import { validateReferenceOnly, ReferenceValidateOnlyResponse } from "@/api/referenceReview";

export interface ValidateOnlyOptions {
  style?: string;
  citationFormat?: string;
}

export function useReferenceValidateOnly(fileId: number) {
  return useMutation<ReferenceValidateOnlyResponse, Error, ValidateOnlyOptions | undefined>({
    mutationFn: (opts?: ValidateOnlyOptions) =>
      validateReferenceOnly(fileId, opts?.style, opts?.citationFormat),
  });
}
