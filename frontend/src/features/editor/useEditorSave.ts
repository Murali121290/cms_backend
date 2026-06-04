import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveFileXhtml } from "@/api/technicalReview";
import { getApiErrorMessage } from "@/api/client";
import { useState } from "react";

export function useEditorSave(fileId: number | null) {
  const queryClient = useQueryClient();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (htmlContent: string) => {
      if (!fileId) throw new Error("No file ID");
      return saveFileXhtml(fileId, htmlContent);
    },
    onSuccess: async () => {
      setStatusMessage("Document saved and converted to DOCX");
      setErrorMessage(null);
      // Invalidate xhtml query to refresh content
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
