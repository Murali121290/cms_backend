import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/api/client";
import { saveStructuringReview } from "@/api/structuringReview";
import type { StructuringSaveResponse } from "@/types/api";

export function useStructuringSave(fileId: number | null) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<StructuringSaveResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: ({
      saveEndpoint,
      changes,
    }: {
      saveEndpoint: string;
      changes: Record<string, unknown>;
    }) => saveStructuringReview(saveEndpoint, changes),
  });

  async function save(saveEndpoint: string, changes: Record<string, unknown>) {
    setResult(null);
    setErrorMessage(null);
    setStatusMessage("Saving structuring review changes...");

    try {
      const response = await saveMutation.mutateAsync({ saveEndpoint, changes });
      await queryClient.invalidateQueries({
        queryKey: ["structuring-review", fileId],
      });
      setResult(response);
      setStatusMessage(
        `Saved ${response.saved_change_count} change${response.saved_change_count === 1 ? "" : "s"} to ${response.target_filename}.`,
      );
      return response;
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Failed to save structuring review."));
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
