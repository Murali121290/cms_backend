import { apiClient } from "@/api/client";

export interface CommentRecord {
  comment_uuid: string;
  text: string;
  author_id: number | null;
  author_name: string;
  created_at: string;
  updated_at: string;
  resolved: boolean;
}

export interface CommentListResponse {
  comments: CommentRecord[];
}

export async function listComments(fileId: number): Promise<CommentRecord[]> {
  const res = await apiClient.get<CommentListResponse>(`/files/${fileId}/comments`);
  return res.data.comments ?? [];
}

export async function createComment(fileId: number, commentUuid: string, text: string): Promise<CommentRecord> {
  const res = await apiClient.post<CommentRecord>(`/files/${fileId}/comments`, {
    comment_uuid: commentUuid,
    text,
  });
  return res.data;
}

export async function updateComment(
  fileId: number,
  commentUuid: string,
  patch: { text?: string; resolved?: boolean },
): Promise<CommentRecord> {
  const res = await apiClient.patch<CommentRecord>(`/files/${fileId}/comments/${commentUuid}`, patch);
  return res.data;
}

export async function deleteComment(fileId: number, commentUuid: string): Promise<void> {
  await apiClient.delete(`/files/${fileId}/comments/${commentUuid}`);
}
