import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import type { ProjectImage } from "./api";

interface SaveArgs {
  image: ProjectImage;
  bakedBlob: Blob;
  bakedMime: string;
  /** Optional DPI to write into the saved file's metadata. */
  dpi?: number | null;
}

/**
 * Save the baked image back to the file's slot. Uses the dedicated
 * `/files/{id}/edit-save` endpoint so DPI metadata can be written server-side
 * (canvas.toDataURL can't emit pHYs/JFIF density chunks).
 */
async function saveEditedImage({ image, bakedBlob, dpi }: SaveArgs) {
  const form = new FormData();
  form.append("file", bakedBlob, image.filename);
  if (dpi != null && dpi > 0) form.append("dpi", String(dpi));
  const res = await apiClient.post<{
    status: string;
    dpi_applied: number | null;
    file: {
      id: number;
      project_id: number;
      chapter_id: number | null;
      filename: string;
      file_type: string;
      category: string;
      version: number;
    };
  }>(`/files/${image.id}/edit-save`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export function useSaveEditedImage(projectId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveEditedImage,
    onSuccess: async (_data, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-images", projectId] }),
        vars.image.chapter_id != null
          ? queryClient.invalidateQueries({
              queryKey: ["chapter-files", projectId, vars.image.chapter_id],
            })
          : Promise.resolve(),
      ]);
    },
  });
}
