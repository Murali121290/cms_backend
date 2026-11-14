import React, { useState, useMemo } from "react";
import {
  Search,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
  MessageSquare,
  MessageCircle,
  Plus,
  Trash2,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Filter,
  BookOpen,
  FileText,
  Sliders,
  CheckCheck,
  Zap,
  ShieldAlert,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { FindReplaceMasterCard } from "./FindReplaceMasterCard";
import { ChangesReviewPanel } from "@/features/editor";
import type { CommentRecord } from "@/api/comments";
import type { CERule, StylesheetSummary } from "@/types/api";

export type RightDockTab = "findings" | "inspector" | "queries" | "rules" | "tracked";

export interface UnifiedFindReplaceSidebarProps {
  findings: any[];
  filteredFindings: any[];
  activeOccurrence: any | null;
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
  searchTerm: string;
  onSearchChange: (val: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (cat: string) => void;
  actionType: "fix" | "highlight";
  onActionTypeChange: (action: "fix" | "highlight") => void;
  customReplacement: string;
  onCustomReplacementChange: (val: string) => void;
  onReplaceAndNext: (rep: string, asTrackChanges: boolean) => void;
  onHighlightAndNext: () => void;
  onSkipNext: () => void;
  onBatchFixRule?: (ruleId: string, replacement: string) => void;
  onApplySelected: () => void;
  isApplying: boolean;
  selectedCount: number;
  applyWarning: string | null;
  editorRef: any;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  stylesheetFilter?: "all" | "in_stylesheet" | "other";
  onStylesheetFilterChange?: (filter: "all" | "in_stylesheet" | "other") => void;
  hasActiveStylesheet?: boolean;
  activeStylesheetName?: string | null;
  activeStylesheet?: StylesheetSummary | null;
  selectedRuleFilter?: string | null;
  onSelectedRuleFilterChange?: (ruleKey: string | null) => void;
  comments?: CommentRecord[];
  commentsLoading?: boolean;
  newCommentText?: string;
  onNewCommentTextChange?: (val: string) => void;
  submittingComment?: boolean;
  onPostComment?: (customText?: string) => void;
  onToggleResolveComment?: (uuid: string, currentResolved: boolean) => void;
  onDeleteComment?: (uuid: string) => void;
  filterUnresolved?: boolean;
  onToggleFilterUnresolved?: () => void;
  selectedEditorText?: string;
  selectedCommentId?: string | null;
  onSelectCommentId?: (uuid: string) => void;
  // Consolidated 4-Tab Dock props
  activeTab?: RightDockTab;
  onActiveTabChange?: (tab: RightDockTab) => void;
  rules?: CERule[];
  onQuickFixFinding?: (finding: any) => void;
}

export function UnifiedFindReplaceSidebar({
  findings,
  filteredFindings,
  activeOccurrence,
  selectedIndex,
  onSelectIndex,
  searchTerm,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  actionType,
  onActionTypeChange,
  customReplacement,
  onCustomReplacementChange,
  onReplaceAndNext,
  onHighlightAndNext,
  onSkipNext,
  onBatchFixRule,
  onApplySelected,
  isApplying,
  selectedCount,
  applyWarning,
  editorRef,
  isCollapsed,
  onToggleCollapse,
  stylesheetFilter = "all",
  onStylesheetFilterChange,
  hasActiveStylesheet = false,
  activeStylesheetName = null,
  activeStylesheet = null,
  selectedRuleFilter = null,
  onSelectedRuleFilterChange,
  comments = [],
  commentsLoading = false,
  newCommentText = "",
  onNewCommentTextChange,
  submittingComment = false,
  onPostComment,
  onToggleResolveComment,
  onDeleteComment,
  filterUnresolved = false,
  onToggleFilterUnresolved,
  selectedEditorText = "",
  selectedCommentId = null,
  onSelectCommentId,
  activeTab: externalTab,
  onActiveTabChange,
  rules = [],
  onQuickFixFinding,
}: UnifiedFindReplaceSidebarProps) {
  const [internalTab, setInternalTab] = useState<RightDockTab>("findings");
  const activeTab = externalTab ?? internalTab;

  const handleTabChange = (tab: RightDockTab) => {
    if (onActiveTabChange) onActiveTabChange(tab);
    else setInternalTab(tab);
  };

  const [rulesSearch, setRulesSearch] = useState("");

  // Counts for Category and House Style Pills
  const counts = useMemo(() => {
    let redFlags = 0;
    let eponyms = 0;
    let houseStyle = 0;
    let inSsCount = 0;

    findings.forEach((f: any) => {
      const isRf = f.ce_rule_no === 125 || f.category === "red_flag" || f.rule_id === "red_flag";
      const isEp = f.ce_rule_no === 124 || f.rule_id === "eponyms";
      if (isRf) redFlags++;
      else if (isEp) eponyms++;
      else houseStyle++;

      if (f.in_stylesheet === true) inSsCount++;
    });

    return {
      all: findings.length,
      redFlags,
      eponyms,
      houseStyle,
      in_stylesheet: inSsCount,
    };
  }, [findings]);

  // Filtered Rules for Reference Tab
  const filteredRules = useMemo(() => {
    if (!rulesSearch.trim()) return rules;
    const q = rulesSearch.toLowerCase().trim();
    return rules.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        String(r.sno).includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        (r.group || "").toLowerCase().includes(q)
    );
  }, [rules, rulesSearch]);

  if (isCollapsed) {
    return (
      <aside className="w-10 bg-white border-l border-slate-200 flex flex-col items-center py-3 shrink-0 select-none shadow-xs z-30">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand Tools Dock"
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
        >
          <PanelRightOpen className="w-4 h-4 text-indigo-600" />
        </button>
        <div className="mt-8 flex flex-col items-center gap-6">
          <button
            type="button"
            onClick={() => {
              onToggleCollapse();
              handleTabChange("findings");
            }}
            className="[writing-mode:vertical-rl] rotate-180 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer flex items-center gap-1.5"
          >
            <span>Findings</span>
            <span className="bg-slate-200 text-slate-800 px-1 py-0.5 rounded text-[10px]">
              {filteredFindings.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onToggleCollapse();
              handleTabChange("inspector");
            }}
            className="[writing-mode:vertical-rl] rotate-180 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer flex items-center gap-1.5"
          >
            <span>Inspector</span>
            {activeOccurrence?.ce_rule_no && (
              <span className="bg-amber-100 text-amber-800 px-1 py-0.5 rounded text-[10px]">
                R{activeOccurrence.ce_rule_no}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              onToggleCollapse();
              handleTabChange("queries");
            }}
            className="[writing-mode:vertical-rl] rotate-180 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer flex items-center gap-1.5"
          >
            <span>Queries (AQ)</span>
            <span className="bg-amber-100 text-amber-800 px-1 py-0.5 rounded text-[10px]">
              {comments.length}
            </span>
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-96 md:w-[420px] xl:w-[460px] bg-white border-l border-slate-200 flex flex-col min-h-0 shrink-0 z-20 shadow-md">
      {/* 1. Header with Consolidated 4-Tab Navigation */}
      <div className="p-2 border-b border-slate-200 bg-slate-50/90 flex items-center justify-between gap-1 shrink-0">
        <nav className="grid grid-cols-4 gap-1 p-1 bg-slate-200/80 rounded-xl text-xs font-semibold text-slate-600 flex-1 mr-1">
          {/* TAB 1: FINDINGS */}
          <button
            type="button"
            onClick={() => handleTabChange("findings")}
            className={`py-1.5 px-1 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all text-center cursor-pointer ${
              activeTab === "findings"
                ? "bg-white text-slate-900 shadow-xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span className="truncate text-[11px]">Findings</span>
            <span
              className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded-full ${
                activeTab === "findings"
                  ? "bg-indigo-100 text-indigo-900"
                  : "bg-slate-300/70 text-slate-700"
              }`}
            >
              {filteredFindings.length}
            </span>
          </button>

          {/* TAB 2: INSPECTOR */}
          <button
            type="button"
            onClick={() => handleTabChange("inspector")}
            className={`py-1.5 px-1 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all text-center cursor-pointer ${
              activeTab === "inspector"
                ? "bg-white text-slate-900 shadow-xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span className="truncate text-[11px]">Inspector</span>
            <span
              className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded-full ${
                activeOccurrence?.ce_rule_no
                  ? "bg-amber-100 text-amber-900"
                  : "bg-slate-300/70 text-slate-700"
              }`}
            >
              {activeOccurrence?.ce_rule_no ? `R${activeOccurrence.ce_rule_no}` : "Focus"}
            </span>
          </button>

          {/* TAB 3: AUTHOR QUERIES (AQ) */}
          <button
            type="button"
            onClick={() => handleTabChange("queries")}
            className={`py-1.5 px-1 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all text-center cursor-pointer ${
              activeTab === "queries"
                ? "bg-white text-slate-900 shadow-xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span className="truncate text-[11px]">Queries AQ</span>
            <span
              className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded-full ${
                comments.length > 0
                  ? "bg-amber-100 text-amber-900"
                  : "bg-slate-300/70 text-slate-700"
              }`}
            >
              {comments.length}
            </span>
          </button>

          {/* TAB 4: RULES REF */}
          <button
            type="button"
            onClick={() => handleTabChange("rules")}
            className={`py-1.5 px-1 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all text-center cursor-pointer ${
              activeTab === "rules"
                ? "bg-white text-slate-900 shadow-xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span className="truncate text-[11px]">Rules Ref</span>
            <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-900">
              {rules.length || 106}
            </span>
          </button>
        </nav>

        <button
          type="button"
          onClick={onToggleCollapse}
          title="Collapse Tools Dock"
          className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer shrink-0"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* 2. TAB CONTENT PANES */}

      {/* ----------------------------------------------------------------- */}
      {/* PANE 1: FINDINGS OCCURRENCE CHECKLIST TAB                        */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === "findings" && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Search & Category Filter Controls */}
          <div className="p-3 border-b border-slate-200 bg-white space-y-2 shrink-0">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search occurrences, context, or rules..."
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white transition-all"
              />
            </div>

            {/* Category Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => onCategoryFilterChange("all")}
                className={`px-2.5 py-0.5 rounded-full transition-all cursor-pointer whitespace-nowrap ${
                  categoryFilter === "all"
                    ? "bg-slate-900 text-white font-bold"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                }`}
              >
                All ({counts.all})
              </button>
              <button
                type="button"
                onClick={() => onCategoryFilterChange("redflag")}
                className={`px-2.5 py-0.5 rounded-full transition-all cursor-pointer whitespace-nowrap font-bold ${
                  categoryFilter === "redflag"
                    ? "bg-rose-600 text-white"
                    : "bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200"
                }`}
              >
                Red Flags ({counts.redFlags})
              </button>
              <button
                type="button"
                onClick={() => onCategoryFilterChange("eponym")}
                className={`px-2.5 py-0.5 rounded-full transition-all cursor-pointer whitespace-nowrap ${
                  categoryFilter === "eponym"
                    ? "bg-amber-600 text-white font-bold"
                    : "bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200"
                }`}
              >
                Eponyms ({counts.eponyms})
              </button>
              <button
                type="button"
                onClick={() => onCategoryFilterChange("style")}
                className={`px-2.5 py-0.5 rounded-full transition-all cursor-pointer whitespace-nowrap ${
                  categoryFilter === "style"
                    ? "bg-indigo-600 text-white font-bold"
                    : "bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200"
                }`}
              >
                House Style ({counts.houseStyle})
              </button>
            </div>

            {/* Stylesheet Scope Toggle */}
            {hasActiveStylesheet && (
              <div className="flex items-center bg-slate-100 p-0.5 rounded-md text-[10.5px] font-semibold">
                <button
                  type="button"
                  onClick={() => onStylesheetFilterChange?.("in_stylesheet")}
                  className={`flex-1 py-0.5 px-2 rounded text-center transition-all cursor-pointer ${
                    stylesheetFilter === "in_stylesheet"
                      ? "bg-white text-indigo-900 shadow-2xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Stylesheet Only ({counts.in_stylesheet})
                </button>
                <button
                  type="button"
                  onClick={() => onStylesheetFilterChange?.("all")}
                  className={`flex-1 py-0.5 px-2 rounded text-center transition-all cursor-pointer ${
                    stylesheetFilter === "all"
                      ? "bg-white text-slate-900 shadow-2xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  All Scanned ({counts.all})
                </button>
              </div>
            )}
          </div>

          {/* Findings Cards List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/50">
            {filteredFindings.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <p className="font-semibold text-slate-700">No occurrences in current filter.</p>
                <p className="text-[11px] text-slate-400 mt-1">All items matching your filter are resolved or compliant.</p>
              </div>
            ) : (
              filteredFindings.map((f: any, idx: number) => {
                const isSelected = selectedIndex === idx;
                const isRedFlag = f.ce_rule_no === 125 || f.category === "red_flag" || f.rule_id === "red_flag";
                const isEponym = f.ce_rule_no === 124 || f.rule_id === "eponyms";

                return (
                  <div
                    key={`${f.para_index}-${f.match_start}-${idx}`}
                    onClick={() => {
                      onSelectIndex(idx);
                      handleTabChange("inspector");
                    }}
                    className={`p-3 rounded-xl border transition-all cursor-pointer text-xs ${
                      isSelected
                        ? "bg-white border-indigo-500 shadow-sm ring-1 ring-indigo-500"
                        : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-2xs"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-mono font-bold text-[10px] px-1.5 py-0.2 rounded border ${
                            isRedFlag
                              ? "bg-rose-100 text-rose-800 border-rose-300"
                              : isEponym
                              ? "bg-amber-100 text-amber-800 border-amber-300"
                              : "bg-sky-100 text-sky-800 border-sky-300"
                          }`}
                        >
                          {f.ce_rule_no ? `R${f.ce_rule_no}` : f.rule_label || "Rule"}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">
                          ¶ {f.para_index}
                        </span>
                      </div>

                      {/* Quick Fix Button */}
                      {(f.replacement || f.suggestion) && !isRedFlag && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectIndex(idx);
                            if (onQuickFixFinding) onQuickFixFinding(f);
                            else onReplaceAndNext(f.replacement || f.suggestion, true);
                          }}
                          className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 transition-colors flex items-center gap-1 cursor-pointer"
                          title="Apply house style fix in 1-click"
                        >
                          <Zap className="w-2.5 h-2.5 text-emerald-600" />
                          <span>Quick Fix</span>
                        </button>
                      )}

                      {f.ia_element && (
                        <span className="text-[10px] font-bold text-sky-800 bg-sky-50 border border-sky-200 px-1.5 py-0.2 rounded truncate max-w-[130px]" title={`IA Rule: ${f.ia_element} (${f.ia_pattern || f.ia_subtype})`}>
                          IA: {f.ia_element}
                        </span>
                      )}

                      {isRedFlag && (
                        <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.2 rounded">
                          AQ Required
                        </span>
                      )}
                    </div>

                    {/* Term Replacement Comparison */}
                    <div className="flex items-center gap-1.5 font-mono text-[11px] mb-1">
                      <span className="text-rose-700 line-through bg-rose-50 px-1 py-0.2 rounded font-semibold truncate max-w-[150px]">
                        {f.surface}
                      </span>
                      {(f.replacement || f.suggestion) && (
                        <>
                          <span className="text-slate-400">→</span>
                          <span className="text-emerald-800 bg-emerald-50 px-1 py-0.2 rounded font-bold truncate max-w-[150px]">
                            {f.replacement || f.suggestion}
                          </span>
                        </>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-500 leading-snug truncate" title={f.suggestion || f.rule_label}>
                      {f.suggestion ? `Suggestion: "${f.suggestion}"` : f.rule_label || "Formatting deviates from house style standard."}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          {/* Sticky Apply Selected Bar */}
          <div className="p-3 border-t border-slate-200 bg-white space-y-2 shrink-0">
            {applyWarning && (
              <div className="p-2 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                <span>{applyWarning}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
              <span>Ready to apply:</span>
              <span className="font-bold text-slate-900">{selectedCount} items</span>
            </div>
            <button
              type="button"
              onClick={onApplySelected}
              disabled={isApplying || selectedCount === 0}
              className="w-full py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-xs shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {isApplying ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Applying Changes...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Apply {selectedCount} Selected Changes</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* PANE 2: OCCURRENCE INSPECTOR TAB                                 */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === "inspector" && (
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-slate-50/50">
          <FindReplaceMasterCard
            activeOccurrence={activeOccurrence}
            totalFindings={filteredFindings.length}
            selectedIndex={selectedIndex}
            onSelectIndex={onSelectIndex}
            actionType={actionType}
            onActionTypeChange={onActionTypeChange}
            customReplacement={customReplacement}
            onCustomReplacementChange={onCustomReplacementChange}
            onReplaceAndNext={onReplaceAndNext}
            onHighlightAndNext={onHighlightAndNext}
            onSkipNext={onSkipNext}
            onBatchFixRule={onBatchFixRule}
            onFilterByRule={(rule) =>
              onSelectedRuleFilterChange?.(selectedRuleFilter === rule ? null : rule)
            }
            isFilteredByRule={Boolean(selectedRuleFilter)}
          />

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => handleTabChange("findings")}
              className="text-xs text-indigo-600 hover:underline font-semibold"
            >
              ← Back to Findings Checklist ({filteredFindings.length})
            </button>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* PANE 3: AUTHOR QUERIES (AQ) TAB                                  */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === "queries" && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3.5">
          {/* Post AQ Box */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <MessageCircle size={14} className="text-indigo-600" /> Post Author Query (AQ)
              </span>
              <span className="text-[10px] text-slate-400 font-medium">Marginal proof note</span>
            </div>

            {/* Attached Selection Badge */}
            {selectedEditorText ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800 flex items-center justify-between shadow-2xs">
                <span className="truncate max-w-[240px]">
                  <strong>Attached to text:</strong> "{selectedEditorText}"
                </span>
                <span className="text-[9px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">
                  Targeted
                </span>
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-[11px] text-slate-500 italic">
                💡 Select text in manuscript to attach AQ directly to a paragraph.
              </div>
            )}

            {/* Quick Preset Buttons */}
            <div className="flex flex-wrap gap-1.5">
              {[
                "AU: Please review inclusion of Campinha-Bacote cultural competence model per publisher guidelines.",
                "AU: Please confirm permissions clearance for direct quotation from DSM.",
                "AU: Replace Wikipedia citation with scholarly peer-reviewed source.",
                "AU: Verify nonpossessive medical eponym formatting.",
              ].map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onPostComment?.(preset)}
                  className="px-2 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-medium transition-colors flex items-center gap-1 cursor-pointer truncate max-w-full text-left"
                >
                  <Plus size={10} className="shrink-0" /> <span className="truncate">{preset}</span>
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              placeholder="Type an Author Query (AQ) comment or editor note..."
              value={newCommentText}
              onChange={(e) => onNewCommentTextChange?.(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none font-sans"
            />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onPostComment?.()}
                disabled={submittingComment || !newCommentText?.trim()}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
              >
                {submittingComment ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />}
                <span>Post AQ Comment</span>
              </button>
            </div>
          </div>

          {/* Filter Header */}
          <div className="flex items-center justify-between px-1 text-xs text-slate-500">
            <span>
              Total Queries: <strong className="text-slate-800">{comments.length}</strong>
            </span>
            <button
              type="button"
              onClick={onToggleFilterUnresolved}
              className={`text-[11px] font-medium transition-colors cursor-pointer ${
                filterUnresolved ? "text-indigo-600 underline font-bold" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {filterUnresolved ? "Showing Open AQ Only" : "Show Open AQ Only"}
            </button>
          </div>

          {/* Comments List */}
          {commentsLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
              <Loader2 className="animate-spin text-indigo-600" size={20} />
              <span>Loading author queries...</span>
            </div>
          ) : comments.filter((c) => !filterUnresolved || !c.resolved).length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200 p-6 shadow-2xs">
              <MessageSquare size={24} className="mx-auto mb-2 text-slate-300" />
              <span>No author queries recorded. Post a query above to attach to manuscript.</span>
            </div>
          ) : (
            comments
              .filter((c) => !filterUnresolved || !c.resolved)
              .map((comment) => (
                <div
                  key={comment.comment_uuid}
                  onClick={() => onSelectCommentId?.(comment.comment_uuid)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    selectedCommentId === comment.comment_uuid
                      ? "ring-2 ring-indigo-400 border-indigo-400 shadow-sm bg-indigo-50/20"
                      : comment.resolved
                      ? "bg-slate-50/60 border-slate-100 opacity-60"
                      : "bg-white border-slate-200 shadow-2xs hover:shadow-xs"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-800 font-bold text-[9px] flex items-center justify-center">
                        {(comment.author_name || "AQ").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="text-xs font-semibold text-slate-800">
                        {comment.author_name || "Author Query"}
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[9px] font-semibold ${
                        comment.resolved
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                          : "bg-amber-50 text-amber-700 border border-amber-100"
                      }`}
                    >
                      {comment.resolved ? "Resolved" : "Open AQ"}
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed mb-2.5">
                    {comment.text}
                  </p>

                  <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleResolveComment?.(comment.comment_uuid, comment.resolved);
                      }}
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-colors flex items-center gap-1 cursor-pointer ${
                        comment.resolved
                          ? "text-slate-500 hover:text-slate-800 bg-slate-100"
                          : "text-emerald-700 hover:bg-emerald-100 bg-emerald-50 border border-emerald-200"
                      }`}
                    >
                      <CheckCircle2 size={11} />
                      {comment.resolved ? "Reopen AQ" : "Resolve AQ"}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteComment?.(comment.comment_uuid);
                      }}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
                      title="Delete query"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* PANE 4: STYLE RULES REFERENCE TAB                                */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === "rules" && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="p-3 border-b border-slate-200 bg-white shrink-0 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search rules catalog (e.g. R6, percentage, eponym)..."
                value={rulesSearch}
                onChange={(e) => setRulesSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white transition-all"
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Active Catalog: <strong>{filteredRules.length} rules</strong></span>
              {activeStylesheetName && (
                <div className="flex items-center gap-1.5 truncate max-w-[200px]" title="Active Stylesheet loaded from CE support/stylesheet.json">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                  <span className="text-emerald-800 font-semibold truncate text-[11px]">
                    {activeStylesheetName}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/50">
            {filteredRules.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-400">No matching rules found in catalog.</p>
            ) : (
              filteredRules.map((rule) => {
                const setting = (activeStylesheet?.ce_rules as any)?.[String(rule.sno)] || (activeStylesheet?.ce_rules as any)?.[rule.sno];
                const isEnabled = setting ? setting.enabled !== false : rule.default_enabled !== false;
                const activeOptIdx = setting?.option ?? 1;
                const activeOptionLabel = rule.options?.[activeOptIdx - 1] || `Option ${activeOptIdx}`;
                const violationCount = findings.filter((f: any) => f.ce_rule_no === rule.sno).length;

                return (
                  <div
                    key={rule.sno}
                    onClick={() => {
                      if (violationCount > 0) {
                        onSelectedRuleFilterChange?.(`R${rule.sno}`);
                        handleTabChange("findings");
                      }
                    }}
                    className={`p-3 bg-white border rounded-xl shadow-2xs hover:shadow-xs transition-all text-xs space-y-2 ${
                      violationCount > 0
                        ? "border-amber-300 ring-1 ring-amber-200/50 cursor-pointer hover:border-amber-400"
                        : "border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded text-[10.5px]">
                          R{rule.sno}
                        </span>
                        <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                          {rule.group}
                        </span>
                      </div>

                      {violationCount > 0 ? (
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1 hover:bg-rose-100 transition-colors"
                          title="Click to view occurrences in manuscript"
                        >
                          <AlertTriangle className="w-2.5 h-2.5 text-rose-500" />
                          <span>{violationCount} {violationCount === 1 ? "violation" : "violations"}</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                          <span>0 findings</span>
                        </span>
                      )}
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-900 text-xs">{rule.name}</h4>
                      <p className="text-[11px] text-slate-600 leading-snug mt-0.5">{rule.description}</p>
                    </div>

                    {/* Active House Style Option from Stylesheet */}
                    {activeStylesheet && (
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between text-[11px]">
                        <span className="text-slate-500 font-medium">House Style Choice:</span>
                        <span className={`font-semibold px-2 py-0.5 rounded ${
                          isEnabled
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10.5px]"
                            : "bg-slate-200 text-slate-600"
                        }`}>
                          {isEnabled ? activeOptionLabel : "Disabled in Stylesheet"}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                      <span>Handling: <strong>{rule.handling}</strong></span>
                      <span>Severity: <strong>{setting?.severity || rule.severity}</strong></span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* PANE 5: TRACKED CHANGES REVIEW TAB                               */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === "tracked" && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <ChangesReviewPanel editor={editorRef.current?.editor} />
        </div>
      )}
    </aside>
  );
}
