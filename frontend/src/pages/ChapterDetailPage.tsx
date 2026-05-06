import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FolderOpen,
  Upload,
  X,
} from "lucide-react";

import { getApiErrorMessage } from "@/api/client";
import { downloadChapterPackage } from "@/api/files";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonTable } from "@/components/ui/SkeletonLoader";
import {
  CHAPTER_SECTIONS,
  ChapterSectionCards,
  SECTION_BY_KEY,
  SECTION_BY_PARAM,
} from "@/features/projects/components/ChapterCategorySummary";
import { ChapterFilesTable } from "@/features/projects/components/ChapterFilesTable";
import {
  ChapterToolbar,
  type ViewMode,
} from "@/features/projects/components/ChapterToolbar";
import { ChapterUploadPanel } from "@/features/projects/components/ChapterUploadPanel";
import { useChapterDetailQuery } from "@/features/projects/useChapterDetailQuery";
import { useChapterFileActions } from "@/features/projects/useChapterFileActions";
import { useChapterFilesQuery } from "@/features/projects/useChapterFilesQuery";
import { useChapterUpload } from "@/features/projects/useChapterUpload";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { ChapterCategoryCounts } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";
import { cn } from "@/utils/cn";

/* ─── Loading skeleton ─────────────────────────────────────────────────────── */

function ChapterDetailSkeleton() {
  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sidebar skeleton */}
      <div className="w-52 flex-shrink-0 bg-white border-r border-surface-200 p-4 space-y-3">
        <div className="skeleton-shimmer rounded h-5 w-32 mb-4" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer rounded h-8 w-full" />
        ))}
      </div>
      {/* Main skeleton */}
      <div className="flex-1 p-6 space-y-4">
        <div className="skeleton-shimmer rounded h-4 w-64 mb-6" />
        <div className="grid grid-cols-3 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer rounded-lg h-28" />
          ))}
        </div>
        <div className="bg-white rounded-lg shadow-card overflow-hidden">
          <SkeletonTable rows={5} cols={5} />
        </div>
      </div>
    </div>
  );
}

/* ─── Error card ───────────────────────────────────────────────────────────── */

function ChapterDetailError({
  message,
  onRetry,
  backTo,
}: {
  message: string;
  onRetry: () => void;
  backTo: string;
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-white rounded-lg shadow-card p-8 max-w-md w-full text-center">
        <div className="w-12 h-12 bg-error-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6 text-error-600" />
        </div>
        <p className="text-sm text-navy-500 mb-6">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            className="text-sm font-medium text-gold-700 hover:text-gold-800 transition-colors"
            onClick={onRetry}
          >
            Retry
          </button>
          <Link className="text-sm text-navy-500 hover:text-navy-700 font-medium" to={backTo}>
            Back to project
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ─── Status banner ─────────────────────────────────────────────────────────── */

const BANNER_STYLES = {
  success: {
    bg: "#F0FDF4", border: "1px solid #BBF7D0", borderLeft: "4px solid #16A34A",
    iconColor: "#16A34A", textColor: "#15803D", Icon: CheckCircle2,
  },
  error: {
    bg: "#FEF2F2", border: "1px solid #FECACA", borderLeft: "4px solid #DC2626",
    iconColor: "#DC2626", textColor: "#B91C1C", Icon: AlertCircle,
  },
  pending: {
    bg: "#F0F9FF", border: "1px solid #BAE6FD", borderLeft: "4px solid #0284C7",
    iconColor: "#0284C7", textColor: "#0369A1", Icon: AlertCircle,
  },
} as const;

function StatusBanner({
  tone,
  message,
  onDismiss,
}: {
  tone: "pending" | "success" | "error";
  message: string;
  onDismiss?: () => void;
}) {
  const [fading, setFading] = useState(false);
  const s = BANNER_STYLES[tone];

  // Auto-dismiss success/error after 5s (fade starts at 4.5s)
  useEffect(() => {
    if (tone === "pending") return;
    const fadeTimer   = setTimeout(() => setFading(true),       4500);
    const dismissTimer = setTimeout(() => onDismiss?.(),        5000);
    return () => { clearTimeout(fadeTimer); clearTimeout(dismissTimer); };
  }, [tone, onDismiss]);

  function handleDismiss() {
    setFading(true);
    setTimeout(() => onDismiss?.(), 300);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex", alignItems: "center", gap: "10px",
        padding: "10px 16px",
        background: s.bg,
        border: s.border,
        borderLeft: s.borderLeft,
        borderRadius: "6px",
        opacity: fading ? 0 : 1,
        transition: "opacity 300ms ease",
      }}
    >
      <s.Icon
        style={{ width: "16px", height: "16px", color: s.iconColor, flexShrink: 0 }}
        aria-hidden="true"
      />
      <span style={{ flex: 1, fontSize: "13px", fontWeight: 500, color: s.textColor }}>
        {message}
      </span>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={handleDismiss}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "20px", height: "20px", padding: 0, border: "none",
            background: "transparent", cursor: "pointer",
            color: "#6B6560", borderRadius: "4px",
            flexShrink: 0,
          }}
        >
          <X style={{ width: "12px", height: "12px" }} aria-hidden />
        </button>
      )}
    </div>
  );
}

