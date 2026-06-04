import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import type { StylesheetSummary, IARow } from "@/types/api";

interface StylesheetPanelProps {
  stylesheet: StylesheetSummary | null;
  selectedStylesheetId: number | null;
  onStylesheetSelect: (id: number | null) => void;
  availableStylesheets?: StylesheetSummary[];
  categoryFilter?: string;
}

export function StylesheetPanel({
  stylesheet,
  selectedStylesheetId,
  onStylesheetSelect,
  availableStylesheets = [],
  categoryFilter = "all",
}: StylesheetPanelProps) {
  const [expandedRules, setExpandedRules] = useState<Set<number>>(new Set());

  // Filter rules by category if selected
  const filteredRules = stylesheet
    ? stylesheet.selected_ia_rows.filter((rule) => {
        if (categoryFilter === "all") return true;
        // Match category with subtype
        return rule.subtype?.toLowerCase() === categoryFilter.toLowerCase();
      })
    : [];

  const toggleRule = (ruleId: number) => {
    const newExpanded = new Set(expandedRules);
    if (newExpanded.has(ruleId)) {
      newExpanded.delete(ruleId);
    } else {
      newExpanded.add(ruleId);
    }
    setExpandedRules(newExpanded);
  };

  return (
    <div className="bg-white rounded-lg shadow-card border border-border flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h3 className="text-xs font-semibold text-text uppercase tracking-wider flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-600" />
          Editorial Stylesheet
        </h3>
      </div>

      {/* Stylesheet Selector */}
      <div className="p-3 border-b border-border">
        <select
          value={selectedStylesheetId ?? ""}
          onChange={(e) => onStylesheetSelect(Number(e.target.value) || null)}
          className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">No Stylesheet</option>
          {availableStylesheets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.is_active ? " âœ“" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Rules List */}
      <div className="flex-1 overflow-y-auto p-3">
        {!stylesheet ? (
          <div className="text-center py-6 text-muted text-xs">
            Select a stylesheet to view rules
          </div>
        ) : !filteredRules || filteredRules.length === 0 ? (
          <div className="text-center py-6 text-muted text-xs">
            {categoryFilter === "all"
              ? "No rules defined in this stylesheet"
              : `No rules found for category: ${categoryFilter}`}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredRules.map((rule: IARow, idx: number) => (
              <div key={idx}>
                <button
                  onClick={() => toggleRule(idx)}
                  className="w-full text-left px-3 py-2 rounded-md bg-background border border-border hover:bg-sidebar/5 transition-all"
                >
                  <div className="flex items-center gap-2">
                    <ChevronDown
                      className={`w-3 h-3 text-muted transition-transform ${
                        expandedRules.has(idx) ? "rotate-180" : ""
                      }`}
                    />
                    <span className="font-mono text-[10px] font-bold text-text">
                      {rule.element}{rule.subtype ? ` (${rule.subtype})` : ""}
                    </span>
                  </div>
                </button>

                {expandedRules.has(idx) && (
                  <div className="mt-1 ml-4 p-2 bg-blue-50 border-l-2 border-blue-300 rounded text-[10px] text-text space-y-1">
                    {rule.element && (
                      <div>
                        <span className="font-semibold">Element:</span> {rule.element}
                      </div>
                    )}
                    {rule.subtype && (
                      <div>
                        <span className="font-semibold">Type:</span> {rule.subtype}
                      </div>
                    )}
                    {rule.pattern && (
                      <div>
                        <span className="font-semibold">Pattern:</span>
                        <div className="font-mono text-[9px] bg-white p-1 rounded mt-0.5 break-words">
                          {rule.pattern}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      {stylesheet && (
        <div className="border-t border-border p-3 bg-blue-50 text-[10px] text-text">
          <p className="font-semibold mb-1">{stylesheet.name}</p>
          <p className="text-[9px] text-muted mt-1">
            {categoryFilter === "all"
              ? `${stylesheet.selected_ia_rows?.length || 0} rules total`
              : `${filteredRules.length} rules for ${categoryFilter}`}
          </p>
          {stylesheet.is_active && (
            <p className="text-[9px] text-green-600 mt-1 font-semibold">âœ“ Active Stylesheet</p>
          )}
        </div>
      )}
    </div>
  );
}
