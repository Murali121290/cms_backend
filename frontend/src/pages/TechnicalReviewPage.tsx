import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  RefreshCw,
  X,
  CheckCircle,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/SkeletonLoader";
import { useTechnicalApply } from "@/features/technicalReview/useTechnicalApply";
import { useTechnicalReviewQuery } from "@/features/technicalReview/useTechnicalReviewQuery";
import { useFileXhtmlQuery } from "@/features/technicalReview/useFileXhtmlQuery";
import {
  WysiwygEditor,
  useEditorSave,
  type Occurrence,
  OnlyOfficeEditor,
  OnlyOfficeSidePanel,
  type OnlyOfficeEditorHandle,
} from "@/features/editor";
import { useSessionStore } from "@/stores/sessionStore";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";
import {
  listComments,
  createComment,
  updateComment,
  deleteComment,
  type CommentRecord,
} from "@/api/comments";
import { toast } from "@/store/useToastStore";
import { useStylesheetsQuery } from "@/features/stylesheets/useStylesheetsQuery";

// Subcomponents
import { TechnicalReviewHeader } from "@/features/technicalReview/components/TechnicalReviewHeader";
import { OccurrencesChecklistSidebar } from "@/features/technicalReview/components/OccurrencesChecklistSidebar";
import { OccurrenceInspectorPanel } from "@/features/technicalReview/components/OccurrenceInspectorPanel";
import { TechnicalApplyConfirmModal } from "@/features/technicalReview/components/TechnicalApplyConfirmModal";
import { OverviewDashboardTab } from "@/features/technicalReview/components/OverviewDashboardTab";

