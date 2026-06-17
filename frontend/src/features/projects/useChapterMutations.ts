import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/api/client";
import { createChapter, deleteChapter, renameChapter } from "@/api/projects";

type ChapterActionKind = "create" | "rename" | "delete";
type ChapterActionTone = "pending" | "success" | "error";

interface ChapterActionStatus {
  tone: ChapterActionTone;
  action: ChapterActionKind;
  chapterId?: number | null;
  message: string;
}

interface UseChapterMutationsOptions {
  projectId: number | null;
}

export function useChapterMutations({ projectId }: UseChapterMutationsOptions) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ChapterActionStatus | null>(null);
  const [activeAction, setActiveAction] = useState<{
    action: ChapterActionKind;
    chapterId?: number | null;
  } | null>(null);

  const createMutation = useMutation({
    mutationFn: ({ number, title }: { number: string; title: string }) =>
      createChapter(projectId as number, { number, title }),
  });
  const renameMutation = useMutation({
    mutationFn: ({
      chapterId,
      number,
      title,
    }: {
      chapterId: number;
      number: string;
      title: string;
    }) => renameChapter(projectId as number, chapterId, { number, title }),
  });
  const deleteMutation = useMutation({
    mutationFn: (chapterId: number) => deleteChapter(projectId as number, chapterId),
  });

  async function refreshReadState() {
    if (projectId === null) {
      return;
    }

    await Promise.all([
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
    ]);
  }

  function isPending(action: ChapterActionKind, chapterId?: number | null) {
    return activeAction?.action === action && activeAction?.chapterId === (chapterId ?? null);
  }

  async function runAction<T>({
    action,
    chapterId,
    pendingMessage,
    successMessage,
    execute,
  }: {
    action: ChapterActionKind;
    chapterId?: number | null;
    pendingMessage: string;
    successMessage: string;
    execute: () => Promise<T>;
  }) {
    setActiveAction({ action, chapterId: chapterId ?? null });
    setStatus({
      tone: "pending",
      action,
      chapterId,
      message: pendingMessage,
    });

    try {
      const response = await execute();
      await refreshReadState();
      setStatus({
        tone: "success",
        action,
        chapterId,
        message: successMessage,
      });
      return response;
    } catch (error) {
      setStatus({
        tone: "error",
        action,
        chapterId,
        message: getApiErrorMessage(error, `Failed to ${action} chapter.`),
      });
      throw error;
    } finally {
      setActiveAction(null);
    }
  }

  return {
    status,
    isPending,
    clearStatus: () => setStatus(null),
    createChapter: (number: string, title: string) =>
      runAction({
        action: "create",
        pendingMessage: `Creating chapter ${number}...`,
        successMessage: `Created chapter ${number}.`,
        execute: () => createMutation.mutateAsync({ number, title }),
      }),
    renameChapter: (chapterId: number, number: string, title: string) =>
      runAction({
        action: "rename",
        chapterId,
        pendingMessage: `Updating chapter ${number}...`,
        successMessage: `Updated chapter ${number}.`,
        execute: () => renameMutation.mutateAsync({ chapterId, number, title }),
      }),
    deleteChapter: (chapterId: number, number: string) =>
      runAction({
        action: "delete",
        chapterId,
        pendingMessage: `Deleting chapter ${number}...`,
        successMessage: `Deleted chapter ${number}.`,
        execute: () => deleteMutation.mutateAsync(chapterId),
      }),
  };
}
