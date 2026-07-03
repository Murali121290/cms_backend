import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Contrast as ContrastIcon,
  Crop,
  FileImage,
  FlipHorizontal,
  FlipVertical,
  Loader2,
  Maximize,
  Minimize,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Sun,
  Undo,
  Redo,
  X as XIcon,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { getProjectImages, convertImage, type ProjectImage } from "./api";
import { useSaveEditedImage } from "./useSaveEditedImage";
import { bakeImage, type CropRect } from "./imageBaking";

// ─── Editing state model ────────────────────────────────────────────────────

interface EditState {
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  brightness: number;
  contrast: number;
  cropRect: CropRect;
  width: number | null;
  height: number | null;
}

const INITIAL_EDIT_STATE: EditState = {
  rotation: 0,
  flipH: false,
  flipV: false,
  brightness: 1,
  contrast: 1,
  cropRect: null,
  width: null,
  height: null,
};

function editsDirty(s: EditState): boolean {
  return (
    s.rotation !== 0 ||
    s.flipH ||
    s.flipV ||
    s.brightness !== 1 ||
    s.contrast !== 1 ||
    s.cropRect !== null
  );
}

// Undo/redo stack over the whole edit state — cheap because each entry is a
// small POJO. We snapshot on every meaningful action instead of every
// slider tick to keep history readable.
function useEditHistory(initial: EditState) {
  const [state, setState] = useState<EditState>(initial);
  const past = useRef<EditState[]>([]);
  const future = useRef<EditState[]>([]);
  const [, force] = useState(0);
  const bump = () => force((n) => n + 1);

  const commit = useCallback((next: EditState | ((prev: EditState) => EditState)) => {
    setState((prev) => {
      const resolved = typeof next === "function" ? (next as (p: EditState) => EditState)(prev) : next;
      past.current.push(prev);
      future.current = [];
      bump();
      return resolved;
    });
  }, []);

  const patch = useCallback((next: Partial<EditState>) => {
    // Lightweight — no history entry. Used by sliders during drag.
    setState((prev) => ({ ...prev, ...next }));
  }, []);

  const undo = useCallback(() => {
    setState((prev) => {
      const last = past.current.pop();
      if (last === undefined) return prev;
      future.current.push(prev);
      bump();
      return last;
    });
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      const nxt = future.current.pop();
      if (nxt === undefined) return prev;
      past.current.push(prev);
      bump();
      return nxt;
    });
  }, []);

  const reset = useCallback((to: EditState) => {
    past.current = [];
    future.current = [];
    setState(to);
    bump();
  }, []);

  return {
    state,
    commit,
    patch,
    undo,
    redo,
    reset,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

// ─── Visual-only status stub ────────────────────────────────────────────────
// Backend does not yet track review status. Deterministically assign a status
// per image so the badges match the mockup; wire to a real field later.
type ReviewStatus = "original" | "pending" | "approved";

function stubStatusFor(image: ProjectImage): ReviewStatus {
  const seed = image.id;
  const bucket = seed % 5;
  if (bucket === 0) return "pending";
  if (bucket === 1) return "approved";
  return "original";
}

const STATUS_STYLES: Record<ReviewStatus, { label: string; className: string }> = {
  original: {
    label: "Original",
    className: "bg-slate-800 text-white",
  },
  pending: {
    label: "Pending Review",
    className: "bg-amber-500 text-white",
  },
  approved: {
    label: "Approved",
    className: "bg-emerald-500 text-white",
  },
};

// ─── Crop overlay ──────────────────────────────────────────────────────────

type Corner = "nw" | "ne" | "sw" | "se";
const MIN_CROP_PERCENT = 5;

interface CropDragState {
  mode: "move" | "resize";
  corner?: Corner;
  startX: number;
  startY: number;
  startRect: { x: number; y: number; w: number; h: number };
  containerRect: DOMRect;
}

// ─── Page ─────────────────────────────────────────────────────────────────

export function ImageReviewPage() {
  const { projectId: projectIdParam } = useParams<{ projectId: string }>();
  const projectId = Number(projectIdParam);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialFileId = searchParams.get("fileId");

  const query = useQuery({
    queryKey: ["project-images", projectId],
    queryFn: () => getProjectImages(projectId),
    enabled: Number.isFinite(projectId),
  });

  const images = query.data?.images ?? [];
  const projectName = query.data?.project?.name;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [saveMsg, setSaveMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (selectedId != null || images.length === 0) return;
    if (initialFileId) {
      const asNum = Number(initialFileId);
      if (Number.isFinite(asNum) && images.some((img) => img.id === asNum)) {
        setSelectedId(asNum);
        return;
      }
    }
    setSelectedId(images[0].id);
  }, [images, selectedId, initialFileId]);

  const selected: ProjectImage | undefined = useMemo(
    () => images.find((img) => img.id === selectedId),
    [images, selectedId],
  );

  const history = useEditHistory(INITIAL_EDIT_STATE);
  const {
    state: edit,
    commit,
    patch,
    undo,
    redo,
    reset,
    canUndo,
    canRedo,
  } = history;

  useEffect(() => {
    reset(INITIAL_EDIT_STATE);
    setCropMode(false);
    setViewZoom(1);
    setSaveMsg(null);
    setNaturalSize(null);
  }, [selected?.id, reset]);

  const [cropMode, setCropMode] = useState(false);
  const [viewZoom, setViewZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const saveMut = useSaveEditedImage(projectId);
  const convertMut = useMutation({
    mutationFn: convertImage,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project-images", projectId] });
    },
  });

  // ── Actions ──────────────────────────────────────────────────────────────

  const rotate = (dir: -1 | 1) =>
    commit((s) => ({ ...s, rotation: (((s.rotation + dir * 90) % 360) + 360) % 360 }));

  const flip = (axis: "h" | "v") =>
    commit((s) => ({
      ...s,
      flipH: axis === "h" ? !s.flipH : s.flipH,
      flipV: axis === "v" ? !s.flipV : s.flipV,
    }));

  const zoomIn = () => setViewZoom((z) => Math.min(4, +(z + 0.1).toFixed(2)));
  const zoomOut = () => setViewZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)));

  const resetAll = () => {
    reset(INITIAL_EDIT_STATE);
    setCropMode(false);
  };

  // Prefer the Art folder of the currently selected image; fall back to the
  // project page if nothing is selected. Using an absolute route means the
  // back button works even when the page was opened via a direct link (in
  // which case `navigate(-1)` would bounce the user out of the SPA).
  const backTarget = useMemo(() => {
    if (selected?.chapter_id != null) {
      return `/projects/${projectId}/chapters/${selected.chapter_id}?folder=art`;
    }
    return `/projects/${projectId}`;
  }, [projectId, selected?.chapter_id]);

  const goBack = () => navigate(backTarget);

  const cancel = () => {
    resetAll();
    setViewZoom(1);
    goBack();
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } catch {
        /* ignore */
      }
    } else {
      try {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } catch {
        /* ignore */
      }
    }
  };

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const save = async () => {
    if (!selected) return;
    if (!editsDirty(edit)) {
      setSaveMsg({ kind: "ok", text: "No edits to save." });
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const bakedDataUrl = await bakeImage(selected.preview_url, {
        rotation: edit.rotation,
        flipH: edit.flipH,
        flipV: edit.flipV,
        brightness: edit.brightness,
        contrast: edit.contrast,
        cropRect: edit.cropRect,
      });
      const blob = await (await fetch(bakedDataUrl)).blob();
      const mime = blob.type || "image/png";
      await saveMut.mutateAsync({ image: selected, bakedBlob: blob, bakedMime: mime });
      setSaveMsg({
        kind: "ok",
        text: selected.needs_transcoding
          ? "Saved edited PNG (source kept intact)."
          : `Saved v${selected.version + 1}.`,
      });
      reset(INITIAL_EDIT_STATE);
      setCropMode(false);
    } catch (e) {
      setSaveMsg({
        kind: "err",
        text: e instanceof Error ? e.message : "Save failed.",
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Crop overlay drag ────────────────────────────────────────────────────
  const imgRef = useRef<HTMLImageElement>(null);
  const cropDragRef = useRef<CropDragState | null>(null);
  const currentCrop = edit.cropRect ?? (cropMode ? { x: 10, y: 10, w: 80, h: 80 } : null);

  useEffect(() => {
    if (cropMode && !edit.cropRect) {
      commit((s) => ({ ...s, cropRect: { x: 10, y: 10, w: 80, h: 80 } }));
    }
  }, [cropMode, edit.cropRect, commit]);

  const beginCropDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, mode: "move" | "resize", corner?: Corner) => {
      const el = imgRef.current;
      if (!el || !currentCrop) return;
      e.preventDefault();
      e.stopPropagation();
      cropDragRef.current = {
        mode,
        corner,
        startX: e.clientX,
        startY: e.clientY,
        startRect: { ...currentCrop },
        containerRect: el.getBoundingClientRect(),
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [currentCrop],
  );

  const onCropDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = cropDragRef.current;
      if (!d) return;
      const dxPct = ((e.clientX - d.startX) / d.containerRect.width) * 100;
      const dyPct = ((e.clientY - d.startY) / d.containerRect.height) * 100;
      let { x, y, w, h } = d.startRect;
      if (d.mode === "move") {
        x = Math.max(0, Math.min(100 - w, x + dxPct));
        y = Math.max(0, Math.min(100 - h, y + dyPct));
      } else if (d.mode === "resize" && d.corner) {
        if (d.corner === "nw") {
          const nx = Math.max(0, Math.min(x + w - MIN_CROP_PERCENT, x + dxPct));
          const ny = Math.max(0, Math.min(y + h - MIN_CROP_PERCENT, y + dyPct));
          w += x - nx;
          h += y - ny;
          x = nx;
          y = ny;
        } else if (d.corner === "ne") {
          const ny = Math.max(0, Math.min(y + h - MIN_CROP_PERCENT, y + dyPct));
          w = Math.max(MIN_CROP_PERCENT, Math.min(100 - x, w + dxPct));
          h += y - ny;
          y = ny;
        } else if (d.corner === "sw") {
          const nx = Math.max(0, Math.min(x + w - MIN_CROP_PERCENT, x + dxPct));
          w += x - nx;
          h = Math.max(MIN_CROP_PERCENT, Math.min(100 - y, h + dyPct));
          x = nx;
        } else if (d.corner === "se") {
          w = Math.max(MIN_CROP_PERCENT, Math.min(100 - x, w + dxPct));
          h = Math.max(MIN_CROP_PERCENT, Math.min(100 - y, h + dyPct));
        }
      }
      patch({ cropRect: { x, y, w, h } });
    },
    [patch],
  );

  const endCropDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (cropDragRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const finalRect = cropDragRef.current.startRect;
      cropDragRef.current = null;
      // Commit as a single history entry at drag end.
      commit((s) => ({ ...s })); // effectively a no-op that snapshots current state
      void finalRect;
    }
  }, [commit]);

  // ── Search + filtered list ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return images;
    return images.filter(
      (img) =>
        img.filename.toLowerCase().includes(q) ||
        (img.chapter_number && img.chapter_number.toLowerCase().includes(q)),
    );
  }, [images, search]);

  const previewFilter = `brightness(${edit.brightness}) contrast(${edit.contrast})`;
  const previewTransform =
    `translate(-50%, -50%) scale(${viewZoom}) rotate(${edit.rotation}deg) ` +
    `scaleX(${edit.flipH ? -1 : 1}) scaleY(${edit.flipV ? -1 : 1})`;
  const previewClipPath =
    edit.cropRect && !cropMode
      ? `inset(${edit.cropRect.y}% ${100 - (edit.cropRect.x + edit.cropRect.w)}% ${100 - (edit.cropRect.y + edit.cropRect.h)}% ${edit.cropRect.x}%)`
      : undefined;

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-800">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-slate-200">
        <button
          onClick={goBack}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex flex-col leading-tight">
          <h1 className="text-sm font-bold tracking-tight text-slate-900">Image Review & Editor</h1>
          <span className="text-[11px] text-slate-500 font-mono truncate max-w-[420px]">
            {selected ? selected.filename : projectName || ""}
          </span>
        </div>
        <div className="flex-1" />
        {saveMsg && (
          <span
            className={
              saveMsg.kind === "ok"
                ? "text-[11px] text-emerald-600"
                : "text-[11px] text-rose-600"
            }
          >
            {saveMsg.text}
          </span>
        )}
        <button
          onClick={toggleFullscreen}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md hover:bg-slate-100 text-slate-600 border border-slate-200"
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          {isFullscreen ? "Exit" : "Fullscreen"}
        </button>
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md hover:bg-slate-100 text-slate-600 border border-slate-200"
        >
          <XIcon className="w-3.5 h-3.5" /> Back
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        {/* Left: editor */}
        <div className="flex-1 min-w-0 flex flex-col bg-slate-100">
          {/* Toolbar */}
          <div className="bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-1 overflow-x-auto shadow-sm">
            <ToolBtn
              disabled={!selected}
              active={cropMode}
              onClick={() => setCropMode((v) => !v)}
              label="Crop"
              icon={<Crop className="w-4 h-4" />}
            />
            <Divider />
            <ToolBtn
              disabled={!selected}
              onClick={() => rotate(-1)}
              label="Rotate L"
              icon={<RotateCcw className="w-4 h-4" />}
            />
            <ToolBtn
              disabled={!selected}
              onClick={() => rotate(1)}
              label="Rotate R"
              icon={<RotateCw className="w-4 h-4" />}
            />
            <ToolBtn
              disabled={!selected}
              active={edit.flipH}
              onClick={() => flip("h")}
              label="Flip H"
              icon={<FlipHorizontal className="w-4 h-4" />}
            />
            <ToolBtn
              disabled={!selected}
              active={edit.flipV}
              onClick={() => flip("v")}
              label="Flip V"
              icon={<FlipVertical className="w-4 h-4" />}
            />
            <Divider />
            <ToolBtn
              disabled={!selected || viewZoom <= 0.25}
              onClick={zoomOut}
              label="Zoom Out"
              icon={<ZoomOut className="w-4 h-4" />}
            />
            <ToolBtn
              disabled={!selected || viewZoom >= 4}
              onClick={zoomIn}
              label="Zoom In"
              icon={<ZoomIn className="w-4 h-4" />}
            />
            <Divider />
            <Slider
              icon={<Sun className="w-3.5 h-3.5 text-amber-500" />}
              label="Brightness"
              value={edit.brightness}
              disabled={!selected}
              onChange={(v) => patch({ brightness: v })}
              onCommit={() => commit((s) => ({ ...s }))}
            />
            <Slider
              icon={<ContrastIcon className="w-3.5 h-3.5 text-slate-600" />}
              label="Contrast"
              value={edit.contrast}
              disabled={!selected}
              onChange={(v) => patch({ contrast: v })}
              onCommit={() => commit((s) => ({ ...s }))}
            />
            <Divider />
            <ToolBtn
              disabled={!canUndo}
              onClick={undo}
              label="Undo"
              icon={<Undo className="w-4 h-4" />}
            />
            <ToolBtn
              disabled={!canRedo}
              onClick={redo}
              label="Redo"
              icon={<Redo className="w-4 h-4" />}
            />
            <ToolBtn
              disabled={!selected}
              onClick={resetAll}
              label="Reset"
              icon={<RefreshCw className="w-4 h-4" />}
            />
            <div className="flex-1" />
            <button
              onClick={cancel}
              className="px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!selected || saving}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-primary text-white hover:bg-primary/90 disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {/* Sub-toolbar: zoom + dims */}
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-1.5 flex items-center gap-4 text-[11px] text-slate-600">
            <span className="font-mono">{Math.round(viewZoom * 100)}%</span>
            {naturalSize && (
              <span className="font-mono">
                {naturalSize.w} × {naturalSize.h}
              </span>
            )}
            {selected && (
              <>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] uppercase font-bold tracking-wider">
                  {selected.file_type}
                </span>
                {selected.needs_transcoding && (
                  <span className="text-amber-600">
                    Preview transcoded from {selected.file_type.toUpperCase()} → PNG
                  </span>
                )}
              </>
            )}
            <div className="flex-1" />
            {selected && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">Convert →</span>
                {(["png", "jpg", "tif"] as const).map((fmt) => {
                  const disabled =
                    convertMut.isPending ||
                    selected.file_type.toLowerCase().startsWith(fmt);
                  return (
                    <button
                      key={fmt}
                      disabled={disabled}
                      onClick={() =>
                        convertMut.mutate({
                          fileId: selected.id,
                          target_format: fmt,
                          mode: "copy",
                        })
                      }
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                    >
                      {fmt}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Canvas area */}
          <div className="flex-1 relative overflow-hidden bg-[#e5e7eb]">
            {query.isLoading && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm gap-2 z-10">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading project images…
              </div>
            )}
            {!query.isLoading && !selected && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
                {images.length === 0
                  ? "No images in this project yet. Upload one from the Art folder."
                  : "Select an image from the right panel to start editing."}
              </div>
            )}
            {selected && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative">
                  <img
                    key={selected.id}
                    ref={imgRef}
                    src={selected.preview_url}
                    alt={selected.filename}
                    onLoad={(e) => {
                      const el = e.currentTarget;
                      setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
                    }}
                    onError={() =>
                      setSaveMsg({ kind: "err", text: "Failed to load preview." })
                    }
                    draggable={false}
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      maxWidth: "82vw",
                      maxHeight: "70vh",
                      transform: previewTransform,
                      transformOrigin: "center center",
                      filter: previewFilter,
                      clipPath: previewClipPath,
                      transition: "filter 100ms ease, clip-path 100ms ease",
                      boxShadow: "0 8px 40px rgba(15, 23, 42, 0.15)",
                      background: "#fff",
                    }}
                  />
                  {cropMode && currentCrop && (
                    <CropOverlay
                      imgRef={imgRef}
                      rect={currentCrop}
                      viewZoom={viewZoom}
                      rotation={edit.rotation}
                      flipH={edit.flipH}
                      flipV={edit.flipV}
                      onBegin={beginCropDrag}
                      onMove={onCropDrag}
                      onEnd={endCropDrag}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: image list */}
        <aside className="w-80 bg-white border-l border-slate-200 flex flex-col">
          <div className="px-3 py-3 border-b border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                All Images ({images.length})
              </span>
              {query.isFetching && (
                <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
              )}
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search images..."
                className="w-full pl-8 pr-2 py-1.5 text-[12px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:border-primary focus:bg-white"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {filtered.map((img) => (
              <ImageCard
                key={img.id}
                image={img}
                selected={img.id === selectedId}
                onClick={() => setSelectedId(img.id)}
              />
            ))}
            {filtered.length === 0 && !query.isLoading && (
              <div className="p-4 text-[11px] text-slate-500 text-center">
                {search ? "No matches." : "No images."}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Toolbar primitives ─────────────────────────────────────────────────────

function ToolBtn({
  active,
  disabled,
  onClick,
  label,
  icon,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-md transition-colors min-w-[46px] ${
        active
          ? "bg-primary/10 text-primary"
          : "text-slate-700 hover:bg-slate-100"
      } ${disabled ? "opacity-35 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {icon}
      <span className="text-[10px] font-semibold leading-none">{label}</span>
    </button>
  );
}

function Divider() {
  return <div className="w-px h-8 bg-slate-200 mx-1 self-center" />;
}

function Slider({
  icon,
  label,
  value,
  onChange,
  onCommit,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-2" title={label}>
      <div className="flex items-center gap-1">
        {icon}
        <input
          type="range"
          min={0.3}
          max={1.7}
          step={0.02}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
          className="w-24 accent-primary"
        />
        <span className="text-[10px] font-mono text-slate-500 w-8 text-right">
          {Math.round(value * 100)}%
        </span>
      </div>
      <span className="text-[10px] font-semibold leading-none text-slate-500">
        {label}
      </span>
    </div>
  );
}

// ─── Image card ─────────────────────────────────────────────────────────────

function ImageCard({
  image,
  selected,
  onClick,
}: {
  image: ProjectImage;
  selected: boolean;
  onClick: () => void;
}) {
  const [thumbError, setThumbError] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const status = stubStatusFor(image);
  const badge = STATUS_STYLES[status];

  return (
    <button
      onClick={onClick}
      className={`w-full flex gap-2 p-2 rounded-lg border transition-colors text-left ${
        selected
          ? "border-primary bg-primary/5"
          : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      {/* Selection checkbox */}
      <div
        className={`w-3.5 h-3.5 mt-1 shrink-0 rounded-sm border flex items-center justify-center ${
          selected ? "bg-primary border-primary" : "border-slate-300 bg-white"
        }`}
      >
        {selected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
      </div>

      {/* Thumbnail */}
      <div className="w-14 h-14 shrink-0 rounded-md overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
        {thumbError ? (
          <FileImage className="w-5 h-5 text-slate-400" />
        ) : (
          <img
            src={image.preview_url}
            alt={image.filename}
            loading="lazy"
            className="w-full h-full object-cover"
            onLoad={(e) => {
              const el = e.currentTarget;
              setDims({ w: el.naturalWidth, h: el.naturalHeight });
            }}
            onError={() => setThumbError(true)}
          />
        )}
      </div>

      {/* Metadata */}
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-slate-900 truncate">
          {image.filename}
        </div>
        <div className="text-[10px] text-slate-500 truncate">
          {image.chapter_number ? `Ch ${image.chapter_number}` : "Project"} ·{" "}
          {image.file_type.toUpperCase()} · v{image.version}
        </div>
        {dims && (
          <div className="text-[10px] text-slate-400 font-mono">
            {dims.w} × {dims.h}
          </div>
        )}
        <div className="mt-1">
          <span
            className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Crop overlay ────────────────────────────────────────────────────────

interface CropOverlayProps {
  imgRef: RefObject<HTMLImageElement>;
  rect: { x: number; y: number; w: number; h: number };
  viewZoom: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  onBegin: (e: React.PointerEvent<HTMLDivElement>, mode: "move" | "resize", corner?: Corner) => void;
  onMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onEnd: (e: React.PointerEvent<HTMLDivElement>) => void;
}

function CropOverlay({
  imgRef,
  rect,
  viewZoom,
  rotation,
  flipH,
  flipV,
  onBegin,
  onMove,
  onEnd,
}: CropOverlayProps) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [imgRef]);
  if (!size) return null;
  const corners: Corner[] = ["nw", "ne", "sw", "se"];
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        width: size.w,
        height: size.h,
        transform:
          `translate(-50%, -50%) scale(${viewZoom}) rotate(${rotation}deg) ` +
          `scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
        pointerEvents: "none",
      }}
    >
      <div
        onPointerDown={(e) => onBegin(e, "move")}
        onPointerMove={onMove}
        onPointerUp={onEnd}
        onPointerCancel={onEnd}
        style={{
          position: "absolute",
          left: `${rect.x}%`,
          top: `${rect.y}%`,
          width: `${rect.w}%`,
          height: `${rect.h}%`,
          border: "1px dashed #f59e0b",
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
          cursor: "move",
          pointerEvents: "auto",
          touchAction: "none",
        }}
      >
        {corners.map((c) => (
          <div
            key={c}
            onPointerDown={(e) => onBegin(e, "resize", c)}
            onPointerMove={onMove}
            onPointerUp={onEnd}
            onPointerCancel={onEnd}
            style={{
              position: "absolute",
              width: 10,
              height: 10,
              background: "#f59e0b",
              border: "1.5px solid #fff",
              borderRadius: 2,
              top: c.startsWith("n") ? -5 : "auto",
              bottom: c.startsWith("s") ? -5 : "auto",
              left: c.endsWith("w") ? -5 : "auto",
              right: c.endsWith("e") ? -5 : "auto",
              cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize",
              touchAction: "none",
            }}
          />
        ))}
      </div>
    </div>
  );
}
