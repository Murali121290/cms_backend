import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { BookOpen, Edit2, Trash2, Check, ChevronDown, ChevronUp, GripVertical, Loader, FileSpreadsheet, Table2, Globe, Download } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonCard } from "@/components/ui/SkeletonLoader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/useToast";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";
import { useStylesheetsQuery, useIATemplateQuery, useStylesheetMutations, useAnalyzeFilesMutation } from "@/features/stylesheets/useStylesheetsQuery";
import { useProjectChaptersQuery } from "@/features/projects/useProjectChaptersQuery";
import { getChapterFiles } from "@/api/projects";
import { StylesheetFormDrawer } from "@/features/stylesheets/StylesheetFormDrawer";
import type { StylesheetSummary, TriggeredIARule, FileRecord } from "@/types/api";

type ActiveTab = "manage" | "create";
type WorkflowStep = "select-files" | "analyzing" | "review-rules" | "saving";

export function StylesheetsPage() {
  const { projectId } = useParams();
  const parsedProjectId = Number.parseInt(projectId ?? "", 10);
  const isValidProjectId = Number.isInteger(parsedProjectId) && parsedProjectId > 0;
  const normalizedProjectId = isValidProjectId ? parsedProjectId : null;

  const [activeTab, setActiveTab] = useState<ActiveTab>("manage");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingStylesheet, setEditingStylesheet] = useState<StylesheetSummary | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  // Id of the stylesheet the user just created — StylesheetCard uses it to
  // scroll into view and paint a temporary highlight. Cleared after ~3s.
  const [justCreatedId, setJustCreatedId] = useState<number | null>(null);

  // Workflow state
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>("select-files");
  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(new Set());
  const [analyzeResult, setAnalyzeResult] = useState<{ triggered_rules: TriggeredIARule[]; analyzed_files: any[]; total_findings: number } | null>(null);
  const [selectedRuleKeys, setSelectedRuleKeys] = useState<Set<string>>(new Set());
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");

  const stylesheetsQuery = useStylesheetsQuery(normalizedProjectId);
  const chaptersQuery = useProjectChaptersQuery(normalizedProjectId);
  const iaTemplateQuery = useIATemplateQuery();
  const mutations = useStylesheetMutations(normalizedProjectId || 0);
  const analyzeFilesMutation = useAnalyzeFilesMutation(normalizedProjectId || 0);
  const { addToast } = useToast();

  useDocumentTitle("Stylesheets — S4 Carlisle CMS");

  // Fade the "just created" highlight after a few seconds so the row settles
  // back into the rest of the list.
  useEffect(() => {
    if (justCreatedId == null) return;
    const t = setTimeout(() => setJustCreatedId(null), 3000);
    return () => clearTimeout(t);
  }, [justCreatedId]);

  if (normalizedProjectId === null) {
    return (
      <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-card p-8 text-center">
          <p className="text-sm text-navy-500 mb-4">The selected project identifier is not valid.</p>
          <Link className="text-sm text-gold-700 hover:text-gold-800 font-medium" to={uiPaths.projects}>
            Back to projects
          </Link>
        </div>
      </main>
    );
  }

  if (stylesheetsQuery.isPending || iaTemplateQuery.isPending) {
    return (
      <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <div className="skeleton-shimmer rounded h-8 w-64 mb-2" aria-hidden="true" />
          <div className="skeleton-shimmer rounded h-4 w-40" aria-hidden="true" />
        </div>
        <div className="grid gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </main>
    );
  }

  if (stylesheetsQuery.isError) {
    return (
      <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-card p-8 text-center">
          <p className="text-sm text-navy-500 mb-4">Stylesheets could not be loaded.</p>
          <Link className="text-sm text-gold-700 hover:text-gold-800 font-medium" to={uiPaths.projectDetail(normalizedProjectId)}>
            Back to project
          </Link>
        </div>
      </main>
    );
  }

  const stylesheets = stylesheetsQuery.data?.stylesheets || [];
  const chapters = chaptersQuery.data?.chapters || [];

  const handleEditStylesheet = (stylesheet: StylesheetSummary) => {
    setEditingStylesheet(stylesheet);
    setIsDrawerOpen(true);
  };

  const handleDeleteStylesheet = (stylesheetId: number) => {
    setDeleteConfirmId(stylesheetId);
  };

  const confirmDeleteStylesheet = () => {
    if (deleteConfirmId !== null) {
      mutations.remove.mutate(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  const handleActivateStylesheet = (stylesheetId: number) => {
    mutations.activate.mutate(stylesheetId);
  };

  const toggleFileSelection = (fileId: number) => {
    setSelectedFileIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const handleAnalyzeFiles = (orderedFileIds: number[]) => {
    const ids = orderedFileIds.filter(id => selectedFileIds.has(id));
    if (ids.length === 0) return;
    setWorkflowStep("analyzing");
    analyzeFilesMutation.mutate(ids, {
      onSuccess: (data) => {
        setAnalyzeResult(data);
        // Pre-check all rules
        const allRuleKeys = new Set(
          data.triggered_rules.map(r => `${r.element}|${r.subtype}|${r.pattern}`)
        );
        setSelectedRuleKeys(allRuleKeys);
        setWorkflowStep("review-rules");
      },
      onError: (error: any) => {
        const errorMessage = error?.response?.data?.message ||
                           error?.message ||
                           "Failed to analyze files";
        console.error("Analyze files error:", error);
        alert(`Failed to analyze files: ${errorMessage}`);
        setWorkflowStep("select-files");
      },
    });
  };

  const handleSaveStylesheet = () => {
    if (!workflowName.trim() || selectedRuleKeys.size === 0) {
      alert("Please enter a name and select at least one rule");
      return;
    }

    const selectedRuleList = analyzeResult!.triggered_rules.filter(
      r => selectedRuleKeys.has(`${r.element}|${r.subtype}|${r.pattern}`)
    );

    setWorkflowStep("saving");
    mutations.create.mutate(
      {
        name: workflowName.trim(),
        description: workflowDescription.trim() || null,
        selected_ia_rows: selectedRuleList.map(r => ({
          element: r.element,
          subtype: r.subtype,
          pattern: r.pattern,
        })),
        analyzed_file_ids: analyzeResult!.analyzed_files.map((f: any) => f.id),
      },
      {
        onSuccess: (res) => {
          // Reset workflow
          setWorkflowStep("select-files");
          setSelectedFileIds(new Set());
          setAnalyzeResult(null);
          setSelectedRuleKeys(new Set());
          setWorkflowName("");
          setWorkflowDescription("");
          setActiveTab("manage");
          setJustCreatedId(res.stylesheet.id);
          addToast({
            title: "Stylesheet created successfully.",
            variant: "success",
          });
        },
        onError: () => {
          alert("Failed to save stylesheet");
          setWorkflowStep("review-rules");
        },
      }
    );
  };

  return (
    <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
      <PageHeader
        breadcrumb={
          <span className="flex items-center gap-1.5">
            <Link to={uiPaths.projects} className="hover:text-navy-700 transition-colors">
              Projects
            </Link>
            <span aria-hidden="true">›</span>
            <Link
              to={uiPaths.projectDetail(normalizedProjectId)}
              className="hover:text-navy-700 transition-colors"
            >
              Project
            </Link>
            <span aria-hidden="true">›</span>
            <span className="text-navy-700">Stylesheets</span>
          </span>
        }
        title="Editorial Stylesheets"
        subtitle="Manage style rules for manuscript editing"
      />

      {/* Tab Controls */}
      <div className="flex border-b border-navy-200 mt-6 mb-6">
        <button
          onClick={() => setActiveTab("manage")}
          className={`py-3 px-4 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "manage"
              ? "border-gold-600 text-gold-700"
              : "border-transparent text-navy-500 hover:text-navy-700"
          }`}
        >
          <BookOpen className="w-4 h-4" />
          My Stylesheets
        </button>
        <button
          onClick={() => setActiveTab("create")}
          className={`py-3 px-4 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "create"
              ? "border-gold-600 text-gold-700"
              : "border-transparent text-navy-500 hover:text-navy-700"
          }`}
        >
          <BookOpen className="w-4 h-4" />
          Create from Analysis
        </button>
      </div>

      {/* Manage Tab */}
      {activeTab === "manage" && (
        <div>
          <div className="flex items-center justify-end gap-2 mb-6">
            <button
              type="button"
              onClick={() => {
                setEditingStylesheet(null);
                setIsDrawerOpen(true);
              }}
              className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-primary text-white hover:bg-[color:var(--color-primary-hover)] border border-primary shadow-subtle transition-all duration-150"
            >
              <BookOpen className="w-4 h-4" />
              New Stylesheet
            </button>
          </div>

          {stylesheets.length > 0 ? (
            <div className="grid gap-4">
              {stylesheets.map((stylesheet) => (
                <StylesheetCard
                  key={stylesheet.id}
                  stylesheet={stylesheet}
                  onEdit={() => handleEditStylesheet(stylesheet)}
                  onDelete={() => handleDeleteStylesheet(stylesheet.id)}
                  onActivate={() => handleActivateStylesheet(stylesheet.id)}
                  isActivating={mutations.activate.isPending}
                  isDeleting={mutations.remove.isPending}
                  isJustCreated={stylesheet.id === justCreatedId}
                />
              ))}
            </div>
          ) : stylesheetsQuery.isFetching ? (
            <div className="grid gap-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : (
            <EmptyState
              title="No stylesheets yet"
              description="Create your first stylesheet to define editorial style rules for this project."
              action={
                <button
                  type="button"
                  onClick={() => {
                    setEditingStylesheet(null);
                    setIsDrawerOpen(true);
                  }}
                  className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-primary text-white hover:bg-[color:var(--color-primary-hover)] border border-primary shadow-subtle transition-all duration-150"
                >
                  Create first stylesheet
                </button>
              }
            />
          )}
        </div>
      )}

      {/* Create Tab */}
      {activeTab === "create" && (
        <div>
          {workflowStep === "select-files" && (
            <SelectFilesStep
              projectId={normalizedProjectId}
              chapters={chapters}
              selectedFileIds={selectedFileIds}
              onToggleFile={toggleFileSelection}
              onAnalyze={handleAnalyzeFiles}
              isLoading={analyzeFilesMutation.isPending}
            />
          )}

          {workflowStep === "analyzing" && (
            <div className="bg-white rounded-lg shadow-card p-12 text-center">
              <Loader className="w-8 h-8 text-gold-600 mx-auto mb-4 animate-spin" />
              <p className="text-sm text-navy-600">Analyzing {selectedFileIds.size} files…</p>
            </div>
          )}

          {workflowStep === "review-rules" && analyzeResult && (
            <ReviewRulesStep
              analyzeResult={analyzeResult}
              selectedRuleKeys={selectedRuleKeys}
              onToggleRule={(key) => {
                setSelectedRuleKeys(prev => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });
              }}
              onNext={() => setWorkflowStep("saving")}
              projectId={normalizedProjectId}
            />
          )}

          {(workflowStep === "saving" || workflowStep === "review-rules") && (
            <SaveStylesheetStep
              name={workflowName}
              description={workflowDescription}
              onNameChange={setWorkflowName}
              onDescriptionChange={setWorkflowDescription}
              onSave={handleSaveStylesheet}
              isLoading={mutations.create.isPending}
              isVisible={workflowStep === "review-rules"}
            />
          )}
        </div>
      )}

      <StylesheetFormDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setEditingStylesheet(null);
        }}
        projectId={normalizedProjectId}
        editingStylesheet={editingStylesheet}
        mutations={mutations}
        iaTemplate={iaTemplateQuery.data?.rows || []}
      />

      <ConfirmDialog
        isOpen={deleteConfirmId !== null}
        title="Delete stylesheet?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={confirmDeleteStylesheet}
        onClose={() => setDeleteConfirmId(null)}
        isLoading={mutations.remove.isPending}
        variant="danger"
      />
    </main>
  );
}