/* ─── Section file view ─────────────────────────────────────────────────────── */

function SectionFileView({
  section,
  count,
  projectId,
  chapterId,
  viewMode,
  onBack,
  onUpload,
  children,
}: {
  section: (typeof CHAPTER_SECTIONS)[number];
  count: number;
  projectId: number;
  chapterId: number;
  viewMode: ViewMode;
  onBack: () => void;
  onUpload: (category: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Back link */}
      <button
        type="button"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 hover:text-navy-900 transition-colors w-fit"
        onClick={onBack}
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Chapter Files
      </button>

      {/* Section header */}
      <div
        className="flex items-center justify-between gap-4 pb-3"
        style={{ borderBottom: "1px solid #E2DDD6" }}
      >
        <div className="flex items-center gap-3">
          <div
            style={{
              width: "36px", height: "36px", borderRadius: "8px",
              backgroundColor: section.bg,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <section.Icon style={{ width: "18px", height: "18px", color: section.color }} aria-hidden="true" />
          </div>
          <div className="flex items-baseline gap-2">
            <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#1A1714", margin: 0 }}>
              {section.label} Files
            </h2>
            <span style={{ fontSize: "12px", color: "#9C9590" }} className="tabular-nums">
              {count} {count === 1 ? "file" : "files"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onUpload(section.key)}
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            padding: "8px 12px", borderRadius: "6px", border: "none",
            backgroundColor: "#C9821A", color: "#ffffff",
            fontSize: "13px", fontWeight: 500,
            cursor: "pointer", transition: "background-color 150ms",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#B5731A"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#C9821A"; }}
        >
          <Upload style={{ width: "14px", height: "14px" }} aria-hidden="true" />
          Upload {section.label}
        </button>
      </div>

      {/* File content — no overflow-hidden so portaled tooltips/popovers render freely */}
      <div className="bg-white rounded-lg shadow-card">{children}</div>
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────────── */

export function ChapterDetailPage() {
  const { projectId, chapterId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const parsedProjectId = Number.parseInt(projectId ?? "", 10);
  const parsedChapterId = Number.parseInt(chapterId ?? "", 10);
  const hasValidProjectId = Number.isInteger(parsedProjectId) && parsedProjectId > 0;
  const hasValidChapterId = Number.isInteger(parsedChapterId) && parsedChapterId > 0;
  const normalizedProjectId = hasValidProjectId ? parsedProjectId : null;
  const normalizedChapterId = hasValidChapterId ? parsedChapterId : null;

  /* URL-driven section state */
  const sectionParam = searchParams.get("section") ?? "";
  const activeSectionDef = SECTION_BY_PARAM[sectionParam] ?? null;
  const activeSection = activeSectionDef?.key ?? null;

  function setSection(section: keyof ChapterCategoryCounts | null) {
    if (section === null) {
      setSearchParams({}, { replace: true });
    } else {
      const def = SECTION_BY_KEY[section];
      setSearchParams({ section: def.paramKey }, { replace: true });
    }
  }

  /* View mode — persisted in localStorage */
  const [viewMode, setViewModeRaw] = useState<ViewMode>(() => {
    try {
      const stored = localStorage.getItem("chapter-files-view");
      return stored === "grid" || stored === "list" ? stored : "list";
    } catch {
      return "list";
    }
  });

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeRaw(mode);
    try {
      localStorage.setItem("chapter-files-view", mode);
    } catch {
      // ignore storage errors
    }
  }, []);

  /* Download state */
  const [isDownloading, setIsDownloading] = useState(false);

  /* Upload panel */
  const [uploadCategory, setUploadCategory] = useState<string | null>(null);

  function openUpload(category: string) {
    setUploadCategory(category);
    // If a different section is active, navigate to it
    const matchingDef = CHAPTER_SECTIONS.find((s) => s.key === category);
    if (matchingDef && activeSection !== matchingDef.key) {
      setSection(matchingDef.key as keyof ChapterCategoryCounts);
    }
  }

  /* Data queries */
  const chapterDetailQuery = useChapterDetailQuery(normalizedProjectId, normalizedChapterId);
  const chapterFilesQuery = useChapterFilesQuery(normalizedProjectId, normalizedChapterId);
  const fileActions = useChapterFileActions({
    projectId: normalizedProjectId,
    chapterId: normalizedChapterId,
  });
  const chapterUpload = useChapterUpload({
    projectId: normalizedProjectId,
    chapterId: normalizedChapterId,
  });
  const hasInitializedSection = useRef(false);

  useDocumentTitle(
    normalizedChapterId === null
      ? "Chapters — S4 Carlisle CMS"
      : chapterDetailQuery.data?.chapter.title
        ? `${chapterDetailQuery.data.chapter.title} — S4 Carlisle CMS`
        : `Chapter ${normalizedChapterId} — S4 Carlisle CMS`,
  );

  /* Close upload panel after successful upload */
  useEffect(() => {
    if (chapterUpload.result && uploadCategory) {
      setUploadCategory(null);
    }
  }, [chapterUpload.result, uploadCategory]);

  /* ── Invalid params ─────────────────────────────────────────── */
  if (normalizedProjectId === null || normalizedChapterId === null) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-lg shadow-card p-8 text-center">
          <p className="text-sm text-navy-500 mb-4">
            The selected project or chapter identifier is not valid.
          </p>
          <Link className="text-sm text-gold-700 hover:text-gold-800 font-medium" to={uiPaths.projects}>
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  /* ── Loading ─────────────────────────────────────────────────── */
  if (chapterDetailQuery.isPending || chapterFilesQuery.isPending) {
    return <ChapterDetailSkeleton />;
  }

  /* ── Error ───────────────────────────────────────────────────── */
  if (chapterDetailQuery.isError || chapterFilesQuery.isError) {
    const error = chapterDetailQuery.error ?? chapterFilesQuery.error;
    return (
      <ChapterDetailError
        message={getApiErrorMessage(error, "The chapter detail page could not be loaded.")}
        onRetry={() => {
          void chapterDetailQuery.refetch();
          void chapterFilesQuery.refetch();
        }}
        backTo={uiPaths.projectDetail(normalizedProjectId)}
      />
    );
  }

  /* ── No data ─────────────────────────────────────────────────── */
  if (!chapterDetailQuery.data || !chapterFilesQuery.data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-lg shadow-card p-8 text-center">
          <p className="text-sm text-navy-500 mb-4">No chapter data was returned.</p>
          <Link
            className="text-sm text-gold-700 hover:text-gold-800 font-medium"
            to={uiPaths.projectDetail(normalizedProjectId)}
          >
            Back to project
          </Link>
        </div>
      </div>
    );
  }

  const { project, chapter } = chapterDetailQuery.data;
  const files = chapterFilesQuery.data.files;
  const categoryCounts = chapter.category_counts;

  /* Chapter package download */
  async function handleDownloadPackage() {
    if (isDownloading || normalizedProjectId === null || normalizedChapterId === null) return;
    setIsDownloading(true);
    try {
      const { blob, filename } = await downloadChapterPackage(
        normalizedProjectId,
        normalizedChapterId,
        `chapter-${normalizedChapterId}-package.zip`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  }

  /* Status banners */
  const banners: Array<{
    tone: "pending" | "success" | "error";
    message: string;
    onDismiss?: () => void;
  }> = [];
  if (fileActions.status) {
    banners.push({
      tone: fileActions.status.tone,
      message: fileActions.status.message,
      onDismiss: fileActions.clearStatus,
    });
  }
  if (uploadCategory === null && chapterUpload.errorMessage) {
    banners.push({ tone: "error", message: chapterUpload.errorMessage });
  } else if (uploadCategory === null && chapterUpload.statusMessage) {
    banners.push({
      tone: chapterUpload.isPending ? "pending" : "success",
      message: chapterUpload.statusMessage,
    });
  }

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* ── Left sidebar: section nav ──────────────────────────────── */}
      <aside
        className="w-52 flex-shrink-0 bg-white border-r border-surface-200 flex flex-col overflow-y-auto"
        aria-label="Chapter file sections"
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-surface-200">
          <FolderOpen className="w-5 h-5 text-gold-500 flex-shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold text-navy-900">Chapter Files</span>
        </div>

        {/* Overview nav item */}
        <nav className="flex-1 py-1.5" aria-label="File type sections">
          <button
            type="button"
            className={cn(
              "w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors duration-100",
              activeSection === null
                ? "bg-surface-100 border-l-2 border-l-gold-600 text-navy-900 font-medium"
                : "text-navy-600 hover:bg-surface-50 hover:text-navy-900"
            )}
            onClick={() => setSection(null)}
          >
            <FolderOpen className="w-4 h-4 flex-shrink-0 text-navy-400" aria-hidden="true" />
            <span className="flex-1 text-left">All Files</span>
            <span className="text-[10px] tabular-nums text-navy-400 bg-surface-200 px-1.5 py-0.5 rounded-full">
              {Object.values(categoryCounts).reduce((a, b) => a + b, 0)}
            </span>
          </button>

          {/* Section items */}
          {CHAPTER_SECTIONS.map((s) => {
            const isActive = activeSection === s.key;
            return (
              <button
                key={s.key}
                type="button"
                className={cn(
                  "w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors duration-100",
                  isActive
                    ? "bg-surface-100 border-l-2 border-l-gold-600 text-navy-900 font-medium"
                    : "text-navy-600 hover:bg-surface-50 hover:text-navy-900"
                )}
                onClick={() => setSection(s.key)}
              >
                <s.Icon
                  className="w-4 h-4 flex-shrink-0"
                  style={{ color: isActive ? s.color : undefined }}
                  aria-hidden="true"
                />
                <span className="flex-1 text-left">{s.label}</span>
                <span className="text-[10px] tabular-nums text-navy-400 bg-surface-200 px-1.5 py-0.5 rounded-full">
                  {categoryCounts[s.key]}
                </span>
              </button>
            );
          })}
        </nav>

      </aside>

      {/* ── Main content ───────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Breadcrumb bar */}
        <div className="flex items-center gap-1.5 px-5 py-2.5 bg-white border-b border-surface-200 text-xs text-navy-400 shrink-0">
          <Link to={uiPaths.projects} className="hover:text-navy-700 transition-colors">
            Projects
          </Link>
          <span aria-hidden="true" className="text-surface-400">›</span>
          <Link
            to={uiPaths.projectDetail(project.id)}
            className="hover:text-navy-700 transition-colors max-w-[10rem] truncate"
          >
            {project.title}
          </Link>
          <span aria-hidden="true" className="text-surface-400">›</span>
          <span className="font-medium text-navy-700" aria-current="page">
            {chapter.title || `Chapter ${chapter.number}`}
          </span>
        </div>

        {/* Status banners */}
        {banners.length > 0 && (
          <div className="px-6 pt-4 space-y-2">
            {banners.map((b) => (
              <StatusBanner
                key={b.message}
                tone={b.tone}
                message={b.message}
                onDismiss={b.onDismiss}
              />
            ))}
          </div>
        )}

        {/* Toolbar */}
        <ChapterToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onUpload={openUpload}
          onDownload={() => void handleDownloadPackage()}
          isDownloading={isDownloading}
        />

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Upload panel (inline above content when open) */}
          {uploadCategory !== null && (
            <div className="bg-white rounded-lg shadow-card p-5 mb-4">
              <ChapterUploadPanel
                activeTab={uploadCategory}
                errorMessage={chapterUpload.errorMessage}
                isPending={chapterUpload.isPending}
                onClearResult={chapterUpload.clearResult}
                onClose={() => setUploadCategory(null)}
                onUpload={chapterUpload.submitUpload}
                result={chapterUpload.result}
                statusMessage={chapterUpload.statusMessage}
              />
            </div>
          )}

          {activeSection === null ? (
            /* ── Overview: card grid ──────────────────────────────── */
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <FolderOpen className="w-6 h-6 text-gold-500" aria-hidden="true" />
                <h1 className="text-lg font-semibold text-navy-900">
                  {chapter.title || `Chapter ${chapter.number}`}
                </h1>
              </div>

              <ChapterSectionCards
                counts={categoryCounts}
                onSelect={(section) => setSection(section)}
              />
            </div>
          ) : (
            /* ── Section file view ─────────────────────────────────── */
            <SectionFileView
              section={activeSectionDef!}
              count={categoryCounts[activeSection]}
              projectId={normalizedProjectId}
              chapterId={normalizedChapterId}
              viewMode={viewMode}
              onBack={() => setSection(null)}
              onUpload={openUpload}
            >
              <ChapterFilesTable
                chapterId={normalizedChapterId}
                files={files}
                isActionPending={(fileId, action) => fileActions.isPending(fileId, action)}
                onCancelCheckout={(file) => fileActions.handleCancelCheckout(file)}
                onCheckout={(file) => fileActions.handleCheckout(file)}
                onDelete={(file) => fileActions.handleDelete(file)}
                projectId={normalizedProjectId}
                searchQuery=""
                selectedSection={activeSection}
              />
            </SectionFileView>
          )}
        </div>
      </div>
    </div>
  );
}
