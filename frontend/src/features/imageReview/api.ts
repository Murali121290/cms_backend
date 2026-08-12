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
  is_original: boolean;
  uploaded_at: string | null;
  download_url: string;
  preview_url: string;
  needs_transcoding: boolean;
}

export interface ProjectImagesResponse {
  project: { id: number; code: string; name: string };
  images: ProjectImage[];
}

export interface GetProjectImagesOptions {
  /**
   * When provided, the rail is scoped to a single chapter. Without this the
   * backend returns every image in the project, which is confusing when the
   * user opened the editor from a specific chapter folder — same-looking
   * thumbnails from other chapters would appear in the rail.
   */
  chapterId?: number | null;
  /**
   * When set, restricts the rail to originals (true) or converted outputs
   * (false). Used to preserve the folder context the user opened the editor
   * from — opening a file from the Originals folder should not surface
   * Converted files in the rail and vice-versa.
   */
  isOriginal?: boolean | null;
}

export async function getProjectImages(
  projectId: number,
  opts: GetProjectImagesOptions = {},
): Promise<ProjectImagesResponse> {
  const params = new URLSearchParams();
  if (opts.chapterId != null && Number.isFinite(opts.chapterId)) {
    params.set("chapter_id", String(opts.chapterId));
  }
  if (opts.isOriginal != null) {
    params.set("is_original", opts.isOriginal ? "true" : "false");
  }
  const qs = params.toString();
  const res = await apiClient.get<ProjectImagesResponse>(
    `/projects/${projectId}/images${qs ? `?${qs}` : ""}`,
  );
  return res.data;
}

export interface ConvertImageArgs {
  fileId: number;
  target_format: "png" | "jpg" | "tif" | "eps";
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

export type MetadataValue = string | number | boolean | null;
export type MetadataSection = Record<string, MetadataValue>;

export interface ImageMetadataResponse {
  file: { id: number; filename: string };
  sections: {
    file_information: MetadataSection;
    image_properties: MetadataSection;
    color_profile: MetadataSection | null;
    tiff_information: MetadataSection | null;
    photoshop_information: MetadataSection | null;
    exif_xmp: MetadataSection | null;
  };
  raw: Record<string, unknown>;
}

export async function getImageMetadata(fileId: number): Promise<ImageMetadataResponse> {
  const res = await apiClient.get<ImageMetadataResponse>(`/files/${fileId}/metadata`);
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
