import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Eye,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ChangesReviewPanel } from "@/features/editor";

interface OccurrenceInspectorPanelProps {
  activeOccurrence: any | null;
  totalFindings: number;
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
  actionType: "fix" | "highlight";
  onActionTypeChange: (action: "fix" | "highlight") => void;
  customReplacement: string;
  onCustomReplacementChange: (val: string) => void;
  onApplySelected: () => void;
  isApplying: boolean;
  selectedCount: number;
  applyWarning: string | null;
  editorRef: any;
  rightTab: "findings" | "trackedChanges";
  onRightTabChange: (tab: "findings" | "trackedChanges") => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onReplaceInEditor?: (
    occ: any,
    replacement: string,
    asTrackChanges: boolean,
    highlightOnly?: boolean
  ) => void;
}

export function OccurrenceInspectorPanel({
  activeOccurrence,
  totalFindings,
  selectedIndex,
  onSelectIndex,
  actionType,
  onActionTypeChange,
  customReplacement,
  onCustomReplacementChange,
  onApplySelected,
  isApplying,
  selectedCount,
  applyWarning,
  editorRef,
  rightTab,
  onRightTabChange,
  isCollapsed,
  onToggleCollapse,
  onReplaceInEditor,
}: OccurrenceInspectorPanelProps) {
  const [replaceSuccess, setReplaceSuccess] = useState(false);

  const surface = activeOccurrence?.surface || "";
  const effectiveReplacement =
    customReplacement !== "" ? customReplacement : activeOccurrence?.replacement || "";
  const replacement = effectiveReplacement;
  const ruleLabel = activeOccurrence?.rule_label || activeOccurrence?.rule_id || "Rule";
  const isInStylesheet = activeOccurrence?.in_stylesheet === true;

  function handleReplaceInEditor() {
    if (!activeOccurrence) return;
    const rep = effectiveReplacement;
    const asTrack = actionType === "fix";

    if (onReplaceInEditor) {
      onReplaceInEditor(activeOccurrence, rep, asTrack, false);
    } else if (editorRef?.current?.replaceOccurrence) {
      editorRef.current.replaceOccurrence(activeOccurrence, rep, { asTrackChanges: asTrack });
    }

    setReplaceSuccess(true);
    setTimeout(() => setReplaceSuccess(false), 2500);
  }

  function handleReplaceAndNext() {
    if (!activeOccurrence) return;
    const rep = effectiveReplacement;
    const asTrack = actionType === "fix";

    if (onReplaceInEditor) {
      // onReplaceInEditor calls setAppliedKeys which removes this item from filteredFindings.
      // The WysiwygEditor useEffect re-runs on the new occurrences array and auto-scrolls
      // to occurrences[selectedIndex] which is now the NEXT occurrence.
      onReplaceInEditor(activeOccurrence, rep, asTrack, false);
      setReplaceSuccess(true);
      setTimeout(() => setReplaceSuccess(false), 2500);
    } else if (editorRef?.current?.replaceOccurrence) {
      const ok = editorRef.current.replaceOccurrence(activeOccurrence, rep, { asTrackChanges: asTrack });
      if (ok) {
        setReplaceSuccess(true);
        setTimeout(() => setReplaceSuccess(false), 2500);
        if (selectedIndex < totalFindings - 1) {
          onSelectIndex(selectedIndex + 1);
        }
      }
    }
  }

  function handleHighlightAndNext() {
    if (!activeOccurrence) return;

    if (onReplaceInEditor) {
      onReplaceInEditor(activeOccurrence, "", false, true);
      setReplaceSuccess(true);
      setTimeout(() => setReplaceSuccess(false), 2500);
    } else if (editorRef?.current?.replaceOccurrence) {
      const ok = editorRef.current.replaceOccurrence(activeOccurrence, "", { highlightOnly: true });
      if (ok) {
        setReplaceSuccess(true);
        setTimeout(() => setReplaceSuccess(false), 2500);
        if (selectedIndex < totalFindings - 1) {
          onSelectIndex(selectedIndex + 1);
        }
      }
    }
  }

  function handleNextOccurrence() {
    // Pure navigation — does NOT apply any highlight or replacement.
    if (selectedIndex < totalFindings - 1) {
      onSelectIndex(selectedIndex + 1);
    }
  }

  if (isCollapsed) {
    return (
      <div className="w-10 bg-white border-l border-slate-200 flex flex-col items-center py-3 shrink-0 select-none">
        <button
          onClick={onToggleCollapse}
          title="Expand Inspector Sidebar"
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
        >
          <Sparkles className="w-4 h-4 text-amber-600" />
        </button>
        <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-bold text-slate-500 mt-6 tracking-wider uppercase">
          Inspector &amp; Fix
        </span>
      </div>
    );
  }

  return (
    <aside className="w-[340px] lg:w-[360px] bg-white border-l border-slate-200 flex flex-col min-h-0 shrink-0 select-none shadow-xs">
      {/* Top Tab Switcher */}
      <div className="p-3 border-b border-slate-200 flex items-center justify-between">
        <div className="flex bg-slate-100 p-0.5 rounded-md text-xs font-bold">
          <button
            onClick={() => onRightTabChange("findings")}
            className={`px-3 py-1 rounded-sm transition-all ${
              rightTab === "findings"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500 hover:text-slate-800 bg-transparent"
            }`}
          >
            Inspector &amp; Fix
          </button>
          <button
            onClick={() => onRightTabChange("trackedChanges")}
            className={`px-3 py-1 rounded-sm transition-all ${
              rightTab === "trackedChanges"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500 hover:text-slate-800 bg-transparent"
            }`}
          >
            Tracked Changes
          </button>
        </div>

        <button
          onClick={onToggleCollapse}
          title="Collapse Inspector"
          className="p-1 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {rightTab === "findings" ? (
        <>
          {/* Occurrence Stepper Navigation */}
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <span
              className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-xs ${
                isInStylesheet
                  ? "bg-amber-100 text-amber-800"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              {isInStylesheet ? "Stylesheet Rule" : ruleLabel}
            </span>

            {totalFindings > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onSelectIndex(Math.max(0, selectedIndex - 1))}
                  disabled={selectedIndex === 0}
                  className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 text-slate-600 transition-colors"
                  title="Previous occurrence (Key: K or ↑)"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[11px] font-mono font-bold text-slate-700">
                  {selectedIndex + 1} of {totalFindings}
                </span>
                <button
                  onClick={() => onSelectIndex(Math.min(totalFindings - 1, selectedIndex + 1))}
                  disabled={selectedIndex >= totalFindings - 1}
                  className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 text-slate-600 transition-colors"
                  title="Next occurrence (Key: J or ↓)"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Body content */}
          {activeOccurrence ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
              {/* Visual Diff Box */}
              <div className="border border-slate-200 rounded-lg overflow-hidden shadow-xs">
                <div className="bg-slate-50 px-3 py-1.5 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Visual Diff Comparison
                </div>
                <div className="divide-y divide-slate-100">
                  <div className="px-3 py-2 bg-rose-50/70 flex items-center gap-2 text-xs">
                    <span className="text-[10px] font-extrabold uppercase text-rose-700 w-14 shrink-0">
                      Original
                    </span>
                    <span className="line-through text-rose-800 font-mono font-bold">
                      {surface}
                    </span>
                  </div>
                  <div className="px-3 py-2 bg-emerald-50/70 flex items-center gap-2 text-xs">
                    <span className="text-[10px] font-extrabold uppercase text-emerald-700 w-14 shrink-0">
                      Target
                    </span>
                    <span className="text-emerald-800 font-mono font-bold">
                      {replacement || "(no replacement set)"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Context preview */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                  Manuscript Context
                </span>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs leading-relaxed text-slate-700 font-medium">
                  {(() => {
                    const text = activeOccurrence.context || "";
                    if (!surface) return text;
                    try {
                      const parts = text.split(new RegExp(`(${surface})`, "i"));
                      return parts.map((part: string, i: number) =>
                        part.toLowerCase() === surface.toLowerCase() ? (
                          <mark
                            key={i}
                            className="bg-amber-100 text-amber-900 font-bold px-1 py-0.5 rounded-xs border border-amber-200"
                          >
                            {part}
                          </mark>
                        ) : (
                          part
                        )
                      );
                    } catch {
                      return text;
                    }
                  })()}
                </div>
              </div>

              {/* Action Choice Selector */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                  Action Resolution
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onActionTypeChange("fix")}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      actionType === "fix"
                        ? "border-emerald-600 bg-emerald-50/50 shadow-xs ring-1 ring-emerald-500/20"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 mb-0.5">
                      <CheckCircle2
                        className={`w-3.5 h-3.5 ${
                          actionType === "fix" ? "text-emerald-600" : "text-slate-400"
                        }`}
                      />
                      <span>Track Changes Fix</span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Replaces text with revision mark
                    </div>
                  </button>

                  <button
                    onClick={() => onActionTypeChange("highlight")}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      actionType === "highlight"
                        ? "border-amber-500 bg-amber-50/50 shadow-xs ring-1 ring-amber-500/20"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 mb-0.5">
                      <Eye
                        className={`w-3.5 h-3.5 ${
                          actionType === "highlight" ? "text-amber-600" : "text-slate-400"
                        }`}
                      />
                      <span>Highlight Only</span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Highlights text for review
                    </div>
                  </button>
                </div>
              </div>

              {/* Replacement input & suggestion chips */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                    {actionType === "fix" ? "Replacement Text" : "Highlight Action"}
                  </span>
                  {actionType === "fix" && activeOccurrence.replacement && (
                    <button
                      onClick={() => {
                        onCustomReplacementChange(activeOccurrence.replacement);
                        onActionTypeChange("fix");
                      }}
                      className="text-[10px] font-bold text-emerald-700 hover:underline bg-emerald-50 px-1.5 py-0.5 rounded-xs"
                    >
                      Use Suggestion: {activeOccurrence.replacement}
                    </button>
                  )}
                  {actionType === "highlight" && (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-xs">
                      No Replacement (Review Only)
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={effectiveReplacement}
                  onChange={(e) => {
                    const val = e.target.value;
                    onCustomReplacementChange(val);
                    if (val.trim()) {
                      onActionTypeChange("fix");
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (actionType === "highlight") {
                        handleHighlightAndNext();
                      } else {
                        handleReplaceAndNext();
                      }
                    }
                  }}
                  placeholder={
                    actionType === "highlight"
                      ? "Optional: type text here to switch to Fix mode..."
                      : "Enter replacement text..."
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs font-mono font-medium focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                />

                {/* Buttons based on Action Type */}
                {actionType === "highlight" ? (
                  <div className="pt-2 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleHighlightAndNext}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 active:bg-amber-300 border border-amber-300 shadow-xs transition-all cursor-pointer"
                        title="Apply yellow highlight to this occurrence and move to next"
                      >
                        <Eye className="w-4 h-4 text-amber-700" />
                        <span>Highlight &amp; Next</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleNextOccurrence}
                        disabled={selectedIndex >= totalFindings - 1}
                        title="Skip this occurrence and move to next (no highlight applied)"
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-200 shadow-xs transition-all cursor-pointer"
                      >
                        <span>Skip / Next</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    {replaceSuccess && (
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-md">
                        <Eye className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>Highlighted in editor (text preserved)!</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="pt-2 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleReplaceInEditor}
                      disabled={!effectiveReplacement}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Replace in Editor</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleReplaceAndNext}
                        disabled={!effectiveReplacement}
                        title="Replace this occurrence with Track Changes and move to next"
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold text-emerald-900 bg-emerald-100 hover:bg-emerald-200 active:bg-emerald-300 border border-emerald-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                        <span>Replace &amp; Next</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleNextOccurrence}
                        disabled={selectedIndex >= totalFindings - 1}
                        title="Skip this occurrence and move to next (no replacement applied)"
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer"
                      >
                        <span>Skip / Next</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    {replaceSuccess && (
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-md">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>Reflected in editor immediately!</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6 text-center text-xs text-slate-400">
              Select an occurrence from the checklist to inspect.
            </div>
          )}

          {/* Sticky Bottom Apply Drawer */}
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
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <ChangesReviewPanel editor={editorRef.current?.editor} />
        </div>
      )}
    </aside>
  );
}
