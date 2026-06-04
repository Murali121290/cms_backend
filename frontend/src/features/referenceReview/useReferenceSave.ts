import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveReferenceReview } from "@/api/referenceReview";
import { getApiErrorMessage } from "@/api/client";
import type { ReferenceSaveResponse } from "@/api/referenceReview";

export function useReferenceSave(fileId: number | null) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<ReferenceSaveResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: ({
      saveEndpoint,
      htmlContent,
    }: {
      saveEndpoint: string;
      htmlContent: string;
    }) => saveReferenceReview(saveEndpoint, htmlContent),
  });

  async function save(saveEndpoint: string, htmlContent: string) {
    setResult(null);
    setErrorMessage(null);
    setStatusMessage("Saving reference review changes and converting...");

    try {
      const response = await saveMutation.mutateAsync({ saveEndpoint, htmlContent });
      await queryClient.invalidateQueries({
        queryKey: ["reference-review", fileId],
      });
      setResult(response);
      setStatusMessage("Document saved successfully and converted to DOCX.");
      return response;
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Failed to save references."));
      setStatusMessage(null);
      throw error;
    }
  }

  function clearMessages() {
    setResult(null);
    setErrorMessage(null);
    setStatusMessage(null);
  }

  return {
    isPending: saveMutation.isPending,
    result,
    errorMessage,
    statusMessage,
    save,
    clearMessages,
  };
}