export function TechnicalReviewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  // Sidebar collapse states for responsive layout
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);

  // Search and filters for occurrences sidebar
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [stylesheetFilter, setStylesheetFilter] = useState<"all" | "in_stylesheet" | "other">("all");

  // Occurrence reviewer states
  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [actionTypes, setActionTypes] = useState<Record<string, "fix" | "highlight">>({});
  const [customReplacements, setCustomReplacements] = useState<Record<string, string>>({});
  const [selectedOccurrenceIndex, setSelectedOccurrenceIndex] = useState<number>(0);
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());
  const [trackChangesEnabled, setTrackChangesEnabled] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<"findings" | "trackedChanges" | "comments">("findings");

  // Comments / Author Queries (AQ) state
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [filterUnresolved, setFilterUnresolved] = useState(false);
  const [selectedEditorText, setSelectedEditorText] = useState<string>("");
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);

  const viewer = useSessionStore((s) => s.viewer);
  const currentUser = viewer?.username;
  const editorRef = useRef<any>(null);
  const [showNoStylesheetWarning, setShowNoStylesheetWarning] = useState(false);
  const [applyWarning, setApplyWarning] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [pendingApplyLists, setPendingApplyLists] = useState<{
    selectedList: any[];
    highlightList: any[];
  } | null>(null);

  const hasAutoSelectedStylesheet = useRef(false);

  useDocumentTitle(
    normalizedFileId === null
      ? "Technical Review — S4 Carlisle CMS"
      : `Technical Review #${normalizedFileId} — S4 Carlisle CMS`,
  );

  const findings = useMemo(() => {
    const raw = technicalReviewQuery.data?.findings ?? [];
    return [...raw].sort((a: any, b: any) => {
      if (a.para_index !== b.para_index) {
        return a.para_index - b.para_index;
      }
      return a.match_start - b.match_start;
    });
  }, [technicalReviewQuery.data]);

  // Fetch comments
  const fetchComments = useCallback(async () => {
    if (!editorFileId) return;
    setCommentsLoading(true);
    try {
      const list = await listComments(editorFileId);
      setComments(list);
    } catch (err) {
      console.error("Failed to load comments:", err);
    } finally {
      setCommentsLoading(false);
    }
  }, [editorFileId]);

  const handleCreateComment = async (customText?: string) => {
    const textToPost = customText || newCommentText;
    if (!editorFileId || !textToPost.trim()) return;
    setSubmittingComment(true);
    try {
      const commentUuid = `cm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await createComment(editorFileId, commentUuid, textToPost.trim());

      if (selectedEditorText && editorRef.current) {
        editorRef.current.addCommentToSelection(commentUuid);
      }

      setNewCommentText("");
      toast.success("AQ Comment posted!");
      fetchComments();
    } catch (err) {
      toast.error("Failed to post comment.");
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleToggleResolveComment = async (commentUuid: string, currentResolved: boolean) => {
    if (!editorFileId) return;
    try {
      await updateComment(editorFileId, commentUuid, { resolved: !currentResolved });
      toast.success(!currentResolved ? "Comment resolved" : "Comment reopened");
      fetchComments();
    } catch (err) {
      toast.error("Failed to update comment status.");
    }
  };

  const handleDeleteComment = async (commentUuid: string) => {
    if (!editorFileId) return;
    try {
      await deleteComment(editorFileId, commentUuid);
      toast.success("Comment deleted");
      fetchComments();
    } catch (err) {
      toast.error("Failed to delete comment.");
    }
  };

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Parse XHTML inline comments on load
  useEffect(() => {
    if (xhtmlQuery.data?.content) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xhtmlQuery.data.content, "text/html");
        const commentNodes = doc.querySelectorAll("span[data-comment-id], span.comment[data-comment], [data-comment-id]");
        const parsedComments: CommentRecord[] = [];

        commentNodes.forEach((el, idx) => {
          const uuid = el.getAttribute("data-comment-id") || `xhtml-cm-${idx}`;
          const commentText = el.getAttribute("data-comment") || el.getAttribute("title") || "Inline XHTML Comment";
          const quotedText = el.textContent?.trim() || "";

          parsedComments.push({
            comment_uuid: uuid,
            author_id: null,
            author_name: "Author Query",
            text: commentText + (quotedText ? ` (On: "${quotedText}")` : ""),
            resolved: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        });

        if (parsedComments.length > 0) {
          setComments((prev) => {
            const existingUuids = new Set(prev.map((c) => c.comment_uuid));
            const newInline = parsedComments.filter((c) => !existingUuids.has(c.comment_uuid));
            return [...prev, ...newInline];
          });
        }
      } catch (e) {
        console.error("Failed to parse XHTML comments:", e);
      }
    }
  }, [xhtmlQuery.data?.content, editorFileId]);

  // Auto-select the project's active stylesheet on first data load
  useEffect(() => {
    if (!hasAutoSelectedStylesheet.current && technicalReviewQuery.data?.active_stylesheet?.id) {
      setSelectedStylesheetId(technicalReviewQuery.data.active_stylesheet.id);
      hasAutoSelectedStylesheet.current = true;
    }
  }, [technicalReviewQuery.data?.active_stylesheet?.id]);

  // Reset applied keys when active file changes (file switch — not page reload)
  // On page reload for the SAME file, appliedKeys is restored from localStorage below.

  // Restore draft + appliedKeys + position from localStorage on first load for this file
  useEffect(() => {
    if (findings.length > 0) {
      const draftKey = editorFileId ? `tr-draft-${editorFileId}` : null;
      let draft: any = null;
      if (draftKey) {
        try {
          draft = JSON.parse(localStorage.getItem(draftKey) || "null");
        } catch {
          /* ignore */
        }
      }

      if (draft) {
        setCheckedIds(draft.checkedIds ?? {});
        setActionTypes(draft.actionTypes ?? {});
        setCustomReplacements(draft.customReplacements ?? {});
        // Restore which items were already processed inline so the user sees remaining only
        const savedApplied: string[] = Array.isArray(draft.appliedKeys) ? draft.appliedKeys : [];
        setAppliedKeys(new Set(savedApplied));
        // Restore last selected position so the user resumes from where they stopped.
        // The appliedKeys filter reduces filteredFindings, so clamp the index safely.
        const savedIdx: number = typeof draft.selectedIndex === "number" ? draft.selectedIndex : 0;
        // We can't clamp to filteredFindings.length here (not yet recomputed), so just restore
        // the raw value — the clamping useEffect below will correct it if needed.
        setSelectedOccurrenceIndex(Math.max(0, savedIdx));
      } else {
        const initialChecked: Record<string, boolean> = {};
        const initialActions: Record<string, "fix" | "highlight"> = {};
        const initialCustoms: Record<string, string> = {};

        findings.forEach((f: any) => {
          const key = `${f.para_index}-${f.match_start}-${f.surface}`;
          initialChecked[key] = true;
          const isTePoint = f.category === "te_point";
          initialActions[key] = isTePoint && f.replacement ? "fix" : "highlight";
          initialCustoms[key] = f.replacement ?? "";
        });

        setCheckedIds(initialChecked);
        setActionTypes(initialActions);
        setCustomReplacements(initialCustoms);
        setAppliedKeys(new Set());
        setSelectedOccurrenceIndex(0);
      }
    }
  }, [findings, editorFileId]);

  // Persist draft + appliedKeys + current position to localStorage on every change
  useEffect(() => {
    if (!editorFileId || Object.keys(checkedIds).length === 0) return;
    const draftKey = `tr-draft-${editorFileId}`;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          checkedIds,
          actionTypes,
          customReplacements,
          // Persist appliedKeys as array (Set is not JSON-serializable)
          appliedKeys: Array.from(appliedKeys),
          // Persist current position so the user resumes where they stopped
          selectedIndex: selectedOccurrenceIndex,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [checkedIds, actionTypes, customReplacements, appliedKeys, selectedOccurrenceIndex, editorFileId]);

  // Filtered occurrences — exclude already applied items so checklist count reduces
  const filteredFindings = useMemo(() => {
    return findings.filter((f: any) => {
      const key = `${f.para_index}-${f.match_start}-${f.surface}`;
      if (appliedKeys.has(key)) return false;

      const matchesSearch =
        f.surface.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.context.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (f.rule_label || "").toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCategory = categoryFilter === "all" || f.category === categoryFilter;

      const matchesStylesheet =
        stylesheetFilter === "all" ||
        (stylesheetFilter === "in_stylesheet" && f.in_stylesheet === true) ||
        (stylesheetFilter === "other" && f.in_stylesheet !== true);

      return matchesSearch && matchesCategory && matchesStylesheet;
    });
  }, [findings, searchTerm, categoryFilter, stylesheetFilter, appliedKeys]);

  // Keep selectedOccurrenceIndex within bounds as items are resolved
  useEffect(() => {
    if (filteredFindings.length > 0 && selectedOccurrenceIndex >= filteredFindings.length) {
      setSelectedOccurrenceIndex(Math.max(0, filteredFindings.length - 1));
    }
  }, [filteredFindings.length, selectedOccurrenceIndex]);


  const activeOccurrence = filteredFindings[selectedOccurrenceIndex] || null;

  const editorOccurrences = useMemo(() => {
    return filteredFindings.map(
      (f: any) =>
        ({
          para_index: f.para_index,
          match_start: f.match_start,
          match_end: f.match_end ?? f.match_start + f.surface.length,
          surface: f.surface,
          category: f.category,
          in_stylesheet: f.in_stylesheet,
        }) as Occurrence,
    );
  }, [filteredFindings]);

  // Send navigation command to OnlyOffice when occurrence is selected
  useEffect(() => {
    if (activeOccurrence && viewMode === "onlyoffice" && onlyofficeRef.current?.connector) {
      const { surface } = activeOccurrence;
      if (surface) {
        try {
          onlyofficeRef.current.connector.executeMethod("SearchAndReplace", [
            {
              searchString: surface,
              replaceString: "",
              matchCase: true,
              findNext: true,
            },
          ]);
        } catch (e) {
          console.error("Failed to navigate in OnlyOffice:", e);
        }
      }
    }
  }, [activeOccurrence, viewMode]);

  // When technical apply completes, update editorFileId
  useEffect(() => {
    if (technicalApply.result?.new_file_id) {
      setEditorFileId(technicalApply.result.new_file_id);
    }
  }, [technicalApply.result?.new_file_id]);

  // Clean cache on unmount
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

  // Selection helpers
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

  function handleToggleSingleCheck(key: string) {
    setCheckedIds((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const reviewedCount = useMemo(() => {
    return filteredFindings.filter((f: any) => {
      const key = `${f.para_index}-${f.match_start}-${f.surface}`;
      return key in actionTypes;
    }).length;
  }, [filteredFindings, actionTypes]);

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

  function handleClearDraft() {
    if (!editorFileId) return;
    try {
      localStorage.removeItem(`tr-draft-${editorFileId}`);
    } catch {
      /* ignore */
    }
    const newChecked: Record<string, boolean> = {};
    const newActions: Record<string, "fix" | "highlight"> = {};
    const newCustoms: Record<string, string> = {};
    findings.forEach((f: any) => {
      const key = `${f.para_index}-${f.match_start}-${f.surface}`;
      newChecked[key] = true;
      const isTePoint = f.category === "te_point";
      newActions[key] = isTePoint && f.replacement ? "fix" : "highlight";
      newCustoms[key] = f.replacement ?? "";
    });
    setCheckedIds(newChecked);
    setActionTypes(newActions);
    setCustomReplacements(newCustoms);
    // Clear persisted progress so all findings appear fresh
    setAppliedKeys(new Set());
  }

  function handleReplaceInEditor(occ: any, rep: string, asTrackChanges: boolean, highlightOnly?: boolean) {
    if (!editorRef.current?.replaceOccurrence) return;
    const key = `${occ.para_index}-${occ.match_start}-${occ.surface}`;
    if (appliedKeys.has(key)) return; // Already applied — prevent duplicate replacement!

    const ok = editorRef.current.replaceOccurrence(occ, rep, { asTrackChanges, highlightOnly });
    if (ok) {
      // 1. Mark as applied so it is removed from active findings and cannot be replaced twice
      setAppliedKeys((prev) => new Set([...prev, key]));

      // 2. Remove from checkedIds so ready-to-apply count reduces immediately: 1194 -> 1193 -> ...
      setCheckedIds((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      if (!highlightOnly && rep) {
        setCustomReplacements((prev) => ({ ...prev, [key]: rep }));
      }
      if (asTrackChanges) {
        setActionTypes((prev) => ({ ...prev, [key]: "fix" }));
      } else if (highlightOnly) {
        setActionTypes((prev) => ({ ...prev, [key]: "highlight" }));
      }
    }
  }

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
          rule_id: f.rule_id,
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

  async function handleConfirmApply() {
    if (!pendingApplyLists) return;
    try {
      const res = await technicalApply.apply(
        null,
        pendingApplyLists.selectedList,
        pendingApplyLists.highlightList,
      );
      setConfirmApply(false);

      // Immediately remove applied findings from local checklist state so they disappear from find tabs
      const batchAppliedKeys = new Set(
        [...pendingApplyLists.selectedList, ...pendingApplyLists.highlightList].map(
          (item: any) => `${item.para_index}-${item.match_start}-${item.surface}`,
        ),
      );
      setCheckedIds((prev) => {
        const next = { ...prev };
        batchAppliedKeys.forEach((k) => delete next[k]);
        return next;
      });
      setActionTypes((prev) => {
        const next = { ...prev };
        batchAppliedKeys.forEach((k) => delete next[k]);
        return next;
      });
      setCustomReplacements((prev) => {
        const next = { ...prev };
        batchAppliedKeys.forEach((k) => delete next[k]);
        return next;
      });
      // Also persist bulk-applied keys so they don't re-appear on next page load
      setAppliedKeys((prev) => new Set([...prev, ...batchAppliedKeys]));

      if (editorFileId) {
        try {
          // Don't clear the draft — keep it so remaining progress is preserved
          // The draft save useEffect will persist the updated appliedKeys automatically
        } catch {
          /* ignore */
        }
      }

      setPendingApplyLists(null);

      // Refetch scan findings and fresh XHTML with track changes / highlights
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["technical-review", editorFileId] }),
        queryClient.invalidateQueries({ queryKey: ["file-xhtml", editorFileId] }),
      ]);

      if (res && res.new_file_id && res.new_file_id !== editorFileId) {
        setEditorFileId(res.new_file_id);
        navigate(
          uiPaths.technicalReview(
            normalizedProjectId!,
            normalizedChapterId!,
            res.new_file_id,
          ),
        );
      }
    } catch (e) {
      console.error(e);
    }
  }


  // Keyboard navigation shortcuts
  useEffect(() => {
    if (activeTab !== "reviewer") return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelectedOccurrenceIndex((i) => Math.min(filteredFindings.length - 1, i + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelectedOccurrenceIndex((i) => Math.max(0, i - 1));
      } else if (e.key === " ") {
        e.preventDefault();
        const f = filteredFindings[selectedOccurrenceIndex];
        if (f) {
          const key = `${f.para_index}-${f.match_start}-${f.surface}`;
          setCheckedIds((prev) => ({ ...prev, [key]: !prev[key] }));
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeTab, filteredFindings, selectedOccurrenceIndex]);

  // Route error states
  if (normalizedProjectId === null || normalizedChapterId === null || normalizedFileId === null) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-card p-10 max-w-md w-full text-center space-y-4 border border-slate-200">
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
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="h-14 bg-slate-200 animate-pulse rounded-lg" aria-hidden="true" />
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
      <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-card p-10 max-w-md w-full text-center space-y-4 border border-slate-200">
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
      <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-card p-10 max-w-md w-full text-center space-y-4 border border-slate-200">
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
  // Restore dynamic check instead of hardcoded false
  const onlyoffice_available = technicalReviewQuery.data.onlyoffice_available ?? false;
  const collabora_url = technicalReviewQuery.data.collabora_url;
  const activeStylesheet = technicalReviewQuery.data.active_stylesheet ?? null;
  const activeStylesheetName =
    stylesheetsQuery.data?.stylesheets.find((s) => s.id === selectedStylesheetId)?.name ||
    activeStylesheet?.name ||
    null;

  const activeKey = activeOccurrence
    ? `${activeOccurrence.para_index}-${activeOccurrence.match_start}-${activeOccurrence.surface}`
    : "";

  const selectedCount = Object.values(checkedIds).filter(Boolean).length;

  return (
    <div className="h-screen w-full flex flex-col bg-slate-50 overflow-hidden font-sans">
      {/* Top Header */}
      <TechnicalReviewHeader
        filename={file.filename}
        chapterTitle={`Chapter #${normalizedChapterId}`}
        activeStylesheetName={activeStylesheetName}
        activeTab={activeTab}
        reviewedCount={appliedKeys.size}
        totalFindings={findings.length}
        onTabChange={(tab) => {
          if (tab === "reviewer") {
            const hasStylesheet = !!(activeStylesheet || selectedStylesheetId);
            if (!hasStylesheet) {
              setShowNoStylesheetWarning(true);
              return;
            }
            setShowNoStylesheetWarning(false);
          }
          setActiveTab(tab);
        }}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
        onBack={() => navigate(uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId))}
      />

      {/* No Stylesheet Alert Banner */}
      {showNoStylesheetWarning && (
        <div className="mx-4 mt-2 p-3.5 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-3 shrink-0">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-bold text-amber-900">Active Stylesheet Required</p>
            <p className="text-xs text-amber-800 mt-0.5">
              This project does not have an active editorial stylesheet. Please configure one in{" "}
              <Link
                to={`/projects/${normalizedProjectId}/stylesheets`}
                className="underline font-bold hover:text-amber-950"
              >
                Project Stylesheets
              </Link>{" "}
              before reviewing stylesheet rule occurrences.
            </p>
          </div>
          <button
            onClick={() => setShowNoStylesheetWarning(false)}
            className="text-amber-600 hover:text-amber-800 p-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Apply Status/Error Banner */}
      {technicalApply.statusMessage && (
        <div
          className={`mx-4 mt-2 px-4 py-2.5 rounded-lg text-xs font-semibold border flex items-center justify-between shrink-0 ${
            technicalApply.isPending
              ? "bg-blue-50 border-blue-200 text-blue-800"
              : "bg-emerald-50 border-emerald-200 text-emerald-800"
          }`}
        >
          <span>{technicalApply.statusMessage}</span>
          <button
            onClick={technicalApply.clearMessages}
            className="text-slate-400 hover:text-slate-700"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {technicalApply.errorMessage && (
        <div className="mx-4 mt-2 px-4 py-2.5 rounded-lg text-xs font-semibold border bg-rose-50 border-rose-200 text-rose-800 flex items-center justify-between shrink-0">
          <span>{technicalApply.errorMessage}</span>
          <button
            onClick={technicalApply.clearMessages}
            className="text-rose-400 hover:text-rose-700"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Apply Result Card */}
      {technicalApply.result && (
        <div className="mx-4 mt-2 bg-white rounded-lg border border-emerald-200 p-3 flex items-center justify-between gap-3 shadow-xs shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <CheckCircle className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <span className="font-bold text-slate-900">Modifications Applied: </span>
              <span className="text-slate-600">
                Created version{" "}
                <span className="font-mono font-bold text-slate-800">
                  {technicalApply.result.new_file.filename}
                </span>{" "}
                (File #{technicalApply.result.new_file_id})
              </span>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={technicalApply.clearMessages}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Main Tab Content */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab === "dashboard" ? (
          <OverviewDashboardTab
            findings={findings}
            rawScanData={technicalReviewQuery.data?.raw_scan}
            spellingVariants={(technicalReviewQuery.data?.spelling_summary as any)?.variants || []}
            editorFileId={editorFileId}
            onOpenVersion={(versionId) => {
              setEditorFileId(versionId);
              navigate(
                uiPaths.technicalReview(
                  normalizedProjectId!,
                  normalizedChapterId!,
                  versionId,
                ) + "?tab=dashboard",
              );
            }}
          />
        ) : (
          /* Reviewer Workspace: 3-column layout */
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {/* Left Sidebar: Findings Checklist */}
            <OccurrencesChecklistSidebar
              findings={findings}
              filteredFindings={filteredFindings}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              categoryFilter={categoryFilter}
              onCategoryFilterChange={setCategoryFilter}
              categoriesList={categoriesList}
              stylesheetFilter={stylesheetFilter}
              onStylesheetFilterChange={setStylesheetFilter}
              hasActiveStylesheet={!!selectedStylesheetId}
              selectedOccurrenceIndex={selectedOccurrenceIndex}
              onSelectOccurrenceIndex={setSelectedOccurrenceIndex}
              checkedIds={checkedIds}
              onToggleCheck={handleToggleSingleCheck}
              onToggleAll={handleToggleAll}
              isAllChecked={isAllChecked}
              actionTypes={actionTypes}
              reviewedCount={reviewedCount}
              onClearDraft={handleClearDraft}
              onBatchFixCategory={handleBatchFixCategory}
              isCollapsed={leftSidebarCollapsed}
              onToggleCollapse={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}
            />

            {/* Middle: Manuscript Document Canvas */}
            <main className="flex-1 flex flex-col min-w-0 bg-slate-100 overflow-hidden relative">
              {/* Document Sub-Toolbar */}
              <div className="h-11 bg-white border-b border-slate-200 px-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}
                    className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
                    title={leftSidebarCollapsed ? "Expand Checklist" : "Collapse Checklist"}
                  >
                    {leftSidebarCollapsed ? (
                      <PanelLeftOpen className="w-4 h-4" />
                    ) : (
                      <PanelLeftClose className="w-4 h-4" />
                    )}
                  </button>

                  <div className="h-4 w-px bg-slate-200" />

                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span>Editor</span>
                  </div>
                </div>

                {/* Occurrence Quick Stepper in Center Toolbar */}
                <div className="flex items-center gap-2">
                  {filteredFindings.length > 0 && (
                    <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 px-2 py-1 rounded-md text-xs">
                      <button
                        onClick={() =>
                          setSelectedOccurrenceIndex((i) => Math.max(0, i - 1))
                        }
                        disabled={selectedOccurrenceIndex === 0}
                        className="p-0.5 hover:bg-slate-200 rounded disabled:opacity-30 text-slate-600 transition-colors"
                        title="Previous finding"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="font-mono font-bold text-slate-700 text-[11px] px-1">
                        {selectedOccurrenceIndex + 1} / {filteredFindings.length}
                      </span>
                      <button
                        onClick={() =>
                          setSelectedOccurrenceIndex((i) =>
                            Math.min(filteredFindings.length - 1, i + 1),
                          )
                        }
                        disabled={selectedOccurrenceIndex >= filteredFindings.length - 1}
                        className="p-0.5 hover:bg-slate-200 rounded disabled:opacity-30 text-slate-600 transition-colors"
                        title="Next finding"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="h-4 w-px bg-slate-200" />

                  <button
                    onClick={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}
                    className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
                    title={rightSidebarCollapsed ? "Expand Inspector" : "Collapse Inspector"}
                  >
                    {rightSidebarCollapsed ? (
                      <PanelRightOpen className="w-4 h-4" />
                    ) : (
                      <PanelRightClose className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Document Editor Area */}
              <div className="flex-1 relative min-h-0 overflow-hidden">
                {xhtmlQuery.isPending ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center space-y-3 bg-slate-100">
                    <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
                    <div className="text-sm font-bold text-slate-800">
                      Loading Document Manuscript...
                    </div>
                    <div className="text-xs text-slate-500">
                      Preparing WYSIWYG document layout
                    </div>
                  </div>
                ) : xhtmlQuery.isError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center space-y-3 bg-slate-100">
                    <AlertTriangle className="w-8 h-8 text-rose-500" />
                    <div className="text-sm font-bold text-slate-800">
                      Manuscript View Unavailable
                    </div>
                    <div className="text-xs text-slate-500 max-w-sm">
                      Failed to fetch XHTML document. Verify file conversion status.
                    </div>
                  </div>
                ) : (
                  <WysiwygEditor
                    ref={editorRef}
                    key={`editor-${editorFileId}-${file.version}`}
                    initialContent={xhtmlQuery.data?.content ?? ""}
                    onSave={async (html) => {
                      const res = await editorSave.save(html);
                      if (res && res.file_id && res.file_id !== editorFileId) {
                        setEditorFileId(res.file_id);
                        navigate(
                          uiPaths.technicalReview(
                            normalizedProjectId!,
                            normalizedChapterId!,
                            res.file_id,
                          ),
                        );
                      }
                    }}
                    isSaving={editorSave.isPending}
                    saveLabel="Save Edits to DOCX"
                    documentTitle={file.filename}
                    height="100%"
                    occurrences={editorOccurrences}
                    selectedOccurrenceIndex={selectedOccurrenceIndex}
                    onOccurrenceClick={(idx) => setSelectedOccurrenceIndex(idx)}
                    onSelectionChange={(text) => setSelectedEditorText(text)}
                    onCommentClick={(commentId) => {
                      setRightSidebarTab("comments");
                      setSelectedCommentId(commentId);
                    }}
                    trackChangesEnabled={trackChangesEnabled}
                    onTrackChangesToggle={setTrackChangesEnabled}
                    currentUser={currentUser}
                    fileId={editorFileId?.toString()}
                  />
                )}
              </div>
            </main>

            {/* Right Sidebar: Inspector & Fix Drawer */}
            <OccurrenceInspectorPanel
              activeOccurrence={activeOccurrence}
              totalFindings={filteredFindings.length}
              selectedIndex={selectedOccurrenceIndex}
              onSelectIndex={setSelectedOccurrenceIndex}
              actionType={actionTypes[activeKey] || "fix"}
              onActionTypeChange={(act) =>
                setActionTypes((prev) => ({ ...prev, [activeKey]: act }))
              }
              customReplacement={
                activeKey in customReplacements && customReplacements[activeKey] !== ""
                  ? customReplacements[activeKey]
                  : (activeOccurrence?.replacement ?? "")
              }
              onCustomReplacementChange={(val) =>
                setCustomReplacements((prev) => ({ ...prev, [activeKey]: val }))
              }
              onApplySelected={handleApplySelected}
              isApplying={technicalApply.isPending}
              selectedCount={selectedCount}
              applyWarning={applyWarning}
              editorRef={editorRef}
              rightTab={rightSidebarTab}
              onRightTabChange={setRightSidebarTab}
              isCollapsed={rightSidebarCollapsed}
              onToggleCollapse={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}
              onReplaceInEditor={handleReplaceInEditor}
              comments={comments}
              commentsLoading={commentsLoading}
              newCommentText={newCommentText}
              onNewCommentTextChange={setNewCommentText}
              submittingComment={submittingComment}
              onPostComment={handleCreateComment}
              onToggleResolveComment={handleToggleResolveComment}
              onDeleteComment={handleDeleteComment}
              filterUnresolved={filterUnresolved}
              onToggleFilterUnresolved={() => setFilterUnresolved((v) => !v)}
              selectedEditorText={selectedEditorText}
              selectedCommentId={selectedCommentId}
              onSelectCommentId={(uuid) => {
                setSelectedCommentId(uuid);
                editorRef.current?.scrollToComment(uuid);
              }}
            />
          </div>
        )}
      </div>

      {/* Floating Exit Fullscreen Button */}
      {isFullscreen && (
        <div className="fixed top-3 right-3 z-50">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Minimize2 className="w-3.5 h-3.5" />}
            onClick={() => setIsFullscreen(false)}
            className="shadow-lg bg-white"
          >
            Exit Fullscreen
          </Button>
        </div>
      )}

      {/* Confirmation Modal */}
      <TechnicalApplyConfirmModal
        isOpen={confirmApply}
        onClose={() => {
          setConfirmApply(false);
          setPendingApplyLists(null);
        }}
        onConfirm={handleConfirmApply}
        isPending={technicalApply.isPending}
        fixesCount={pendingApplyLists?.selectedList.length ?? 0}
        highlightsCount={pendingApplyLists?.highlightList.length ?? 0}
      />
    </div>
  );
}
export default TechnicalReviewPage;
