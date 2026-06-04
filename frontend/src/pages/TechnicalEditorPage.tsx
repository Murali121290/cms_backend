import { useState, useRef } from "react";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FileText,
  Info,
  LayoutDashboard,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonCard } from "@/components/ui/SkeletonLoader";
import { useTechnicalReviewQuery } from "@/features/technicalReview/useTechnicalReviewQuery";
import { WysiwygEditor, useEditorSave, type WysiwygEditorHandle } from "@/features/editor";
import { useFileXhtmlQuery } from "@/features/technicalReview/useFileXhtmlQuery";
import { StylesPanel } from "@/features/structuringReview/components/EditorStylesPanel";
import { VersionHistoryPanel } from "@/features/structuringReview/components/VersionHistoryPanel";
import { useParagraphStyles } from "@/features/editor/useParagraphStyles";
import { CollaboraSidePanel } from "@/features/editor/CollaboraSidePanel";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";

export function TechnicalEditorPage() {
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
  const reviewQuery = useTechnicalReviewQuery(normalizedFileId);
  const xhtmlQuery = useFileXhtmlQuery(normalizedFileId);
  const editorSave = useEditorSave(normalizedFileId);
  const stylesQuery = useParagraphStyles();

  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const defaultTab: "overview" | "editor" | "collabora" =
    (tabParam === "editor" || tabParam === "collabora" || tabParam === "overview") ? tabParam : "overview";
  const [activeTab, setActiveTab] = useState<"overview" | "editor" | "collabora">(defaultTab);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [customStyles, setCustomStyles] = useState<string[]>([]);
  const collaboraIframeRef = useRef<HTMLIFrameElement>(null);

  useDocumentTitle(
    normalizedFileId === null
      ? "Technical Editor — S4 Carlisle CMS"
      : `Technical Editor #${normalizedFileId} — S4 Carlisle CMS`,
  );

  // ── Invalid params ────────────────────────────────────────────────────────
  if (normalizedProjectId === null || normalizedChapterId === null || normalizedFileId === null) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Invalid technical editor route"
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (reviewQuery.isError) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Failed to load technical editor"
            description={getApiErrorMessage(reviewQuery.error, "An error occurred while loading the editor.")}
          />
          <Button variant="primary" onClick={() => void reviewQuery.refetch()}>
            Retry
          </Button>
        </div>
      </main>
    );
  }

  const review = reviewQuery.data;
  if (!review) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <EmptyState
          title="No file data"
          description="Unable to load the requested file."
        />
      </main>
    );
  }

  const collabora_url = review.collabora_url || null;
  const publisherStyles = stylesQuery.data || [];
  const allStyles = [
    ...publisherStyles,
    ...customStyles,
  ].sort();
  const hasCollabora = !!collabora_url;

  const handleAddStyle = (style: string) => {
    if (!customStyles.includes(style)) {
      setCustomStyles((prev) => [...prev, style].sort());
    }
  };

  return (
    <main className="flex flex-col h-screen bg-surface-100">
      {/* Page Header */}
      {!isFullscreen && (
        <div className="flex-shrink-0 bg-white border-b border-surface-200">
          <PageHeader
            title="Technical Editor Workspace"
            subtitle={review.file.filename}
            secondaryActions={[
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
        </div>
      )}

      {/* Tab Controls */}
      {!isFullscreen && (
        <div className="flex border-b border-navy-200 bg-white">
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
            WYSIWYG Editor
          </button>
          {hasCollabora && (
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

      {/* Content area */}
      <div className="flex-1 overflow-hidden bg-white">
        {/* ── TAB 1: OVERVIEW ──────────────────────────────────────────── */}
        {(activeTab === "overview" || isFullscreen) && !isFullscreen && (
          <div className="space-y-6 page-enter p-6 max-w-6xl mx-auto">
            {/* File info card */}
            <div className="bg-white rounded-lg shadow-card p-6 border border-navy-100">
              <h3 className="text-sm font-semibold text-navy-900 mb-4 flex items-center gap-2">
                <Info className="w-4 h-4 text-navy-500" />
                Document Information
              </h3>
              <dl className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-surface-100 rounded-lg">
                    <dt className="text-[10px] uppercase font-bold text-navy-400 tracking-wider">Filename</dt>
                    <dd className="text-xs font-semibold text-navy-700 mt-1">{review.file.filename}</dd>
                  </div>
                  <div className="p-3 bg-surface-100 rounded-lg">
                    <dt className="text-[10px] uppercase font-bold text-navy-400 tracking-wider">Version</dt>
                    <dd className="text-sm font-bold text-navy-800 mt-1 font-mono">v{review.file.version}</dd>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-surface-100 rounded-lg">
                    <dt className="text-[10px] uppercase font-bold text-navy-400 tracking-wider">Collabora</dt>
                    <dd className="mt-1">
                      <Badge variant={hasCollabora ? "success" : "error"} size="sm">
                        {hasCollabora ? "Available" : "Unavailable"}
                      </Badge>
                    </dd>
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

            {/* Quick action */}
            <div className="bg-white rounded-lg shadow-card p-6 border border-navy-100">
              <h3 className="text-sm font-semibold text-navy-900 mb-4 flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-navy-500" />
                Quick Actions
              </h3>
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
                    <p className="text-sm font-semibold text-navy-800">Open WYSIWYG Editor</p>
                    <p className="text-xs text-navy-500">Review and save edits</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-navy-400 group-hover:text-navy-700 transition-colors" />
              </button>
            </div>
          </div>
        )}

        {/* ── TAB 2: WYSIWYG EDITOR ─────────────────────────────────────── */}
        {(activeTab === "editor" || isFullscreen) && activeTab !== "collabora" && (
          <div className="flex-1 flex flex-col min-h-0 page-enter">
            <WysiwygEditor
              ref={editorRef}
              key={`editor-${normalizedFileId}`}
              initialContent={xhtmlQuery.data?.content ?? ""}
              onSave={async (html) => {
                const res = await editorSave.save(html);
                if (res && res.file_id && res.file_id !== normalizedFileId) {
                  navigate(uiPaths.technicalEditor(normalizedProjectId, normalizedChapterId, res.file_id) + "?tab=editor");
                } else {
                  void reviewQuery.refetch();
                }
              }}
              isSaving={editorSave.isPending}
              saveLabel="Save & Convert to DOCX"
              documentTitle={review.file.filename}
              height={isFullscreen ? "calc(100vh - 20px)" : "calc(100vh - 260px)"}
              styles={allStyles}
              onAddStyle={handleAddStyle}
              sidePanel={
                <div className="flex flex-col gap-4 h-full min-h-0">
                  <div className="flex-1 min-h-0">
                    <StylesPanel styles={allStyles} editorRef={editorRef} />
                  </div>
                  <div className="flex-shrink-0">
                    <VersionHistoryPanel
                      fileId={normalizedFileId}
                      currentFileId={normalizedFileId}
                      onOpenVersion={(versionId) => {
                        navigate(uiPaths.technicalEditor(normalizedProjectId, normalizedChapterId, versionId) + "?tab=editor");
                      }}
                    />
                  </div>
                </div>
              }
            />
          </div>
        )}

        {/* ── TAB 3: COLLABORA EDITOR ──────────────────────────────────── */}
        {activeTab === "collabora" && collabora_url && (
          <div className="flex-1 flex flex-col min-h-0 page-enter">
            {/* Collabora Toolbar */}
            <div className="bg-white border-b border-navy-200 px-4 py-3 flex items-center gap-4 shadow-sm">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-medium text-emerald-700">Auto-saving via WOPI</span>
              </div>
              <span className="text-xs text-navy-400">Editing: {review.file.filename}</span>
            </div>

            {/* Split pane: tabbed sidebar + Collabora Editor */}
            <div className="flex-1 flex min-h-0 gap-0">
              <CollaboraSidePanel
                iframeRef={collaboraIframeRef}
                styles={allStyles}
                fileId={normalizedFileId}
                findings={review.findings as any[]}
                onOpenVersion={(versionId) =>
                  navigate(uiPaths.technicalEditor(normalizedProjectId, normalizedChapterId, versionId) + "?tab=collabora")
                }
              />

              {/* Collabora iframe */}
              <iframe
                ref={collaboraIframeRef}
                src={collabora_url}
                className="flex-1 w-full border-0 overflow-hidden"
                allow="clipboard-read; clipboard-write"
                allowFullScreen
                title="Collabora Editor"
                style={{ minHeight: isFullscreen ? "calc(100vh - 80px)" : "600px" }}
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
