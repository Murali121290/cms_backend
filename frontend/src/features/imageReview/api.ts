import { apiClient } from "@/api/client";

export interface ProjectImage {
  id: number;
  project_id: number;
  chapter_id: number | null;
  chapter_number: string | null;
  chapter_title: string | null;
  filename: string;
  file_type: string;
  category: string;
  version: number;
  uploaded_at: string | null;
  download_url: string;
  preview_url: string;
  needs_transcoding: boolean;
}

export interface ProjectImagesResponse {
  project: { id: number; code: string; name: string };
  images: ProjectImage[];
}

export async function getProjectImages(projectId: number): Promise<ProjectImagesResponse> {
  const res = await apiClient.get<ProjectImagesResponse>(`/projects/${projectId}/images`);
  return res.data;
}

export interface ConvertImageArgs {
  fileId: number;
  target_format: "png" | "jpg" | "tif";
  mode?: "copy" | "in_place";
}

export async function convertImage({
  fileId,
  target_format,
  mode = "copy",
}: ConvertImageArgs) {
  const res = await apiClient.post<{
    status: string;
    mode: string;
    file: {
      id: number;
      project_id: number;
      chapter_id: number | null;
      filename: string;
      file_type: string;
      category: string;
      version: number;
    };
  }>(`/files/${fileId}/convert`, { target_format, mode });
  return res.data;
}

export interface ReplaceImageArgs {
  fileId: number;
  file: File;
  reason: string;
}

export async function replaceImage({ fileId, file, reason }: ReplaceImageArgs) {
  const form = new FormData();
  form.append("file", file);
  form.append("reason", reason);
  const res = await apiClient.post<{
    status: string;
    reason: string;
    file: {
      id: number;
      project_id: number;
      chapter_id: number | null;
      filename: string;
      file_type: string;
      category: string;
      version: number;
    };
  }>(`/files/${fileId}/replace`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function exportSelectedImages(projectId: number, fileIds: number[]): Promise<Blob> {
  const res = await apiClient.post<Blob>(
    `/projects/${projectId}/images/export`,
    { file_ids: fileIds },
    { responseType: "blob" },
  );
  return res.data;
}
