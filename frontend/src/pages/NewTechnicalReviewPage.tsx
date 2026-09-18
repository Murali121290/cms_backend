import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/SkeletonLoader";
import { getApiErrorMessage } from "@/api/client";
import { WysiwygEditor, useEditorSave, type Occurrence } from "@/features/editor";
import { useFileXhtmlQuery } from "@/features/technicalReview/useFileXhtmlQuery";
import { useStylesheetsQuery } from "@/features/stylesheets/useStylesheetsQuery";
import { useTechnicalApply } from "@/features/technicalReview/useTechnicalApply";
import { useTechnicalReviewQuery } from "@/features/technicalReview/useTechnicalReviewQuery";
import { LeftTechnicalSidebarTable } from "@/features/technicalReview/components/LeftTechnicalSidebarTable";
import { OccurrenceInspectorPanel } from "@/features/technicalReview/components/OccurrenceInspectorPanel";
import { TechnicalApplyConfirmModal } from "@/features/technicalReview/components/TechnicalApplyConfirmModal";
import { useSessionStore } from "@/stores/sessionStore";

interface NewTechnicalReviewPageProps {
  projectId: number;
  chapterId: number;
  fileId: number;
  onComplete: (result: { fileId: number }) => void;
}

// Sub-view rendered by UnifiedReviewEditorPage for the Technical Editing
// stage. OccurrencesChecklistSidebar and OccurrenceInspectorPanel are fully
// controlled ("dumb") components — TechnicalReviewPage.tsx owns all of the
// filtering/selection/apply orchestration around them, so that logic is
// ported here verbatim (same derivations, same handlers) rather than
// rebuilt differently, giving full feature parity. Only the alternate
// OnlyOffice/Collabora view modes, the Dashboard tab, and fullscreen are
// dropped — this unified workflow only uses the local WYSIWYG editor.
export function NewTechnicalReviewPage({ projectId, chapterId, fileId, onComplete }: NewTechnicalReviewPageProps) {
  const queryClient = useQueryClient();

  const [selectedStylesheetId, setSelectedStylesheetId] = useState<number | null>(null);
  const [editorFileId, setEditorFileId] = useState<number>(fileId);

  const technicalReviewQuery = useTechnicalReviewQuery(editorFileId, selectedStylesheetId);
  const stylesheetsQuery = useStylesheetsQuery(projectId);
  const technicalApply = useTechnicalApply({ projectId, chapterId, fileId: editorFileId });
  const editorSave = useEditorSave(editorFileId);
  const xhtmlQuery = useFileXhtmlQuery(editorFileId);
  const editorRef = useRef<any>(null);
  const currentUser = useSessionStore((s) => s.viewer)?.username;

  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [stylesheetFilter, setStylesheetFilter] = useState<"all" | "in_stylesheet" | "other">("all");

  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [actionTypes, setActionTypes] = useState<Record<string, "fix" | "highlight">>({});
  const [customReplacements, setCustomReplacements] = useState<Record<string, string>>({});
  const [selectedOccurrenceIndex, setSelectedOccurrenceIndex] = useState<number>(0);
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());
  const [trackChangesEnabled, setTrackChangesEnabled] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<"findings" | "trackedChanges">("findings");

  const [applyWarning, setApplyWarning] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [pendingApplyLists, setPendingApplyLists] = useState<{
    selectedList: any[];
    highlightList: any[];
  } | null>(null);

  const hasAutoSelectedStylesheet = useRef(false);

  const findings = useMemo(() => {
    const raw = technicalReviewQuery.data?.findings ?? [];
    return [...raw].sort((a: any, b: any) => {
      if (a.para_index !== b.para_index) return a.para_index - b.para_index;
      return a.match_start - b.match_start;
    });
  }, [technicalReviewQuery.data]);

  useEffect(() => {
    if (!hasAutoSelectedStylesheet.current && technicalReviewQuery.data?.active_stylesheet?.id) {
      setSelectedStylesheetId(technicalReviewQuery.data.active_stylesheet.id);
      hasAutoSelectedStylesheet.current = true;
    }
  }, [technicalReviewQuery.data?.active_stylesheet?.id]);

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
        const savedApplied: string[] = Array.isArray(draft.appliedKeys) ? draft.appliedKeys : [];
        setAppliedKeys(new Set(savedApplied));
        const savedIdx: number = typeof draft.selectedIndex === "number" ? draft.selectedIndex : 0;
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
          appliedKeys: Array.from(appliedKeys),
          selectedIndex: selectedOccurrenceIndex,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [checkedIds, actionTypes, customReplacements, appliedKeys, selectedOccurrenceIndex, editorFileId]);

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
    setAppliedKeys(new Set());
  }

  function handleReplaceInEditor(occ: any, rep: string, asTrackChanges: boolean, highlightOnly?: boolean) {
    if (!editorRef.current?.replaceOccurrence) return;
    const key = `${occ.para_index}-${occ.match_start}-${occ.surface}`;
    if (appliedKeys.has(key)) return;

    const ok = editorRef.current.replaceOccurrence(occ, rep, { asTrackChanges, highlightOnly });
    if (ok) {
      setAppliedKeys((prev) => new Set([...prev, key]));
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
      setAppliedKeys((prev) => new Set([...prev, ...batchAppliedKeys]));
      setPendingApplyLists(null);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["technical-review", editorFileId] }),
        queryClient.invalidateQueries({ queryKey: ["file-xhtml", editorFileId] }),
      ]);

      const nextFileId = res && res.new_file_id ? res.new_file_id : editorFileId;
      if (nextFileId !== editorFileId) {
        setEditorFileId(nextFileId);
      }
      // Applying is the completion signal for the Technical stage.
      onComplete({ fileId: nextFileId });
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
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
  }, [filteredFindings, selectedOccurrenceIndex]);

  if (technicalReviewQuery.isPending) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <SkeletonCard />
      </div>
    );
  }

  if (technicalReviewQuery.isError || !technicalReviewQuery.data) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <div className="bg-white rounded-xl shadow-card p-10 max-w-md w-full text-center space-y-4 border border-slate-200">
          <EmptyState
            title="Technical review unavailable"
            description={getApiErrorMessage(
              technicalReviewQuery.error,
              "The technical review contract returned no data.",
            )}
          />
        </div>
      </div>
    );
  }

  const file = technicalReviewQuery.data.file;
  const activeKey = activeOccurrence
    ? `${activeOccurrence.para_index}-${activeOccurrence.match_start}-${activeOccurrence.surface}`
    : "";
  const selectedCount = Object.values(checkedIds).filter(Boolean).length;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-50">
      {stylesheetsQuery.data && !selectedStylesheetId && !technicalReviewQuery.data.active_stylesheet && (
        <div className="mx-4 mt-2 p-3.5 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-3 shrink-0">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 text-xs font-bold text-amber-900">
            This project does not have an active editorial stylesheet. Configure one in Project Stylesheets before
            reviewing stylesheet rule occurrences.
          </div>
        </div>
      )}

      {technicalApply.statusMessage && (
        <div className="mx-4 mt-2 px-4 py-2.5 rounded-lg text-xs font-semibold border bg-blue-50 border-blue-200 text-blue-800 shrink-0">
          {technicalApply.statusMessage}
        </div>
      )}
      {technicalApply.errorMessage && (
        <div className="mx-4 mt-2 px-4 py-2.5 rounded-lg text-xs font-semibold border bg-rose-50 border-rose-200 text-rose-800 shrink-0">
          {technicalApply.errorMessage}
        </div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <LeftTechnicalSidebarTable
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

        <main className="flex-1 flex flex-col min-w-0 bg-slate-100 overflow-hidden relative">
          <div className="flex-1 relative min-h-0 overflow-hidden">
            {xhtmlQuery.isPending ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center space-y-3 bg-slate-100">
                <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
                <div className="text-sm font-bold text-slate-800">Loading Document Manuscript...</div>
              </div>
            ) : (
              <WysiwygEditor
                ref={editorRef}
                key={`unified-technical-${editorFileId}-${file.version}`}
                initialContent={xhtmlQuery.data?.content ?? ""}
                onSave={async (html) => {
                  const res = await editorSave.save(html);
                  if (res && res.file_id && res.file_id !== editorFileId) {
                    setEditorFileId(res.file_id);
                  }
                }}
                isSaving={editorSave.isPending}
                saveLabel="Save Edits to DOCX"
                documentTitle={file.filename}
                height="100%"
                occurrences={editorOccurrences}
                selectedOccurrenceIndex={selectedOccurrenceIndex}
                onOccurrenceClick={(idx) => setSelectedOccurrenceIndex(idx)}
                trackChangesEnabled={trackChangesEnabled}
                onTrackChangesToggle={setTrackChangesEnabled}
                currentUser={currentUser}
                fileId={editorFileId.toString()}
              />
            )}
          </div>
        </main>

        <OccurrenceInspectorPanel
          activeOccurrence={activeOccurrence}
          totalFindings={filteredFindings.length}
          selectedIndex={selectedOccurrenceIndex}
          onSelectIndex={setSelectedOccurrenceIndex}
          actionType={actionTypes[activeKey] || "fix"}
          onActionTypeChange={(act) => setActionTypes((prev) => ({ ...prev, [activeKey]: act }))}
          customReplacement={
            activeKey in customReplacements && customReplacements[activeKey] !== ""
              ? customReplacements[activeKey]
              : (activeOccurrence?.replacement ?? "")
          }
          onCustomReplacementChange={(val) => setCustomReplacements((prev) => ({ ...prev, [activeKey]: val }))}
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
        />
      </div>

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
