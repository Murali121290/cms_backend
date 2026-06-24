import { useState, useRef, useEffect, useLayoutEffect, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Info,
  Layers,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonCard } from "@/components/ui/SkeletonLoader";
import { useStructuringReviewQuery } from "@/features/structuringReview/useStructuringReviewQuery";
import { WysiwygEditor, useEditorSaveRuns, type WysiwygEditorHandle, OnlyOfficeEditor, OnlyOfficeSidePanel, type OnlyOfficeEditorHandle, CollaboraSidePanel } from "@/features/editor";
import { useSessionStore } from "@/stores/sessionStore";
import { useFileXhtmlRunsQuery } from "@/features/technicalReview/useFileXhtmlRunsQuery";
import { StylesPanel } from "@/features/structuringReview/components/EditorStylesPanel";
import { VersionHistoryPanel } from "@/features/structuringReview/components/VersionHistoryPanel";
import { useParagraphStyles } from "@/features/editor/useParagraphStyles";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";

const ToolbarPopoverContext = createContext<{
  openId: string | null;
  setOpenId: (id: string | null) => void;
}>({ openId: null, setOpenId: () => {} });

function ToolbarPopoverGroup({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ToolbarPopoverContext.Provider value={{ openId, setOpenId }}>
      {children}
    </ToolbarPopoverContext.Provider>
  );
}

interface ToolbarPopoverProps {
  id: string;
  icon: React.ReactNode;
  label: string;
  title?: string;
  sticky?: boolean;
  width?: number;
  hideHeader?: boolean;
  children: React.ReactNode;
}

