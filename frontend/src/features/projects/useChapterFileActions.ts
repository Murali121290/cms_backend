import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/api/client";
import {
  cancelCheckout,
  checkoutFile,
  deleteFile,
  downloadFile,
} from "@/api/files";
import type { FileRecord } from "@/types/api";

type FileActionKind = "download" | "checkout" | "cancel_checkout" | "delete";
type FileActionTone = "pending" | "success" | "error";

interface FileActionStatus {
  tone: FileActionTone;
  fileId: number;
  action: FileActionKind;
  message: string;
}

interface UseChapterFileActionsOptions {
  projectId: number | null;
  chapterId: number | null;
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(objectUrl);
}

export function useChapterFileActions({
  projectId,
  chapterId,
}: UseChapterFileActionsOptions) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<FileActionStatus | null>(null);
  const [activeAction, setActiveAction] = useState<{
    fileId: number;
    action: FileActionKind;
  } | null>(null);

  const downloadMutation = useMutation({
    mutationFn: ({ fileId, filename }: { fileId: number; filename: string }) =>
      downloadFile(fileId, filename),
  });

  const checkoutMutation = useMutation({
    mutationFn: (fileId: number) => checkoutFile(fileId),
  });

  const cancelCheckoutMutation = useMutation({
    mutationFn: (fileId: number) => cancelCheckout(fileId),
  });

  const deleteMutation = useMutation({
    mutationFn: (fileId: number) => deleteFile(fileId),
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
    ]);
  }

  function isPending(fileId: number, action: FileActionKind) {
    return activeAction?.fileId === fileId && activeAction.action === action;
  }

  async function runAction<T>({
    file,
    action,
    pendingMessage,
    successMessage,
    refreshAfterSuccess,
    execute,
  }: {
    file: FileRecord;
    action: FileActionKind;
    pendingMessage: string;
    successMessage: string;
    refreshAfterSuccess: boolean;
    execute: () => Promise<T>;
  }) {
    setActiveAction({ fileId: file.id, action });
    setStatus({
      tone: "pending",
      fileId: file.id,
      action,
      message: pendingMessage,
    });

    try {
      await execute();
      if (refreshAfterSuccess) {
        await refreshReadState();
      }
      setStatus({
        tone: "success",
        fileId: file.id,
        action,
        message: successMessage,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        fileId: file.id,
        action,
        message: getApiErrorMessage(error, `Failed to ${action.replace("_", " ")} file.`),
      });
    } finally {
      setActiveAction(null);
    }
  }

  async function handleDownload(file: FileRecord) {
    await runAction({
      file,
      action: "download",
      pendingMessage: `Downloading ${file.filename}...`,
      successMessage: `Downloaded ${file.filename}.`,
      refreshAfterSuccess: false,
      execute: async () => {
        const result = await downloadMutation.mutateAsync({
          fileId: file.id,
          filename: file.filename,
        });
        downloadBlob(result.blob, result.filename);
      },
    });
  }

  async function handleCheckout(file: FileRecord) {
    await runAction({
      file,
      action: "checkout",
      pendingMessage: `Checking out ${file.filename}...`,
      successMessage: `Checked out ${file.filename}.`,
      refreshAfterSuccess: true,
      execute: () => checkoutMutation.mutateAsync(file.id),
    });
  }

  async function handleCancelCheckout(file: FileRecord) {
    await runAction({
      file,
      action: "cancel_checkout",
      pendingMessage: `Cancelling checkout for ${file.filename}...`,
      successMessage: `Checkout cancelled for ${file.filename}.`,
      refreshAfterSuccess: true,
      execute: () => cancelCheckoutMutation.mutateAsync(file.id),
    });
  }

  async function handleDelete(file: FileRecord) {
    await runAction({
      file,
      action: "delete",
      pendingMessage: `Deleting ${file.filename}...`,
      successMessage: `Deleted ${file.filename}.`,
      refreshAfterSuccess: true,
      execute: () => deleteMutation.mutateAsync(file.id),
    });
  }

  return {
    status,
    clearStatus: () => setStatus(null),
    isPending,
    handleDownload,
    handleCheckout,
    handleCancelCheckout,
    handleDelete,
  };
}