interface StylesheetCardProps {
  stylesheet: StylesheetSummary;
  onEdit: () => void;
  onDelete: () => void;
  onActivate: () => void;
  isActivating: boolean;
  isDeleting: boolean;
  isJustCreated?: boolean;
}

function StylesheetCard({
  stylesheet,
  onEdit,
  onDelete,
  onActivate,
  isActivating,
  isDeleting,
  isJustCreated = false,
}: StylesheetCardProps) {
  const isActive = stylesheet.is_active;
  const [showAllRules, setShowAllRules] = useState(false);
  const ruleCount = stylesheet.selected_ia_rows.length;
  const previewLimit = 5;
  const visibleRules =
    showAllRules || ruleCount <= previewLimit
      ? stylesheet.selected_ia_rows
      : stylesheet.selected_ia_rows.slice(0, previewLimit);
  const sourceFiles = stylesheet.source_files ?? [];
  const sourceFileCount = sourceFiles.length || stylesheet.analyzed_file_ids?.length || 0;

  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isJustCreated && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isJustCreated]);

  return (
    <div
      ref={cardRef}
      className={`bg-white rounded-lg shadow-card border-l-4 p-5 transition-all ${
        isActive ? "border-gold-500" : "border-navy-100"
      } ${
        isJustCreated ? "ring-2 ring-gold-400 ring-offset-2 bg-gold-50/40" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <h3 className="text-lg font-bold text-navy-900 tracking-tight break-words">
              {stylesheet.name}
            </h3>
            {isActive && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold-50 text-gold-700 text-xs font-medium">
                <Check className="w-3 h-3" />
                Active
              </span>
            )}
          </div>
          {stylesheet.description && (
            <p className="text-sm text-navy-500 mb-3">{stylesheet.description}</p>
          )}

          {/* Metadata row */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mb-4 text-[11px]">
            <MetaField label="Created" value={formatDateTime(stylesheet.created_at)} />
            <MetaField
              label="Last Modified"
              value={formatDateTime(stylesheet.updated_at || stylesheet.created_at)}
            />
            <MetaField
              label="Total Rules"
              value={`${ruleCount} rule${ruleCount === 1 ? "" : "s"}`}
            />
            <MetaField
              label={`Source Document${sourceFileCount === 1 ? "" : "s"}`}
              value={
                sourceFiles.length > 0
                  ? sourceFiles.map((f) => f.filename).join(", ")
                  : sourceFileCount > 0
                  ? `${sourceFileCount} file${sourceFileCount === 1 ? "" : "s"}`
                  : "—"
              }
            />
          </dl>

          {ruleCount > 0 && (
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse w-full">
                <thead>
                  <tr className="border-b border-navy-100 text-navy-400 uppercase tracking-wide text-[10px]">
                    <th className="py-1.5 px-2 text-left">Element</th>
                    <th className="py-1.5 px-2 text-left">Subtype</th>
                    <th className="py-1.5 px-2 text-left">Pattern</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRules.map((row, i) => (
                    <tr key={i} className="border-b border-navy-50">
                      <td className="py-1.5 px-2 font-medium text-navy-800">{row.element}</td>
                      <td className="py-1.5 px-2 text-navy-600">{row.subtype}</td>
                      <td className="py-1.5 px-2 font-mono text-navy-600 truncate">{row.pattern}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ruleCount > previewLimit && (
                <button
                  type="button"
                  onClick={() => setShowAllRules((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 mt-2"
                >
                  {showAllRules ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      Show {ruleCount - previewLimit} more rule{ruleCount - previewLimit === 1 ? "" : "s"}
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Consolidated exports — only shown when the stylesheet has stored file IDs */}
          {stylesheet.analyzed_file_ids && stylesheet.analyzed_file_ids.length > 0 && (
            <div className="mt-3 pt-3 border-t border-navy-100">
              <p className="text-[10px] font-semibold text-navy-500 uppercase tracking-wider mb-2">
                Download Reports ({stylesheet.analyzed_file_ids.length} file{stylesheet.analyzed_file_ids.length !== 1 ? "s" : ""})
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/v2/projects/${stylesheet.project_id}/stylesheets/${stylesheet.id}/export?format=excel`}
                  className="no-underline"
                  download
                >
                  <button type="button" className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold rounded bg-white border border-navy-200 text-navy-700 hover:bg-navy-50 shadow-sm transition-all">
                    <FileSpreadsheet className="w-3 h-3 text-navy-500" /> Export Excel
                  </button>
                </a>
                <a
                  href={`/api/v2/projects/${stylesheet.project_id}/stylesheets/${stylesheet.id}/export?format=ia-excel`}
                  className="no-underline"
                  download
                >
                  <button type="button" className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold rounded bg-white border border-navy-200 text-navy-700 hover:bg-navy-50 shadow-sm transition-all">
                    <Table2 className="w-3 h-3 text-navy-500" /> Export IA
                  </button>
                </a>
                <a
                  href={`/api/v2/projects/${stylesheet.project_id}/stylesheets/${stylesheet.id}/export?format=html`}
                  className="no-underline"
                  download
                >
                  <button type="button" className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold rounded bg-white border border-navy-200 text-navy-700 hover:bg-navy-50 shadow-sm transition-all">
                    <Globe className="w-3 h-3 text-navy-500" /> Export HTML
                  </button>
                </a>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isActive && (
            <button
              type="button"
              onClick={onActivate}
              disabled={isActivating}
              className="p-2 text-navy-600 hover:bg-navy-50 rounded-md transition-colors disabled:opacity-50"
              title="Apply this stylesheet to the project"
              aria-label="Apply stylesheet"
            >
              <Check className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="p-2 text-navy-600 hover:bg-navy-50 rounded-md transition-colors"
            title="Edit stylesheet name, description, and rules"
            aria-label="Edit stylesheet"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
            title="Delete stylesheet"
            aria-label="Delete stylesheet"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <dt className="text-navy-400 uppercase tracking-wide text-[10px] shrink-0">{label}</dt>
      <dd className="text-navy-700 font-medium truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface SelectFilesStepProps {
  projectId: number;
  chapters: any[];
  selectedFileIds: Set<number>;
  onToggleFile: (fileId: number) => void;
  onAnalyze: (orderedFileIds: number[]) => void;
  isLoading: boolean;
}

interface FlatFile {
  file: FileRecord;
  chapterNumber: string;
  chapterTitle: string;
}

function SelectFilesStep({
  projectId,
  chapters,
  selectedFileIds,
  onToggleFile,
  onAnalyze,
  isLoading,
}: SelectFilesStepProps) {
  // Fetch files for every chapter in parallel. React Query caches each query
  // under the same key ["chapter-files", ...] so revisits are instant.
  const fileQueries = useQueries({
    queries: chapters.map((c: any) => ({
      queryKey: ["chapter-files", projectId, c.id] as const,
      queryFn: () => getChapterFiles(projectId, c.id),
      staleTime: 30_000,
    })),
  });

  const allLoaded = fileQueries.length === 0 || fileQueries.every(q => !q.isPending);
  const anyLoading = fileQueries.some(q => q.isPending);

  // Flatten all manuscript files across chapters into a single list. The
  // natural order (chapter order → filename order) seeds the initial ordering;
  // the user then reorders via drag-and-drop.
  const flatFiles: FlatFile[] = useMemo(() => {
    const out: FlatFile[] = [];
    chapters.forEach((c: any, idx: number) => {
      const files = fileQueries[idx]?.data?.files ?? [];
      files
        .filter(f => f.category === "Manuscript")
        .forEach(f => {
          out.push({
            file: f,
            chapterNumber: c.number,
            chapterTitle: c.title,
          });
        });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters, ...fileQueries.map(q => q.data)]);

  // User-visible ordering. Kept as a plain array of file IDs so drag-reorders
  // are cheap. Reconciled when the fetched flat list changes: existing IDs
  // keep their position, newly-arrived IDs append, missing IDs drop out.
  const [orderedIds, setOrderedIds] = useState<number[]>([]);
  useEffect(() => {
    setOrderedIds(prev => {
      const known = new Set(flatFiles.map(f => f.file.id));
      const preserved = prev.filter(id => known.has(id));
      const preservedSet = new Set(preserved);
      const appended = flatFiles.map(f => f.file.id).filter(id => !preservedSet.has(id));
      return [...preserved, ...appended];
    });
  }, [flatFiles]);

  const filesById = useMemo(() => {
    const m = new Map<number, FlatFile>();
    for (const f of flatFiles) m.set(f.file.id, f);
    return m;
  }, [flatFiles]);

  const orderedFiles: FlatFile[] = useMemo(
    () => orderedIds.map(id => filesById.get(id)).filter((x): x is FlatFile => !!x),
    [orderedIds, filesById],
  );

  // Drag state — matches the native-DnD pattern used elsewhere in the app
  // (see EditorStylesPanel). We track the dragged file ID and the row currently
  // under the cursor (with position: before / after).
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<{ id: number; pos: "before" | "after" } | null>(null);

  const reorder = (srcId: number, targetId: number, pos: "before" | "after") => {
    if (srcId === targetId) return;
    setOrderedIds(prev => {
      const next = prev.filter(id => id !== srcId);
      const targetIdx = next.indexOf(targetId);
      if (targetIdx === -1) return prev;
      const insertAt = pos === "before" ? targetIdx : targetIdx + 1;
      next.splice(insertAt, 0, srcId);
      return next;
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-card p-6">
      <h3 className="text-sm font-semibold text-navy-900 mb-1">Select Files to Analyze</h3>
      <p className="text-xs text-navy-500 mb-4">
        Drag rows to reorder. The order is preserved when the files are analyzed.
      </p>

      <div className="border border-navy-100 rounded-md mb-6 max-h-96 overflow-y-auto">
        {chapters.length === 0 ? (
          <p className="text-sm text-navy-500 p-4">No chapters found in this project</p>
        ) : anyLoading && flatFiles.length === 0 ? (
          <div className="p-4 flex items-center gap-2 text-sm text-navy-500">
            <Loader className="w-4 h-4 animate-spin" />
            Loading files…
          </div>
        ) : allLoaded && flatFiles.length === 0 ? (
          <p className="text-sm text-navy-500 p-4">No manuscript files available in this project.</p>
        ) : (
          <ul className="divide-y divide-navy-100">
            {orderedFiles.map(({ file, chapterNumber }) => {
              const isChecked = selectedFileIds.has(file.id);
              const isDragging = draggedId === file.id;
              const showTop = dragOver?.id === file.id && dragOver.pos === "before";
              const showBottom = dragOver?.id === file.id && dragOver.pos === "after";
              return (
                <li
                  key={file.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    try { e.dataTransfer.setData("text/plain", String(file.id)); } catch { /* ignore */ }
                    setDraggedId(file.id);
                  }}
                  onDragEnd={() => { setDraggedId(null); setDragOver(null); }}
                  onDragOver={(e) => {
                    if (draggedId == null || draggedId === file.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pos = (e.clientY - rect.top) < rect.height / 2 ? "before" : "after";
                    if (!dragOver || dragOver.id !== file.id || dragOver.pos !== pos) {
                      setDragOver({ id: file.id, pos });
                    }
                  }}
                  onDragLeave={(e) => {
                    const next = e.relatedTarget as Node | null;
                    if (!next || !e.currentTarget.contains(next)) {
                      if (dragOver?.id === file.id) setDragOver(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const src = draggedId;
                    const over = dragOver;
                    setDraggedId(null);
                    setDragOver(null);
                    if (src != null && over && over.id === file.id) {
                      reorder(src, file.id, over.pos);
                    }
                  }}
                  className={`relative flex items-center gap-2 px-3 py-2 text-sm select-none group hover:bg-navy-50 ${
                    isDragging ? "opacity-40" : ""
                  }`}
                >
                  {showTop && (
                    <div className="absolute left-0 right-0 -top-px h-0.5 bg-gold-500 rounded-full pointer-events-none" />
                  )}
                  {showBottom && (
                    <div className="absolute left-0 right-0 -bottom-px h-0.5 bg-gold-500 rounded-full pointer-events-none" />
                  )}
                  <GripVertical
                    className="w-4 h-4 text-navy-300 cursor-grab active:cursor-grabbing shrink-0"
                    aria-hidden
                  />
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onToggleFile(file.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-navy-300 shrink-0"
                  />
                  <span className="text-navy-700 truncate flex-1" title={file.filename}>
                    {file.filename}
                  </span>
                  <span className="text-[10px] font-mono text-navy-400 shrink-0">
                    Ch {chapterNumber}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-navy-100">
        <span className="text-sm text-navy-600">{selectedFileIds.size} files selected</span>
        <button
          onClick={() => onAnalyze(orderedIds)}
          disabled={selectedFileIds.size === 0 || isLoading}
          className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 border border-blue-600 shadow-subtle transition-all duration-150 disabled:opacity-50"
        >
          Analyze Selected Files
        </button>
      </div>
    </div>
  );
}

interface ReviewRulesStepProps {
  analyzeResult: any;
  selectedRuleKeys: Set<string>;
  onToggleRule: (key: string) => void;
  onNext: () => void;
  projectId: number;
}

function ReviewRulesStep({
  analyzeResult,
  selectedRuleKeys,
  onToggleRule,
  onNext,
  projectId,
}: ReviewRulesStepProps) {
  return (
    <div className="bg-white rounded-lg shadow-card p-6">
      <h3 className="text-sm font-semibold text-navy-900 mb-2">Review Results</h3>
      <p className="text-xs text-navy-500 mb-4">
        Analyzed {analyzeResult.analyzed_files.length} files · {analyzeResult.total_findings} findings · {analyzeResult.triggered_rules.length} unique rules triggered
      </p>

      {/* Consolidated export — all files merged into one download */}
      <div className="mb-4 p-4 bg-gold-50 rounded-lg border border-gold-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gold-900">Export All Files (Consolidated)</p>
          <p className="text-[10px] text-gold-700 mt-0.5">Merges all {analyzeResult.analyzed_files.length} files into a single report</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {analyzeResult.analyzed_files.length > 0 && (() => {
            const fileIdsCsv = analyzeResult.analyzed_files.map((f: any) => f.id).join(",");
            const base = `/api/v2/projects/${projectId}/technical-review/export?file_ids=${fileIdsCsv}`;
            return (
              <>
                <a href={`${base}&format=excel`} className="no-underline" download>
                  <button type="button" className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-all">
                    <Download className="w-3.5 h-3.5" /> Export Excel
                  </button>
                </a>
                <a href={`${base}&format=ia-excel`} className="no-underline" download>
                  <button type="button" className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded bg-white border border-navy-200 text-navy-700 hover:bg-navy-50 shadow-sm transition-all">
                    <Download className="w-3.5 h-3.5" /> Export IA
                  </button>
                </a>
                <a href={`${base}&format=html`} className="no-underline" download>
                  <button type="button" className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded bg-navy-700 text-white hover:bg-navy-800 shadow-sm transition-all">
                    <Download className="w-3.5 h-3.5" /> Export HTML
                  </button>
                </a>
              </>
            );
          })()}
        </div>
      </div>

      {/* Export Reports section — per-file */}
      <div className="mb-6 p-4 bg-navy-50 rounded-lg border border-navy-100">
        <h4 className="text-xs font-semibold text-navy-800 uppercase tracking-wider mb-3">
          Export Per-File Reports
        </h4>
        <div className="space-y-3">
          {analyzeResult.analyzed_files.map((file: any) => (
            <div key={file.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 bg-white rounded border border-navy-100">
              <span className="text-xs font-medium text-navy-700 truncate max-w-md" title={file.filename}>
                {file.filename}
              </span>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/v2/files/${file.id}/technical-review/export/excel`}
                  className="no-underline"
                  download
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded bg-white hover:bg-navy-50 border border-navy-200 text-navy-700 shadow-sm transition-all"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-navy-500" />
                    Export Excel
                  </button>
                </a>
                <a
                  href={`/api/v2/files/${file.id}/technical-review/export/ia-excel`}
                  className="no-underline"
                  download
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded bg-white hover:bg-navy-50 border border-navy-200 text-navy-700 shadow-sm transition-all"
                  >
                    <Table2 className="w-3.5 h-3.5 text-navy-500" />
                    Export IA
                  </button>
                </a>
                <a
                  href={`/api/v2/files/${file.id}/technical-review/export/html`}
                  className="no-underline"
                  download
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded bg-white hover:bg-navy-50 border border-navy-200 text-navy-700 shadow-sm transition-all"
                  >
                    <Globe className="w-3.5 h-3.5 text-navy-500" />
                    Export HTML
                  </button>
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-medium text-navy-700">Select Rules to Include</span>
        <div className="space-x-2">
          <button
            onClick={() => {
              const allKeys = new Set(
                analyzeResult.triggered_rules.map((r: TriggeredIARule) => `${r.element}|${r.subtype}|${r.pattern}`)
              );
              onToggleRule("__select_all__");
              // Toggle all
              if (selectedRuleKeys.size === analyzeResult.triggered_rules.length) {
                // Deselect all
                analyzeResult.triggered_rules.forEach((r: TriggeredIARule) => {
                  const key = `${r.element}|${r.subtype}|${r.pattern}`;
                  if (selectedRuleKeys.has(key)) {
                    onToggleRule(key);
                  }
                });
              } else {
                // Select all
                analyzeResult.triggered_rules.forEach((r: TriggeredIARule) => {
                  const key = `${r.element}|${r.subtype}|${r.pattern}`;
                  if (!selectedRuleKeys.has(key)) {
                    onToggleRule(key);
                  }
                });
              }
            }}
            className="text-xs text-gold-700 hover:text-gold-800 font-medium"
          >
            {selectedRuleKeys.size === analyzeResult.triggered_rules.length ? "Deselect All" : "Select All"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto mb-6">
        <table className="text-xs border-collapse w-full border border-navy-100">
          <thead>
            <tr className="bg-navy-50 border-b border-navy-100">
              <th className="py-2 px-3 text-left font-medium text-navy-700">
                <input
                  type="checkbox"
                  checked={selectedRuleKeys.size === analyzeResult.triggered_rules.length && analyzeResult.triggered_rules.length > 0}
                  onChange={() => {}}
                  className="rounded border-navy-300"
                />
              </th>
              <th className="py-2 px-3 text-left font-medium text-navy-700">Element</th>
              <th className="py-2 px-3 text-left font-medium text-navy-700">Subtype</th>
              <th className="py-2 px-3 text-left font-medium text-navy-700">Pattern</th>
              <th className="py-2 px-3 text-right font-medium text-navy-700">Count</th>
            </tr>
          </thead>
          <tbody>
            {analyzeResult.triggered_rules.map((rule: TriggeredIARule, i: number) => {
              const key = `${rule.element}|${rule.subtype}|${rule.pattern}`;
              return (
                <tr key={i} className="border-b border-navy-100 hover:bg-navy-50">
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      checked={selectedRuleKeys.has(key)}
                      onChange={() => onToggleRule(key)}
                      className="rounded border-navy-300"
                    />
                  </td>
                  <td className="py-2 px-3 font-medium text-navy-800">{rule.element}</td>
                  <td className="py-2 px-3 text-navy-600">{rule.subtype}</td>
                  <td className="py-2 px-3 font-mono text-navy-600">{rule.pattern}</td>
                  <td className="py-2 px-3 text-right">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gold-100 text-gold-700 text-xs font-semibold">
                      {rule.count}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        onClick={onNext}
        disabled={selectedRuleKeys.size === 0}
        className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-primary text-white hover:bg-[color:var(--color-primary-hover)] border border-primary shadow-subtle transition-all duration-150 disabled:opacity-50"
      >
        Next: Name & Save
      </button>
    </div>
  );
}

interface SaveStylesheetStepProps {
  name: string;
  description: string;
  onNameChange: (name: string) => void;
  onDescriptionChange: (desc: string) => void;
  onSave: () => void;
  isLoading: boolean;
  isVisible: boolean;
}

function SaveStylesheetStep({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onSave,
  isLoading,
  isVisible,
}: SaveStylesheetStepProps) {
  if (!isVisible) return null;

  return (
    <div className="bg-white rounded-lg shadow-card p-6 mt-6">
      <h3 className="text-sm font-semibold text-navy-900 mb-4">Name & Save Stylesheet</h3>
      <div className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-xs font-semibold text-navy-700 mb-1.5 uppercase tracking-wide">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g., American Standard Style"
            className="w-full px-3 py-2 rounded-md border border-navy-200 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-xs font-semibold text-navy-700 mb-1.5 uppercase tracking-wide">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Optional notes about this stylesheet"
            rows={2}
            className="w-full px-3 py-2 rounded-md border border-navy-200 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent resize-none"
          />
        </div>

        <button
          onClick={onSave}
          disabled={!name.trim() || isLoading}
          className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 border border-blue-600 shadow-subtle transition-all duration-150 disabled:opacity-50"
        >
          {isLoading ? "Saving..." : "Save Stylesheet"}
        </button>
      </div>
    </div>
  );
}
