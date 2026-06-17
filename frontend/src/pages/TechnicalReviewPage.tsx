import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle,
  Info,
  LayoutDashboard,
  FileText,
  Download,
  AlertTriangle,
  Search,
  CheckSquare,
  Square,
  HelpCircle,
  Eye,
  Sliders,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  BookOpen,
  Maximize2,
  Minimize2,
  X,
  FileSpreadsheet,
  Table2,
  Globe,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonCard } from "@/components/ui/SkeletonLoader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useTechnicalApply } from "@/features/technicalReview/useTechnicalApply";
import { useTechnicalReviewQuery } from "@/features/technicalReview/useTechnicalReviewQuery";
import { useFileXhtmlQuery } from "@/features/technicalReview/useFileXhtmlQuery";
import { WysiwygEditor, useEditorSave, type Occurrence, ChangesReviewPanel, OnlyOfficeEditor, OnlyOfficeSidePanel, type OnlyOfficeEditorHandle } from "@/features/editor";
import { useSessionStore } from "@/stores/sessionStore";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";
import { useStylesheetsQuery } from "@/features/stylesheets/useStylesheetsQuery";
import { StylesheetPanel } from "@/features/technicalReview/components/StylesheetPanel";
import { VersionHistoryPanel } from "@/features/structuringReview/components/VersionHistoryPanel";

