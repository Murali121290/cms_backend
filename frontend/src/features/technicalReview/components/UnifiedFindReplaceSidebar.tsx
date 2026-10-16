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
} from "lucide-react";
import { FindReplaceMasterCard } from "./FindReplaceMasterCard";
import { ChangesReviewPanel } from "@/features/editor";
import type { CommentRecord } from "@/api/comments";

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
  // Comments / Author Queries
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
}: UnifiedFindReplaceSidebarProps) {
  const [activeTab, setActiveTab] = useState<"findReplace" | "comments" | "tracked">("findReplace");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Counts for Category Pills
  const counts = useMemo(() => {
    let teCount = 0;
    let mechCount = 0;
    findings.forEach((f: any) => {
      if (f.category === "te_point") {
        teCount++;
      } else {
        mechCount++;
      }
    });
    return {
      all: findings.length,
      te: teCount,
      mechanical: mechCount,
    };
  }, [findings]);

  if (isCollapsed) {
    return (
      <aside className="w-10 bg-white border-l border-slate-200 flex flex-col items-center py-3 shrink-0 select-none shadow-xs z-30">
        <button
          onClick={onToggleCollapse}
          title="Expand Review Panel"
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
        >
          <PanelRightOpen className="w-4 h-4 text-slate-600" />
        </button>
        <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-bold text-slate-500 mt-6 tracking-wider uppercase">
          Review &amp; Fix ({filteredFindings.length})
        </span>
      </aside>
    );
  }

  return (
    <aside className="w-[390px] xl:w-[420px] bg-white border-l border-slate-200 flex flex-col min-h-0 shrink-0 select-none shadow-md z-30 transition-all">
      {/* 1. Top Tab Bar Header */}
      <div className="p-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
        <div className="flex bg-slate-200/80 p-0.5 rounded-lg text-xs font-semibold flex-1">
          <button
            onClick={() => setActiveTab("findReplace")}
            className={`flex-1 py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === "findReplace"
                ? "bg-white text-slate-900 shadow-xs font-bold"
                : "text-slate-600 hover:text-slate-900 bg-transparent"
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Find &amp; Replace</span>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                activeTab === "findReplace"
                  ? "bg-sky-100 text-sky-800"
                  : "bg-slate-300 text-slate-700"
              }`}
            >
              {filteredFindings.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("comments")}
            className={`flex-1 py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === "comments"
                ? "bg-white text-slate-900 shadow-xs font-bold"
                : "text-slate-600 hover:text-slate-900 bg-transparent"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-violet-600" />
            <span>Comments</span>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                activeTab === "comments"
                  ? "bg-violet-100 text-violet-800"
                  : "bg-slate-300 text-slate-700"
              }`}
            >
              {comments.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("tracked")}
            className={`flex-1 py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === "tracked"
                ? "bg-white text-slate-900 shadow-xs font-bold"
                : "text-slate-600 hover:text-slate-900 bg-transparent"
            }`}
          >
            <span>Tracked</span>
          </button>
        </div>

        <button
          onClick={onToggleCollapse}
          title="Collapse Panel"
          className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-200 transition-colors cursor-pointer shrink-0"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Tab Contents */}
      {activeTab === "findReplace" ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Quick Search & Category Pills Bar */}
          <div className="px-3 py-2 bg-white border-b border-slate-200 flex flex-col gap-2 shrink-0">
            {/* Search Input */}
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search occurrences, context, or rules..."
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500 transition-all"
              />
            </div>

            {/* Category Filter Pills (Technical vs Mechanical) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
              <button
                type="button"
                onClick={() => onCategoryFilterChange("all")}
                className={`px-2.5 py-1 rounded-md text-[10.5px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  categoryFilter === "all"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                }`}
              >
                ALL ({counts.all})
              </button>
              <button
                type="button"
                onClick={() => onCategoryFilterChange("te_point")}
                className={`px-2.5 py-1 rounded-md text-[10.5px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  categoryFilter === "te_point"
                    ? "bg-sky-700 text-white"
                    : "bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200"
                }`}
              >
                TE_POINT ({counts.te})
              </button>
              <button
                type="button"
                onClick={() => onCategoryFilterChange("mechanical")}
                className={`px-2.5 py-1 rounded-md text-[10.5px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  categoryFilter === "mechanical"
                    ? "bg-purple-700 text-white"
                    : "bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200"
                }`}
              >
                MECHANICAL ({counts.mechanical})
              </button>
            </div>
          </div>

          {/* Scrollable Center: The Single Find & Replace Card + Quick Jump Accordion */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-slate-50/50">
            {/* The Single Master Card */}
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
            />

            {/* Quick-Jump Drawer Accordion */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <button
                type="button"
                onClick={() => setIsDrawerOpen(!isDrawerOpen)}
                className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-xs font-bold text-slate-700 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  <span>Browse All Occurrences ({filteredFindings.length})</span>
                </div>
                {isDrawerOpen ? (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {isDrawerOpen && (
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 p-1">
                  {filteredFindings.map((f: any, idx: number) => {
                    const isSelected = idx === selectedIndex;
                    return (
                      <div
                        key={idx}
                        onClick={() => onSelectIndex(idx)}
                        className={`p-2 rounded-lg cursor-pointer transition-colors text-xs flex items-center justify-between gap-2 ${
                          isSelected
                            ? "bg-sky-50 font-semibold border-l-3 border-sky-600"
                            : "hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        <div className="min-w-0 flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-slate-400 w-5 text-right shrink-0">
                            {idx + 1}.
                          </span>
                          <span className="font-mono font-bold text-rose-700 truncate max-w-[120px]">
                            "{f.surface}"
                          </span>
                          {f.replacement && (
                            <>
                              <span className="text-slate-400">→</span>
                              <span className="font-mono font-bold text-emerald-700 truncate max-w-[120px]">
                                "{f.replacement}"
                              </span>
                            </>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                          {f.rule_label || f.rule_id}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Sticky Bottom Apply Footer */}
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
              onClick={onApplySelected}
              disabled={isApplying || selectedCount === 0}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-xs shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
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
      ) : activeTab === "comments" ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {/* Post AQ Box */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <MessageCircle size={14} className="text-violet-600" /> Post Author Query / AQ Comment
              </span>
            </div>

            {/* Attached Selection Badge */}
            {selectedEditorText ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800 flex items-center justify-between shadow-2xs">
                <span className="truncate max-w-[240px]">
                  <strong>Attached to selection:</strong> "{selectedEditorText}"
                </span>
                <span className="text-[9px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">
                  Selected
                </span>
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-500 italic">
                💡 Select text in document editor to attach AQ directly.
              </div>
            )}

            {/* Quick Preset Buttons */}
            <div className="flex flex-wrap gap-1.5">
              {[
                "AQ: Please cite reference in text.",
                "AQ: Define abbreviation on first use.",
                "AQ: Verify numerical data accuracy.",
                "AQ: Confirm author name formatting.",
              ].map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onPostComment?.(preset)}
                  className="px-2 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-medium transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={10} /> {preset}
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              placeholder="Type an Author Query (AQ) comment or editor note..."
              value={newCommentText}
              onChange={(e) => onNewCommentTextChange?.(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"
            />

            <div className="flex justify-end">
              <button
                onClick={() => onPostComment?.()}
                disabled={submittingComment || !newCommentText?.trim()}
                className="px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
              >
                {submittingComment ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />}
                Post AQ Comment
              </button>
            </div>
          </div>

          {/* Filter Header */}
          <div className="flex items-center justify-between px-1 text-xs text-slate-500">
            <span>
              Total Comments: <strong className="text-slate-800">{comments.length}</strong>
            </span>
            <button
              onClick={onToggleFilterUnresolved}
              className={`text-[11px] font-medium transition-colors cursor-pointer ${
                filterUnresolved ? "text-violet-600 underline" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {filterUnresolved ? "Showing Open AQ Only" : "Show Open AQ Only"}
            </button>
          </div>

          {/* Comments List */}
          {commentsLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
              <Loader2 className="animate-spin text-violet-600" size={20} />
              Loading file comments...
            </div>
          ) : comments.filter((c) => !filterUnresolved || !c.resolved).length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-100 p-6 shadow-2xs">
              <MessageSquare size={24} className="mx-auto mb-2 text-slate-300" />
              No comments or author queries found. Post a comment above to get started.
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
                      ? "ring-2 ring-violet-400 border-violet-400 shadow-sm bg-violet-50/20"
                      : comment.resolved
                      ? "bg-slate-50/60 border-slate-100 opacity-60"
                      : "bg-white border-slate-100 shadow-2xs hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-violet-100 text-violet-700 font-bold text-[9px] flex items-center justify-center">
                        {(comment.author_name || "AQ").slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-800">
                          {comment.author_name || "Reviewer"}
                        </div>
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
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteComment?.(comment.comment_uuid);
                      }}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
                      title="Delete comment"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <ChangesReviewPanel editor={editorRef.current?.editor} />
        </div>
      )}
    </aside>
  );
}
