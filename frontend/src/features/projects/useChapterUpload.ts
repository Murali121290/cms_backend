import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/api/client";
import { uploadChapterFiles } from "@/api/files";
import type { FileUploadResponse } from "@/types/api";

interface UseChapterUploadOptions {
  projectId: number | null;
  chapterId: number | null;
}

export function useChapterUpload({ projectId, chapterId }: UseChapterUploadOptions) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<FileUploadResponse | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: ({
      category,
      files,
    }: {
      category: string;
      files: File[];
    }) =>
      uploadChapterFiles({
        projectId: projectId as number,
        chapterId: chapterId as number,
        category,
        files,
      }),
  });

  async function refreshReadState() {
    if (projectId === null || chapterId === null) {
      return;
    }

    await Promise.all([
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

  async function submitUpload(category: string, files: File[]) {
    setErrorMessage(null);
    setResult(null);
    setStatusMessage(`Uploading ${files.length} file${files.length === 1 ? "" : "s"} to ${category}...`);

    try {
      const response = await uploadMutation.mutateAsync({ category, files });
      await refreshReadState();
      setResult(response);
      setStatusMessage(
        `Upload finished: ${response.uploaded.length} uploaded, ${response.skipped.length} skipped.`,
      );
      return response;
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Failed to upload files."));
      setStatusMessage(null);
      throw error;
    }
  }

  function clearResult() {
    setResult(null);
    setStatusMessage(null);
    setErrorMessage(null);
  }

  return {
    isPending: uploadMutation.isPending,
    result,
    statusMessage,
    errorMessage,
    submitUpload,
    clearResult,
  };
}
