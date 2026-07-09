import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Crop,
  Download,
  FileImage,
  Gauge,
  Info,
  Loader2,
  Maximize,
  Maximize2,
  Minimize,
  RefreshCw,
  Repeat,
  RotateCcw,
  RotateCw,
  Search,
  Undo,
  Redo,
  X as XIcon,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import {
  getProjectImages,
  convertImage,
  replaceImage,
  exportSelectedImages,
  type ProjectImage,
} from "./api";
import { useSaveEditedImage } from "./useSaveEditedImage";
import { bakeImage, type CropRect } from "./imageBaking";
import { MetadataPanel } from "./MetadataPanel";

// ─── Editing state model ────────────────────────────────────────────────────

interface EditState {
  rotation: number;
  cropRect: CropRect;
  /** Target output pixel dimensions. Null = keep source (post-crop, post-rotate). */
  targetWidth: number | null;
  targetHeight: number | null;
  /** DPI metadata to write on save. Null = don't touch density. */
  dpi: number | null;
}

const INITIAL_EDIT_STATE: EditState = {
  rotation: 0,
  cropRect: null,
  targetWidth: null,
  targetHeight: null,
  dpi: null,
};

function editsDirty(s: EditState): boolean {
  return (
    s.rotation !== 0 ||
    s.cropRect !== null ||
    s.targetWidth !== null ||
    s.targetHeight !== null ||
    s.dpi !== null
  );
}

// ─── Undo / redo history over EditState ─────────────────────────────────────

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
    undo,
    redo,
    reset,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

// ─── Visual-only status stub ────────────────────────────────────────────────
type ReviewStatus = "original" | "pending" | "approved";

function stubStatusFor(image: ProjectImage): ReviewStatus {
  const bucket = image.id % 5;
  if (bucket === 0) return "pending";
  if (bucket === 1) return "approved";
  return "original";
}

const STATUS_STYLES: Record<ReviewStatus, { label: string; className: string }> = {
  original: { label: "Original", className: "bg-slate-800 text-white" },
  pending: { label: "Pending Review", className: "bg-amber-500 text-white" },
  approved: { label: "Approved", className: "bg-emerald-500 text-white" },
};

// ─── Crop overlay types ────────────────────────────────────────────────────

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

