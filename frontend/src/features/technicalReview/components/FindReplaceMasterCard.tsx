import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Eye,
  Zap,
} from "lucide-react";

export interface FindReplaceMasterCardProps {
  activeOccurrence: any | null;
  totalFindings: number;
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
  actionType: "fix" | "highlight";
  onActionTypeChange: (action: "fix" | "highlight") => void;
  customReplacement: string;
  onCustomReplacementChange: (val: string) => void;
  onReplaceAndNext: (rep: string, asTrackChanges: boolean) => void;
  onHighlightAndNext: () => void;
  onSkipNext: () => void;
  onBatchFixRule?: (ruleId: string, replacement: string) => void;
}

export function FindReplaceMasterCard({
  activeOccurrence,
  totalFindings,
  selectedIndex,
  onSelectIndex,
  actionType,
  onActionTypeChange,
  customReplacement,
  onCustomReplacementChange,
  onReplaceAndNext,
  onHighlightAndNext,
  onSkipNext,
  onBatchFixRule,
}: FindReplaceMasterCardProps) {
  const [replaceSuccess, setReplaceSuccess] = useState<string | null>(null);

  const surface = activeOccurrence?.surface || "";
  const defaultReplacement = activeOccurrence?.replacement || "";
  const effectiveReplacement =
    customReplacement !== "" ? customReplacement : defaultReplacement;
  const ruleLabel = activeOccurrence?.rule_label || activeOccurrence?.rule_id || "Technical Rule";
  const ruleId = activeOccurrence?.rule_id || "";
  const category = (activeOccurrence?.category || "te_point").toLowerCase();
  const paraIndex = activeOccurrence?.para_index ?? null;
  const replacementOptions: string[] = activeOccurrence?.replacement_options || [];

  const handleApplyFix = () => {
    onReplaceAndNext(effectiveReplacement, true);
    setReplaceSuccess("Replaced with track changes!");
    setTimeout(() => setReplaceSuccess(null), 2000);
  };

  const handleApplyHighlight = () => {
    onHighlightAndNext();
    setReplaceSuccess("Highlighted in document!");
    setTimeout(() => setReplaceSuccess(null), 2000);
  };

  if (!activeOccurrence) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-400 shadow-sm">
        No active occurrence selected.
      </div>
    );
  }

  return (
    <div className="bg-white border-1.5 border-slate-300 hover:border-slate-400 rounded-xl shadow-sm hover:shadow transition-all flex flex-col overflow-hidden">
      {/* 1. Header & Integrated Stepper */}
      <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="text-[10px] font-black uppercase tracking-wider text-slate-800 bg-slate-200 px-2 py-0.5 rounded-sm truncate max-w-[150px]"
            title={ruleLabel}
          >
            {ruleLabel}
          </span>
          <span
            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-xs shrink-0 ${
              category === "te_point"
                ? "bg-sky-100 text-sky-800 border border-sky-200"
                : "bg-purple-100 text-purple-800 border border-purple-200"
            }`}
          >
            {category === "te_point" ? "TE Point" : "Mechanical"}
          </span>
          {paraIndex !== null && (
            <span className="text-[10px] font-medium text-slate-400 shrink-0">
              Para {paraIndex}
            </span>
          )}
        </div>

        {totalFindings > 0 && (
          <div className="flex items-center gap-1 shrink-0 bg-white border border-slate-200 px-1.5 py-0.5 rounded-md shadow-2xs">
            <button
              onClick={() => onSelectIndex(Math.max(0, selectedIndex - 1))}
              disabled={selectedIndex === 0}
              className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-30 text-slate-600 transition-colors cursor-pointer"
              title="Previous occurrence (Key: K or ↑)"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono font-bold text-slate-700 px-1">
              {selectedIndex + 1} of {totalFindings}
            </span>
            <button
              onClick={() => onSelectIndex(Math.min(totalFindings - 1, selectedIndex + 1))}
              disabled={selectedIndex >= totalFindings - 1}
              className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-30 text-slate-600 transition-colors cursor-pointer"
              title="Next occurrence (Key: J or ↓)"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* 2. Card Content Body */}
      <div className="p-3.5 space-y-3">
        {/* Section 1: FIND (Matched text + Sentence context) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span>1. Find (Surface)</span>
            <span className="font-mono text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
              "{surface}"
            </span>
          </div>

          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs leading-relaxed text-slate-700 font-medium">
            {(() => {
              const text = activeOccurrence.context || "";
              if (!surface) return text;
              try {
                const parts = text.split(new RegExp(`(${surface.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")})`, "i"));
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

        {/* Section 2: REPLACE (Field + Live Dropdown Options) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span>2. Replace With</span>
            {defaultReplacement && (
              <button
                type="button"
                onClick={() => {
                  onCustomReplacementChange(defaultReplacement);
                  onActionTypeChange("fix");
                }}
                className="text-[10px] font-bold text-emerald-700 hover:underline bg-emerald-50 px-1.5 py-0.5 rounded-xs cursor-pointer"
              >
                Reset Default: "{defaultReplacement}"
              </button>
            )}
          </div>

          <div className="relative">
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
                    handleApplyHighlight();
                  } else {
                    handleApplyFix();
                  }
                }
              }}
              placeholder={
                actionType === "highlight"
                  ? "Type replacement or use options below..."
                  : "Enter replacement text..."
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono font-medium focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none bg-white transition-all"
            />
          </div>

          {/* Quick Dropdown / Options Chips */}
          {replacementOptions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <span className="text-[10px] font-semibold text-slate-400 self-center">Options:</span>
              {replacementOptions.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onCustomReplacementChange(opt);
                    onActionTypeChange("fix");
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition-colors cursor-pointer border ${
                    effectiveReplacement === opt
                      ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200"
                  }`}
                >
                  {opt || "(empty)"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Section 3: Visual Diff Preview */}
        <div className="border border-slate-200 rounded-lg overflow-hidden text-xs">
          <div className="bg-slate-50 px-2.5 py-1 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500 flex justify-between">
            <span>3. Live Diff Preview</span>
            <span>{actionType === "fix" ? "Track Changes" : "Highlight Only"}</span>
          </div>
          <div className="p-2 bg-slate-50/50 font-mono text-[11px] leading-relaxed flex items-center gap-1.5 flex-wrap">
            <span className="bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded line-through">
              {surface}
            </span>
            <span className="text-slate-400">→</span>
            {actionType === "fix" && effectiveReplacement ? (
              <span className="bg-emerald-100 text-emerald-900 font-bold px-1.5 py-0.5 rounded">
                {effectiveReplacement}
              </span>
            ) : (
              <span className="bg-amber-100 text-amber-900 font-medium px-1.5 py-0.5 rounded">
                [Highlight Marker]
              </span>
            )}
          </div>
        </div>

        {/* Section 4: Action Resolution Toggle */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            4. Action Resolution
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onActionTypeChange("fix")}
              className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                actionType === "fix"
                  ? "border-emerald-600 bg-emerald-50/60 shadow-2xs ring-1 ring-emerald-500/20"
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
                Replaces text with revision
              </div>
            </button>

            <button
              type="button"
              onClick={() => onActionTypeChange("highlight")}
              className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                actionType === "highlight"
                  ? "border-amber-500 bg-amber-50/60 shadow-2xs ring-1 ring-amber-500/20"
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
                Marks for manual review
              </div>
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-1 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {actionType === "fix" ? (
              <button
                type="button"
                onClick={handleApplyFix}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 shadow-sm transition-all cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Replace &amp; Next</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleApplyHighlight}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 active:bg-amber-300 border border-amber-300 shadow-2xs transition-all cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5 text-amber-700" />
                <span>Highlight &amp; Next</span>
              </button>
            )}

            <button
              type="button"
              onClick={onSkipNext}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 border border-slate-200 shadow-2xs transition-all cursor-pointer"
            >
              <span>Skip / Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Batch Fix Button (Optional) */}
          {onBatchFixRule && ruleId && (
            <button
              type="button"
              onClick={() => onBatchFixRule(ruleId, effectiveReplacement)}
              className="w-full flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-300 transition-colors cursor-pointer"
            >
              <Zap className="w-3 h-3 text-amber-500" />
              <span>Batch Fix All for "{ruleLabel}"</span>
            </button>
          )}

          {/* Flash Feedback */}
          {replaceSuccess && (
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-md">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>{replaceSuccess}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
