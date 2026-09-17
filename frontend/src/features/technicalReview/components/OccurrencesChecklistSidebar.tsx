import React, { useRef, useEffect } from "react";
import { Search, CheckSquare, Square, ChevronLeft, RotateCcw } from "lucide-react";
import { OccurrenceChecklistCard } from "./OccurrenceChecklistCard";

interface OccurrencesChecklistSidebarProps {
  findings: any[];
  filteredFindings: any[];
  searchTerm: string;
  onSearchChange: (val: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (cat: string) => void;
  categoriesList: string[];
  stylesheetFilter: "all" | "in_stylesheet" | "other";
  onStylesheetFilterChange: (filter: "all" | "in_stylesheet" | "other") => void;
  hasActiveStylesheet: boolean;
  selectedOccurrenceIndex: number;
  onSelectOccurrenceIndex: (idx: number) => void;
  checkedIds: Record<string, boolean>;
  onToggleCheck: (key: string) => void;
  onToggleAll: () => void;
  isAllChecked: boolean;
  actionTypes: Record<string, "fix" | "highlight">;
  reviewedCount: number;
  onClearDraft?: () => void;
  onBatchFixCategory?: (category: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function OccurrencesChecklistSidebar({
  findings,
  filteredFindings,
  searchTerm,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  categoriesList,
  stylesheetFilter,
  onStylesheetFilterChange,
  hasActiveStylesheet,
  selectedOccurrenceIndex,
  onSelectOccurrenceIndex,
  checkedIds,
  onToggleCheck,
  onToggleAll,
  isAllChecked,
  actionTypes,
  reviewedCount,
  onClearDraft,
  onBatchFixCategory,
  isCollapsed,
  onToggleCollapse,
}: OccurrencesChecklistSidebarProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll selected occurrence into view
  useEffect(() => {
    if (selectedOccurrenceIndex >= 0 && containerRef.current) {
      const container = containerRef.current;
      const el = document.getElementById(`checklist-item-${selectedOccurrenceIndex}`);
      if (el) {
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
          const offset =
            elRect.top -
            containerRect.top +
            container.scrollTop -
            container.clientHeight / 2 +
            elRect.height / 2;
          container.scrollTo({ top: offset, behavior: "smooth" });
        }
      }
    }
  }, [selectedOccurrenceIndex]);

  const percentReviewed =
    filteredFindings.length > 0
      ? Math.round((reviewedCount / filteredFindings.length) * 100)
      : 0;

  if (isCollapsed) {
    return (
      <div className="w-10 bg-white border-r border-slate-200 flex flex-col items-center py-3 shrink-0 select-none">
        <button
          onClick={onToggleCollapse}
          title="Expand Checklist Sidebar"
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
        >
          <Search className="w-4 h-4" />
        </button>
        <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-bold text-slate-500 mt-6 tracking-wider uppercase">
          Checklist ({filteredFindings.length})
        </span>
      </div>
    );
  }

  return (
    <aside className="w-[320px] lg:w-[340px] bg-white border-r border-slate-200 flex flex-col min-h-0 shrink-0 select-none shadow-xs">
      {/* Top Header */}
      <div className="p-3 border-b border-slate-200 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
              Findings Checklist
            </span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
              {filteredFindings.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {onClearDraft && (
              <button
                onClick={onClearDraft}
                title="Reset all saved draft actions for this file"
                className="p-1 text-slate-400 hover:text-rose-600 rounded-md hover:bg-slate-100 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={onToggleCollapse}
              title="Collapse sidebar"
              className="p-1 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search occurrences or rules..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-md text-xs font-medium focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50 focus:bg-white outline-none transition-all"
          />
        </div>

        {/* Category & Stylesheet Chips */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-thin">
          <button
            onClick={() => onCategoryFilterChange("all")}
            className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md shrink-0 transition-all ${
              categoryFilter === "all"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            All ({findings.length})
          </button>
          {categoriesList.map((cat) => {
            const count = findings.filter((f) => f.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => onCategoryFilterChange(cat)}
                className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md shrink-0 transition-all ${
                  categoryFilter === cat
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>

        {/* Stylesheet Filter tabs if no active stylesheet locked */}
        {!hasActiveStylesheet && (
          <div className="grid grid-cols-3 gap-1 bg-slate-100 p-0.5 rounded-md text-[10px] font-bold uppercase">
            <button
              onClick={() => onStylesheetFilterChange("all")}
              className={`py-1 rounded-sm text-center transition-all ${
                stylesheetFilter === "all" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500"
              }`}
            >
              All
            </button>
            <button
              onClick={() => onStylesheetFilterChange("in_stylesheet")}
              className={`py-1 rounded-sm text-center transition-all ${
                stylesheetFilter === "in_stylesheet" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500"
              }`}
            >
              Stylesheet
            </button>
            <button
              onClick={() => onStylesheetFilterChange("other")}
              className={`py-1 rounded-sm text-center transition-all ${
                stylesheetFilter === "other" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500"
              }`}
            >
              Other
            </button>
          </div>
        )}

        {/* Batch Action Bar if current category has replacements */}
        {categoryFilter !== "all" &&
          onBatchFixCategory &&
          findings.some((f) => f.category === categoryFilter && f.replacement) && (
            <div className="flex items-center justify-between p-2 bg-amber-50 border border-amber-200 rounded-md text-[10px]">
              <span className="font-bold text-amber-900 uppercase">Batch Apply</span>
              <button
                onClick={() => onBatchFixCategory(categoryFilter)}
                className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xs uppercase shadow-xs transition-colors"
              >
                Fix all {categoryFilter}
              </button>
            </div>
          )}
      </div>

      {/* Master Select & Progress Header */}
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <button
          onClick={onToggleAll}
          className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 uppercase hover:text-slate-900 cursor-pointer"
        >
          {isAllChecked ? (
            <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <Square className="w-3.5 h-3.5 text-slate-400" />
          )}
          <span>Select All</span>
        </button>

        <span className="text-[10px] font-bold text-slate-500">
          Reviewed: {reviewedCount}/{filteredFindings.length} ({percentReviewed}%)
        </span>
      </div>

      {/* Progress Track */}
      <div className="w-full h-1 bg-slate-100">
        <div
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${percentReviewed}%` }}
        />
      </div>

      {/* Scrollable list */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-2.5 space-y-2 min-h-0">
        {filteredFindings.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            No matching occurrences found.
          </div>
        ) : (
          filteredFindings.map((finding, idx) => {
            const key = `${finding.para_index}-${finding.match_start}-${finding.surface}`;
            const isChecked = checkedIds[key] ?? false;
            const isSelected = selectedOccurrenceIndex === idx;
            const actionType = actionTypes[key] || "fix";

            return (
              <OccurrenceChecklistCard
                key={`${key}-${idx}`}
                finding={finding}
                index={idx}
                isSelected={isSelected}
                isChecked={isChecked}
                actionType={actionType}
                onSelect={() => onSelectOccurrenceIndex(idx)}
                onToggleCheck={() => onToggleCheck(key)}
              />
            );
          })
        )}
      </div>
    </aside>
  );
}