const DPI_PRESETS = [72, 150, 300, 600];

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
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [saveMsg, setSaveMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [replaceDialogFor, setReplaceDialogFor] = useState<ProjectImage | null>(null);

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
  const { state: edit, commit, undo, redo, reset, canUndo, canRedo } = history;

  const [cropMode, setCropMode] = useState(false);
  const [viewZoom, setViewZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [resizePopoverOpen, setResizePopoverOpen] = useState(false);
  const [dpiPopoverOpen, setDpiPopoverOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);

  useEffect(() => {
    reset(INITIAL_EDIT_STATE);
    setCropMode(false);
    setViewZoom(1);
    setSaveMsg(null);
    setNaturalSize(null);
    setResizePopoverOpen(false);
    setDpiPopoverOpen(false);
    setMetadataOpen(false);
  }, [selected?.id, reset]);

  const saveMut = useSaveEditedImage(projectId);
  const convertMut = useMutation({
    mutationFn: convertImage,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project-images", projectId] });
    },
  });

  const replaceMut = useMutation({
    mutationFn: replaceImage,
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["project-images", projectId] });
      setSaveMsg({ kind: "ok", text: `Replaced ${res.file.filename} · v${res.file.version}` });
    },
    onError: (err: unknown) => {
      setSaveMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Replace failed.",
      });
    },
  });

  const exportMut = useMutation({
    mutationFn: async (ids: number[]) => exportSelectedImages(projectId, ids),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-${projectId}-images.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaveMsg({ kind: "ok", text: "Export ready." });
    },
    onError: (err: unknown) => {
      setSaveMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Export failed.",
      });
    },
  });

  const toggleChecked = (id: number) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const backTarget = useMemo(() => {
    if (selected?.chapter_id != null) {
      return `/projects/${projectId}/chapters/${selected.chapter_id}?folder=art`;
    }
    return `/projects/${projectId}`;
  }, [projectId, selected?.chapter_id]);
  const goBack = () => navigate(backTarget);

  const rotate = (dir: -1 | 1) =>
    commit((s) => ({ ...s, rotation: (((s.rotation + dir * 90) % 360) + 360) % 360 }));

  const zoomIn = () => setViewZoom((z) => Math.min(4, +(z + 0.1).toFixed(2)));
  const zoomOut = () => setViewZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)));

  const resetAll = () => {
    reset(INITIAL_EDIT_STATE);
    setCropMode(false);
    setResizePopoverOpen(false);
    setDpiPopoverOpen(false);
  };

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
      } catch { /* ignore */ }
    } else {
      try {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } catch { /* ignore */ }
    }
  };

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const setResolution = (w: number | null, h: number | null) =>
    commit((s) => ({ ...s, targetWidth: w, targetHeight: h }));

  const setDpi = (dpi: number | null) => commit((s) => ({ ...s, dpi }));

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
        cropRect: edit.cropRect,
        targetWidth: edit.targetWidth,
        targetHeight: edit.targetHeight,
      });
      const blob = await (await fetch(bakedDataUrl)).blob();
      const mime = blob.type || "image/png";
      const res = await saveMut.mutateAsync({
        image: selected,
        bakedBlob: blob,
        bakedMime: mime,
        dpi: edit.dpi,
      });
      const parts: string[] = [];
      if (res.file.filename === selected.filename) {
        parts.push(`Saved v${res.file.version}`);
      } else {
        parts.push(`Saved as ${res.file.filename}`);
      }
      if (res.dpi_applied) parts.push(`DPI ${res.dpi_applied}`);
      setSaveMsg({ kind: "ok", text: parts.join(" · ") });
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

  // Preview loading — fetch the URL ourselves so we can surface the actual
  // failure reason (401 / 403 / 404 / network / decode) instead of the
  // <img>'s opaque onError. On success we hand a blob URL to the <img> so
  // the editor initialises on a fully-decoded local resource.
  type PreviewState =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; url: string }
    | { kind: "error"; message: string };
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  useEffect(() => {
    if (!selected) {
      setPreview({ kind: "idle" });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    setPreview({ kind: "loading" });

    (async () => {
      const url = selected.preview_url;
      let res: Response;
      try {
        res = await fetch(url, {
          credentials: "include",
          signal: controller.signal,
        });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[ImageReview] preview fetch network error", { url, err });
        setPreview({ kind: "error", message: `Network error loading preview: ${msg}` });
        return;
      }

      if (!res.ok) {
        let detail = "";
        try {
          const body = await res.clone().json();
          detail = body?.message || body?.detail || "";
        } catch {
          try { detail = (await res.clone().text()).slice(0, 200); } catch { /* noop */ }
        }
        const specific =
          res.status === 401 ? "Authentication required (401)"
          : res.status === 403 ? "Access denied (403)"
          : res.status === 404 ? "Image file not found on the server (404)"
          : res.status === 415 ? "Image format not supported for preview (415)"
          : `Server returned HTTP ${res.status}`;
        console.error("[ImageReview] preview HTTP error", {
          url,
          status: res.status,
          statusText: res.statusText,
          detail,
        });
        if (!cancelled) {
          setPreview({
            kind: "error",
            message: detail ? `${specific}: ${detail}` : specific,
          });
        }
        return;
      }

      let blob: Blob;
      try {
        blob = await res.blob();
      } catch (err) {
        if (cancelled) return;
        console.error("[ImageReview] preview blob decode error", { url, err });
        setPreview({
          kind: "error",
          message: `Failed to decode preview response: ${err instanceof Error ? err.message : err}`,
        });
        return;
      }

      if (blob.size === 0) {
        if (!cancelled) {
          console.error("[ImageReview] preview response is empty", { url });
          setPreview({ kind: "error", message: "Server returned an empty preview." });
        }
        return;
      }

      objectUrl = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      setPreview({ kind: "ready", url: objectUrl });
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selected?.id, selected?.preview_url]);
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
          w += x - nx; h += y - ny; x = nx; y = ny;
        } else if (d.corner === "ne") {
          const ny = Math.max(0, Math.min(y + h - MIN_CROP_PERCENT, y + dyPct));
          w = Math.max(MIN_CROP_PERCENT, Math.min(100 - x, w + dxPct));
          h += y - ny; y = ny;
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
      // During drag we mutate state directly without pushing to history for
      // every pointermove; a single history entry gets pushed at pointerUp.
      commit((s) => ({ ...s, cropRect: { x, y, w, h } }));
    },
    [commit],
  );

  const endCropDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (cropDragRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      cropDragRef.current = null;
    }
  }, []);

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

  const previewFilter = "none";
  const previewTransform =
    `translate(-50%, -50%) scale(${viewZoom}) rotate(${edit.rotation}deg)`;
  const previewClipPath =
    edit.cropRect && !cropMode
      ? `inset(${edit.cropRect.y}% ${100 - (edit.cropRect.x + edit.cropRect.w)}% ${100 - (edit.cropRect.y + edit.cropRect.h)}% ${edit.cropRect.x}%)`
      : undefined;

  // Effective post-crop / post-rotate dimensions we'd write on save.
  const effectiveOutSize = useMemo(() => {
    if (!naturalSize) return null;
    const crop = edit.cropRect;
    let w = crop ? Math.round((crop.w / 100) * naturalSize.w) : naturalSize.w;
    let h = crop ? Math.round((crop.h / 100) * naturalSize.h) : naturalSize.h;
    if (edit.rotation === 90 || edit.rotation === 270) [w, h] = [h, w];
    if (edit.targetWidth) w = edit.targetWidth;
    if (edit.targetHeight) h = edit.targetHeight;
    return { w, h };
  }, [naturalSize, edit.cropRect, edit.rotation, edit.targetWidth, edit.targetHeight]);

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-800">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-slate-200">
        <button onClick={goBack} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500" title="Back">
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
          <span className={saveMsg.kind === "ok" ? "text-[11px] text-emerald-600" : "text-[11px] text-rose-600"}>
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
          <div className="bg-white border-b border-slate-200 px-3 py-2 flex items-center flex-wrap gap-1 shadow-sm">
            <ToolBtn disabled={!selected} active={cropMode} onClick={() => setCropMode((v) => !v)} label="Crop" icon={<Crop className="w-4 h-4" />} />
            <Divider />
            <ToolBtn disabled={!selected} onClick={() => rotate(-1)} label="Rotate L" icon={<RotateCcw className="w-4 h-4" />} />
            <ToolBtn disabled={!selected} onClick={() => rotate(1)} label="Rotate R" icon={<RotateCw className="w-4 h-4" />} />
            <Divider />
            <ToolBtn disabled={!selected || viewZoom <= 0.25} onClick={zoomOut} label="Zoom Out" icon={<ZoomOut className="w-4 h-4" />} />
            <ToolBtn disabled={!selected || viewZoom >= 4} onClick={zoomIn} label="Zoom In" icon={<ZoomIn className="w-4 h-4" />} />
            <Divider />

            {/* Resize popover */}
            <PopoverAnchor
              open={resizePopoverOpen}
              onOpenChange={(v) => { setResizePopoverOpen(v); if (v) setDpiPopoverOpen(false); }}
              trigger={(anchorRef) => (
                <div ref={anchorRef}>
                  <ToolBtn
                    disabled={!selected}
                    active={edit.targetWidth != null || edit.targetHeight != null}
                    onClick={() => { setResizePopoverOpen((v) => !v); setDpiPopoverOpen(false); }}
                    label="Resize"
                    icon={<Maximize2 className="w-4 h-4" />}
                  />
                </div>
              )}
            >
              {selected && naturalSize && (
                <ResizePopover
                  natural={naturalSize}
                  rotation={edit.rotation}
                  crop={edit.cropRect}
                  currentW={edit.targetWidth}
                  currentH={edit.targetHeight}
                  onApply={(w, h) => { setResolution(w, h); setResizePopoverOpen(false); }}
                  onClose={() => setResizePopoverOpen(false)}
                />
              )}
            </PopoverAnchor>

            {/* DPI popover */}
            <PopoverAnchor
              open={dpiPopoverOpen}
              onOpenChange={(v) => { setDpiPopoverOpen(v); if (v) setResizePopoverOpen(false); }}
              trigger={(anchorRef) => (
                <div ref={anchorRef}>
                  <ToolBtn
                    disabled={!selected}
                    active={edit.dpi != null}
                    onClick={() => { setDpiPopoverOpen((v) => !v); setResizePopoverOpen(false); }}
                    label={edit.dpi ? `DPI ${edit.dpi}` : "DPI"}
                    icon={<Gauge className="w-4 h-4" />}
                  />
                </div>
              )}
            >
              {selected && (
                <DpiPopover
                  current={edit.dpi}
                  onApply={(v) => { setDpi(v); setDpiPopoverOpen(false); }}
                  onClose={() => setDpiPopoverOpen(false)}
                />
              )}
            </PopoverAnchor>

            <Divider />
            <ToolBtn
              disabled={!selected}
              onClick={() => setMetadataOpen(true)}
              label="Metadata"
              icon={<Info className="w-4 h-4" />}
            />
            <Divider />
            <ToolBtn disabled={!canUndo} onClick={undo} label="Undo" icon={<Undo className="w-4 h-4" />} />
            <ToolBtn disabled={!canRedo} onClick={redo} label="Redo" icon={<Redo className="w-4 h-4" />} />
            <ToolBtn disabled={!selected} onClick={resetAll} label="Reset" icon={<RefreshCw className="w-4 h-4" />} />
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

          {/* Sub-toolbar */}
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-1.5 flex items-center gap-4 text-[11px] text-slate-600 flex-wrap">
            <span className="font-mono">{Math.round(viewZoom * 100)}%</span>
            {naturalSize && (
              <span className="font-mono" title="Source pixel dimensions">
                Source {naturalSize.w} × {naturalSize.h}
              </span>
            )}
            {effectiveOutSize && (
              <span className="font-mono text-slate-900" title="Output pixel dimensions after crop + rotate + resize">
                Output {effectiveOutSize.w} × {effectiveOutSize.h}
              </span>
            )}
            {edit.dpi != null && (
              <span className="font-mono text-primary" title="Print density metadata that will be written on save">
                {edit.dpi} DPI
              </span>
            )}
            {selected && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] uppercase font-bold tracking-wider">
                {selected.file_type}
              </span>
            )}
            {selected?.needs_transcoding && (
              <span className="text-amber-600">
                Preview transcoded from {selected.file_type.toUpperCase()} → PNG
              </span>
            )}
            <div className="flex-1" />
            {selected && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">Convert →</span>
                {(["png", "jpg", "tif"] as const).map((fmt) => {
                  const disabled = convertMut.isPending || selected.file_type.toLowerCase().startsWith(fmt);
                  return (
                    <button
                      key={fmt}
                      disabled={disabled}
                      onClick={() =>
                        convertMut.mutate({ fileId: selected.id, target_format: fmt, mode: "copy" })
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
            {selected && preview.kind === "loading" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-500 text-sm">
                <Loader2 className="w-5 h-5 animate-spin" />
                Loading preview…
              </div>
            )}
            {selected && preview.kind === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                <FileImage className="w-8 h-8 text-red-400" />
                <div className="text-sm font-semibold text-red-500">Preview unavailable</div>
                <div className="text-xs text-slate-500 max-w-md">{preview.message}</div>
                <div className="text-[10px] text-slate-400 font-mono break-all max-w-md">
                  {selected.preview_url}
                </div>
              </div>
            )}
            {selected && preview.kind === "ready" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative">
                  <img
                    key={selected.id}
                    ref={imgRef}
                    src={preview.url}
                    alt={selected.filename}
                    onLoad={(e) => {
                      const el = e.currentTarget;
                      setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
                    }}
                    onError={() => {
                      // The blob URL failed to decode as an image — the fetch
                      // succeeded but the bytes aren't a valid image.
                      console.error("[ImageReview] <img> failed to decode blob", {
                        source: selected.preview_url,
                      });
                      setPreview({
                        kind: "error",
                        message: "Preview downloaded but the image data could not be decoded.",
                      });
                    }}
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
                      transition: "clip-path 100ms ease",
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
              {query.isFetching && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
            </div>
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search images..."
                className="w-full pl-8 pr-2 py-1.5 text-[12px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:border-primary focus:bg-white"
              />
            </div>

            {/* Batch actions row */}
            <RailActions
              filtered={filtered}
              checkedIds={checkedIds}
              setCheckedIds={setCheckedIds}
              onExport={() => exportMut.mutate(Array.from(checkedIds))}
              exporting={exportMut.isPending}
              onReplace={() => {
                const only = Array.from(checkedIds);
                if (only.length !== 1) return;
                const target = images.find((i) => i.id === only[0]);
                if (target) setReplaceDialogFor(target);
              }}
            />
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {filtered.map((img) => (
              <ImageCard
                key={img.id}
                image={img}
                selected={img.id === selectedId}
                checked={checkedIds.has(img.id)}
                onClick={() => setSelectedId(img.id)}
                onToggleCheck={() => toggleChecked(img.id)}
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

      {/* Metadata panel */}
      {metadataOpen && selected && (
        <MetadataPanel
          fileId={selected.id}
          filename={selected.filename}
          onClose={() => setMetadataOpen(false)}
        />
      )}

      {/* Replace dialog */}
      {replaceDialogFor && (
        <ReplaceDialog
          image={replaceDialogFor}
          onClose={() => setReplaceDialogFor(null)}
          isSubmitting={replaceMut.isPending}
          onSubmit={async (file, reason) => {
            await replaceMut.mutateAsync({
              fileId: replaceDialogFor.id,
              file,
              reason,
            });
            setReplaceDialogFor(null);
            setCheckedIds(new Set());
          }}
        />
      )}
    </div>
  );
}

// ─── Toolbar primitives ─────────────────────────────────────────────────────

function ToolBtn({
  active, disabled, onClick, label, icon,
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
        active ? "bg-primary/10 text-primary" : "text-slate-700 hover:bg-slate-100"
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

// ─── Popover anchor ────────────────────────────────────────────────────────
// Renders the popover in a portal with fixed positioning tied to the trigger
// element. This escapes the toolbar's `overflow-x-auto` container (which would
// otherwise clip the popover) and keeps it visible over any adjacent content.

function PopoverAnchor({
  open,
  onOpenChange,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger: (anchorRef: React.RefObject<HTMLDivElement>) => React.ReactNode;
  children: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const compute = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <>
      {trigger(anchorRef)}
      {open && pos && createPortal(
        <div
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            zIndex: 2147483000,
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Resize popover ────────────────────────────────────────────────────────

function ResizePopover({
  natural, rotation, crop, currentW, currentH, onApply, onClose,
}: {
  natural: { w: number; h: number };
  rotation: number;
  crop: CropRect;
  currentW: number | null;
  currentH: number | null;
  onApply: (w: number | null, h: number | null) => void;
  onClose: () => void;
}) {
  // Baseline dimensions after crop + rotate — the user's Resize acts on top of
  // those, not the raw source, so we compute the current post-crop-rotate size
  // and pre-populate the inputs with it.
  const rotated = rotation === 90 || rotation === 270;
  const cropW = crop ? Math.round((crop.w / 100) * natural.w) : natural.w;
  const cropH = crop ? Math.round((crop.h / 100) * natural.h) : natural.h;
  const baseW = rotated ? cropH : cropW;
  const baseH = rotated ? cropW : cropH;
  const aspect = baseW / Math.max(1, baseH);

  const [w, setW] = useState<number>(currentW ?? baseW);
  const [h, setH] = useState<number>(currentH ?? baseH);
  const [lock, setLock] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const updateW = (v: number) => {
    setW(v);
    if (lock) setH(Math.max(1, Math.round(v / aspect)));
  };
  const updateH = (v: number) => {
    setH(v);
    if (lock) setW(Math.max(1, Math.round(v * aspect)));
  };

  const applyScale = (pct: number) => {
    const nw = Math.max(1, Math.round(baseW * pct));
    const nh = Math.max(1, Math.round(baseH * pct));
    setW(nw); setH(nh);
  };

  return (
    <div
      ref={rootRef}
      className="bg-white border border-slate-200 rounded-lg shadow-xl p-3 w-64 text-[11px]"
    >
      <div className="font-bold text-slate-700 mb-2">Resize</div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500 text-[10px]">Width (px)</span>
          <input
            type="number"
            min={1}
            value={w}
            onChange={(e) => updateW(Math.max(1, Number(e.target.value) || 1))}
            className="px-2 py-1 border border-slate-300 rounded font-mono text-slate-800 focus:outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500 text-[10px]">Height (px)</span>
          <input
            type="number"
            min={1}
            value={h}
            onChange={(e) => updateH(Math.max(1, Number(e.target.value) || 1))}
            className="px-2 py-1 border border-slate-300 rounded font-mono text-slate-800 focus:outline-none focus:border-primary"
          />
        </label>
      </div>
      <label className="flex items-center gap-1.5 mb-2 text-slate-600 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={lock}
          onChange={(e) => setLock(e.target.checked)}
          className="accent-primary"
        />
        Lock aspect ratio
      </label>
      <div className="flex items-center gap-1 mb-2">
        <span className="text-slate-500">Presets:</span>
        {[0.25, 0.5, 0.75].map((p) => (
          <button
            key={p}
            onClick={() => applyScale(p)}
            className="px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50 font-mono text-slate-700"
          >
            {Math.round(p * 100)}%
          </button>
        ))}
      </div>
      <div className="text-slate-400 text-[10px] mb-2">
        Base after crop + rotate: {baseW} × {baseH}
      </div>
      <div className="flex justify-between gap-1.5">
        <button
          onClick={() => onApply(null, null)}
          className="px-2 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
        >
          Clear
        </button>
        <div className="flex gap-1.5">
          <button
            onClick={onClose}
            className="px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onApply(w, h)}
            className="px-2 py-1 rounded bg-primary text-white hover:bg-primary/90 font-semibold"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DPI popover ───────────────────────────────────────────────────────────

function DpiPopover({
  current, onApply, onClose,
}: {
  current: number | null;
  onApply: (v: number | null) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState<number>(current ?? 300);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="bg-white border border-slate-200 rounded-lg shadow-xl p-3 w-56 text-[11px]"
    >
      <div className="font-bold text-slate-700 mb-2">DPI (dots per inch)</div>
      <div className="flex gap-1 mb-2 flex-wrap">
        {DPI_PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setValue(p)}
            className={`px-2 py-1 rounded font-mono ${
              value === p
                ? "bg-primary text-white"
                : "border border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-0.5 mb-2">
        <span className="text-slate-500 text-[10px]">Custom</span>
        <input
          type="number"
          min={1}
          max={2400}
          value={value}
          onChange={(e) => setValue(Math.max(1, Math.min(2400, Number(e.target.value) || 1)))}
          className="px-2 py-1 border border-slate-300 rounded font-mono text-slate-800 focus:outline-none focus:border-primary"
        />
      </label>
      <div className="text-slate-400 text-[10px] mb-2">
        Writes to the saved file's density metadata. Does not resample pixels — use
        Resize for that.
      </div>
      <div className="flex justify-between gap-1.5">
        <button
          onClick={() => onApply(null)}
          className="px-2 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
        >
          Clear
        </button>
        <div className="flex gap-1.5">
          <button
            onClick={onClose}
            className="px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onApply(value)}
            className="px-2 py-1 rounded bg-primary text-white hover:bg-primary/90 font-semibold"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Image card ─────────────────────────────────────────────────────────────

function ImageCard({
  image, selected, checked, onClick, onToggleCheck,
}: {
  image: ProjectImage;
  selected: boolean;
  checked: boolean;
  onClick: () => void;
  onToggleCheck: () => void;
}) {
  const [thumbError, setThumbError] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const status = stubStatusFor(image);
  const badge = STATUS_STYLES[status];

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      className={`w-full flex gap-2 p-2 rounded-lg border transition-colors text-left cursor-pointer ${
        selected ? "border-primary bg-primary/5" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      {/* Multi-select checkbox (separate from the row click that focuses the editor) */}
      <div
        onClick={(e) => { e.stopPropagation(); onToggleCheck(); }}
        className={`w-3.5 h-3.5 mt-1 shrink-0 rounded-sm border flex items-center justify-center cursor-pointer ${
          checked ? "bg-primary border-primary" : "border-slate-300 bg-white hover:border-slate-400"
        }`}
      >
        {checked && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
      </div>
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
    </div>
  );
}

// ─── Rail action row (Select All / Export Selected / Replace) ──────────────

function RailActions({
  filtered, checkedIds, setCheckedIds, onExport, exporting, onReplace,
}: {
  filtered: ProjectImage[];
  checkedIds: Set<number>;
  setCheckedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  onExport: () => void;
  exporting: boolean;
  onReplace: () => void;
}) {
  const filteredIds = useMemo(() => filtered.map((f) => f.id), [filtered]);
  const allChecked = filteredIds.length > 0 && filteredIds.every((id) => checkedIds.has(id));
  const someChecked = filteredIds.some((id) => checkedIds.has(id));
  const canReplace = checkedIds.size === 1;
  const canExport = checkedIds.size > 0;

  const toggleAll = () => {
    if (allChecked) {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  return (
    <div className="flex items-center justify-between gap-1 text-[11px]">
      <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 select-none">
        <span
          className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${
            allChecked
              ? "bg-primary border-primary"
              : someChecked
              ? "bg-primary/50 border-primary/70"
              : "border-slate-300 bg-white"
          }`}
        >
          {(allChecked || someChecked) && (
            <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
          )}
        </span>
        <input
          type="checkbox"
          className="sr-only"
          checked={allChecked}
          onChange={toggleAll}
        />
        <span onClick={toggleAll}>Select All</span>
      </label>
      <button
        onClick={onExport}
        disabled={!canExport || exporting}
        className="flex items-center gap-1 px-2 py-1 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
        title={canExport ? "Download the selected images as a ZIP" : "Select at least one image"}
      >
        {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
        Export Selected
      </button>
      <button
        onClick={onReplace}
        disabled={!canReplace}
        className="flex items-center gap-1 px-2 py-1 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
        title={
          canReplace
            ? "Replace the selected image with a new upload (audit reason required)"
            : "Select exactly one image to replace"
        }
      >
        <Repeat className="w-3 h-3" />
        Replace
      </button>
    </div>
  );
}

// ─── Replace dialog ────────────────────────────────────────────────────────

function ReplaceDialog({
  image, onClose, onSubmit, isSubmitting,
}: {
  image: ProjectImage;
  onClose: () => void;
  onSubmit: (file: File, reason: string) => Promise<void> | void;
  isSubmitting: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const reasonClean = reason.trim();
  const reasonValid = reasonClean.length >= 3;
  const canSubmit = !!file && reasonValid && !isSubmitting;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 2147483000, background: "rgba(15, 23, 42, 0.45)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-[440px] max-w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900">Replace image</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="text-[11px] text-slate-500 mb-3">
          <span className="font-mono">{image.filename}</span> · v{image.version}
        </div>

        <label className="block mb-3">
          <span className="text-[11px] font-semibold text-slate-700">New file</span>
          <input
            type="file"
            accept="image/*,.tif,.tiff,.eps"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-[12px] text-slate-700 file:mr-3 file:py-1 file:px-2 file:rounded-md file:border file:border-slate-300 file:bg-slate-50 file:text-slate-700 file:font-semibold hover:file:bg-slate-100"
          />
          {file && (
            <span className="mt-1 block text-[10px] text-slate-500 font-mono truncate">
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </span>
          )}
        </label>

        <label className="block mb-3">
          <span className="text-[11px] font-semibold text-slate-700">
            Reason <span className="text-rose-500">*</span>
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this image being replaced? (recorded to the file's version history)"
            className="mt-1 block w-full text-[12px] px-2 py-1.5 border border-slate-300 rounded-md text-slate-800 focus:outline-none focus:border-primary"
          />
          <span className="mt-1 block text-[10px] text-slate-400">
            {reasonClean.length < 3
              ? `Enter at least 3 characters (${reasonClean.length}/3)`
              : "Saved with the archived version for audit"}
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => file && onSubmit(file, reasonClean)}
            disabled={!canSubmit}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-primary text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Repeat className="w-3.5 h-3.5" />
            )}
            {isSubmitting ? "Replacing…" : "Replace"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Crop overlay ────────────────────────────────────────────────────────

interface CropOverlayProps {
  imgRef: RefObject<HTMLImageElement>;
  rect: { x: number; y: number; w: number; h: number };
  viewZoom: number;
  rotation: number;
  onBegin: (e: React.PointerEvent<HTMLDivElement>, mode: "move" | "resize", corner?: Corner) => void;
  onMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onEnd: (e: React.PointerEvent<HTMLDivElement>) => void;
}

function CropOverlay({ imgRef, rect, viewZoom, rotation, onBegin, onMove, onEnd }: CropOverlayProps) {
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
        transform: `translate(-50%, -50%) scale(${viewZoom}) rotate(${rotation}deg)`,
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
