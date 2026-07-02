import type { CropRect } from "./ImageNode";

export interface BakeOptions {
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  brightness: number;
  contrast: number;
  cropRect: CropRect;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image for baking"));
    img.src = src;
  });
}

export async function bakeImage(src: string, opts: BakeOptions): Promise<string> {
  const img = await loadImage(src);
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;

  const crop = opts.cropRect;
  const srcX = crop ? Math.max(0, Math.round((crop.x / 100) * naturalW)) : 0;
  const srcY = crop ? Math.max(0, Math.round((crop.y / 100) * naturalH)) : 0;
  const srcW = crop
    ? Math.max(1, Math.round((crop.w / 100) * naturalW))
    : naturalW;
  const srcH = crop
    ? Math.max(1, Math.round((crop.h / 100) * naturalH))
    : naturalH;

  const rotation = ((opts.rotation % 360) + 360) % 360;
  const swap = rotation === 90 || rotation === 270;
  const outW = swap ? srcH : srcW;
  const outH = swap ? srcW : srcH;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.save();
  const filters: string[] = [];
  if (opts.brightness !== 1) filters.push(`brightness(${opts.brightness})`);
  if (opts.contrast !== 1) filters.push(`contrast(${opts.contrast})`);
  if (filters.length) ctx.filter = filters.join(" ");

  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(opts.flipH ? -1 : 1, opts.flipV ? -1 : 1);
  ctx.drawImage(img, srcX, srcY, srcW, srcH, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx.restore();

  const mime = src.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
  try {
    return canvas.toDataURL(mime, mime === "image/jpeg" ? 0.92 : undefined);
  } catch {
    throw new Error(
      "Cannot export edited image — the source image is cross-origin and cannot be read from a canvas.",
    );
  }
}

export function editAttrsChanged(attrs: {
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  brightness: number;
  contrast: number;
  cropRect: CropRect;
}): boolean {
  return (
    attrs.rotation !== 0 ||
    attrs.flipH ||
    attrs.flipV ||
    attrs.brightness !== 1 ||
    attrs.contrast !== 1 ||
    attrs.cropRect !== null
  );
}
