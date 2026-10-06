import React from "react";
import { CheckSquare, Square, Check, Eye } from "lucide-react";

interface OccurrenceChecklistCardProps {
  finding: any;
  index: number;
  isSelected: boolean;
  isChecked: boolean;
  actionType: "fix" | "highlight";
  onSelect: () => void;
  onToggleCheck: () => void;
}

export function OccurrenceChecklistCard({
  finding,
  index,
  isSelected,
  isChecked,
  actionType,
  onSelect,
  onToggleCheck,
}: OccurrenceChecklistCardProps) {
  const isInStylesheet = finding.in_stylesheet === true;
  const surface = finding.surface || "";
  const replacement = finding.replacement || "";
  const context = finding.context || "";
  const ruleLabel = finding.rule_label || finding.rule_id || "Rule";
  const paraIndex = finding.para_index !== undefined ? `Para ${finding.para_index + 1}` : "";

  // Highlight the matching surface inside context text
  const renderedContext = React.useMemo(() => {
    if (!context || !surface) return context;
    try {
      const parts = context.split(new RegExp(`(${surface})`, "i"));
      return parts.map((part: string, i: number) =>
        part.toLowerCase() === surface.toLowerCase() ? (
          <mark
            key={i}
            className="bg-amber-100 text-amber-900 font-semibold px-1 py-0.5 rounded-xs border border-amber-200"
          >
            {part}
          </mark>
        ) : (
          part
        )
      );
    } catch {
      return context;
    }
  }, [context, surface]);

  return (
    <div
      id={`checklist-item-${index}`}
      onClick={onSelect}
      className={`group p-3 rounded-lg border cursor-pointer transition-all duration-150 border-l-4 relative ${
        isInStylesheet
          ? "border-l-amber-500 bg-white hover:bg-amber-50/20"
          : "border-l-indigo-400 bg-white hover:bg-indigo-50/20"
      } ${
        isSelected
          ? "border-blue-500 bg-blue-50/60 shadow-sm ring-1 ring-blue-400/30"
          : "border-slate-200 hover:border-slate-300 hover:shadow-xs"
      }`}
    >
      {/* Top Meta Line */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-sm truncate ${
              isInStylesheet
                ? "bg-amber-100 text-amber-800"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {isInStylesheet ? "Stylesheet" : ruleLabel}
          </span>
          <span className="text-[10px] text-slate-400 font-medium">{finding.category}</span>
        </div>
        {paraIndex && (
          <span className="text-[10px] text-slate-400 font-mono shrink-0">{paraIndex}</span>
        )}
      </div>

      {/* Surface Word & Replacement preview */}
      <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5 mb-1 truncate">
        <span className="text-rose-700 font-mono">{`"${surface}"`}</span>
        {replacement && (
          <>
            <span className="text-slate-400 font-normal">→</span>
            <span className="text-emerald-700 font-mono">{`"${replacement}"`}</span>
          </>
        )}
      </div>

      {/* Context sentence with mark */}
      <p className="text-[11px] text-slate-600 leading-snug line-clamp-2 mb-2 font-normal">
        {renderedContext}
      </p>

      {/* Quick Action Bar */}
      <div
        className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]"
        onClick={(e) => e.stopPropagation()}
      >
        <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 hover:text-slate-900 font-semibold select-none">
          <button
            type="button"
            onClick={onToggleCheck}
            className="text-slate-400 hover:text-slate-700 p-0.5"
          >
            {isChecked ? (
              <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <Square className="w-3.5 h-3.5 text-slate-400" />
            )}
          </button>
          <span className="text-[10px] font-medium">Batch apply</span>
        </label>

        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-xs ${
            actionType === "fix"
              ? "text-emerald-700 bg-emerald-50"
              : "text-amber-700 bg-amber-50"
          }`}
        >
          {actionType === "fix" ? (
            <>
              <Check className="w-3 h-3" />
              <span>Fix</span>
            </>
          ) : (
            <>
              <Eye className="w-3 h-3" />
              <span>Highlight</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
