import { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

import type { CropRect } from "./ImageNode";
import { useImageEditing } from "./imageEditingContext";

const MIN_WIDTH = 32;
const MIN_CROP_PERCENT = 5;

type Corner = "nw" | "ne" | "sw" | "se";

interface DragState {
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  aspect: number;
  corner: Corner;
}

interface CropDragState {
  mode: "move" | "resize";
  corner?: Corner;
  startX: number;
  startY: number;
  startRect: { x: number; y: number; w: number; h: number };
  containerRect: DOMRect;
}

export function ImageNodeView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const { cropMode, setCropMode } = useImageEditing();
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const [imgReady, setImgReady] = useState(false);
  const [pxSize, setPxSize] = useState<{ w: number; h: number } | null>(null);

  const {
    src,
    alt,
    title,
    width,
    height,
    rotation,
    flipH,
    flipV,
    brightness,
    contrast,
    cropRect,
    originalSrc,
  } = node.attrs as {
    src: string;
    alt: string | null;
    title: string | null;
    width: number | null;
    height: number | null;
    rotation: number;
    flipH: boolean;
    flipV: boolean;
    brightness: number;
    contrast: number;
    cropRect: CropRect;
    originalSrc: string | null;
  };

  // Ensure originalSrc is captured the first time the node renders.
  useEffect(() => {
    if (!originalSrc && src) {
      updateAttributes({ originalSrc: src });
    }
  }, [originalSrc, src, updateAttributes]);

  const handleLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setImgReady(true);
    if (width == null || height == null) {
      updateAttributes({ width: img.naturalWidth, height: img.naturalHeight });
    }
  }, [width, height, updateAttributes]);

  useEffect(() => {
    if (!selected && cropMode) {
      setCropMode(false);
    }
  }, [selected, cropMode, setCropMode]);

  // Track rendered size so overlays line up.
  useEffect(() => {
    if (!imgReady) return;
    const el = imgRef.current;
    if (!el) return;
    const update = () => {
      setPxSize({ w: el.clientWidth, h: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [imgReady, width, height]);

  // ── Resize handles ────────────────────────────────────────────────────────
  const dragRef = useRef<DragState | null>(null);
  const startResize = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>, corner: Corner) => {
      e.preventDefault();
      e.stopPropagation();
      const img = imgRef.current;
      if (!img) return;
      const rect = img.getBoundingClientRect();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startW: rect.width,
        startH: rect.height,
        aspect: rect.width / Math.max(1, rect.height),
        corner,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const signX = d.corner === "ne" || d.corner === "se" ? 1 : -1;
      const signY = d.corner === "sw" || d.corner === "se" ? 1 : -1;
      let newW = d.startW + signX * dx;
      let newH = d.startH + signY * dy;
      // Constrain to aspect ratio, driven by whichever axis moved more.
      if (Math.abs(dx) > Math.abs(dy)) {
        newH = newW / d.aspect;
      } else {
        newW = newH * d.aspect;
      }
      newW = Math.max(MIN_WIDTH, Math.round(newW));
      newH = Math.max(MIN_WIDTH, Math.round(newH));
      updateAttributes({ width: newW, height: newH });
    },
    [updateAttributes],
  );

  const endResize = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    if (dragRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dragRef.current = null;
    }
  }, []);

  // ── Crop overlay dragging ────────────────────────────────────────────────
  const cropDragRef = useRef<CropDragState | null>(null);
  const currentCrop: CropRect =
    cropRect ?? (cropMode ? { x: 10, y: 10, w: 80, h: 80 } : null);

  useEffect(() => {
    if (cropMode && !cropRect) {
      updateAttributes({ cropRect: { x: 10, y: 10, w: 80, h: 80 } });
    }
  }, [cropMode, cropRect, updateAttributes]);

  const beginCropDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, mode: "move" | "resize", corner?: Corner) => {
      const container = containerRef.current;
      const img = imgRef.current;
      if (!container || !img || !currentCrop) return;
      e.preventDefault();
      e.stopPropagation();
      cropDragRef.current = {
        mode,
        corner,
        startX: e.clientX,
        startY: e.clientY,
        startRect: { ...currentCrop },
        containerRect: img.getBoundingClientRect(),
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [currentCrop],
  );

  const onCropPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = cropDragRef.current;
      if (!d) return;
      const rect = d.containerRect;
      const dxPct = ((e.clientX - d.startX) / rect.width) * 100;
      const dyPct = ((e.clientY - d.startY) / rect.height) * 100;
      let { x, y, w, h } = d.startRect;

      if (d.mode === "move") {
        x = Math.max(0, Math.min(100 - w, x + dxPct));
        y = Math.max(0, Math.min(100 - h, y + dyPct));
      } else if (d.mode === "resize" && d.corner) {
        if (d.corner === "nw") {
          const nx = Math.max(0, Math.min(x + w - MIN_CROP_PERCENT, x + dxPct));
          const ny = Math.max(0, Math.min(y + h - MIN_CROP_PERCENT, y + dyPct));
          w = w + (x - nx);
          h = h + (y - ny);
          x = nx;
          y = ny;
        } else if (d.corner === "ne") {
          const ny = Math.max(0, Math.min(y + h - MIN_CROP_PERCENT, y + dyPct));
          w = Math.max(MIN_CROP_PERCENT, Math.min(100 - x, w + dxPct));
          h = h + (y - ny);
          y = ny;
        } else if (d.corner === "sw") {
          const nx = Math.max(0, Math.min(x + w - MIN_CROP_PERCENT, x + dxPct));
          w = w + (x - nx);
          h = Math.max(MIN_CROP_PERCENT, Math.min(100 - y, h + dyPct));
          x = nx;
        } else if (d.corner === "se") {
          w = Math.max(MIN_CROP_PERCENT, Math.min(100 - x, w + dxPct));
          h = Math.max(MIN_CROP_PERCENT, Math.min(100 - y, h + dyPct));
        }
      }
      updateAttributes({ cropRect: { x, y, w, h } });
    },
    [updateAttributes],
  );

  const endCropDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (cropDragRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      cropDragRef.current = null;
    }
  }, []);

  // ── Rendering ────────────────────────────────────────────────────────────
  const rotationCss = `rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`;
  const filterCss = `brightness(${brightness}) contrast(${contrast})`;
  const clipPath =
    cropRect && !cropMode
      ? `inset(${cropRect.y}% ${100 - (cropRect.x + cropRect.w)}% ${100 - (cropRect.y + cropRect.h)}% ${cropRect.x}%)`
      : undefined;

  const editable = editor?.isEditable !== false;
  const showHandles = selected && editable && !cropMode;
  const showCrop = selected && editable && cropMode && currentCrop;

  return (
    <NodeViewWrapper
      as="span"
      className="tt-image-wrapper"
      style={{
        display: "inline-block",
        position: "relative",
        maxWidth: "100%",
        lineHeight: 0,
      }}
      data-selected={selected ? "true" : "false"}
    >
      <span
        ref={containerRef}
        style={{ position: "relative", display: "inline-block", lineHeight: 0 }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt ?? ""}
          title={title ?? undefined}
          width={width ?? undefined}
          height={height ?? undefined}
          onLoad={handleLoad}
          draggable={false}
          onClick={(e) => {
            e.stopPropagation();
          }}
          style={{
            display: "block",
            maxWidth: "100%",
            height: "auto",
            transform: rotationCss,
            filter: filterCss,
            clipPath,
            outline: selected
              ? "2px solid rgba(217, 119, 6, 0.85)"
              : "1px solid transparent",
            outlineOffset: selected ? "2px" : 0,
            transition:
              "transform 120ms ease, filter 120ms ease, outline-color 120ms ease",
            userSelect: "none",
          }}
        />

        {/* Resize handles */}
        {showHandles && pxSize && (
          <>
            {(["nw", "ne", "sw", "se"] as Corner[]).map((c) => (
              <span
                key={c}
                onPointerDown={(e) => startResize(e, c)}
                onPointerMove={onResizePointerMove}
                onPointerUp={endResize}
                onPointerCancel={endResize}
                style={{
                  position: "absolute",
                  width: 12,
                  height: 12,
                  background: "#d97706",
                  border: "2px solid #fff",
                  borderRadius: 3,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
                  cursor:
                    c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize",
                  top: c.startsWith("n") ? -6 : "auto",
                  bottom: c.startsWith("s") ? -6 : "auto",
                  left: c.endsWith("w") ? -6 : "auto",
                  right: c.endsWith("e") ? -6 : "auto",
                  touchAction: "none",
                  zIndex: 5,
                }}
                aria-label={`Resize ${c}`}
              />
            ))}
          </>
        )}

        {/* Crop overlay */}
        {showCrop && currentCrop && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
          >
            {/* Dim outside area with four rectangles so the crop window stays clear. */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                height: `${currentCrop.y}%`,
                background: "rgba(0,0,0,0.45)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                top: `${currentCrop.y + currentCrop.h}%`,
                width: "100%",
                height: `${100 - (currentCrop.y + currentCrop.h)}%`,
                background: "rgba(0,0,0,0.45)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                top: `${currentCrop.y}%`,
                width: `${currentCrop.x}%`,
                height: `${currentCrop.h}%`,
                background: "rgba(0,0,0,0.45)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${currentCrop.x + currentCrop.w}%`,
                top: `${currentCrop.y}%`,
                width: `${100 - (currentCrop.x + currentCrop.w)}%`,
                height: `${currentCrop.h}%`,
                background: "rgba(0,0,0,0.45)",
              }}
            />

            {/* Crop window (draggable) */}
            <div
              onPointerDown={(e) => beginCropDrag(e, "move")}
              onPointerMove={onCropPointerMove}
              onPointerUp={endCropDrag}
              onPointerCancel={endCropDrag}
              style={{
                position: "absolute",
                left: `${currentCrop.x}%`,
                top: `${currentCrop.y}%`,
                width: `${currentCrop.w}%`,
                height: `${currentCrop.h}%`,
                border: "1px dashed #fbbf24",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.4) inset",
                cursor: "move",
                pointerEvents: "auto",
                touchAction: "none",
              }}
            >
              {(["nw", "ne", "sw", "se"] as Corner[]).map((c) => (
                <div
                  key={c}
                  onPointerDown={(e) => beginCropDrag(e, "resize", c)}
                  onPointerMove={onCropPointerMove}
                  onPointerUp={endCropDrag}
                  onPointerCancel={endCropDrag}
                  style={{
                    position: "absolute",
                    width: 10,
                    height: 10,
                    background: "#fbbf24",
                    border: "1.5px solid #fff",
                    borderRadius: 2,
                    top: c.startsWith("n") ? -5 : "auto",
                    bottom: c.startsWith("s") ? -5 : "auto",
                    left: c.endsWith("w") ? -5 : "auto",
                    right: c.endsWith("e") ? -5 : "auto",
                    cursor:
                      c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize",
                    touchAction: "none",
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </span>
    </NodeViewWrapper>
  );
}
