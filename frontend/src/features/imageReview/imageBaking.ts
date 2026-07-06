export type CropRect = { x: number; y: number; w: number; h: number } | null;

export interface BakeOptions {
  rotation: number;
  cropRect: CropRect;
  /** Target pixel resolution — resamples the crop into these dimensions. */
  targetWidth: number | null;
  targetHeight: number | null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image for baking"));
    img.src = src;
  });
}

/**
 * Flatten the current edit state into a fresh PNG/JPEG data URL via canvas.
 * Pipeline: crop → rotate → resample to target resolution. DPI metadata is
 * applied server-side because canvas cannot embed density chunks.
 */
export async function bakeImage(src: string, opts: BakeOptions): Promise<string> {
  const img = await loadImage(src);
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;

  const crop = opts.cropRect;
  const srcX = crop ? Math.max(0, Math.round((crop.x / 100) * naturalW)) : 0;
  const srcY = crop ? Math.max(0, Math.round((crop.y / 100) * naturalH)) : 0;
  const srcW = crop ? Math.max(1, Math.round((crop.w / 100) * naturalW)) : naturalW;
  const srcH = crop ? Math.max(1, Math.round((crop.h / 100) * naturalH)) : naturalH;

  const rotation = ((opts.rotation % 360) + 360) % 360;
  const rotated = rotation === 90 || rotation === 270;
  const cropOutW = rotated ? srcH : srcW;
  const cropOutH = rotated ? srcW : srcH;

  const outW = opts.targetWidth && opts.targetWidth > 0 ? opts.targetWidth : cropOutW;
  const outH = opts.targetHeight && opts.targetHeight > 0 ? opts.targetHeight : cropOutH;

  // Draw crop+rotate onto an intermediate canvas at natural dimensions, then
  // (if resampling) blit onto a second canvas at the final target size. Doing
  // the resample in a second pass lets the browser pick a smoothing filter,
  // which is important for aggressive downscales.
  const stage = document.createElement("canvas");
  stage.width = cropOutW;
  stage.height = cropOutH;
  const sctx = stage.getContext("2d");
  if (!sctx) throw new Error("Canvas 2D context unavailable");
  sctx.save();
  sctx.translate(cropOutW / 2, cropOutH / 2);
  sctx.rotate((rotation * Math.PI) / 180);
  sctx.drawImage(img, srcX, srcY, srcW, srcH, -srcW / 2, -srcH / 2, srcW, srcH);
  sctx.restore();

  let finalCanvas: HTMLCanvasElement = stage;
  if (outW !== cropOutW || outH !== cropOutH) {
    const scaled = document.createElement("canvas");
    scaled.width = outW;
    scaled.height = outH;
    const rctx = scaled.getContext("2d");
    if (!rctx) throw new Error("Canvas 2D context unavailable");
    rctx.imageSmoothingEnabled = true;
    rctx.imageSmoothingQuality = "high";
    rctx.drawImage(stage, 0, 0, outW, outH);
    finalCanvas = scaled;
  }

  const mime = src.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
  try {
    return finalCanvas.toDataURL(mime, mime === "image/jpeg" ? 0.92 : undefined);
  } catch {
    throw new Error(
      "Cannot export edited image — the source image is cross-origin and cannot be read from a canvas.",
    );
  }
}
