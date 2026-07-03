import { useMutation, useQueryClient } from "@tanstack/react-query";

import { uploadChapterFiles } from "@/api/files";
import type { ProjectImage } from "./api";

interface SaveArgs {
  image: ProjectImage;
  bakedBlob: Blob;
  bakedMime: string;
}

function chooseSaveFilename(image: ProjectImage, bakedMime: string): string {
  // If the source was a browser-safe format, keep the exact filename so the
  // upload endpoint archives + versions in place. For TIFF/EPS we can't ship
  // the edited PNG through the same extension without a server transcode; use
  // a ".png" sibling filename so the copy is unambiguous. The convert
  // endpoint is available separately if the user wants to fold it back into
  // the original format.
  if (!image.needs_transcoding) return image.filename;
  const stem = image.filename.includes(".")
    ? image.filename.slice(0, image.filename.lastIndexOf("."))
    : image.filename;
  const ext = bakedMime === "image/jpeg" ? "jpg" : "png";
  return `${stem}-edited.${ext}`;
}

export function useSaveEditedImage(projectId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ image, bakedBlob, bakedMime }: SaveArgs) => {
      if (image.chapter_id == null) {
        throw new Error("This image is not attached to a chapter; cannot save.");
      }
      const filename = chooseSaveFilename(image, bakedMime);
      const file = new File([bakedBlob], filename, { type: bakedMime });
      return uploadChapterFiles({
        projectId,
        chapterId: image.chapter_id,
        category: image.category || "Art",
        files: [file],
      });
    },
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
