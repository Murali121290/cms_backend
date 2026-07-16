import { useState, useRef, useMemo } from "react";
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
  BookMarked,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
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
import { useStylesheetsQuery, useStylesheetMutations } from "@/features/stylesheets/useStylesheetsQuery";
import type { Occurrence } from "@/features/editor/OccurrenceHighlight";
import type { StylesheetSummary } from "@/types/api";

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
  const stylesheetsQuery = useStylesheetsQuery(normalizedProjectId);
  const activeStylesheet = stylesheetsQuery.data?.active_stylesheet;
  const projectStylesheets = stylesheetsQuery.data?.stylesheets || [];
  const { activate: activateStylesheet } = useStylesheetMutations(normalizedProjectId || 0);

  const reviewQuery = useTechnicalReviewQuery(normalizedFileId, activeStylesheet?.id);
  const xhtmlQuery = useFileXhtmlQuery(normalizedFileId);
  const editorSave = useEditorSave(normalizedFileId);
  const stylesQuery = useParagraphStyles();
  const [selectedFindingIndex, setSelectedFindingIndex] = useState(-1);

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
      ? "Technical Editor â€” S4 Carlisle CMS"
      : `Technical Editor #${normalizedFileId} â€” S4 Carlisle CMS`,
  );

  // â”€â”€ Invalid params â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (normalizedProjectId === null || normalizedChapterId === null || normalizedFileId === null) {
    return (
      <main className="page-enter min-h-screen bg-background p-6 flex items-center justify-center">
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

  // â”€â”€ Loading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (reviewQuery.isPending || stylesheetsQuery.isPending) {
    return (
      <main className="page-enter min-h-screen bg-background p-6">
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
      <main className="page-enter min-h-screen bg-background p-6 flex items-center justify-center">
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
      <main className="page-enter min-h-screen bg-background p-6 flex items-center justify-center">
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

  // Map technical-review findings to Occurrence objects for editor highlighting
  const findings: any[] = review.findings || [];
  const occurrences: Occurrence[] = useMemo(() =>
    findings.map((f) => ({
      para_index: f.para_index ?? 0,
      match_start: f.match_start ?? 0,
      match_end: f.match_end ?? (f.surface?.length ?? 0),
      surface: f.surface ?? "",
      category: "stylesheet",
      in_stylesheet: true,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [review.findings]
  );

  const handleAddStyle = (style: string) => {
    if (!customStyles.includes(style)) {
      setCustomStyles((prev) => [...prev, style].sort());
    }
  };

  return (
    <main className="flex flex-col h-screen bg-background">
      {/* Page Header */}
      {!isFullscreen && (
        <div className="flex-shrink-0 bg-white border-b border-border">
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
        <div className="flex border-b border-border bg-white">
          <button
            onClick={() => setActiveTab("overview")}
            className={`py-3 px-6 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all ${
              activeTab === "overview"
                ? "border-text text-text"
                : "border-transparent text-muted hover:text-text"
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Document Overview
          </button>
          <button
            onClick={() => setActiveTab("editor")}
            className={`py-3 px-6 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all ${
              activeTab === "editor"
                ? "border-text text-text"
                : "border-transparent text-muted hover:text-text"
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
                  ? "border-text text-text"
                  : "border-transparent text-muted hover:text-text"
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
        {/* â”€â”€ TAB 1: OVERVIEW â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {(activeTab === "overview" || isFullscreen) && !isFullscreen && (
          <div className="space-y-6 page-enter p-6 max-w-6xl mx-auto">
            {/* File info card */}
            <div className="bg-white rounded-lg shadow-card p-6 border border-border">
              <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
                <Info className="w-4 h-4 text-muted" />
                Document Information
              </h3>
              <dl className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-background rounded-lg">
                    <dt className="text-[10px] uppercase font-bold text-muted tracking-wider">Filename</dt>
                    <dd className="text-xs font-semibold text-text mt-1">{review.file.filename}</dd>
                  </div>
                  <div className="p-3 bg-background rounded-lg">
                    <dt className="text-[10px] uppercase font-bold text-muted tracking-wider">Version</dt>
                    <dd className="text-sm font-bold text-text mt-1 font-mono">v{review.file.version}</dd>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-background rounded-lg">
                    <dt className="text-[10px] uppercase font-bold text-muted tracking-wider">Collabora</dt>
                    <dd className="mt-1">
                      <Badge variant={hasCollabora ? "success" : "error"} size="sm">
                        {hasCollabora ? "Available" : "Unavailable"}
                      </Badge>
                    </dd>
                  </div>
                  <div className="p-3 bg-background rounded-lg">
                    <dt className="text-[10px] uppercase font-bold text-muted tracking-wider">Lock</dt>
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

            {/* Stylesheet Selection card */}
            <div className="bg-white rounded-lg shadow-card p-6 border border-border">
              <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
                <BookMarked className="w-4 h-4 text-muted" />
                Editorial Stylesheet
              </h3>
              <div className="max-w-md">
                <Select
                  label="Active Stylesheet"
                  placeholder="Select a stylesheet to apply..."
                  options={projectStylesheets.map((s) => ({
                    value: s.id.toString(),
                    label: s.name,
                  }))}
                  value={activeStylesheet?.id?.toString() || ""}
                  onChange={(e) => {
                    if (e.target.value) {
                      activateStylesheet.mutate(Number(e.target.value));
                    }
                  }}
                  disabled={activateStylesheet.isPending || stylesheetsQuery.isPending}
                />
                <p className="text-xs text-muted mt-2">
                  The selected stylesheet will be used to analyze occurrences and enforce formatting rules while editing.
                </p>
              </div>
            </div>

            {/* Quick action */}
            <div className="bg-white rounded-lg shadow-card p-6 border border-border">
              <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-muted" />
                Quick Actions
              </h3>
              <button
                type="button"
                onClick={() => setActiveTab("editor")}
                className="w-full flex items-center justify-between px-4 py-3 bg-sidebar/3 hover:bg-sidebar/5 rounded-lg transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-text/15 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-white" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-text">Open WYSIWYG Editor</p>
                    <p className="text-xs text-muted">Review and save edits</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted group-hover:text-text transition-colors" />
              </button>
            </div>
          </div>
        )}

        {/* â”€â”€ TAB 2: WYSIWYG EDITOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
              occurrences={occurrences}
              selectedOccurrenceIndex={selectedFindingIndex}
              onOccurrenceClick={setSelectedFindingIndex}
              sidePanel={
                <div className="flex flex-col h-full min-h-0 divide-y divide-border">
                  {/* Stylesheet occurrences panel */}
                  <StylesheetOccurrencesPanel
                    activeStylesheet={activeStylesheet}
                    projectStylesheets={projectStylesheets}
                    onActivateStylesheet={(id) => activateStylesheet.mutate(id)}
                    isActivating={activateStylesheet.isPending}
                    findings={findings}
                    selectedIndex={selectedFindingIndex}
                    onSelect={(i) => {
                      setSelectedFindingIndex(i);
                      const f = findings[i];
                      if (f?.surface) {
                        editorRef.current?.editor?.commands?.setSearchTerm(f.surface);
                      }
                    }}
                    onReplace={(i) => {
                      const f = findings[i];
                      if (f?.replacement && editorRef.current?.editor) {
                        editorRef.current.editor.commands.setSearchTerm(f.surface ?? "");
                        editorRef.current.editor.commands.replaceCurrent(f.replacement);
                      }
                    }}
                    onReplaceAll={(i) => {
                      const f = findings[i];
                      if (f?.replacement && editorRef.current?.editor) {
                        editorRef.current.editor.commands.setSearchTerm(f.surface ?? "");
                        editorRef.current.editor.commands.replaceAll(f.replacement);
                      }
                    }}
                  />
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <StylesPanel styles={allStyles} editorRef={editorRef} onAddStyle={handleAddStyle} />
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

        {/* â”€â”€ TAB 3: COLLABORA EDITOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {activeTab === "collabora" && collabora_url && (
          <div className="flex-1 flex flex-col min-h-0 page-enter">
            {/* Collabora Toolbar */}
            <div className="bg-white border-b border-border px-4 py-3 flex items-center gap-4 shadow-sm">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-medium text-emerald-700">Auto-saving via WOPI</span>
              </div>
              <span className="text-xs text-muted">Editing: {review.file.filename}</span>
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

// ── Stylesheet Occurrences Panel ───────────────────────────────────────────────

interface StylesheetOccurrencesPanelProps {
  activeStylesheet: StylesheetSummary | null | undefined;
  projectStylesheets: StylesheetSummary[];
  onActivateStylesheet: (id: number) => void;
  isActivating: boolean;
  findings: any[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  onReplace: (i: number) => void;
  onReplaceAll: (i: number) => void;
}

function StylesheetOccurrencesPanel({
  activeStylesheet,
  projectStylesheets,
  onActivateStylesheet,
  isActivating,
  findings,
  selectedIndex,
  onSelect,
  onReplace,
  onReplaceAll,
}: StylesheetOccurrencesPanelProps) {
  if (!activeStylesheet && projectStylesheets.length === 0) {
    return (
      <div className="px-3 py-4 text-center">
        <BookMarked className="w-5 h-5 text-muted mx-auto mb-1.5 opacity-40" />
        <p className="text-xs text-muted">No active stylesheet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col max-h-64 min-h-0">
      {/* Header */}
      <div className="px-3 py-2 bg-gold-50 border-b border-gold-200 flex flex-col gap-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <BookMarked className="w-3.5 h-3.5 text-gold-700 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <select
              className="text-xs font-semibold text-gold-800 bg-transparent border-b border-gold-300 focus:outline-none focus:border-gold-600 w-full truncate"
              value={activeStylesheet?.id?.toString() || ""}
              onChange={(e) => {
                if (e.target.value) {
                  onActivateStylesheet(Number(e.target.value));
                }
              }}
              disabled={isActivating}
            >
              <option value="" disabled>Select a Stylesheet...</option>
              {projectStylesheets.map((s) => (
                <option key={s.id} value={s.id.toString()}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
        {activeStylesheet && (
          <p className="text-[10px] text-gold-600 pl-5">
            {findings.length === 0 ? "No occurrences" : `${findings.length} occurrence${findings.length !== 1 ? "s" : ""}`}
          </p>
        )}
      </div>

      {findings.length === 0 ? (
        <div className="px-3 py-3 text-center">
          <p className="text-xs text-muted">All clear — no matches found</p>
        </div>
      ) : (
        <div className="overflow-y-auto flex-1">
          {findings.map((finding, i) => {
            const isSelected = selectedIndex === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSelect(i)}
                className={`w-full text-left px-3 py-2 transition-colors border-l-2 ${
                  isSelected
                    ? "bg-gold-50 border-l-gold-500"
                    : "border-l-transparent hover:bg-surface"
                }`}
              >
                <p className="text-xs font-mono text-text truncate">{finding.surface}</p>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[10px] text-muted truncate max-w-[60%]">{finding.rule_id}</span>
                  {finding.count > 0 && (
                    <span className="text-[10px] bg-gold-100 text-gold-700 px-1.5 py-0.5 rounded font-semibold">
                      ×{finding.count}
                    </span>
                  )}
                </div>
                {finding.replacement && (
                  <div className="flex items-center gap-1 mt-1">
                    <ArrowRight className="w-3 h-3 text-emerald-600 flex-shrink-0" />
                    <span className="text-[10px] font-mono text-emerald-700 truncate flex-1">{finding.replacement}</span>
                    {isSelected && (
                      <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => onReplace(i)}
                          className="text-[10px] px-1.5 py-0.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => onReplaceAll(i)}
                          className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200 transition-colors"
                        >
                          All
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
