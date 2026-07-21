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
  Hash,
  Lock,
  Unlock,
  Save,
  Sparkles,
  RefreshCw,
  Download,
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

  // Map technical-review findings to Occurrence objects for editor highlighting.
  // Must run before any conditional return to keep hook order stable (React #310).
  const reviewFindings = reviewQuery.data?.findings;
  const occurrences: Occurrence[] = useMemo(() =>
    (reviewFindings || []).map((f: any) => ({
      para_index: f.para_index ?? 0,
      match_start: f.match_start ?? 0,
      match_end: f.match_end ?? (f.surface?.length ?? 0),
      surface: f.surface ?? "",
      category: "stylesheet",
      in_stylesheet: true,
    })),
    [reviewFindings]
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

  const findings: any[] = review.findings || [];

  const handleAddStyle = (style: string) => {
    if (!customStyles.includes(style)) {
      setCustomStyles((prev) => [...prev, style].sort());
    }
  };

  const tabs: { key: "overview" | "editor" | "collabora"; label: string; icon: React.ReactNode; show: boolean }[] = [
    { key: "overview", label: "Document Overview", icon: <LayoutDashboard className="w-4 h-4" />, show: true },
    { key: "editor", label: "WYSIWYG Editor", icon: <FileText className="w-4 h-4" />, show: true },
    { key: "collabora", label: "Collabora Office Editor", icon: <BookOpen className="w-4 h-4" />, show: hasCollabora },
  ];

  return (
    <main className="flex flex-col h-screen bg-background">
      {/* Page Header */}
      {!isFullscreen && (
        <div className="flex-shrink-0 bg-white border-b border-border">
          <div className="px-6 pt-5 pb-4">
            <PageHeader
              title="Technical Editor"
              subtitle="Review, edit, and finalize the manuscript for publication."
              badge={
                <div className="flex items-center gap-1.5">
                  <Badge variant="default" size="sm">
                    <span className="inline-flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {review.file.filename}
                    </span>
                  </Badge>
                  <Badge variant="default" size="sm">
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Hash className="w-3 h-3" />v{review.file.version}
                    </span>
                  </Badge>
                  <Badge variant={review.file.lock.is_checked_out ? "warning" : "success"} size="sm">
                    <span className="inline-flex items-center gap-1">
                      {review.file.lock.is_checked_out ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      {review.file.lock.is_checked_out
                        ? `Locked · ${review.file.lock.checked_out_by_username ?? "user"}`
                        : "Available"}
                    </span>
                  </Badge>
                </div>
              }
              secondaryActions={[
                <Button
                  key="fullscreen"
                  variant="secondary"
                  size="sm"
                  leftIcon={<Maximize2 />}
                  onClick={() => setIsFullscreen(true)}
                >
                  Fullscreen
                </Button>,
                <Button
                  key="back"
                  variant="ghost"
                  size="sm"
                  leftIcon={<ArrowLeft />}
                  onClick={() => navigate(-1)}
                >
                  Back
                </Button>,
              ]}
            />
          </div>

          {/* Tab Controls */}
          <div role="tablist" aria-label="Technical editor views" className="flex items-center gap-1 px-4 -mb-px">
            {tabs.filter((t) => t.show).map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.key)}
                  className={[
                    "relative inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-md",
                    "transition-colors duration-150",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    isActive
                      ? "text-primary bg-surface-50"
                      : "text-muted hover:text-text hover:bg-surface-50/60",
                  ].join(" ")}
                >
                  <span className={isActive ? "text-primary" : "text-muted"}>{tab.icon}</span>
                  {tab.label}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-2 -bottom-px h-0.5 bg-primary rounded-full"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto bg-background">
        {/* â”€â”€ TAB 1: OVERVIEW â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {(activeTab === "overview" || isFullscreen) && !isFullscreen && (
          <div className="page-enter px-6 py-8 max-w-6xl mx-auto space-y-6">
            {/* â”€â”€ Hero: Document summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <section className="bg-white rounded-xl shadow-card border border-border overflow-hidden">
              <div className="p-6 flex items-start gap-5">
                <div className="shrink-0 w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <FileText className="w-7 h-7 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase font-semibold tracking-wider text-muted">Manuscript</p>
                  <h2 className="mt-0.5 text-lg font-semibold text-text truncate" title={review.file.filename}>
                    {review.file.filename}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    File #{review.file.id ?? normalizedFileId} · Version <span className="font-mono">v{review.file.version}</span>
                  </p>
                </div>
                <div className="hidden sm:flex flex-col items-end gap-2 shrink-0">
                  <Badge variant={review.file.lock.is_checked_out ? "warning" : "success"} size="sm">
                    <span className="inline-flex items-center gap-1">
                      {review.file.lock.is_checked_out ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      {review.file.lock.is_checked_out
                        ? `Locked · ${review.file.lock.checked_out_by_username ?? "user"}`
                        : "Available"}
                    </span>
                  </Badge>
                  <Badge variant={hasCollabora ? "success" : "default"} size="sm">
                    <span className="inline-flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      Collabora {hasCollabora ? "ready" : "unavailable"}
                    </span>
                  </Badge>
                </div>
              </div>

              {/* Metadata strip */}
              <dl className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border border-t border-border bg-surface-50/60">
                <div className="px-5 py-3">
                  <dt className="text-[10px] uppercase font-semibold tracking-wider text-muted">Version</dt>
                  <dd className="mt-1 text-sm font-mono font-semibold text-text">v{review.file.version}</dd>
                </div>
                <div className="px-5 py-3">
                  <dt className="text-[10px] uppercase font-semibold tracking-wider text-muted">Findings</dt>
                  <dd className="mt-1 text-sm font-semibold text-text">
                    {findings.length}
                    <span className="text-xs font-normal text-muted ml-1">
                      {findings.length === 1 ? "occurrence" : "occurrences"}
                    </span>
                  </dd>
                </div>
                <div className="px-5 py-3">
                  <dt className="text-[10px] uppercase font-semibold tracking-wider text-muted">Stylesheet</dt>
                  <dd className="mt-1 text-sm font-semibold text-text truncate" title={activeStylesheet?.name || "None"}>
                    {activeStylesheet?.name || <span className="text-muted font-normal">Not selected</span>}
                  </dd>
                </div>
                <div className="px-5 py-3">
                  <dt className="text-[10px] uppercase font-semibold tracking-wider text-muted">Editors</dt>
                  <dd className="mt-1 text-sm font-semibold text-text">
                    {hasCollabora ? "WYSIWYG + Collabora" : "WYSIWYG"}
                  </dd>
                </div>
              </dl>
            </section>

            {/* â”€â”€ Two-column: Stylesheet + Quick Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Stylesheet Selection card */}
              <section className="lg:col-span-3 bg-white rounded-xl shadow-card border border-border p-6">
                <header className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <BookMarked className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-text">Editorial Stylesheet</h3>
                    <p className="text-xs text-muted">Rules used to analyze this manuscript</p>
                  </div>
                </header>
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
                {activeStylesheet ? (
                  <div className="mt-3 flex items-start gap-2 rounded-md bg-success-50 border border-success-200 px-3 py-2">
                    <CheckCircle2 className="w-4 h-4 text-success-700 shrink-0 mt-0.5" />
                    <p className="text-xs text-success-900 leading-snug">
                      <span className="font-semibold">{activeStylesheet.name}</span> is active. Formatting rules and
                      occurrences will be applied while editing.
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 flex items-start gap-2 rounded-md bg-warning-50 border border-warning-200 px-3 py-2">
                    <AlertTriangle className="w-4 h-4 text-warning-700 shrink-0 mt-0.5" />
                    <p className="text-xs text-warning-900 leading-snug">
                      No stylesheet is active. Select one above to enable rule-based analysis.
                    </p>
                  </div>
                )}
              </section>

              {/* Quick Actions card */}
              <section className="lg:col-span-2 bg-white rounded-xl shadow-card border border-border p-6">
                <header className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-text">Quick Actions</h3>
                    <p className="text-xs text-muted">Jump into editing</p>
                  </div>
                </header>
                <div className="space-y-2">
                  <QuickActionButton
                    icon={<FileText className="w-4 h-4" />}
                    title="Open WYSIWYG Editor"
                    description="Review, edit, and save as DOCX"
                    onClick={() => setActiveTab("editor")}
                  />
                  {hasCollabora && (
                    <QuickActionButton
                      icon={<BookOpen className="w-4 h-4" />}
                      title="Open Collabora Editor"
                      description="Auto-save via WOPI"
                      onClick={() => setActiveTab("collabora")}
                    />
                  )}
                </div>
              </section>
            </div>

            {/* â”€â”€ Info tip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div className="flex items-start gap-3 rounded-xl border border-border bg-white px-5 py-4">
              <Info className="w-4 h-4 text-muted shrink-0 mt-0.5" />
              <p className="text-xs text-muted leading-relaxed">
                Changes made in the WYSIWYG editor are converted back to DOCX on save. Collabora edits are auto-saved
                via WOPI. Use <span className="font-medium text-text">Fullscreen</span> for a distraction-free view.
              </p>
            </div>
          </div>
        )}

        {/* â”€â”€ TAB 2: WYSIWYG EDITOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {(activeTab === "editor" || isFullscreen) && activeTab !== "collabora" && (
          <div className="flex-1 flex flex-col min-h-0 page-enter bg-white">
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
                <div className="flex flex-col h-full min-h-0 bg-surface-50/40">
                  {/* Panel header */}
                  <div className="px-4 py-2.5 bg-white border-b border-border flex items-center gap-2 shrink-0">
                    <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center">
                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase font-semibold tracking-wider text-muted leading-none">
                        Editor Toolkit
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-text truncate">
                        {activeStylesheet?.name || "No stylesheet"}
                      </p>
                    </div>
                    {findings.length > 0 && (
                      <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning-100 text-warning-800 text-[10px] font-semibold">
                        <AlertTriangle className="w-3 h-3" />
                        {findings.length}
                      </span>
                    )}
                  </div>

                  {/* Section: Stylesheet occurrences */}
                  <SectionHeader
                    icon={<BookMarked className="w-3 h-3" />}
                    label="Stylesheet Occurrences"
                  />
                  <div className="bg-white border-b border-border">
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
                  </div>

                  {/* Section: Paragraph styles */}
                  <SectionHeader
                    icon={<FileText className="w-3 h-3" />}
                    label="Paragraph Styles"
                    trailing={
                      <span className="text-[10px] text-muted tabular-nums">
                        {allStyles.length}
                      </span>
                    }
                  />
                  <div className="flex-1 min-h-0 overflow-hidden bg-white border-b border-border">
                    <StylesPanel styles={allStyles} editorRef={editorRef} onAddStyle={handleAddStyle} />
                  </div>

                  {/* Section: Version history */}
                  <div className="flex-shrink-0 p-2 bg-surface-50/60">
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
          <div className="flex-1 flex flex-col min-h-0 page-enter bg-white">
            {/* Collabora Toolbar */}
            <div className="bg-white border-b border-border px-5 py-2.5 flex items-center justify-between gap-4 shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <BookOpen className="w-4.5 h-4.5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase font-semibold tracking-wider text-muted leading-none">
                    Collabora Office · WOPI
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-text truncate" title={review.file.filename}>
                    {review.file.filename}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success-50 border border-success-200">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-500 opacity-60"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success-600"></span>
                  </span>
                  <Save className="w-3 h-3 text-success-700" />
                  <span className="text-[11px] font-medium text-success-800">Auto-saving</span>
                </span>
                <Badge variant="default" size="sm">
                  <span className="inline-flex items-center gap-1 font-mono">
                    <Hash className="w-3 h-3" />v{review.file.version}
                  </span>
                </Badge>
                <div className="h-6 w-px bg-border" aria-hidden="true" />
                <a
                  href={`/api/v2/files/${normalizedFileId}/download`}
                  download
                  title="Download current file"
                  className={[
                    "inline-flex items-center justify-center w-8 h-8 rounded-md",
                    "text-muted hover:text-primary hover:bg-primary/5",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    "transition-colors",
                  ].join(" ")}
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => {
                    if (collaboraIframeRef.current) {
                      const src = collaboraIframeRef.current.src;
                      collaboraIframeRef.current.src = src;
                    }
                  }}
                  title="Reload editor"
                  className={[
                    "inline-flex items-center justify-center w-8 h-8 rounded-md",
                    "text-muted hover:text-primary hover:bg-primary/5",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    "transition-colors",
                  ].join(" ")}
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsFullscreen(true)}
                  title="Fullscreen"
                  className={[
                    "inline-flex items-center justify-center w-8 h-8 rounded-md",
                    "text-muted hover:text-primary hover:bg-primary/5",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    "transition-colors",
                  ].join(" ")}
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Split pane: tabbed sidebar + Collabora Editor */}
            <div className="flex-1 flex min-h-0 gap-0 border-t border-border/60">
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
                className="flex-1 w-full border-0 overflow-hidden bg-surface-50"
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
        <div className="fixed top-4 right-4 z-50">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Minimize2 />}
            onClick={() => setIsFullscreen(false)}
            className="shadow-hover backdrop-blur bg-white/95"
          >
            Exit Fullscreen
          </Button>
        </div>
      )}
    </main>
  );
}

