import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
  type CommentRecord,
} from "@/api/comments";

const keyFor = (fileId: number | null) => ["comments", fileId] as const;

export function useCommentsQuery(fileId: number | null) {
  return useQuery({
    queryKey: keyFor(fileId),
    queryFn: () => listComments(fileId as number),
    enabled: fileId != null,
    staleTime: 30_000,
  });
}

export function useCommentMutations(fileId: number | null) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: keyFor(fileId) });

  const create = useMutation({
    mutationFn: ({ commentUuid, text }: { commentUuid: string; text: string }) =>
      createComment(fileId as number, commentUuid, text),
    onSuccess: (record) => {
      qc.setQueryData<CommentRecord[]>(keyFor(fileId), (prev) => {
        if (!prev) return [record];
        // Idempotent create: server returns the existing row if UUID collides.
        const idx = prev.findIndex((c) => c.comment_uuid === record.comment_uuid);
        if (idx === -1) return [...prev, record];
        const next = prev.slice();
        next[idx] = record;
        return next;
      });
    },
    onError: invalidate,
  });

  const update = useMutation({
    mutationFn: ({
      commentUuid,
      text,
      resolved,
    }: {
      commentUuid: string;
      text?: string;
      resolved?: boolean;
    }) => updateComment(fileId as number, commentUuid, { text, resolved }),
    onSuccess: (record) => {
      qc.setQueryData<CommentRecord[]>(keyFor(fileId), (prev) =>
        (prev ?? []).map((c) => (c.comment_uuid === record.comment_uuid ? record : c)),
      );
    },
    onError: invalidate,
  });

  const remove = useMutation({
    mutationFn: ({ commentUuid }: { commentUuid: string }) => deleteComment(fileId as number, commentUuid),
    onSuccess: (_data, vars) => {
      qc.setQueryData<CommentRecord[]>(keyFor(fileId), (prev) =>
        (prev ?? []).filter((c) => c.comment_uuid !== vars.commentUuid),
      );
    },
    onError: invalidate,
  });

  return { create, update, remove };
}
