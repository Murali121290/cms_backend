import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BookOpen, Edit2, Trash2, Check, ChevronDown, ChevronRight, Loader } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonCard } from "@/components/ui/SkeletonLoader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";
import { useStylesheetsQuery, useIATemplateQuery, useStylesheetMutations, useAnalyzeFilesMutation } from "@/features/stylesheets/useStylesheetsQuery";
import { useProjectChaptersQuery } from "@/features/projects/useProjectChaptersQuery";
import { useChapterFilesQuery } from "@/features/projects/useChapterFilesQuery";
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

  // Workflow state
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>("select-files");
  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());
  const [analyzeResult, setAnalyzeResult] = useState<{ triggered_rules: TriggeredIARule[]; analyzed_files: any[]; total_findings: number } | null>(null);
  const [selectedRuleKeys, setSelectedRuleKeys] = useState<Set<string>>(new Set());
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");

  const stylesheetsQuery = useStylesheetsQuery(normalizedProjectId);
  const chaptersQuery = useProjectChaptersQuery(normalizedProjectId);
  const iaTemplateQuery = useIATemplateQuery();
  const mutations = useStylesheetMutations(normalizedProjectId || 0);
  const analyzeFilesMutation = useAnalyzeFilesMutation(normalizedProjectId || 0);

  useDocumentTitle("Stylesheets — S4 Carlisle CMS");

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

  const toggleChapter = (chapterId: number) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const toggleFileSelection = (fileId: number) => {
    setSelectedFileIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const handleAnalyzeFiles = () => {
    if (selectedFileIds.size === 0) return;
    setWorkflowStep("analyzing");
    analyzeFilesMutation.mutate(Array.from(selectedFileIds), {
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
      },
      {
        onSuccess: () => {
          // Reset workflow
          setWorkflowStep("select-files");
          setSelectedFileIds(new Set());
          setAnalyzeResult(null);
          setSelectedRuleKeys(new Set());
          setWorkflowName("");
          setWorkflowDescription("");
          setActiveTab("manage");
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
              className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-gold-600 text-white hover:bg-gold-700 border border-gold-600 shadow-subtle transition-all duration-150"
            >
              <BookOpen className="w-4 h-4" />
              New Stylesheet
            </button>
          </div>

          {stylesheets.length === 0 ? (
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
                  className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-gold-600 text-white hover:bg-gold-700 border border-gold-600 shadow-subtle transition-all duration-150"
                >
                  Create first stylesheet
                </button>
              }
            />
          ) : (
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
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Tab */}
      {activeTab === "create" && (
        <div>
          {workflowStep === "select-files" && (
            <SelectFilesStep
              chapters={chapters}
              expandedChapters={expandedChapters}
              selectedFileIds={selectedFileIds}
              onToggleChapter={toggleChapter}
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
}

function StylesheetCard({
  stylesheet,
  onEdit,
  onDelete,
  onActivate,
  isActivating,
  isDeleting,
}: StylesheetCardProps) {
  const isActive = stylesheet.is_active;

  return (
    <div
      className={`bg-white rounded-lg shadow-card border-l-4 p-4 transition-all ${
        isActive ? "border-gold-500" : "border-navy-100"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-navy-900">{stylesheet.name}</h3>
            {isActive && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold-50 text-gold-700 text-xs font-medium">
                <Check className="w-3 h-3" />
                Active
              </span>
            )}
          </div>
          {stylesheet.description && (
            <p className="text-xs text-navy-500 mb-3">{stylesheet.description}</p>
          )}
          {stylesheet.selected_ia_rows.length > 0 && (
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
                  {stylesheet.selected_ia_rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-b border-navy-50">
                      <td className="py-1.5 px-2 font-medium text-navy-800">{row.element}</td>
                      <td className="py-1.5 px-2 text-navy-600">{row.subtype}</td>
                      <td className="py-1.5 px-2 font-mono text-navy-600 truncate">{row.pattern}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stylesheet.selected_ia_rows.length > 5 && (
                <p className="text-xs text-navy-400 mt-1">
                  +{stylesheet.selected_ia_rows.length - 5} more rules
                </p>
              )}
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
              title="Make active"
            >
              <Check className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="p-2 text-navy-600 hover:bg-navy-50 rounded-md transition-colors"
            title="Edit"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface SelectFilesStepProps {
  chapters: any[];
  expandedChapters: Set<number>;
  selectedFileIds: Set<number>;
  onToggleChapter: (chapterId: number) => void;
  onToggleFile: (fileId: number) => void;
  onAnalyze: () => void;
  isLoading: boolean;
}

function SelectFilesStep({
  chapters,
  expandedChapters,
  selectedFileIds,
  onToggleChapter,
  onToggleFile,
  onAnalyze,
  isLoading,
}: SelectFilesStepProps) {
  return (
    <div className="bg-white rounded-lg shadow-card p-6">
      <h3 className="text-sm font-semibold text-navy-900 mb-4">Select Files to Analyze</h3>
      <div className="space-y-2 mb-6 max-h-96 overflow-y-auto">
        {chapters.length === 0 ? (
          <p className="text-sm text-navy-500">No chapters found in this project</p>
        ) : (
          chapters.map((chapter) => (
            <ChapterAccordion
              key={chapter.id}
              chapter={chapter}
              isExpanded={expandedChapters.has(chapter.id)}
              onToggle={() => onToggleChapter(chapter.id)}
              selectedFileIds={selectedFileIds}
              onToggleFile={onToggleFile}
            />
          ))
        )}
      </div>
      <div className="flex items-center justify-between pt-4 border-t border-navy-100">
        <span className="text-sm text-navy-600">{selectedFileIds.size} files selected</span>
        <button
          onClick={onAnalyze}
          disabled={selectedFileIds.size === 0 || isLoading}
          className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-gold-600 text-white hover:bg-gold-700 border border-gold-600 shadow-subtle transition-all duration-150 disabled:opacity-50"
        >
          Analyze Selected Files
        </button>
      </div>
    </div>
  );
}

interface ChapterAccordionProps {
  chapter: any;
  isExpanded: boolean;
  onToggle: () => void;
  selectedFileIds: Set<number>;
  onToggleFile: (fileId: number) => void;
}

function ChapterAccordion({
  chapter,
  isExpanded,
  onToggle,
  selectedFileIds,
  onToggleFile,
}: ChapterAccordionProps) {
  const { data: filesData } = useChapterFilesQuery(chapter.project_id, chapter.id);
  const files = filesData?.files || [];
  const manuscriptFiles = files.filter(f => f.category === "Manuscript");

  return (
    <div className="border border-navy-100 rounded-md">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-navy-50 transition-colors"
      >
        <span className="text-sm font-medium text-navy-700">
          Chapter {chapter.number}: {chapter.title}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-navy-400">{manuscriptFiles.length} files</span>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-navy-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-navy-400" />
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="border-t border-navy-100 bg-navy-50 p-3 space-y-2">
          {manuscriptFiles.length === 0 ? (
            <p className="text-xs text-navy-500">No manuscript files in this chapter</p>
          ) : (
            manuscriptFiles.map((file) => (
              <label
                key={file.id}
                className="flex items-center gap-2 text-xs cursor-pointer hover:bg-white p-1 rounded"
              >
                <input
                  type="checkbox"
                  checked={selectedFileIds.has(file.id)}
                  onChange={() => onToggleFile(file.id)}
                  className="rounded border-navy-300"
                />
                <span className="text-navy-700">{file.filename}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface ReviewRulesStepProps {
  analyzeResult: any;
  selectedRuleKeys: Set<string>;
  onToggleRule: (key: string) => void;
  onNext: () => void;
}

function ReviewRulesStep({
  analyzeResult,
  selectedRuleKeys,
  onToggleRule,
  onNext,
}: ReviewRulesStepProps) {
  return (
    <div className="bg-white rounded-lg shadow-card p-6">
      <h3 className="text-sm font-semibold text-navy-900 mb-2">Review Results</h3>
      <p className="text-xs text-navy-500 mb-4">
        Analyzed {analyzeResult.analyzed_files.length} files · {analyzeResult.total_findings} findings · {analyzeResult.triggered_rules.length} unique rules triggered
      </p>

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
        className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-gold-600 text-white hover:bg-gold-700 border border-gold-600 shadow-subtle transition-all duration-150 disabled:opacity-50"
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
          className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-gold-600 text-white hover:bg-gold-700 border border-gold-600 shadow-subtle transition-all duration-150 disabled:opacity-50"
        >
          {isLoading ? "Saving..." : "Save Stylesheet"}
        </button>
      </div>
    </div>
  );
}