// ── Section header used in Tab 2 side panel ────────────────────────────────────
interface SectionHeaderProps {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
}
function SectionHeader({ icon, label, trailing }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-100/70 border-b border-border/70">
      <span className="text-muted">{icon}</span>
      <span className="flex-1 text-[10px] uppercase font-semibold tracking-wider text-muted">
        {label}
      </span>
      {trailing}
    </div>
  );
}

// ── Quick-action tile used in Overview ──────────────────────────────────────────
interface QuickActionButtonProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}
function QuickActionButton({ icon, title, description, onClick }: QuickActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg",
        "border border-border bg-white hover:bg-surface-50 hover:border-primary/40",
        "transition-all duration-150",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
      ].join(" ")}
    >
      <span className="w-8 h-8 shrink-0 rounded-md bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
        {icon}
      </span>
      <span className="flex-1 min-w-0 text-left">
        <span className="block text-sm font-semibold text-text truncate">{title}</span>
        <span className="block text-xs text-muted truncate">{description}</span>
      </span>
      <ChevronRight className="w-4 h-4 text-muted group-hover:text-primary transition-colors shrink-0" />
    </button>
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
      <div className="px-4 py-6 text-center bg-surface-50/50">
        <div className="w-10 h-10 rounded-full bg-white border border-border mx-auto flex items-center justify-center mb-2">
          <BookMarked className="w-5 h-5 text-muted opacity-60" />
        </div>
        <p className="text-xs font-medium text-text">No active stylesheet</p>
        <p className="text-[11px] text-muted mt-0.5">Create one from the Stylesheets page.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col max-h-64 min-h-0">
      {/* Header */}
      <div className="px-3 py-2.5 bg-primary/5 border-b border-primary/15 flex flex-col gap-1.5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <BookMarked className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <span className="text-[10px] uppercase tracking-wider font-semibold text-primary">
            Active Stylesheet
          </span>
        </div>
        <select
          className={[
            "w-full text-xs font-semibold text-text bg-white border border-border rounded-md",
            "px-2 py-1.5 truncate",
            "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40",
            "disabled:opacity-60 disabled:cursor-not-allowed transition-colors",
          ].join(" ")}
          value={activeStylesheet?.id?.toString() || ""}
          onChange={(e) => {
            if (e.target.value) {
              onActivateStylesheet(Number(e.target.value));
            }
          }}
          disabled={isActivating}
        >
          <option value="" disabled>Select a stylesheet…</option>
          {projectStylesheets.map((s) => (
            <option key={s.id} value={s.id.toString()}>{s.name}</option>
          ))}
        </select>
        {activeStylesheet && (
          <div className="flex items-center justify-between text-[10px] text-muted">
            <span>
              {findings.length === 0
                ? "No occurrences"
                : `${findings.length} occurrence${findings.length !== 1 ? "s" : ""}`}
            </span>
            {findings.length > 0 && (
              <span className="inline-flex items-center gap-0.5 font-medium text-primary/80">
                <AlertTriangle className="w-3 h-3" />
                Review
              </span>
            )}
          </div>
        )}
      </div>

      {findings.length === 0 ? (
        <div className="px-3 py-4 text-center">
          <CheckCircle2 className="w-5 h-5 text-success-600 mx-auto mb-1" />
          <p className="text-xs font-medium text-text">All clear</p>
          <p className="text-[11px] text-muted">No stylesheet matches found.</p>
        </div>
      ) : (
        <div className="overflow-y-auto flex-1 divide-y divide-border/60">
          {findings.map((finding, i) => {
            const isSelected = selectedIndex === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSelect(i)}
                aria-pressed={isSelected}
                className={[
                  "group w-full text-left px-3 py-2 border-l-2",
                  "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                  isSelected
                    ? "bg-primary/5 border-l-primary"
                    : "border-l-transparent hover:bg-surface-50 hover:border-l-primary/30",
                ].join(" ")}
              >
                <p className="text-xs font-mono text-text truncate">{finding.surface}</p>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <span className="text-[10px] text-muted truncate">{finding.rule_id}</span>
                  {finding.count > 0 && (
                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                      ×{finding.count}
                    </span>
                  )}
                </div>
                {finding.replacement && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <ArrowRight className="w-3 h-3 text-success-600 flex-shrink-0" />
                    <span className="text-[10px] font-mono text-success-800 truncate flex-1">{finding.replacement}</span>
                    {isSelected && (
                      <div
                        className="flex gap-1 flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => onReplace(i)}
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-success-600 text-white hover:bg-success-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-success-500/40 transition-colors"
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => onReplaceAll(i)}
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-success-100 text-success-800 hover:bg-success-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-success-500/40 transition-colors"
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
