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
