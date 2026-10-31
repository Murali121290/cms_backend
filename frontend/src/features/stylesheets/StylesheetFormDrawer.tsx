import { useState, useEffect, useMemo } from "react";
import { ChevronDown, ChevronUp, Maximize2, Minimize2, X } from "lucide-react";

import type {
  CERuleSettings,
  StylesheetSummary,
  IATemplateRow,
  StylesheetUpdateRequest,
  StylesheetCreateRequest,
} from "@/types/api";
import { CERulesEditor } from "./CERulesEditor";
import { useCeRulesQuery } from "./useStylesheetsQuery";

interface StylesheetFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  editingStylesheet: StylesheetSummary | null;
  mutations: {
    create: { mutate: (payload: StylesheetCreateRequest) => void; isPending: boolean };
    update: { mutate: (params: { id: number; payload: StylesheetUpdateRequest }) => void; isPending: boolean };
  };
  iaTemplate: IATemplateRow[];
}

interface ElementGroup {
  element: string;
  rows: IATemplateRow[];
}

export function StylesheetFormDrawer({
  isOpen,
  onClose,
  projectId,
  editingStylesheet,
  mutations,
  iaTemplate,
}: StylesheetFormDrawerProps) {
  const [isFullPage, setIsFullPage] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedRows, setSelectedRows] = useState<IATemplateRow[]>([]);
  const [expandedElements, setExpandedElements] = useState<Set<string>>(new Set());
  const [ceRules, setCeRules] = useState<CERuleSettings>({});
  const [section, setSection] = useState<"ia" | "ce">("ce");
  const ceRulesQuery = useCeRulesQuery();

  useEffect(() => {
    if (editingStylesheet) {
      setName(editingStylesheet.name);
      setDescription(editingStylesheet.description || "");
      setSelectedRows(
        editingStylesheet.selected_ia_rows.map((row) => ({
          ...row,
          example: null,
        }))
      );
      setExpandedElements(
        new Set(editingStylesheet.selected_ia_rows.map((row) => row.element))
      );
      setCeRules(editingStylesheet.ce_rules ?? {});
      if (editingStylesheet.ce_rules && Object.keys(editingStylesheet.ce_rules).length > 0) {
        setSection("ce");
      } else if (editingStylesheet.selected_ia_rows?.length > 0) {
        setSection("ia");
      } else {
        setSection("ce");
      }
    } else {
      setName("");
      setDescription("");
      setSelectedRows([]);
      setExpandedElements(new Set());
      setCeRules({});
      setSection("ce");
    }
    setIsFullPage(true);
  }, [editingStylesheet, isOpen]);

  const linkedSelectedRows = useMemo(() => {
    const link = new Map(iaTemplate.map((r) => [`${r.element}|${r.subtype}|${r.pattern}`, r]));
    return selectedRows.map((r) => ({ ...r, ...link.get(`${r.element}|${r.subtype}|${r.pattern}`) }));
  }, [iaTemplate, selectedRows]);

  const groupedRows = groupByElement(iaTemplate);

  const toggleElement = (element: string) => {
    const newExpanded = new Set(expandedElements);
    if (newExpanded.has(element)) {
      newExpanded.delete(element);
    } else {
      newExpanded.add(element);
    }
    setExpandedElements(newExpanded);
  };

  const toggleRowSelection = (row: IATemplateRow) => {
    setSelectedRows((prev) => {
      const exists = prev.some((r) => r.element === row.element && r.subtype === row.subtype && r.pattern === row.pattern);
      if (exists) {
        return prev.filter((r) => !(r.element === row.element && r.subtype === row.subtype && r.pattern === row.pattern));
      } else {
        return [...prev, row];
      }
    });
  };

  const isRowSelected = (row: IATemplateRow) => {
    return selectedRows.some((r) => r.element === row.element && r.subtype === row.subtype && r.pattern === row.pattern);
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      selected_ia_rows: selectedRows,
      ce_rules: ceRules,
    };

    if (editingStylesheet) {
      mutations.update.mutate({
        id: editingStylesheet.id,
        payload: {
          name: payload.name,
          description: payload.description,
          selected_ia_rows: payload.selected_ia_rows,
          ce_rules: payload.ce_rules,
        },
      });
    } else {
      mutations.create.mutate(payload);
    }

    onClose();
  };

  const isPending = mutations.create.isPending || mutations.update.isPending;

  if (!isOpen) {
    return null;
  }

  // 1. FULL PAGE PREVIEW MODE (Default)
  if (isFullPage) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-slate-50 w-full h-full overflow-hidden">
        {/* Top Studio Control Bar */}
        <header className="px-6 py-3 bg-white border-b border-border flex items-center justify-between gap-4 shrink-0 shadow-xs">
          {/* Studio Branding & Title */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  Editorial Studio
                </span>
                <h2 className="text-base font-bold text-slate-900 truncate">
                  {editingStylesheet ? "Edit Stylesheet" : "New Stylesheet"}
                </h2>
              </div>
              <p className="text-[11px] text-muted hidden md:block">
                Configure CE checklist rules, house style presets &amp; live manuscript preview
              </p>
            </div>
          </div>

          {/* Inline Name and Description Inputs */}
          <div className="flex-1 max-w-2xl flex items-center gap-2">
            <div className="flex-1 min-w-[220px]">
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Stylesheet Name (e.g., American Standard Style / CMOS 17th)... *"
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary bg-slate-50 focus:bg-white transition-colors"
              />
            </div>
            <div className="hidden lg:block flex-1 min-w-[180px]">
              <input
                id="description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional notes / publisher guidance..."
                className="w-full px-3 py-1.5 text-xs rounded-md border border-slate-200 focus:outline-none focus:ring-1 focus:ring-primary bg-slate-50 focus:bg-white text-slate-600"
              />
            </div>
          </div>

          {/* Section Tabs & Action Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 mr-2" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={section === "ce"}
                onClick={() => setSection("ce")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  section === "ce"
                    ? "bg-white text-slate-900 shadow-xs font-semibold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                CE Rules ({ceRulesQuery.data?.rules.length ?? 72})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === "ia"}
                onClick={() => setSection("ia")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  section === "ia"
                    ? "bg-white text-slate-900 shadow-xs font-semibold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                IA Rows ({selectedRows.length})
              </button>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || !name.trim()}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-xs"
            >
              {isPending ? "Saving..." : editingStylesheet ? "Update" : "Create Stylesheet"}
            </button>

            <div className="h-5 w-px bg-slate-200 mx-1" />

            {/* Toggle to Drawer Mode */}
            <button
              type="button"
              onClick={() => setIsFullPage(false)}
              title="Switch to Side Drawer mode"
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors"
            >
              <Minimize2 className="w-4 h-4" />
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-slate-100 rounded-md transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Main Full Page Body */}
        <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
          {section === "ce" ? (
            <div>
              {ceRulesQuery.isPending ? (
                <div className="p-12 text-center text-sm text-muted">Loading checklist rules…</div>
              ) : ceRulesQuery.isError ? (
                <div className="p-12 text-center text-sm text-red-600">The checklist rules could not be loaded. Close and reopen to try again.</div>
              ) : (
                <CERulesEditor
                  rules={ceRulesQuery.data.rules}
                  selectedRows={linkedSelectedRows}
                  settings={ceRules}
                  onChange={setCeRules}
                  isFullPage={true}
                />
              )}
            </div>
          ) : (
            <div className="max-w-5xl mx-auto space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-text">Legacy Style Rules from IA Analysis</h3>
                  <p className="text-xs text-muted">Select specific patterns to enforce from previous publication analyses.</p>
                </div>
                <span className="text-xs font-semibold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                  {selectedRows.length} rules selected
                </span>
              </div>
              <div className="border border-border rounded-lg bg-white overflow-hidden shadow-xs divide-y divide-border">
                {groupedRows.map((group) => (
                  <div key={group.element} className="divide-y divide-border">
                    <button
                      type="button"
                      onClick={() => toggleElement(group.element)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                    >
                      <span className="text-xs font-bold text-text uppercase tracking-wider">{group.element}</span>
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <span>{group.rows.length} patterns</span>
                        {expandedElements.has(group.element) ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </button>
                    {expandedElements.has(group.element) && (
                      <div className="px-4 py-3 bg-slate-50/50 grid grid-cols-1 md:grid-cols-2 gap-2">
                        {group.rows.map((row, i) => (
                          <label key={i} className="flex items-start gap-2 p-2 bg-white rounded border border-slate-200 text-xs cursor-pointer hover:border-amber-400 transition-colors">
                            <input
                              type="checkbox"
                              checked={isRowSelected(row)}
                              onChange={() => toggleRowSelection(row)}
                              className="mt-0.5 rounded border-border"
                            />
                            <div className="min-w-0 flex-1">
                              <span className="font-mono text-text block truncate">{row.pattern}</span>
                              {row.subtype && <span className="text-[10px] text-muted block">{row.subtype}</span>}
                            </div>
                            {row.ce_rule_no && (
                              <span className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">
                                R{row.ce_rule_no} · Opt {row.ce_option}
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. SIDE DRAWER MODE (When minimized)
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-xl bg-white shadow-xl flex flex-col max-h-screen overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-text">
              {editingStylesheet ? "Edit Stylesheet" : "New Stylesheet"}
            </h2>
            <span className="text-[10px] text-muted bg-slate-100 px-1.5 py-0.5 rounded">Drawer Mode</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsFullPage(true)}
              title="Expand to Full Page Preview"
              className="text-muted hover:text-text p-1.5 rounded hover:bg-slate-100 transition-colors"
              type="button"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="text-muted hover:text-red-600 p-1.5 rounded hover:bg-slate-100 transition-colors"
              type="button"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-4">
            <div>
              <label htmlFor="drawer-name" className="block text-xs font-semibold text-text mb-1.5 uppercase tracking-wide">
                Name
              </label>
              <input
                id="drawer-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., American Standard Style"
                className="w-full px-3 py-2 rounded-md border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="drawer-desc" className="block text-xs font-semibold text-text mb-1.5 uppercase tracking-wide">
                Description
              </label>
              <textarea
                id="drawer-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional notes about this stylesheet"
                rows={2}
                className="w-full px-3 py-2 rounded-md border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
              />
            </div>

            <div className="flex gap-1.5" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={section === "ce"}
                onClick={() => setSection("ce")}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${
                  section === "ce" ? "bg-primary text-white border-primary" : "bg-white text-text border-border"
                }`}
              >
                CE rules ({ceRulesQuery.data?.rules.length ?? 72})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === "ia"}
                onClick={() => setSection("ia")}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${
                  section === "ia" ? "bg-primary text-white border-primary" : "bg-white text-text border-border"
                }`}
              >
                IA rows ({selectedRows.length})
              </button>
            </div>

            {section === "ce" ? (
              <div className="space-y-2">
                <p className="text-[11px] text-muted">
                  Options tagged &ldquo;From IA row&rdquo; follow the ticked IA rows. Choosing a different option here overrides that.
                  &ldquo;Query author&rdquo; options and rules 12, 26 and 28 are never applied automatically.
                </p>
                {ceRulesQuery.isPending ? (
                  <p className="text-xs text-muted">Loading checklist rules…</p>
                ) : ceRulesQuery.isError ? (
                  <p className="text-xs text-red-600">The checklist rules could not be loaded. Close and reopen the stylesheet to try again.</p>
                ) : (
                  <CERulesEditor
                    rules={ceRulesQuery.data.rules}
                    selectedRows={linkedSelectedRows}
                    settings={ceRules}
                    onChange={setCeRules}
                    isFullPage={false}
                  />
                )}
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-text mb-2 uppercase tracking-wide">
                  Style Rules ({selectedRows.length} selected)
                </label>
                <div className="border border-border rounded-md bg-sidebar/3 overflow-hidden">
                  {groupedRows.map((group) => (
                    <div key={group.element} className="border-b border-border last:border-b-0">
                      <button
                        type="button"
                        onClick={() => toggleElement(group.element)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-sidebar/5 transition-colors text-left"
                      >
                        <span className="text-xs font-semibold text-text">{group.element}</span>
                        {expandedElements.has(group.element) ? (
                          <ChevronUp className="w-4 h-4 text-muted" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted" />
                        )}
                      </button>
                      {expandedElements.has(group.element) && (
                        <div className="px-3 pb-2 bg-white space-y-1.5 border-t border-border">
                          {group.rows.map((row, i) => (
                            <label key={i} className="flex items-start gap-2 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isRowSelected(row)}
                                onChange={() => toggleRowSelection(row)}
                                className="mt-0.5 rounded border-border"
                              />
                              <span className="flex-1 font-mono text-text">{row.pattern}</span>
                              {row.ce_rule_no && (
                                <span className="text-[10px] text-muted shrink-0">
                                  R{row.ce_rule_no} · Opt {row.ce_option}
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3 bg-sidebar/3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex-1 px-4 py-2 text-sm font-medium text-text bg-white border border-border rounded-md hover:bg-sidebar/3 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !name.trim()}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary border border-primary rounded-md hover:bg-primary transition-colors disabled:opacity-50"
          >
            {isPending ? "Saving..." : editingStylesheet ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function groupByElement(rows: IATemplateRow[]): ElementGroup[] {
  const grouped = new Map<string, IATemplateRow[]>();
  for (const row of rows) {
    if (!grouped.has(row.element)) {
      grouped.set(row.element, []);
    }
    grouped.get(row.element)!.push(row);
  }
  return Array.from(grouped.entries())
    .map(([element, items]) => ({ element, rows: items }))
    .sort((a, b) => a.element.localeCompare(b.element));
}