export function TechnicalReviewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wysiwyContentRef = useRef<HTMLDivElement>(null);
  const sidebarContainerRef = useRef<HTMLDivElement>(null);
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

  const [selectedStylesheetId, setSelectedStylesheetId] = useState<number | null>(null);
  const [editorFileId, setEditorFileId] = useState<number | null>(normalizedFileId);
  const technicalReviewQuery = useTechnicalReviewQuery(editorFileId, selectedStylesheetId);
  const stylesheetsQuery = useStylesheetsQuery(normalizedProjectId);
  const technicalApply = useTechnicalApply({
    projectId: normalizedProjectId,
    chapterId: normalizedChapterId,
    fileId: editorFileId,
  });
  const editorSave = useEditorSave(editorFileId);

  const [viewMode, setViewMode] = useState<"onlyoffice" | "collabora" | "local">("local");
  const onlyofficeRef = useRef<OnlyOfficeEditorHandle>(null);
  const collaboraIframeRef = useRef<HTMLIFrameElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const xhtmlQuery = useFileXhtmlQuery(editorFileId);

  const [activeTab, setActiveTab] = useState<"dashboard" | "reviewer">("reviewer");

  // Search and filters for occurrences sidebar
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [stylesheetFilter, setStylesheetFilter] = useState<"all" | "in_stylesheet" | "other">("all");

  // Occurrence reviewer states
  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [actionTypes, setActionTypes] = useState<Record<string, "fix" | "highlight">>({}); // defaults to fix
  const [customReplacements, setCustomReplacements] = useState<Record<string, string>>({});
  const [selectedOccurrenceIndex, setSelectedOccurrenceIndex] = useState<number>(0);
  const [trackChangesEnabled, setTrackChangesEnabled] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<"findings" | "trackedChanges">("findings");
  const viewer = useSessionStore((s) => s.viewer);
  const currentUser = viewer?.username;
  const editorRef = useRef<any>(null);
  const [showNoStylesheetWarning, setShowNoStylesheetWarning] = useState(false);
  const [applyWarning, setApplyWarning] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [pendingApplyLists, setPendingApplyLists] = useState<{ selectedList: any[]; highlightList: any[] } | null>(null);
  const hasAutoSelectedStylesheet = useRef(false);
  const draftKey = editorFileId ? `tr-draft-${editorFileId}` : null;

  useDocumentTitle(
    normalizedFileId === null
      ? "Technical Review — S4 Carlisle CMS"
      : `Technical Review #${normalizedFileId} — S4 Carlisle CMS`,
  );

  const findings = useMemo(() => {
    const raw = technicalReviewQuery.data?.findings ?? [];
    // Filter out te_point findings that are not part of the active stylesheet (in_stylesheet !== true)
    const filtered = raw.filter((f: any) => {
      if (f.category === "te_point" && f.in_stylesheet !== true) {
        return false;
      }
      return true;
    });
    // Sort chronologically by para_index and match_start to align checklist with manuscript reading order
    return [...filtered].sort((a: any, b: any) => {
      if (a.para_index !== b.para_index) {
        return a.para_index - b.para_index;
      }
      return a.match_start - b.match_start;
    });
  }, [technicalReviewQuery.data]);

  // Auto-select the project's active stylesheet on first data load
  useEffect(() => {
    if (!hasAutoSelectedStylesheet.current && technicalReviewQuery.data?.active_stylesheet?.id) {
      setSelectedStylesheetId(technicalReviewQuery.data.active_stylesheet.id);
      hasAutoSelectedStylesheet.current = true;
    }
  }, [technicalReviewQuery.data?.active_stylesheet?.id]);

  // Initializing selections when data loads — restore from localStorage draft first
  useEffect(() => {
    if (findings.length > 0) {
      const draftKey = editorFileId ? `tr-draft-${editorFileId}` : null;
      let draft: any = null;
      if (draftKey) {
        try { draft = JSON.parse(localStorage.getItem(draftKey) || "null"); } catch { /* ignore */ }
      }

      if (draft) {
        // Restore saved draft
        setCheckedIds(draft.checkedIds ?? {});
        setActionTypes(draft.actionTypes ?? {});
        setCustomReplacements(draft.customReplacements ?? {});
      } else {
        const initialChecked: Record<string, boolean> = {};
        const initialActions: Record<string, "fix" | "highlight"> = {};
        const initialCustoms: Record<string, string> = {};

        findings.forEach((f: any) => {
          const key = `${f.para_index}-${f.match_start}-${f.surface}`;
          initialChecked[key] = true;
          // Default to fix ONLY for te_point findings that have a replacement, others default to highlight
          const isTePoint = f.category === "te_point";
          initialActions[key] = (isTePoint && f.replacement) ? "fix" : "highlight";
          initialCustoms[key] = f.replacement ?? "";
        });

        setCheckedIds(initialChecked);
        setActionTypes(initialActions);
        setCustomReplacements(initialCustoms);
      }
      setSelectedOccurrenceIndex(0);
    }
  }, [findings, editorFileId]);

  // Persist draft to localStorage on every state change
  useEffect(() => {
    if (!editorFileId || Object.keys(checkedIds).length === 0) return;
    const draftKey = `tr-draft-${editorFileId}`;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ checkedIds, actionTypes, customReplacements }));
    } catch { /* ignore */ }
  }, [checkedIds, actionTypes, customReplacements, editorFileId]);

  // Filtered occurrences
  const filteredFindings = useMemo(() => {
    return findings.filter((f: any) => {
      const matchesSearch =
        f.surface.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.context.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (f.rule_label || "").toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCategory =
        categoryFilter === "all" ||
        f.category === categoryFilter;

      // If stylesheet is selected, ONLY show findings that match it (or standard rules)
      if (selectedStylesheetId) {
        return matchesSearch && matchesCategory && (f.in_stylesheet === true || f.category !== "te_point");
      }

      // If no stylesheet selected, apply stylesheet filter
      const matchesStylesheet =
        stylesheetFilter === "all" ||
        (stylesheetFilter === "in_stylesheet" && f.in_stylesheet === true) ||
        (stylesheetFilter === "other" && f.in_stylesheet !== true);

      return matchesSearch && matchesCategory && matchesStylesheet;
    });
  }, [findings, searchTerm, categoryFilter, stylesheetFilter, selectedStylesheetId]);

  const activeOccurrence = filteredFindings[selectedOccurrenceIndex] || null;

  // Convert filteredFindings to Occurrence format — indices align with selectedOccurrenceIndex
  const editorOccurrences = useMemo(() => {
    return filteredFindings.map((f: any) => ({
      para_index: f.para_index,
      match_start: f.match_start,
      match_end: f.match_end ?? (f.match_start + f.surface.length),
      surface: f.surface,
      category: f.category,
      in_stylesheet: f.in_stylesheet,
    } as Occurrence));
  }, [filteredFindings]);

  // Send navigation command to OnlyOffice when occurrence is selected
  useEffect(() => {
    if (activeOccurrence && viewMode === "onlyoffice" && onlyofficeRef.current?.connector) {
      const { surface } = activeOccurrence;
      if (surface) {
        try {
          onlyofficeRef.current.connector.executeMethod("SearchAndReplace", [{
            searchString: surface,
            replaceString: "",
            matchCase: true,
            findNext: true
          }]);
        } catch (e) {
          console.error("Failed to navigate in OnlyOffice:", e);
        }
      }
    }
  }, [activeOccurrence, viewMode]);

  // When technical apply completes, reload editor with new file XHTML
  useEffect(() => {
    if (technicalApply.result?.new_file_id) {
      setEditorFileId(technicalApply.result.new_file_id);
    }
  }, [technicalApply.result?.new_file_id]);


  // Scroll active checklist item into view inside left sidebar list
  useEffect(() => {
    if (selectedOccurrenceIndex !== -1 && sidebarContainerRef.current) {
      const container = sidebarContainerRef.current;
      const el = document.getElementById(`checklist-item-${selectedOccurrenceIndex}`);
      if (el) {
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        
        // Only scroll if not already fully visible
        if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
          const offset = elRect.top - containerRect.top + container.scrollTop - container.clientHeight / 2 + elRect.height / 2;
          container.scrollTo({ top: offset, behavior: "smooth" });
        }
      }
    }
  }, [selectedOccurrenceIndex, filteredFindings]);

  // Keep selected index in bounds when filters change
  useEffect(() => {
    if (selectedOccurrenceIndex >= filteredFindings.length && filteredFindings.length > 0) {
      setSelectedOccurrenceIndex(0);
    }
  }, [filteredFindings.length, selectedOccurrenceIndex]);

  // Clear cache when closing Technical Review page
  useEffect(() => {
    return () => {
      queryClient.removeQueries({ queryKey: ["technical-review"] });
    };
  }, [queryClient]);

  const categoriesList = useMemo(() => {
    const cats = new Set<string>();
    findings.forEach((f: any) => {
      if (f.category) cats.add(f.category);
    });
    return Array.from(cats);
  }, [findings]);

  // Doughnut Chart data calculation
  const chartSlices = useMemo(() => {
    const counts: Record<string, number> = {};
    findings.forEach((f: any) => {
      const cat = f.category || "General";
      counts[cat] = (counts[cat] || 0) + 1;
    });

    const colors: Record<string, string> = {
      spelling: "#3b82f6",     // Blue
      hyphenation: "#f59e0b",  // Amber
      consistency: "#10b981",  // Emerald
      grammar: "#8b5cf6",      // Purple
      bias: "#ef4444",         // Red
      style: "#6366f1",        // Indigo
      General: "#6b7280"       // Gray
    };

    let total = findings.length || 1;
    let accumulatedPercent = 0;

    return Object.entries(counts).map(([name, val]) => {
      const percent = (val / total) * 100;
      const startPercent = accumulatedPercent;
      accumulatedPercent += percent;
      return {
        name,
        value: val,
        percent,
        startPercent,
        color: colors[name] || "#14b8a6"
      };
    });
  }, [findings]);

  const spellingVariantProfile = useMemo(() => {
    const summary = technicalReviewQuery.data?.spelling_summary || {};
    return (summary as any).variants || [];
  }, [technicalReviewQuery.data]);

  const stats = useMemo(() => {
    return (technicalReviewQuery.data as any)?.stats || {};
  }, [technicalReviewQuery.data]);



  // Form apply actions - step 1: validate and show confirmation
  function handleApplySelected() {
    const selectedList: any[] = [];
    const highlightList: any[] = [];

    filteredFindings.forEach((f: any) => {
      const key = `${f.para_index}-${f.match_start}-${f.surface}`;
      if (checkedIds[key]) {
        const payloadItem = {
          para_index: f.para_index,
          match_start: f.match_start,
          surface: f.surface,
          replacement: customReplacements[key] || f.replacement || "",
          source: f.source || "body",
          region: f.region || "body",
          rule_id: f.rule_id
        };

        const shouldFix = actionTypes[key] === "fix";

        if (shouldFix && payloadItem.replacement) {
          selectedList.push(payloadItem);
        } else {
          highlightList.push(payloadItem);
        }
      }
    });

    if (selectedList.length === 0 && highlightList.length === 0) {
      setApplyWarning("Please select at least one occurrence to apply changes.");
      return;
    }

    setApplyWarning(null);
    setPendingApplyLists({ selectedList, highlightList });
    setConfirmApply(true);
  }

  // Step 2: confirm and apply
  async function handleConfirmApply() {
    if (!pendingApplyLists) return;
    try {
      await technicalApply.apply(null, pendingApplyLists.selectedList, pendingApplyLists.highlightList);
      setConfirmApply(false);
      setPendingApplyLists(null);
    } catch (e) {
      console.error(e);
    }
  }

  // Handle master select
  const isAllChecked = useMemo(() => {
    if (filteredFindings.length === 0) return false;
    return filteredFindings.every((f: any) => {
      const key = `${f.para_index}-${f.match_start}-${f.surface}`;
      return checkedIds[key];
    });
  }, [filteredFindings, checkedIds]);

  function handleToggleAll() {
    const newChecked = { ...checkedIds };
    filteredFindings.forEach((f: any) => {
      const key = `${f.para_index}-${f.match_start}-${f.surface}`;
      newChecked[key] = !isAllChecked;
    });
    setCheckedIds(newChecked);
  }

  // Progress tracker: how many unique finding keys have been actioned (actionType explicitly set)
  const reviewedCount = useMemo(() => {
    return filteredFindings.filter((f: any) => {
      const key = `${f.para_index}-${f.match_start}-${f.surface}`;
      return key in actionTypes;
    }).length;
  }, [filteredFindings, actionTypes]);

  // Batch fix: apply suggested replacement for all checked findings in the given category
  function handleBatchFixCategory(category: string) {
    const newActions = { ...actionTypes };
    const newReplacements = { ...customReplacements };
    findings
      .filter((f: any) => f.category === category && f.replacement)
      .forEach((f: any) => {
        const key = `${f.para_index}-${f.match_start}-${f.surface}`;
        newActions[key] = "fix";
        newReplacements[key] = f.replacement;
      });
    setActionTypes(newActions);
    setCustomReplacements(newReplacements);
  }

  // Clear localStorage draft
  function handleClearDraft() {
    if (!editorFileId) return;
    try { localStorage.removeItem(`tr-draft-${editorFileId}`); } catch { /* ignore */ }
    // Reset to clean slate
    const newChecked: Record<string, boolean> = {};
    const newActions: Record<string, "fix" | "highlight"> = {};
    const newCustoms: Record<string, string> = {};
    findings.forEach((f: any) => {
      const key = `${f.para_index}-${f.match_start}-${f.surface}`;
      newChecked[key] = true;
      // Default to fix ONLY for te_point findings that have a replacement, others default to highlight
      const isTePoint = f.category === "te_point";
      newActions[key] = (isTePoint && f.replacement) ? "fix" : "highlight";
      newCustoms[key] = f.replacement ?? "";
    });
    setCheckedIds(newChecked);
    setActionTypes(newActions);
    setCustomReplacements(newCustoms);
  }

  // Keyboard navigation: ↑↓ / J K to navigate, Space to toggle check, Enter to apply current
  useEffect(() => {
    if (activeTab !== "reviewer") return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelectedOccurrenceIndex(i => Math.min(filteredFindings.length - 1, i + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelectedOccurrenceIndex(i => Math.max(0, i - 1));
      } else if (e.key === " ") {
        e.preventDefault();
        const f = filteredFindings[selectedOccurrenceIndex];
        if (f) {
          const key = `${f.para_index}-${f.match_start}-${f.surface}`;
          setCheckedIds(prev => ({ ...prev, [key]: !prev[key] }));
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeTab, filteredFindings, selectedOccurrenceIndex]);

  if (normalizedProjectId === null || normalizedChapterId === null || normalizedFileId === null) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Invalid technical review route"
            description="The selected project, chapter, or file identifier is not valid."
          />
          <Link to={uiPaths.projects}>
            <Button variant="primary">Back to Projects</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (technicalReviewQuery.isPending) {
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

  if (technicalReviewQuery.isError) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Technical review unavailable"
            description={getApiErrorMessage(
              technicalReviewQuery.error,
              "The frontend shell could not load the technical review contract.",
            )}
          />
          <div className="flex items-center justify-center gap-3">
            <Button variant="primary" onClick={() => void technicalReviewQuery.refetch()}>
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

  if (!technicalReviewQuery.data) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Technical review unavailable"
            description="The technical review contract returned no data."
          />
          <Link to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
            <Button variant="primary">Back to Chapter</Button>
          </Link>
        </div>
      </main>
    );
  }

  const file = technicalReviewQuery.data.file;
  const onlyoffice_available = technicalReviewQuery.data.onlyoffice_available;
  const collabora_url = technicalReviewQuery.data.collabora_url;
  const inconsistencies = technicalReviewQuery.data.inconsistencies;
  const ia_report = technicalReviewQuery.data.ia_report;
  const activeStylesheet = technicalReviewQuery.data.active_stylesheet ?? null;

  const activeKey = activeOccurrence
    ? `${activeOccurrence.para_index}-${activeOccurrence.match_start}-${activeOccurrence.surface}`
    : "";

  return (
    <main className={`page-enter min-h-screen bg-surface-100 flex flex-col TEST-CLASSES-DEPLOYED ${isFullscreen ? "p-2" : "p-6"}`}>
      <div className={`w-full flex-1 flex flex-col ${isFullscreen ? "max-w-none px-0" : "max-w-[1600px] mx-auto px-4 space-y-6"}`}>
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
                <span className="text-navy-700">Technical Editor</span>
              </span>
            }
            title="Advanced Manuscript consistency reviewer"
            subtitle={file.filename}
            secondaryActions={[
              <a
                key="download-docx"
                href={`/api/v2/files/${fileId}/download`}
                className="no-underline"
                download
              >
                <Button variant="secondary" leftIcon={<Download className="w-4 h-4" />}>
                  Export DOCX
                </Button>
              </a>,
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
              onClick={() => setActiveTab("dashboard")}
              className={`py-3 px-6 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all ${activeTab === "dashboard"
                ? "border-navy-600 text-navy-800"
                : "border-transparent text-navy-400 hover:text-navy-600"
                }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Overview Dashboard
            </button>
            <button
              onClick={() => {
                const hasStylesheet = !!(technicalReviewQuery.data?.active_stylesheet || selectedStylesheetId);
                if (!hasStylesheet) {
                  setShowNoStylesheetWarning(true);
                  return;
                }
                setShowNoStylesheetWarning(false);
                setActiveTab("reviewer");
              }}
              className={`py-3 px-6 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all ${activeTab === "reviewer"
                ? "border-navy-600 text-navy-800"
                : "border-transparent text-navy-400 hover:text-navy-600"
                }`}
            >
              <FileText className="w-4 h-4" />
              Occurrences Review Workspace
            </button>
          </div>
        )}

        {/* No stylesheet warning */}
        {showNoStylesheetWarning && (
          <div className="mx-0 p-4 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">Stylesheet required</p>
              <p className="text-xs text-amber-700 mt-1">
                This project has no active stylesheet. Please go to{" "}
                <a
                  href={`/projects/${normalizedProjectId}/stylesheets`}
                  className="underline font-semibold"
                >
                  Project Stylesheets
                </a>{" "}
                to create and activate one before using the review workspace.
              </p>
            </div>
            <button
              onClick={() => setShowNoStylesheetWarning(false)}
              className="text-amber-500 hover:text-amber-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Status / error banners */}
        {technicalApply.statusMessage ? (
          <div
            className={`px-4 py-3 rounded-md text-sm font-medium border ${technicalApply.isPending
              ? "bg-info-100 border-info-100 text-info-600"
              : "bg-success-100 border-success-100 text-success-600"
              }`}
          >
            {technicalApply.statusMessage}
          </div>
        ) : null}
        {technicalApply.errorMessage ? (
          <div className="px-4 py-3 rounded-md text-sm font-medium border bg-error-100 border-error-100 text-error-600">
            {technicalApply.errorMessage}
          </div>
        ) : null}

        {/* Apply result */}
        {technicalApply.result ? (
          <div className="bg-white rounded-lg shadow-card p-5 flex items-start gap-4">
            <div className="w-9 h-9 rounded-md flex items-center justify-center bg-success-100 shrink-0">
              <CheckCircle className="w-5 h-5 text-success-600" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-navy-900 text-sm">Apply result</p>
              <p className="text-sm text-navy-500 mt-0.5">
                New file:{" "}
                <span className="font-medium text-navy-700">
                  {technicalApply.result.new_file.filename}
                </span>{" "}
                (ID {technicalApply.result.new_file_id})
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={technicalApply.clearMessages}>
              Dismiss
            </Button>
          </div>
        ) : null}

        {/* -------------------- TAB 1: OVERVIEW DASHBOARD -------------------- */}
        {activeTab === "dashboard" && (
          <div className="space-y-6 page-enter">
            {/* Metric summaries */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm transition-shadow duration-150 hover:shadow-md border-t-[3.5px] border-t-blue-500">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total Findings</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-1">{findings.length}</div>
                <p className="text-[11px] text-slate-500 mt-1.5">Consistency anomalies detected</p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm transition-shadow duration-150 hover:shadow-md border-t-[3.5px] border-t-amber-500">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Spelling Variants</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-1">
                  {findings.filter((f: any) => f.category === "spelling").length}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">Variant spelling profiles</p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm transition-shadow duration-150 hover:shadow-md border-t-[3.5px] border-t-emerald-500">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Inconsistencies</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-1">
                  {(technicalReviewQuery.data?.raw_scan as any)?.total_inconsistencies ?? 0}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">Explicit standard mismatches</p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm transition-shadow duration-150 hover:shadow-md border-t-[3.5px] border-t-purple-500">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Language Mix</span>
                <div className="text-xl font-extrabold text-slate-900 mt-2 truncate">
                  {(technicalReviewQuery.data?.raw_scan as any)?.mix_metric || "Standard"}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">US vs UK variant balance</p>
              </div>
            </div>

            {/* Split layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Category doughnut & Quick Stats */}
              <div className="lg:col-span-6 space-y-6">
                {/* Category Doughnut */}
                <div className="bg-white rounded-lg shadow-card p-6">
                  <h3 className="text-sm font-semibold text-navy-900 mb-5">Anomalies Category Distribution</h3>
                  {findings.length === 0 ? (
                    <div className="text-center py-10 text-navy-400 text-sm">No findings detected.</div>
                  ) : (
                    <div className="flex flex-col sm:flex-row items-center justify-around gap-6">
                      {/* SVG pure-gauge chart */}
                      <div className="relative w-40 h-40">
                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                          <circle cx="50" cy="50" r="40" fill="transparent" stroke="#e2e8f0" strokeWidth="12" />
                          {chartSlices.map((slice, idx) => {
                            const circumference = 2 * Math.PI * 40;
                            const strokeDasharray = `${(slice.percent / 100) * circumference} ${circumference}`;
                            const strokeDashoffset = `${-((slice.startPercent / 100) * circumference)}`;
                            return (
                              <circle
                                key={idx}
                                cx="50"
                                cy="50"
                                r="40"
                                fill="transparent"
                                stroke={slice.color}
                                strokeWidth="12"
                                strokeDasharray={strokeDasharray}
                                strokeDashoffset={strokeDashoffset}
                                onClick={() => {
                                  setCategoryFilter(slice.name);
                                  setActiveTab("reviewer");
                                }}
                                className="cursor-pointer transition-opacity hover:opacity-75"
                              />
                            );
                          })}
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-2xl font-bold text-navy-800">{findings.length}</span>
                          <span className="text-xs text-navy-400 font-medium">Issues</span>
                        </div>
                      </div>

                      {/* Legend */}
                      <div className="flex-1 space-y-2.5">
                        {chartSlices.map((slice, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setCategoryFilter(slice.name);
                              setActiveTab("reviewer");
                            }}
                            className="w-full flex items-center justify-between text-xs hover:bg-surface-50 p-2 rounded-md transition-colors cursor-pointer group"
                          >
                            <div className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-sm group-hover:scale-125 transition-transform" style={{ backgroundColor: slice.color }} />
                              <span className="capitalize font-semibold text-navy-700 group-hover:text-navy-900">{slice.name}</span>
                            </div>
                            <span className="text-navy-400 font-bold group-hover:text-navy-600">{slice.value} ({slice.percent.toFixed(0)}%)</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Quick stats details */}
                <div className="bg-white rounded-lg shadow-card p-6">
                  <h3 className="text-sm font-semibold text-navy-900 mb-4">Quick telemetry stats</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-surface-100 rounded-lg">
                      <span className="text-[10px] uppercase font-bold text-navy-400 tracking-wider">Word count</span>
                      <div className="text-lg font-bold text-navy-700 mt-0.5">{stats.word_count || "N/A"}</div>
                    </div>
                    <div className="p-3 bg-surface-100 rounded-lg">
                      <span className="text-[10px] uppercase font-bold text-navy-400 tracking-wider">Character count</span>
                      <div className="text-lg font-bold text-navy-700 mt-0.5">{stats.char_count || "N/A"}</div>
                    </div>
                    <div className="p-3 bg-surface-100 rounded-lg">
                      <span className="text-[10px] uppercase font-bold text-navy-400 tracking-wider">Missing captions</span>
                      <div className="text-lg font-bold text-navy-700 mt-0.5">{stats.missing_captions ?? 0}</div>
                    </div>
                    <div className="p-3 bg-surface-100 rounded-lg">
                      <span className="text-[10px] uppercase font-bold text-navy-400 tracking-wider">Missing citations</span>
                      <div className="text-lg font-bold text-navy-700 mt-0.5">{stats.missing_citations ?? 0}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* British vs American Spelling variant table */}
              <div className="lg:col-span-6 space-y-6">
                <div className="bg-white rounded-lg shadow-card p-6">
                  <h3 className="text-sm font-semibold text-navy-900 mb-4 flex items-center justify-between">
                    British vs American Variant spelling profile
                    <Badge variant="default">Spelling profile</Badge>
                  </h3>

                  {spellingVariantProfile.length === 0 ? (
                    <div className="text-center py-10 text-navy-400 text-sm">
                      No variant spelling profiles found. High level spelling consistency is achieved!
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-navy-100 text-navy-400 font-bold bg-surface-100 uppercase tracking-wider text-[10px]">
                            <th className="py-2 px-3">British (UK)</th>
                            <th className="py-2 px-3">American (US)</th>
                            <th className="py-2 px-3 text-center">UK count</th>
                            <th className="py-2 px-3 text-center">US count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {spellingVariantProfile.map((varItem: any, idx: number) => (
                            <tr key={idx} className="border-b border-navy-50 hover:bg-surface-50 transition-colors">
                              <td className="py-2.5 px-3 font-semibold text-navy-800">{varItem.uk || "-"}</td>
                              <td className="py-2.5 px-3 font-semibold text-navy-800">{varItem.us || "-"}</td>
                              <td className="py-2.5 px-3 text-center text-navy-500 font-bold">{varItem.uk_count ?? 0}</td>
                              <td className="py-2.5 px-3 text-center text-navy-500 font-bold">{varItem.us_count ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Version History panel */}
                <VersionHistoryPanel
                  fileId={editorFileId}
                  currentFileId={editorFileId || 0}
                  onOpenVersion={(versionId) => {
                    setEditorFileId(versionId);
                    navigate(uiPaths.technicalReview(normalizedProjectId!, normalizedChapterId!, versionId) + "?tab=dashboard");
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* -------------------- TAB 2: REVIEWER WORKSPACE -------------------- */}
        {activeTab === "reviewer" && (
          <div className="flex-1 flex flex-col min-h-0 page-enter">
            {/* Stylesheet Filter Banner */}
            {selectedStylesheetId && (
              <div className="bg-gradient-to-r from-blue-50 to-blue-100 border-b border-blue-300 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></div>
                  <div>
                    <p className="text-xs font-semibold text-blue-900">
                      Active Editorial Stylesheet: <span className="font-bold">{stylesheetsQuery.data?.stylesheets.find(s => s.id === selectedStylesheetId)?.name || "Project Stylesheet"}</span>
                    </p>
                    <p className="text-[10px] text-blue-700 mt-0.5">
                      Showing stylesheet rules and standard anomalies
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Split layout */}
            <div
              className="flex gap-4 overflow-hidden min-h-0"
              style={{ height: isFullscreen ? "calc(100vh - 20px)" : "calc(100vh - 260px)" }}
            >
              {/* Left sidebar: Occurrences list */}
              <div className="w-[24%] bg-white rounded-lg shadow-card border border-navy-100 flex flex-col min-h-0 shrink-0 transition-all duration-300">
                <div className="p-4 border-b border-navy-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-navy-800 uppercase tracking-wider">Occurrences checklist</h3>
                    <div className="flex items-center gap-2">
                      {editorFileId && (
                        <button
                          onClick={handleClearDraft}
                          title="Reset and clear all saved selections/replacements for this file draft"
                          className="text-[10px] text-red-500 hover:text-red-700 font-bold hover:underline transition-colors uppercase shrink-0"
                        >
                          Clear Draft
                        </button>
                      )}
                      <Badge variant="info" size="sm">{filteredFindings.length} Items</Badge>
                    </div>
                  </div>

                  {/* Search Bar */}
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-navy-300" />
                    <input
                      type="text"
                      placeholder="Search occurrences..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 border border-navy-200 rounded-md text-xs focus:ring-1 focus:ring-navy-600 focus:outline-none"
                    />
                  </div>

                  {/* Filter selector - Category */}
                  <div className="flex items-center gap-1 bg-surface-100 p-1 rounded-md overflow-x-auto scrollbar-thin">
                    <button
                      onClick={() => setCategoryFilter("all")}
                      className={`px-3 py-1 text-[10px] font-bold uppercase rounded-sm transition-all shrink-0 ${categoryFilter === "all" ? "bg-white text-navy-800 shadow-sm" : "text-navy-400 hover:text-navy-600"
                        }`}
                    >
                      All
                    </button>
                    {categoriesList.map((cat, idx) => (
                      <button
                        key={idx}
                        onClick={() => setCategoryFilter(cat)}
                        className={`px-3 py-1 text-[10px] font-bold uppercase rounded-sm truncate transition-all shrink-0 ${categoryFilter === cat ? "bg-white text-navy-800 shadow-sm" : "text-navy-400 hover:text-navy-600"
                          }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  {/* Filter selector - Stylesheet */}
                  {!selectedStylesheetId && (
                    <div className="flex items-center gap-1 bg-surface-100 p-1 rounded-md">
                      <button
                        onClick={() => setStylesheetFilter("all")}
                        className={`flex-1 py-1 text-[10px] font-bold uppercase rounded-sm transition-all ${stylesheetFilter === "all" ? "bg-white text-navy-800 shadow-sm" : "text-navy-400 hover:text-navy-600"
                          }`}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setStylesheetFilter("in_stylesheet")}
                        className={`flex-1 py-1 text-[10px] font-bold uppercase rounded-sm transition-all ${stylesheetFilter === "in_stylesheet" ? "bg-white text-navy-800 shadow-sm" : "text-navy-400 hover:text-navy-600"
                          }`}
                      >
                        In Stylesheet
                      </button>
                      <button
                        onClick={() => setStylesheetFilter("other")}
                        className={`flex-1 py-1 text-[10px] font-bold uppercase rounded-sm transition-all ${stylesheetFilter === "other" ? "bg-white text-navy-800 shadow-sm" : "text-navy-400 hover:text-navy-600"
                          }`}
                      >
                        Other
                      </button>
                    </div>
                  )}

                  {/* Category Batch Fix Action Bar */}
                  {categoryFilter !== "all" && findings.some(f => f.category === categoryFilter && f.replacement) && (
                    <div className="flex items-center justify-between p-2 bg-amber-50 border border-amber-200 rounded-md transition-all">
                      <span className="text-[10px] text-amber-800 font-bold uppercase tracking-wide">Batch:</span>
                      <button
                        onClick={() => handleBatchFixCategory(categoryFilter)}
                        className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[9px] font-extrabold uppercase transition-colors shrink-0 shadow-sm"
                      >
                        Fix All {categoryFilter}
                      </button>
                    </div>
                  )}
                </div>

                {/* Master checkbox toggle bar */}
                <div className="px-4 py-2 border-b border-navy-50 flex items-center justify-between bg-surface-50">                  <button
                    onClick={handleToggleAll}
                    className="flex items-center gap-1.5 text-[10px] font-bold text-navy-500 uppercase tracking-wide hover:text-navy-700"
                  >
                    {isAllChecked ? (
                      <CheckSquare className="w-3.5 h-3.5 text-navy-700" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                    Select / Deselect all
                  </button>
                </div>

                {/* Progress Tracker */}
                {filteredFindings.length > 0 && (
                  <div className="px-4 py-3 border-b border-navy-50 space-y-2">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-navy-700">Reviewed: {reviewedCount} / {filteredFindings.length}</span>
                      <span className="text-navy-400 font-medium">{filteredFindings.length > 0 ? Math.round((reviewedCount / filteredFindings.length) * 100) : 0}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-navy-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all duration-300"
                        style={{ width: `${filteredFindings.length > 0 ? (reviewedCount / filteredFindings.length) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Summary line */}
                {selectedStylesheetId && findings.length > 0 && (
                  <div className="px-4 py-2 text-xs text-navy-600 bg-navy-50 border-b border-navy-100">
                    {findings.filter(f => f.in_stylesheet === true).length} of {findings.length} findings match the selected stylesheet
                  </div>
                )}

                {/* Scrollable list */}
                <div
                  ref={sidebarContainerRef}
                  className="flex-1 overflow-y-auto divide-y divide-navy-50"
                >
                  {filteredFindings.length === 0 ? (
                    <div className="text-center py-10 text-navy-400 text-xs">No matching anomalies found.</div>
                  ) : (
                    filteredFindings.map((f: any, idx: number) => {
                      const key = `${f.para_index}-${f.match_start}-${f.surface}`;
                      const isChecked = checkedIds[key] ?? false;
                      const isSelected = selectedOccurrenceIndex === idx;

                      // Severity / Category border highlights
                      const borderHighlight = f.in_stylesheet 
                        ? "border-l-gold-500 bg-gold-50/10 hover:bg-gold-50/20" 
                        : "border-l-indigo-500 bg-indigo-50/10 hover:bg-indigo-50/20";

                      return (
                        <div
                          key={idx}
                          id={`checklist-item-${idx}`}
                          onClick={() => setSelectedOccurrenceIndex(idx)}
                          className={`p-4 flex items-start gap-3.5 cursor-pointer border-b border-slate-100 transition-all duration-200 border-l-[4px] relative rounded-r-lg ${borderHighlight} ${
                            isSelected
                              ? "bg-emerald-50/70 border-l-emerald-500 shadow-md translate-x-1 scale-[1.01]"
                              : "hover:translate-x-0.5 hover:shadow-sm"
                          }`}
                        >
                          {/* Checkbox */}
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setCheckedIds(prev => ({ ...prev, [key]: !prev[key] }));
                            }}
                            className="text-slate-400 hover:text-slate-600 shrink-0 mt-0.5 transition-colors"
                          >
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-emerald-600 drop-shadow-sm" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center justify-between gap-2.5">
                              <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400 truncate max-w-[50%]">
                                {f.rule_label || f.rule_id}
                              </span>
                              {f.in_stylesheet ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold-100/60 text-gold-700 text-[8px] font-extrabold tracking-wide uppercase">
                                  Stylesheet
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100/60 text-indigo-700 text-[8px] font-extrabold tracking-wide uppercase">
                                  Finding
                                </span>
                              )}
                              <Badge size="sm" variant={f.category === "spelling" ? "default" : "outline"}>
                                {f.category}
                              </Badge>
                            </div>
                            <div className="text-xs font-bold text-slate-800 font-sans tracking-tight truncate">
                              "{f.surface}"
                            </div>
                            <div className="text-[10px] text-slate-500 font-medium leading-relaxed line-clamp-2">
                              {f.context}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              {/* Middle panel: Live Collabora Online / Local WYSIWYG document editor iframe */}
              <div className="flex-1 bg-white rounded-lg shadow-card border border-navy-100 flex flex-col overflow-hidden min-w-0">
                <div className="bg-surface-100 px-4 py-2 border-b border-navy-100 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    {onlyoffice_available ? (
                      <div className="flex items-center gap-1 bg-surface-200 p-0.5 rounded-md">
                        <button
                          onClick={() => setViewMode("local")}
                          className={`px-3 py-1 text-xs font-bold rounded-md border-0 cursor-pointer ${
                            viewMode === "local"
                              ? "bg-navy-800 text-white shadow-sm"
                              : "text-navy-500 hover:text-navy-700 bg-transparent"
                          }`}
                        >
                          Local Editor
                        </button>
                        <button
                          onClick={() => setViewMode("onlyoffice")}
                          className={`px-3 py-1 text-xs font-bold rounded-md border-0 cursor-pointer ${
                            viewMode === "onlyoffice"
                              ? "bg-navy-800 text-white shadow-sm"
                              : "text-navy-500 hover:text-navy-700 bg-transparent"
                          }`}
                        >
                          OnlyOffice Editor
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                        <span className="text-xs font-bold text-navy-700 uppercase tracking-wide">
                          Local WYSIWYG Workspace
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setIsFullscreen(!isFullscreen)}
                      leftIcon={isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                      className="text-navy-700 hover:text-navy-900 font-semibold text-[11px] py-1 px-2.5 h-8 flex items-center gap-1"
                    >
                      {isFullscreen ? "Exit Full Screen" : "Full Screen"}
                    </Button>
                  </div>
                </div>

                <div className="flex-1 bg-surface-200 relative flex flex-col min-h-0 overflow-hidden">
                  {viewMode === "local" ? (
                    xhtmlQuery.isPending ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center space-y-3 bg-surface-200">
                        <RefreshCw className="w-8 h-8 text-navy-500 animate-spin" />
                        <div className="text-sm font-semibold text-navy-800">Generating Document WYSIWYG View...</div>
                        <div className="text-xs text-navy-400">Pandoc converting manuscript on the fly</div>
                      </div>
                    ) : xhtmlQuery.isError ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center space-y-3 bg-surface-200">
                        <AlertTriangle className="w-8 h-8 text-error-500" />
                        <div className="text-sm font-semibold text-navy-800">WYSIWYG Mode Unavailable</div>
                        <div className="text-xs text-navy-500 max-w-sm">
                          Failed to fetch XHTML document. Make sure conversion packages are installed.
                        </div>
                      </div>
                    ) : (
                      <WysiwygEditor
                        ref={editorRef}
                        key={`editor-${editorFileId}`}
                        initialContent={xhtmlQuery.data?.content ?? ""}
                        onSave={async (html) => {
                          const res = await editorSave.save(html);
                          if (res && res.file_id && res.file_id !== editorFileId) {
                            setEditorFileId(res.file_id);
                            navigate(uiPaths.technicalReview(normalizedProjectId!, normalizedChapterId!, res.file_id));
                          }
                        }}
                        isSaving={editorSave.isPending}
                        saveLabel="Save Edits to DOCX"
                        documentTitle={technicalReviewQuery.data?.file.filename}
                        height={isFullscreen ? "calc(100vh - 80px)" : "calc(100vh - 320px)"}
                        occurrences={editorOccurrences}
                        selectedOccurrenceIndex={selectedOccurrenceIndex}
                        onOccurrenceClick={(idx) => setSelectedOccurrenceIndex(idx)}
                        trackChangesEnabled={trackChangesEnabled}
                        onTrackChangesToggle={setTrackChangesEnabled}
                        currentUser={currentUser}
                        fileId={editorFileId?.toString()}
                      />
                    )
                  ) : viewMode === "onlyoffice" ? (
                    <div className="flex-1 flex min-h-0 gap-0 w-full h-full relative" style={{ minHeight: isFullscreen ? "calc(100vh - 80px)" : "600px" }}>
                      <OnlyOfficeSidePanel
                        connector={onlyofficeRef.current?.connector}
                        styles={[]}
                        fileId={normalizedFileId}
                        findings={findings}
                      />
                      <OnlyOfficeEditor
                        ref={onlyofficeRef}
                        fileId={normalizedFileId}
                        mode="original"
                        height="100%"
                      />
                    </div>
                  ) : (
                    collabora_url ? (
                      <iframe
                        ref={collaboraIframeRef}
                        src={collabora_url}
                        title="Collabora Online editor"
                        className="w-full h-full border-none absolute inset-0"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center space-y-3">
                        <AlertTriangle className="w-10 h-10 text-amber-500" />
                        <div className="text-sm font-semibold text-navy-800">Collabora Online Office Unavailable</div>
                        <div className="text-xs text-navy-500 max-w-sm">
                          Launch URL was not provided by the server. Double check Collabora container services or use the Local WYSIWYG mode.
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>

              {/* Right sidebar: Occurrences editor replacement controls */}
              <div className="w-[24%] bg-white rounded-lg shadow-card border border-navy-100 flex flex-col min-h-0 shrink-0 p-5 space-y-5 transition-all duration-300">
                <div className="flex border-b border-navy-100 pb-2">
                  <button
                    onClick={() => setRightSidebarTab("findings")}
                    className={`flex-1 pb-1.5 text-center text-xs font-bold border-b-2 transition-all cursor-pointer ${
                      rightSidebarTab === "findings"
                        ? "border-navy-800 text-navy-800 bg-transparent border-t-0 border-x-0"
                        : "border-transparent text-navy-400 hover:text-navy-600 bg-transparent border-t-0 border-x-0"
                    }`}
                  >
                    Occurrences
                  </button>
                  <button
                    onClick={() => setRightSidebarTab("trackedChanges")}
                    className={`flex-1 pb-1.5 text-center text-xs font-bold border-b-2 transition-all cursor-pointer ${
                      rightSidebarTab === "trackedChanges"
                        ? "border-navy-800 text-navy-800 bg-transparent border-t-0 border-x-0"
                        : "border-transparent text-navy-400 hover:text-navy-600 bg-transparent border-t-0 border-x-0"
                    }`}
                  >
                    Tracked Changes
                  </button>
                </div>

                {rightSidebarTab === "findings" ? (
                  <>
                    <div className="flex items-center justify-between pb-3 border-b border-navy-100">
                      <h3 className="text-xs font-bold text-navy-800 uppercase tracking-wider">
                        Occurrence Details &amp; Fix options
                      </h3>
                      {filteredFindings.length > 0 && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setSelectedOccurrenceIndex(i => Math.max(0, i - 1))}
                            disabled={selectedOccurrenceIndex === 0}
                            className="p-1 rounded hover:bg-surface-100 disabled:opacity-30 transition-colors cursor-pointer border-none bg-transparent"
                            title="Previous occurrence"
                          >
                            <ChevronLeft className="w-4 h-4 text-navy-500" />
                          </button>
                          <span className="text-[10px] text-navy-400 font-mono">
                            {selectedOccurrenceIndex + 1}/{filteredFindings.length}
                          </span>
                          <button
                            onClick={() => setSelectedOccurrenceIndex(i => Math.min(filteredFindings.length - 1, i + 1))}
                            disabled={selectedOccurrenceIndex >= filteredFindings.length - 1}
                            className="p-1 rounded hover:bg-surface-100 disabled:opacity-30 transition-colors cursor-pointer border-none bg-transparent"
                            title="Next occurrence"
                          >
                            <ChevronRight className="w-4 h-4 text-navy-500" />
                          </button>
                        </div>
                      )}
                    </div>

                    {activeOccurrence ? (
                  <div className="flex-1 flex flex-col justify-start min-h-0 space-y-4">
                    <div className="space-y-4 overflow-y-auto pr-1">
                      {/* Category metadata */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2.5 bg-surface-100 rounded-md">
                          <span className="text-[9px] uppercase font-bold text-navy-400">Rule Category</span>
                          <div className="text-xs font-bold text-navy-700 uppercase mt-0.5">{activeOccurrence.category}</div>
                        </div>
                        <div className="p-2.5 bg-surface-100 rounded-md">
                          <span className="text-[9px] uppercase font-bold text-navy-400">Region context</span>
                          <div className="text-xs font-bold text-navy-700 uppercase mt-0.5">{activeOccurrence.region}</div>
                        </div>
                      </div>

                      {/* Pattern context details */}
                      <div>
                        <span className="text-[10px] uppercase font-bold text-navy-400">Context sentence</span>
                        <div className="p-3 bg-surface-50 border border-navy-50 rounded-lg text-xs leading-relaxed text-navy-700 mt-1.5 font-medium">
                          {/* Highlight the matching occurrence in the context */}
                          {(() => {
                            const text = activeOccurrence.context || "";
                            const surface = activeOccurrence.surface || "";
                            const parts = text.split(new RegExp(`(${surface})`, 'i'));
                            return parts.map((part: string, i: number) =>
                              part.toLowerCase() === surface.toLowerCase() ? (
                                <mark key={i} className="bg-amber-100 px-1 font-bold text-navy-900 border border-amber-200 rounded-sm">
                                  {part}
                                </mark>
                              ) : part
                            );
                          })()}
                        </div>
                      </div>

                      {/* Interactive toggle between track changes fix vs highlighting */}
                      <div className="space-y-2">
                        <span className="text-[10px] uppercase font-bold text-navy-400">Action choice</span>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setActionTypes(prev => ({ ...prev, [activeKey]: "fix" }))}
                            className={`py-2 px-3 text-xs font-bold rounded-lg border flex items-center justify-center gap-1.5 transition-all ${actionTypes[activeKey] === "fix"
                              ? "bg-navy-800 border-navy-800 text-white shadow-sm"
                              : "bg-white border-navy-200 text-navy-600 hover:bg-surface-50"
                              }`}
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            Track Changes Fix
                          </button>
                          <button
                            onClick={() => setActionTypes(prev => ({ ...prev, [activeKey]: "highlight" }))}
                            className={`py-2 px-3 text-xs font-bold rounded-lg border flex items-center justify-center gap-1.5 transition-all ${actionTypes[activeKey] === "highlight"
                              ? "bg-amber-500 border-amber-500 text-white shadow-sm"
                              : "bg-white border-navy-200 text-navy-600 hover:bg-surface-50"
                              }`}
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Highlight Only
                          </button>
                        </div>
                      </div>

                      {/* Replacements form */}
                      <div className="space-y-2">
                        <span className="text-[10px] uppercase font-bold text-navy-400">
                          {actionTypes[activeKey] === "fix" ? "Replacement input override" : "Custom Replacement (Enter text to upgrade to Track Changes Fix)"}
                        </span>

                        {/* Suggested options badges */}
                        {activeOccurrence.replacement && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            <button
                              onClick={() => {
                                setCustomReplacements(prev => ({ ...prev, [activeKey]: activeOccurrence.replacement }));
                                setActionTypes(prev => ({ ...prev, [activeKey]: "fix" }));
                              }}
                              className="px-2 py-1 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-700 text-[10px] rounded font-bold transition-all"
                            >
                              Suggestion: {activeOccurrence.replacement}
                            </button>
                          </div>
                        )}

                        <input
                          type="text"
                          value={customReplacements[activeKey] || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomReplacements(prev => ({ ...prev, [activeKey]: val }));
                            if (val.trim()) {
                              setActionTypes(prev => ({ ...prev, [activeKey]: "fix" }));
                            }
                          }}
                          className="w-full px-3 py-2 border border-navy-200 rounded-md text-xs focus:ring-1 focus:ring-navy-600 focus:outline-none font-medium"
                          placeholder="Type targeted replacement here..."
                        />
                      </div>
                    </div>

                    {/* Submit changes button */}
                    <div className="pt-4 border-t border-navy-100 shrink-0 space-y-2">
                      {applyWarning && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-center gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {applyWarning}
                        </div>
                      )}
                      {!confirmApply ? (
                        <button
                          type="button"
                          onClick={handleApplySelected}
                          disabled={technicalApply.isPending}
                          className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold rounded-lg shadow-emerald-500/20 shadow-lg hover:shadow-emerald-500/40 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] border-none flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {technicalApply.isPending ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <CheckCircle className="w-4 h-4" />
                          )}
                          Apply Selected Changes
                        </button>
                      ) : pendingApplyLists ? (
                        <div className="space-y-2">
                          <div className="text-xs text-navy-600 bg-surface-50 border border-navy-100 rounded-md px-3 py-2">
                            Apply <strong>{pendingApplyLists.selectedList.length} fix(es)</strong> and <strong>{pendingApplyLists.highlightList.length} highlight(s)</strong>?
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={handleConfirmApply}
                              disabled={technicalApply.isPending}
                              className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold rounded-md shadow-md border-none cursor-pointer flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {technicalApply.isPending ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                "Confirm Apply"
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmApply(false);
                                setPendingApplyLists(null);
                              }}
                              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-md border-none cursor-pointer flex items-center justify-center transition-all duration-150"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-center text-xs text-navy-400 py-10">
                    Select an occurrence from the checklist sidebar to see details.
                  </div>
                )}
                  </>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <ChangesReviewPanel editor={editorRef.current?.editor} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
