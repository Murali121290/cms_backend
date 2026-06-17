import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveFileXhtmlRuns } from "@/api/technicalReview";
import { getApiErrorMessage } from "@/api/client";
import { useState } from "react";

/** Save hook that uses the delta-patch xhtml-runs/save endpoint. */
export function useEditorSaveRuns(fileId: number | null) {
  const queryClient = useQueryClient();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (htmlContent: string) => {
      if (!fileId) throw new Error("No file ID");
      return saveFileXhtmlRuns(fileId, htmlContent);
    },
    onSuccess: async () => {
      setStatusMessage("Document saved and converted to DOCX");
      setErrorMessage(null);
      // Invalidate both query keys so content refreshes after save
      await queryClient.invalidateQueries({ queryKey: ["file-xhtml-runs", fileId] });
      await queryClient.invalidateQueries({ queryKey: ["file-xhtml", fileId] });
    },
    onError: (error: any) => {
      setErrorMessage(getApiErrorMessage(error, "Failed to save document"));
      setStatusMessage(null);
    },
  });

  return {
    save: mutation.mutateAsync,
    isPending: mutation.isPending,
    statusMessage,
    errorMessage,
    clearMessages: () => {
      setStatusMessage(null);
      setErrorMessage(null);
    },
  };
}
