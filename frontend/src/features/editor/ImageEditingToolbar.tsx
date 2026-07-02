import { useCallback, useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Crop,
  Maximize,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  ZoomIn,
  ZoomOut,
  Sun,
  Contrast as ContrastIcon,
  Undo,
  Redo,
  RefreshCw,
  Check,
  X as XIcon,
} from "lucide-react";

import { IMAGE_DEFAULT_ATTRS } from "./ImageNode";
import { useImageEditing } from "./imageEditingContext";
import { bakeImage, editAttrsChanged } from "./imageBaking";

interface Props {
  editor: Editor | null;
  imagePos: number | null;
  onExit: () => void;
}

const ToolButton = ({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`p-1.5 rounded-md transition-all duration-150 ${
      active
        ? "bg-amber-600 text-white shadow-sm shadow-amber-500/10"
        : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
    } ${disabled ? "opacity-35 cursor-not-allowed" : "cursor-pointer"}`}
  >
    {children}
  </button>
);

const Divider = () => <div className="w-px h-5 bg-slate-700 mx-1" />;

export function ImageEditingToolbar({ editor, imagePos, onExit }: Props) {
  const { cropMode, setCropMode, viewZoom, setViewZoom } = useImageEditing();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resizeOpen, setResizeOpen] = useState(false);
  // Force a re-render on every editor transaction so slider/toggle values
  // reflect live attribute changes while the user is dragging.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const bump = () => setTick((n) => n + 1);
    editor.on("transaction", bump);
    return () => {
      editor.off("transaction", bump);
    };
  }, [editor]);

  const node = useMemo(() => {
    if (!editor || imagePos == null) return null;
    return editor.state.doc.nodeAt(imagePos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, imagePos, tick]);

  const attrs = (node?.attrs ?? {}) as {
    src?: string;
    originalSrc?: string | null;
    rotation?: number;
    flipH?: boolean;
    flipV?: boolean;
    brightness?: number;
    contrast?: number;
    cropRect?: { x: number; y: number; w: number; h: number } | null;
    width?: number | null;
    height?: number | null;
  };

  useEffect(() => {
    // Auto-exit crop mode when selection leaves the image.
    return () => {
      if (cropMode) setCropMode(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateAttrs = useCallback(
    (patch: Record<string, unknown>) => {
      if (!editor || imagePos == null) return;
      const tr = editor.state.tr.setNodeMarkup(imagePos, undefined, {
        ...editor.state.doc.nodeAt(imagePos)?.attrs,
        ...patch,
      });
      editor.view.dispatch(tr);
    },
    [editor, imagePos],
  );

  const rotate = (dir: -1 | 1) => {
    const current = attrs.rotation ?? 0;
    const next = (((current + dir * 90) % 360) + 360) % 360;
    updateAttrs({ rotation: next });
  };

  const flip = (axis: "h" | "v") => {
    updateAttrs({
      flipH: axis === "h" ? !attrs.flipH : attrs.flipH,
      flipV: axis === "v" ? !attrs.flipV : attrs.flipV,
    });
  };

  const resetEdits = () => {
    if (!editor || imagePos == null) return;
    updateAttrs({ ...IMAGE_DEFAULT_ATTRS });
    setCropMode(false);
  };

  const cancelAndExit = () => {
    resetEdits();
    onExit();
  };

  const zoomIn = () => setViewZoom(Math.min(3, +(viewZoom + 0.1).toFixed(2)));
  const zoomOut = () => setViewZoom(Math.max(0.4, +(viewZoom - 0.1).toFixed(2)));

  const save = async () => {
    if (!editor || imagePos == null || !node) return;
    const dirty = editAttrsChanged({
      rotation: attrs.rotation ?? 0,
      flipH: !!attrs.flipH,
      flipV: !!attrs.flipV,
      brightness: attrs.brightness ?? 1,
      contrast: attrs.contrast ?? 1,
      cropRect: attrs.cropRect ?? null,
    });
    if (!dirty) {
      onExit();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const source = attrs.originalSrc ?? attrs.src ?? "";
      if (!source) throw new Error("Image has no source");
      const dataUrl = await bakeImage(source, {
        rotation: attrs.rotation ?? 0,
        flipH: !!attrs.flipH,
        flipV: !!attrs.flipV,
        brightness: attrs.brightness ?? 1,
        contrast: attrs.contrast ?? 1,
        cropRect: attrs.cropRect ?? null,
      });

      // Walk the doc and update every image node that shares the same origin,
      // baking the new data URL into src and clearing edit attrs so the change
      // is durable in the persisted HTML.
      const originalSrc = attrs.originalSrc ?? attrs.src;
      const tr = editor.state.tr;
      editor.state.doc.descendants((n, pos) => {
        if (n.type.name !== "image") return true;
        const nOrig = n.attrs.originalSrc ?? n.attrs.src;
        if (nOrig !== originalSrc) return true;
        tr.setNodeMarkup(pos, undefined, {
          ...n.attrs,
          src: dataUrl,
          originalSrc: dataUrl,
          ...IMAGE_DEFAULT_ATTRS,
          width: null,
          height: null,
        });
        return true;
      });
      editor.view.dispatch(tr);
      setCropMode(false);
      onExit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save edited image");
    } finally {
      setSaving(false);
    }
  };

  const disabled = !editor || imagePos == null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap w-full">
      <span className="text-[10px] uppercase tracking-wider font-bold text-amber-400 pr-1">
        Image
      </span>
      <Divider />

      <ToolButton
        active={cropMode}
        disabled={disabled}
        onClick={() => setCropMode(!cropMode)}
        title="Crop — drag the crop box to adjust; click again to apply the marquee"
      >
        <Crop className="w-4 h-4" />
      </ToolButton>

      {/* Resize opens an inline width input; actual resize is via corner handles too. */}
      <div className="relative">
        <ToolButton
          active={resizeOpen}
          disabled={disabled}
          onClick={() => setResizeOpen((v) => !v)}
          title="Resize (or drag corner handles)"
        >
          <Maximize className="w-4 h-4" />
        </ToolButton>
        {resizeOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-[#0c1222] border border-slate-700 rounded-md p-2 flex items-center gap-2 shadow-xl">
            <label className="text-[10px] uppercase text-slate-400">W</label>
            <input
              type="number"
              min={16}
              defaultValue={attrs.width ?? ""}
              onChange={(e) => {
                const w = Number(e.target.value);
                if (!Number.isFinite(w) || w < 16) return;
                const currentW = attrs.width;
                const currentH = attrs.height;
                if (currentW && currentH) {
                  const ratio = currentH / currentW;
                  updateAttrs({ width: w, height: Math.round(w * ratio) });
                } else {
                  updateAttrs({ width: w });
                }
              }}
              className="w-16 px-1.5 py-1 text-xs bg-slate-900 text-white border border-slate-700 rounded"
            />
            <span className="text-[10px] text-slate-500">px</span>
          </div>
        )}
      </div>

      <Divider />

      <ToolButton disabled={disabled} onClick={() => rotate(-1)} title="Rotate Left 90°">
        <RotateCcw className="w-4 h-4" />
      </ToolButton>
      <ToolButton disabled={disabled} onClick={() => rotate(1)} title="Rotate Right 90°">
        <RotateCw className="w-4 h-4" />
      </ToolButton>
      <ToolButton
        active={!!attrs.flipH}
        disabled={disabled}
        onClick={() => flip("h")}
        title="Flip Horizontal"
      >
        <FlipHorizontal className="w-4 h-4" />
      </ToolButton>
      <ToolButton
        active={!!attrs.flipV}
        disabled={disabled}
        onClick={() => flip("v")}
        title="Flip Vertical"
      >
        <FlipVertical className="w-4 h-4" />
      </ToolButton>

      <Divider />

      <ToolButton onClick={zoomOut} disabled={viewZoom <= 0.4} title="Zoom Out (view only)">
        <ZoomOut className="w-4 h-4" />
      </ToolButton>
      <span className="text-[10px] font-mono text-slate-400 w-10 text-center">
        {Math.round(viewZoom * 100)}%
      </span>
      <ToolButton onClick={zoomIn} disabled={viewZoom >= 3} title="Zoom In (view only)">
        <ZoomIn className="w-4 h-4" />
      </ToolButton>

      <Divider />

      <div className="flex items-center gap-1.5" title="Brightness">
        <Sun className="w-3.5 h-3.5 text-slate-400" />
        <input
          type="range"
          min={0.3}
          max={1.7}
          step={0.02}
          disabled={disabled}
          value={attrs.brightness ?? 1}
          onChange={(e) => updateAttrs({ brightness: Number(e.target.value) })}
          className="w-20 accent-amber-500"
        />
      </div>
      <div className="flex items-center gap-1.5" title="Contrast">
        <ContrastIcon className="w-3.5 h-3.5 text-slate-400" />
        <input
          type="range"
          min={0.3}
          max={1.7}
          step={0.02}
          disabled={disabled}
          value={attrs.contrast ?? 1}
          onChange={(e) => updateAttrs({ contrast: Number(e.target.value) })}
          className="w-20 accent-amber-500"
        />
      </div>

      <Divider />

      <ToolButton
        onClick={() => editor?.chain().focus().undo().run()}
        disabled={!editor?.can().undo()}
        title="Undo (Ctrl+Z)"
      >
        <Undo className="w-4 h-4" />
      </ToolButton>
      <ToolButton
        onClick={() => editor?.chain().focus().redo().run()}
        disabled={!editor?.can().redo()}
        title="Redo (Ctrl+Y)"
      >
        <Redo className="w-4 h-4" />
      </ToolButton>

      <Divider />

      <ToolButton onClick={resetEdits} disabled={disabled} title="Reset all edits on this image">
        <RefreshCw className="w-4 h-4" />
      </ToolButton>
      <button
        type="button"
        onClick={cancelAndExit}
        disabled={disabled}
        title="Cancel & discard edits"
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800 disabled:opacity-40"
      >
        <XIcon className="w-3.5 h-3.5" /> Cancel
      </button>
      <button
        type="button"
        onClick={save}
        disabled={disabled || saving}
        title="Save (bake edits into the image)"
        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40"
      >
        <Check className="w-3.5 h-3.5" />
        {saving ? "Saving…" : "Save"}
      </button>

      {error && (
        <span className="ml-2 text-[10px] text-rose-400 font-mono max-w-[280px] truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