function ToolbarPopover({ id, icon, label, title, sticky, width = 320, hideHeader, children }: ToolbarPopoverProps) {
  const { openId, setOpenId } = useContext(ToolbarPopoverContext);
  const open = openId === id;
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }, [open]);

  useEffect(() => {
    if (!open || sticky) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpenId(null);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, sticky, setOpenId]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpenId(open ? null : id)}
        title={title ?? label}
        className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border shrink-0 inline-flex items-center gap-1.5 transition-all duration-150 cursor-pointer ${
          open
            ? "bg-amber-600 text-white border-amber-500"
            : "bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-slate-100"
        }`}
      >
        {icon}
        {label}
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", top: pos.top, right: pos.right, width, maxHeight: "70vh" }}
          className="z-50 bg-white border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        >
          {!hideHeader && (
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-slate-50 shrink-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text inline-flex items-center gap-1.5">
                {icon}
                {title ?? label}
              </span>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="p-1 rounded hover:bg-slate-200 text-muted hover:text-text cursor-pointer border-none bg-transparent"
                title="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="flex-1 min-h-0">
            {children}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export function StructuringReviewPage() {
  const navigate = useNavigate();
  const { projectId, chapterId, fileId } = useParams();
  const parsedProjectId = Number.parseInt(projectId ?? "", 10);
  const parsedChapterId = Number.parseInt(chapterId ?? "", 10);
  const parsedFileId = Number.parseInt(fileId ?? "", 10);
  const normalizedProjectId =
    Number.isInteger(parsedProjectId) && parsedProjectId > 0 ? parsedProjectId : null;
  const normalizedChapterId =
    Number.isInteger(parsedChapterId) && parsedChapterId > 0 ? parsedChapterId : null;
  const normalizedFileId =
    Number.isInteger(parsedFileId) && parsedFileId > 0 ? parsedFileId : null;

  const editorRef = useRef<WysiwygEditorHandle>(null);
  const reviewQuery = useStructuringReviewQuery(normalizedFileId);
  const xhtmlQuery = useFileXhtmlRunsQuery(normalizedFileId);
  const editorSave = useEditorSaveRuns(normalizedFileId);
  const stylesQuery = useParagraphStyles();

  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const defaultTab: "overview" | "editor" | "onlyoffice" | "collabora" =
    (tabParam === "editor" || tabParam === "onlyoffice" || tabParam === "collabora" || tabParam === "overview") ? tabParam : "overview";
  const [activeTab, setActiveTab] = useState<"overview" | "editor" | "onlyoffice" | "collabora">(defaultTab);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [trackChangesEnabled, setTrackChangesEnabled] = useState(false);
  const location = useLocation();
  const xsltContent = (location.state as { xsltContent?: string } | null)?.xsltContent;

  const viewer = useSessionStore((s) => s.viewer);
  const currentUser = viewer?.username;
  const [customStyles, setCustomStyles] = useState<string[]>([]);
  const onlyofficeRef = useRef<OnlyOfficeEditorHandle>(null);
  const [ooConnector, setOoConnector] = useState<any>(null);
  const collaboraIframeRef = useRef<HTMLIFrameElement>(null);

  useDocumentTitle(
    normalizedFileId === null
      ? "Structuring Review — S4 Carlisle CMS"
      : `Structuring Review #${normalizedFileId} — S4 Carlisle CMS`,
  );

  // ── Invalid params ────────────────────────────────────────────────────────
  if (normalizedProjectId === null || normalizedChapterId === null || normalizedFileId === null) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Invalid structuring review route"
            description="The selected project, chapter, or file identifier is not valid."
          />
          <Link to={uiPaths.projects}>
            <Button variant="primary">Back to Projects</Button>
          </Link>
        </div>
      </main>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (reviewQuery.isPending) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="h-14 skeleton-shimmer rounded-md" aria-hidden="true" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
            <div className="space-y-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (reviewQuery.isError) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Structuring review unavailable"
            description={getApiErrorMessage(
              reviewQuery.error,
              "The frontend shell could not load the structuring review metadata.",
            )}
          />
          <div className="flex items-center justify-center gap-3">
            <Button variant="primary" onClick={() => void reviewQuery.refetch()}>
              Try Again
            </Button>
            <Link to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
              <Button variant="secondary">Back to Chapter</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ── No data ───────────────────────────────────────────────────────────────
  if (!reviewQuery.data) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Structuring review unavailable"
            description="The structuring review contract returned no data."
          />
          <Link to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
            <Button variant="primary">Back to Chapter</Button>
          </Link>
        </div>
      </main>
    );
  }

  const review = reviewQuery.data;

  // Synchronized styles state merging publisher styles, review styles, and custom styles
  const publisherStyles = stylesQuery.data || [];
  const allStyles = Array.from(new Set([...publisherStyles, ...(review?.styles || []), ...customStyles])).sort();

  const handleAddStyle = (newStyleName: string) => {
    if (!customStyles.includes(newStyleName)) {
      setCustomStyles((prev) => [...prev, newStyleName]);
    }
  };

  // ── Computed info ─────────────────────────────────────────────────────────
  const styleCount = review.styles.length;
  const editorMode = review.editor.mode;
  const saveMode = review.editor.save_mode;
  const wopiMode = review.editor.wopi_mode;
  const onlyoffice_available = Boolean(review.editor.onlyoffice_available);
  const hasCollabora = Boolean(review.editor.collabora_url);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className={`page-enter min-h-screen bg-surface-100 flex flex-col ${isFullscreen ? "p-2" : "p-6"}`}>
      <div className={`w-full flex-1 flex flex-col ${
        isFullscreen
          ? "max-w-none px-0"
          : activeTab === "editor"
            ? "px-4 space-y-6"
            : "max-w-[1600px] mx-auto px-4 space-y-6"
      }`}>

        {/* Page Header */}
        {!isFullscreen && (
          <PageHeader
            breadcrumb={
              <span className="flex items-center gap-1.5 text-sm text-navy-400">
                <Link className="hover:text-navy-700 transition-colors" to={uiPaths.projects}>
                  Projects
                </Link>
                <span>/</span>
                <Link
                  className="hover:text-navy-700 transition-colors"
                  to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}
                >
                  Chapter
                </Link>
                <span>/</span>
                <span className="text-navy-700">Structuring Review</span>
              </span>
            }
            title="Document Structuring Workspace"
            subtitle={review.file.filename}
            secondaryActions={[
              <a
                key="export"
                href={review.actions.export_href}
                className="no-underline"
                download
              >
                <Button variant="secondary" leftIcon={<Download className="w-4 h-4" />}>
                  Export Processed File
                </Button>
              </a>,
              <Button
                key="fullscreen"
                variant="secondary"
                leftIcon={<Maximize2 className="w-4 h-4" />}
                onClick={() => setIsFullscreen(true)}
              >
                Fullscreen
              </Button>,
              <Button
                key="back"
                variant="secondary"
                leftIcon={<ArrowLeft />}
                onClick={() => navigate(-1)}
              >
                Back
              </Button>,
            ]}
          />
        )}

        {/* Tab Controls */}
        {!isFullscreen && (
          <div className="flex border-b border-navy-200">
            <button
              onClick={() => setActiveTab("overview")}
              className={`py-3 px-6 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all ${
                activeTab === "overview"
                  ? "border-navy-600 text-navy-800"
                  : "border-transparent text-navy-400 hover:text-navy-600"
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Document Overview
            </button>
            <button
              onClick={() => setActiveTab("editor")}
              className={`py-3 px-6 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all ${
                activeTab === "editor"
                  ? "border-navy-600 text-navy-800"
                  : "border-transparent text-navy-400 hover:text-navy-600"
              }`}
            >
              <FileText className="w-4 h-4" />
              Structuring Editor Workspace
            </button>
            {onlyoffice_available && (
              <button
                onClick={() => setActiveTab("onlyoffice")}
                className={`py-3 px-6 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all ${
                  activeTab === "onlyoffice"
                    ? "border-navy-600 text-navy-800"
                    : "border-transparent text-navy-400 hover:text-navy-600"
                }`}
              >
                <BookOpen className="w-4 h-4" />
                OnlyOffice Editor
              </button>
            )}
            {review.editor.collabora_url && (
              <button
                onClick={() => setActiveTab("collabora")}
                className={`py-3 px-6 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all ${
                  activeTab === "collabora"
                    ? "border-navy-600 text-navy-800"
                    : "border-transparent text-navy-400 hover:text-navy-600"
                }`}
              >
                <BookOpen className="w-4 h-4" />
                Collabora Office Editor
              </button>
            )}
          </div>
        )}

        {/* Error banner only — success feedback comes from the save button's state */}
        {editorSave.errorMessage && (
          <div className="px-4 py-3 rounded-md text-sm font-medium border bg-error-100 border-error-100 text-error-600">
            {editorSave.errorMessage}
          </div>
        )}

        {/* ── TAB 1: OVERVIEW DASHBOARD ──────────────────────────── */}
        {(activeTab === "overview" || isFullscreen) && !isFullscreen && (
          <div className="space-y-6 page-enter">
            {/* Summary metric cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm transition-shadow duration-150 hover:shadow-md border-t-[3.5px] border-t-blue-500">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Editor Mode</span>
                <div className="text-xl font-extrabold text-slate-900 mt-1 capitalize">{editorMode}</div>
                <p className="text-[11px] text-slate-500 mt-1.5">Document processing mode</p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm transition-shadow duration-150 hover:shadow-md border-t-[3.5px] border-t-amber-500">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Styles Applied</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-1">{styleCount}</div>
                <p className="text-[11px] text-slate-500 mt-1.5">Document paragraph styles</p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm transition-shadow duration-150 hover:shadow-md border-t-[3.5px] border-t-emerald-500">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Save Mode</span>
                <div className="text-sm font-extrabold text-slate-900 mt-2 capitalize">{saveMode.replace(/_/g, " ")}</div>
                <p className="text-[11px] text-slate-500 mt-1.5">WOPI autosave enabled</p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm transition-shadow duration-150 hover:shadow-md border-t-[3.5px] border-t-purple-500">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">WOPI Mode</span>
                <div className="text-xl font-extrabold text-slate-900 mt-1 capitalize">{wopiMode}</div>
                <p className="text-[11px] text-slate-500 mt-1.5">Web Office Protocol Interface</p>
              </div>
            </div>

            {/* Body split */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left: File info + Styles */}
              <div className="lg:col-span-6 space-y-6">
                {/* File information */}
                <div className="bg-white rounded-lg shadow-card p-6">
                  <h3 className="text-sm font-semibold text-navy-900 mb-5 flex items-center gap-2">
                    <Info className="w-4 h-4 text-navy-500" />
                    Document Information
                  </h3>
                  <dl className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-surface-100 rounded-lg">
                        <dt className="text-[10px] uppercase font-bold text-navy-400 tracking-wider">Source File</dt>
                        <dd className="text-xs font-semibold text-navy-700 mt-1 break-all">{review.file.filename}</dd>
                      </div>
                      <div className="p-3 bg-surface-100 rounded-lg">
                        <dt className="text-[10px] uppercase font-bold text-navy-400 tracking-wider">Processed File</dt>
                        <dd className="text-xs font-semibold text-navy-700 mt-1 break-all">{review.processed_file.filename}</dd>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-surface-100 rounded-lg">
                        <dt className="text-[10px] uppercase font-bold text-navy-400 tracking-wider">File ID</dt>
                        <dd className="text-sm font-bold text-navy-800 mt-1 font-mono">{review.file.id}</dd>
                      </div>
                      <div className="p-3 bg-surface-100 rounded-lg">
                        <dt className="text-[10px] uppercase font-bold text-navy-400 tracking-wider">Collabora</dt>
                        <dd className="mt-1">
                          <Badge variant={hasCollabora ? "success" : "error"} size="sm">
                            {hasCollabora ? "Available" : "Unavailable"}
                          </Badge>
                        </dd>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-surface-100 rounded-lg">
                        <dt className="text-[10px] uppercase font-bold text-navy-400 tracking-wider">Version</dt>
                        <dd className="text-sm font-bold text-navy-800 mt-1 font-mono">v{review.file.version}</dd>
                      </div>
                      <div className="p-3 bg-surface-100 rounded-lg">
                        <dt className="text-[10px] uppercase font-bold text-navy-400 tracking-wider">Lock</dt>
                        <dd className="mt-1">
                          <Badge variant={review.file.lock.is_checked_out ? "warning" : "success"} size="sm">
                            {review.file.lock.is_checked_out
                              ? `Locked by ${review.file.lock.checked_out_by_username ?? "user"}`
                              : "Available"}
                          </Badge>
                        </dd>
                      </div>
                    </div>
                  </dl>
                </div>

                {/* Quick actions */}
                <div className="bg-white rounded-lg shadow-card p-6">
                  <h3 className="text-sm font-semibold text-navy-900 mb-4 flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-navy-500" />
                    Quick Actions
                  </h3>
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setActiveTab("editor")}
                      className="w-full flex items-center justify-between px-4 py-3 bg-navy-50 hover:bg-navy-100 rounded-lg transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md bg-navy-800 flex items-center justify-center">
                          <FileText className="w-4 h-4 text-white" />
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-semibold text-navy-800">Open Editor Workspace</p>
                          <p className="text-xs text-navy-500">Review and save structuring changes</p>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-navy-400 group-hover:text-navy-700 transition-colors" />
                    </button>

                    <a
                      href={review.actions.export_href}
                      className="w-full flex items-center justify-between px-4 py-3 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors group no-underline"
                      download
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md bg-emerald-600 flex items-center justify-center">
                          <Download className="w-4 h-4 text-white" />
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-semibold text-emerald-800">Export Processed File</p>
                          <p className="text-xs text-emerald-600">Download the structured document</p>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-emerald-400 group-hover:text-emerald-700 transition-colors" />
                    </a>
                  </div>
                </div>

                {/* Version history panel */}
                <VersionHistoryPanel
                  fileId={normalizedFileId}
                  currentFileId={normalizedFileId}
                  onOpenVersion={(versionId) => {
                    navigate(uiPaths.structuringReview(normalizedProjectId, normalizedChapterId, versionId) + "?tab=overview");
                  }}
                />
              </div>

              {/* Right: Styles list */}
              <div className="lg:col-span-6 space-y-6">
                <div className="bg-white rounded-lg shadow-card p-6">
                  <h3 className="text-sm font-semibold text-navy-900 mb-4 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-gold-600" />
                      Document Paragraph Styles
                    </span>
                    <Badge variant="default">{styleCount} styles</Badge>
                  </h3>

                  {styleCount === 0 ? (
                    <div className="text-center py-10 text-navy-400 text-sm">
                      No paragraph styles detected in the processed document.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-navy-100 text-navy-400 font-bold bg-surface-100 uppercase tracking-wider text-[10px]">
                            <th className="py-2 px-3">#</th>
                            <th className="py-2 px-3">Style Name</th>
                            <th className="py-2 px-3 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {review.styles.map((style, idx) => (
                            <tr key={idx} className="border-b border-navy-50 hover:bg-surface-50 transition-colors">
                              <td className="py-2.5 px-3 text-navy-400 font-mono">{idx + 1}</td>
                              <td className="py-2.5 px-3 font-semibold text-navy-800">{style}</td>
                              <td className="py-2.5 px-3 text-right">
                                <Badge variant="success" size="sm">Applied</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: EDITOR WORKSPACE ────────────────────────────── */}
        {(activeTab === "editor" || isFullscreen) && activeTab !== "onlyoffice" && (
          <div className="flex-1 flex flex-col min-h-0 page-enter">
            {xhtmlQuery.isPending && !xsltContent ? (
              <div style={{ padding: "24px", textAlign: "center" }}>Loading document…</div>
            ) : (
              <>
              <WysiwygEditor
                ref={editorRef}
              key={`editor-${normalizedFileId}`}
              initialContent={xsltContent ?? xhtmlQuery.data?.content ?? ""}
              onSave={async (html) => {
                const res = await editorSave.save(html);
                if (res && res.file_id && res.file_id !== normalizedFileId) {
                  navigate(uiPaths.structuringReview(normalizedProjectId, normalizedChapterId, res.file_id) + "?tab=editor");
                } else {
                  void reviewQuery.refetch();
                }
              }}
              isSaving={editorSave.isPending}
              saveLabel="Save & Convert to DOCX"
              documentTitle={review.file.filename}
              exportHref={review.actions.export_href}
              trackChangesEnabled={trackChangesEnabled}
              onTrackChangesToggle={setTrackChangesEnabled}
              height={isFullscreen ? "calc(100vh - 20px)" : "calc(100vh - 260px)"}
              styles={allStyles}
              onAddStyle={handleAddStyle}
              currentUser={currentUser}
              fileId={normalizedFileId?.toString()}
              toolbarExtras={
                <ToolbarPopoverGroup>
                  <ToolbarPopover
                    id="group"
                    icon={<Layers className="w-3.5 h-3.5" />}
                    label="Group"
                    title="Document Elements"
                    sticky
                    width={360}
                  >
                    <StylesPanel
                      styles={allStyles}
                      editorRef={editorRef}
                      onAddStyle={handleAddStyle}
                      fileId={normalizedFileId}
                      charStyles={review.char_styles}
                      visibleTabs={["group"]}
                    />
                  </ToolbarPopover>
                  <ToolbarPopover
                    id="para"
                    icon={<FileText className="w-3.5 h-3.5" />}
                    label="Para"
                    title="Paragraph Styles"
                    sticky
                    width={320}
                  >
                    <StylesPanel
                      styles={allStyles}
                      editorRef={editorRef}
                      onAddStyle={handleAddStyle}
                      fileId={normalizedFileId}
                      charStyles={review.char_styles}
                      visibleTabs={["paragraph"]}
                    />
                  </ToolbarPopover>
                  <ToolbarPopover
                    id="char"
                    icon={<BookOpen className="w-3.5 h-3.5" />}
                    label="Char"
                    title="Character Styles"
                    sticky
                    width={320}
                  >
                    <StylesPanel
                      styles={allStyles}
                      editorRef={editorRef}
                      onAddStyle={handleAddStyle}
                      fileId={normalizedFileId}
                      charStyles={review.char_styles}
                      visibleTabs={["character"]}
                    />
                  </ToolbarPopover>
                  <ToolbarPopover
                    id="history"
                    icon={<Clock className="w-3.5 h-3.5" />}
                    label="History"
                    title="Version History"
                    width={320}
                    hideHeader
                  >
                    <VersionHistoryPanel
                      fileId={normalizedFileId}
                      currentFileId={normalizedFileId}
                      defaultExpanded
                      onOpenVersion={(versionId) => {
                        navigate(uiPaths.structuringReview(normalizedProjectId, normalizedChapterId, versionId) + "?tab=editor");
                      }}
                    />
                  </ToolbarPopover>
                </ToolbarPopoverGroup>
              }
            />
              </>
          )}
          </div>
        )}

        {activeTab === "onlyoffice" && onlyoffice_available && (
          <div className="flex-1 flex flex-col min-h-0 page-enter">
            {/* OnlyOffice Toolbar */}
            <div className="bg-white border-b border-navy-200 px-4 py-3 flex items-center gap-4 shadow-sm">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-medium text-emerald-700">Auto-saving via OnlyOffice callback</span>
              </div>
            </div>

            {/* Split pane: tabbed sidebar + OnlyOffice Editor.
                Use a definite height (not min-height) so the side panel's list
                can scroll internally instead of growing past the viewport. */}
            <div className="flex-1 flex min-h-0 gap-0" style={{ height: isFullscreen ? "calc(100vh - 90px)" : "calc(100vh - 240px)" }}>
              <OnlyOfficeSidePanel
                connector={ooConnector}
                styles={allStyles}
                fileId={normalizedFileId}
                onOpenVersion={(versionId) =>
                  navigate(uiPaths.structuringReview(normalizedProjectId, normalizedChapterId, versionId) + "?tab=onlyoffice")
                }
                onAddStyle={handleAddStyle}
              />

              <OnlyOfficeEditor
                ref={onlyofficeRef}
                fileId={normalizedFileId}
                mode="structuring"
                height={isFullscreen ? "calc(100vh - 90px)" : "calc(100vh - 240px)"}
                onConnectorReady={setOoConnector}
              />
            </div>
          </div>
        )}

        {activeTab === "collabora" && review.editor.collabora_url && (
          <div className="flex-1 flex flex-col min-h-0 page-enter">
            {/* Collabora Toolbar */}
            <div className="bg-white border-b border-navy-200 px-4 py-3 flex items-center gap-4 shadow-sm">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-medium text-emerald-700">Auto-saving via WOPI</span>
              </div>
            </div>

            {/* Split pane: tabbed sidebar + Collabora Editor */}
            <div className="flex-1 flex min-h-0 gap-0" style={{ minHeight: isFullscreen ? "calc(100vh - 80px)" : "600px" }}>
              <CollaboraSidePanel
                iframeRef={collaboraIframeRef}
                styles={allStyles}
                fileId={normalizedFileId}
                onOpenVersion={(versionId) =>
                  navigate(uiPaths.structuringReview(normalizedProjectId, normalizedChapterId, versionId) + "?tab=collabora")
                }
              />

              {/* Collabora iframe */}
              <iframe
                ref={collaboraIframeRef}
                src={review.editor.collabora_url}
                className="flex-1 w-full border-0 overflow-hidden"
                allow="clipboard-read; clipboard-write"
                allowFullScreen
                title="Collabora Editor"
              />
            </div>
          </div>
        )}
      </div>

      {/* Floating Fullscreen Exit Button */}
      {isFullscreen && (
        <div style={{ position: "fixed", top: "16px", right: "16px", zIndex: 1000 }}>
          <Button
            variant="secondary"
            leftIcon={<Minimize2 className="w-4 h-4" />}
            onClick={() => setIsFullscreen(false)}
            style={{ boxShadow: "0 4px 12px rgba(0,0,0,0.15)", backgroundColor: "#FFFFFF" }}
          >
            Exit Fullscreen
          </Button>
        </div>
      )}
    </main>
  );
}
