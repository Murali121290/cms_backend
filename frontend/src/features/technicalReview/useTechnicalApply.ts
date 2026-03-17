import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/api/client";
import { applyTechnicalReview } from "@/api/technicalReview";
import type { TechnicalApplyResponse } from "@/types/api";

interface UseTechnicalApplyOptions {
  projectId: number | null;
  chapterId: number | null;
  fileId: number | null;
}

export function useTechnicalApply({
  projectId,
  chapterId,
  fileId,
}: UseTechnicalApplyOptions) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<TechnicalApplyResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const applyMutation = useMutation({
    mutationFn: (replacements: Record<string, string>) =>
      applyTechnicalReview(fileId as number, replacements),
  });

  async function refreshReadState() {
    if (projectId === null || chapterId === null || fileId === null) {
      return;
    }

    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["technical-review", fileId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["chapter-detail", projectId, chapterId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["chapter-files", projectId, chapterId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["project-detail", projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["project-chapters", projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["projects"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["dashboard"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["notifications"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["activities"],
      }),
    ]);
  }

  async function apply(replacements: Record<string, string>) {
    setResult(null);
    setErrorMessage(null);
    setStatusMessage("Applying technical review changes...");

    try {
      const response = await applyMutation.mutateAsync(replacements);
      await refreshReadState();
      setResult(response);
      setStatusMessage(`Technical review applied. Created ${response.new_file.filename}.`);
      return response;
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Failed to apply technical review."));
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
    isPending: applyMutation.isPending,
    result,
    errorMessage,
    statusMessage,
    apply,
    clearMessages,
  };
}
