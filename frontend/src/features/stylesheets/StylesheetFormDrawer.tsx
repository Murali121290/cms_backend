import { useState, useEffect, useMemo, useRef } from "react";
import {
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  X,
  FileText,
  Upload,
  Loader2,
  CheckCircle2,
  Sparkles,
  BookMarked,
} from "lucide-react";

import type {
  CERuleSettings,
  StylesheetSummary,
  IATemplateRow,
  StylesheetUpdateRequest,
  StylesheetCreateRequest,
  DocxStylesheetParseResponse,
  CESeverity,
} from "@/types/api";
import { CERulesEditor } from "./CERulesEditor";
import { useCeRulesQuery, useIATemplateQuery } from "./useStylesheetsQuery";
import { parseDocxStylesheet, getSpringerPreset } from "@/api/stylesheets";

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
  const fallbackIaQuery = useIATemplateQuery();
  const effectiveIaTemplate = iaTemplate.length > 0 ? iaTemplate : (fallbackIaQuery.data?.rows || []);

  // DOCX Import states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingDocx, setIsUploadingDocx] = useState(false);
  const [isLoadingSpringer, setIsLoadingSpringer] = useState(false);
  const [docxImportData, setDocxImportData] = useState<DocxStylesheetParseResponse | null>(null);
  const [showDocxDetails, setShowDocxDetails] = useState(false);

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
    setDocxImportData(null);
    setShowDocxDetails(false);
  }, [editingStylesheet, isOpen]);

  const linkedSelectedRows = useMemo(() => {
    const link = new Map(effectiveIaTemplate.map((r) => [`${r.element}|${r.subtype}|${r.pattern}`, r]));
    return selectedRows.map((r) => ({ ...r, ...link.get(`${r.element}|${r.subtype}|${r.pattern}`) }));
  }, [effectiveIaTemplate, selectedRows]);

  const groupedRows = groupByElement(effectiveIaTemplate);

  const toggleElement = (element: string) => {
    const newExpanded = new Set(expandedElements);
    if (newExpanded.has(element)) {
      newExpanded.delete(element);
    } else {
      newExpanded.add(element);
    }
    setExpandedElements(newExpanded);
  };

  const normalizePattern = (p: string) => p.replace(/[\u2013\u2014–—]/g, "-").trim().toLowerCase();

  const toggleRowSelection = (row: IATemplateRow) => {
    setSelectedRows((prev) => {
      const exists = prev.some(
        (r) =>
          r.element.toLowerCase() === row.element.toLowerCase() &&
          (r.pattern.toLowerCase() === row.pattern.toLowerCase() ||
            normalizePattern(r.pattern) === normalizePattern(row.pattern)) &&
          (!row.subtype || !r.subtype || r.subtype.toLowerCase() === row.subtype.toLowerCase())
      );
      if (exists) {
        return prev.filter(
          (r) =>
            !(
              r.element.toLowerCase() === row.element.toLowerCase() &&
              (r.pattern.toLowerCase() === row.pattern.toLowerCase() ||
                normalizePattern(r.pattern) === normalizePattern(row.pattern)) &&
              (!row.subtype || !r.subtype || r.subtype.toLowerCase() === row.subtype.toLowerCase())
            )
        );
      } else {
        return [...prev, row];
      }
    });
  };

  const isRowSelected = (row: IATemplateRow) => {
    return selectedRows.some(
      (r) =>
        r.element.toLowerCase() === row.element.toLowerCase() &&
        (r.pattern.toLowerCase() === row.pattern.toLowerCase() ||
          normalizePattern(r.pattern) === normalizePattern(row.pattern)) &&
        (!row.subtype || !r.subtype || r.subtype.toLowerCase() === row.subtype.toLowerCase())
    );
  };

  const handleDocxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploadingDocx(true);
      const res = await parseDocxStylesheet(projectId, file);
      setDocxImportData(res);

      // Auto-fill suggested name & description
      if (res.suggested_name) setName(res.suggested_name);
      if (res.suggested_description) setDescription(res.suggested_description);

      // Auto-configure CE rules
      const newCeRules: CERuleSettings = { ...ceRules };
      for (const [sno, r] of Object.entries(res.matched_ce_rules)) {
        newCeRules[sno] = {
          enabled: r.enabled,
          option: r.option,
          severity: r.severity as CESeverity,
        };
      }
      setCeRules(newCeRules);

      // Auto-match IA rows from template
      const newSelectedRows: IATemplateRow[] = [];
      const newExpanded = new Set<string>(expandedElements);
      for (const matchedIa of res.matched_ia_rows) {
        const found =
          effectiveIaTemplate.find(
            (t) =>
              t.element.toLowerCase() === matchedIa.element.toLowerCase() &&
              (t.pattern.toLowerCase() === matchedIa.pattern.toLowerCase() ||
                normalizePattern(t.pattern) === normalizePattern(matchedIa.pattern)) &&
              (!matchedIa.subtype || t.subtype.toLowerCase() === matchedIa.subtype.toLowerCase())
          ) ||
          effectiveIaTemplate.find(
            (t) =>
              t.element.toLowerCase() === matchedIa.element.toLowerCase() &&
              (t.pattern.toLowerCase() === matchedIa.pattern.toLowerCase() ||
                normalizePattern(t.pattern) === normalizePattern(matchedIa.pattern))
          ) ||
          effectiveIaTemplate.find(
            (t) =>
              t.element.toLowerCase() === matchedIa.element.toLowerCase() &&
              (normalizePattern(t.pattern).includes(normalizePattern(matchedIa.pattern)) ||
                normalizePattern(matchedIa.pattern).includes(normalizePattern(t.pattern)))
          );

        const matchedRow: IATemplateRow = found || {
          element: matchedIa.element,
          subtype: matchedIa.subtype || "General",
          pattern: matchedIa.pattern,
          example: matchedIa.source_value || null,
        };

        if (
          !newSelectedRows.some(
            (r) =>
              r.element.toLowerCase() === matchedRow.element.toLowerCase() &&
              (r.pattern.toLowerCase() === matchedRow.pattern.toLowerCase() ||
                normalizePattern(r.pattern) === normalizePattern(matchedRow.pattern)) &&
              (!matchedRow.subtype || !r.subtype || r.subtype.toLowerCase() === matchedRow.subtype.toLowerCase())
          )
        ) {
          newSelectedRows.push(matchedRow);
          newExpanded.add(matchedRow.element);
        }
      }
      setSelectedRows(newSelectedRows);
      setExpandedElements(newExpanded);

      // Switch to CE tab so user immediately sees imported rules
      setSection("ce");
    } catch (err: any) {
      console.error("Failed to parse DOCX stylesheet:", err);
      alert(err?.response?.data?.message || err?.message || "Failed to parse editorial style sheet (.docx).");
    } finally {
      setIsUploadingDocx(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleLoadSpringerPreset = async () => {
    try {
      setIsLoadingSpringer(true);
      const res = await getSpringerPreset();
      setName(res.name);
      setDescription(res.description);

      const newCeRules: CERuleSettings = {};
      for (const [sno, r] of Object.entries(res.ce_rules || {})) {
        const item = r as any;
        newCeRules[sno] = {
          enabled: item.enabled,
          option: item.option,
          severity: item.severity as CESeverity,
        };
      }
      setCeRules(newCeRules);

      const newSelectedRows: IATemplateRow[] = [];
      const newExpanded = new Set<string>(expandedElements);
      for (const matchedIa of (res.selected_ia_rows || [])) {
        const found =
          effectiveIaTemplate.find(
            (t) =>
              t.element.toLowerCase() === matchedIa.element.toLowerCase() &&
              (t.pattern.toLowerCase() === matchedIa.pattern.toLowerCase() ||
                normalizePattern(t.pattern) === normalizePattern(matchedIa.pattern)) &&
              (!matchedIa.subtype || t.subtype.toLowerCase() === matchedIa.subtype.toLowerCase())
          ) || {
            element: matchedIa.element,
            subtype: matchedIa.subtype || "General",
            pattern: matchedIa.pattern,
            example: matchedIa.example || null,
          };
        newSelectedRows.push(found);
        newExpanded.add(found.element);
      }
      setSelectedRows(newSelectedRows);
      setExpandedElements(newExpanded);

      const matchedMap: Record<string, any> = {};
      for (const [sno, r] of Object.entries(res.ce_rules || {})) {
        const item = r as any;
        matchedMap[sno] = {
          sno: Number(sno),
          rule_name: `Rule ${sno}`,
          option: item.option,
          enabled: item.enabled,
          severity: item.severity,
          source_label: "Springer Preset",
          source_value: "Springer Style Sheet (July 2026)",
          explanation: `Default Springer specification (Option ${item.option})`,
          notes: `Default Springer specification (Option ${item.option})`,
        };
      }
      setDocxImportData({
        metadata: { "Customer": "Springer Publishing Company", "Edition": "July 2026 Update" },
        suggested_name: res.name,
        suggested_description: res.description,
        detected_preset_id: "springer",
        matched_ce_rules: matchedMap,
        matched_ia_rows: res.selected_ia_rows || [],
        word_list: res.word_list || [],
        total_specs_scanned: Object.keys(res.ce_rules || {}).length,
        matched_rules_count: Object.keys(res.ce_rules || {}).length,
      });

      setSection("ce");
    } catch (err: any) {
      console.error("Failed to load Springer preset:", err);
      alert("Failed to load Springer Publishing House Style preset.");
    } finally {
      setIsLoadingSpringer(false);
    }
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

          {/* Inline Name and Description Inputs + Import DOCX Button */}
          <div className="flex-1 max-w-2xl flex items-center gap-2">
            <div className="flex-1 min-w-[200px]">
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Stylesheet Name (e.g., American Standard Style / CMOS 17th)... *"
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary bg-slate-50 focus:bg-white transition-colors"
              />
            </div>
            <div className="hidden lg:block flex-1 min-w-[160px]">
              <input
                id="description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional notes / publisher guidance..."
                className="w-full px-3 py-1.5 text-xs rounded-md border border-slate-200 focus:outline-none focus:ring-1 focus:ring-primary bg-slate-50 focus:bg-white text-slate-600"
              />
            </div>

            {/* Hidden DOCX input & Trigger Button */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx"
              onChange={handleDocxUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingDocx || isLoadingSpringer}
              title="Upload existing Word style sheet (.docx) to automatically choose rules and options"
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md transition-colors flex items-center gap-1.5 shrink-0 shadow-2xs disabled:opacity-50"
            >
              {isUploadingDocx ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                  <span>Parsing...</span>
                </>
              ) : (
                <>
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  <span>Word Style Sheet</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleLoadSpringerPreset}
              disabled={isLoadingSpringer || isUploadingDocx}
              title="Load official Springer Publishing House Style Sheet (July 2026 update)"
              className="px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-md transition-colors flex items-center gap-1.5 shrink-0 shadow-2xs disabled:opacity-50"
            >
              {isLoadingSpringer ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                  <span>Loading...</span>
                </>
              ) : (
                <>
                  <BookMarked className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Springer Preset</span>
                </>
              )}
            </button>
          </div>

          {/* Section Tabs & Action Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 mr-2" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={section === "ce"}
                onClick={() => setSection("ce")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${section === "ce"
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
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${section === "ia"
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
          {/* DOCX Import Summary Banner */}
          {docxImportData && (
            <div className="mb-4 bg-emerald-50 border border-emerald-300 rounded-lg p-3.5 text-xs text-emerald-950 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-bold">
                    Successfully imported specifications from editorial style sheet!
                  </span>
                  <span className="bg-emerald-200/80 text-emerald-900 font-mono font-bold px-2 py-0.5 rounded text-[10px] uppercase">
                    {docxImportData.detected_preset_id.toUpperCase()} Preset
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDocxDetails(!showDocxDetails)}
                    className="text-emerald-800 hover:text-emerald-950 underline font-medium text-[11px]"
                  >
                    {showDocxDetails ? "Hide Import Details" : "View Extracted Details"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDocxImportData(null)}
                    className="text-emerald-700 hover:text-emerald-900 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[11px] text-emerald-900 pt-1 border-t border-emerald-200/70">
                <span>
                  <strong>{docxImportData.matched_rules_count}</strong> CE checklist rules auto-configured
                </span>
                <span>•</span>
                <span>
                  <strong>{docxImportData.matched_ia_rows.length}</strong> IA structural rows matched
                </span>
                <span>•</span>
                <span>
                  <strong>{docxImportData.word_list.length}</strong> publisher word list terms extracted
                </span>
              </div>

              {showDocxDetails && (
                <div className="mt-2 pt-2 border-t border-emerald-200/80 space-y-2 text-[11px] bg-white/70 p-2.5 rounded">
                  <div>
                    <span className="font-bold text-slate-800 block mb-1">
                      Auto-Configured Rules &amp; Options:
                    </span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      {Object.entries(docxImportData.matched_ce_rules).map(([sno, r]) => (
                        <div key={sno} className="bg-white p-1.5 rounded border border-emerald-200 text-slate-800">
                          <span className="font-mono font-bold text-emerald-800">R{sno}</span> ({r.rule_name}):{" "}
                          <span className="font-semibold">Option {r.option}</span>
                          <span className="block text-[10px] text-slate-500 truncate" title={r.source_value}>
                            From: "{r.source_label}" → {r.source_value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {docxImportData.word_list.length > 0 && (
                    <div>
                      <span className="font-bold text-slate-800 block mb-1">
                        Extracted Project Terminology ({docxImportData.word_list.length} terms):
                      </span>
                      <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1 bg-white rounded border border-emerald-200">
                        {docxImportData.word_list.map((w, i) => (
                          <span key={i} className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-[10px] font-mono">
                            {w}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
            {/* DOCX Import Button in Drawer Mode */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-800 block">Import Style Sheet (.docx)</span>
                <span className="text-[11px] text-slate-500">Auto-choose CE rules &amp; IA rows from Word</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx"
                onChange={handleDocxUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingDocx}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-md transition-colors flex items-center gap-1.5 shadow-2xs disabled:opacity-50"
              >
                {isUploadingDocx ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                    <span>Parsing...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5 text-blue-600" />
                    <span>Choose File</span>
                  </>
                )}
              </button>
            </div>

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
                className={`px-3 py-1 rounded-full text-xs font-medium border ${section === "ce" ? "bg-primary text-white border-primary" : "bg-white text-text border-border"
                  }`}
              >
                CE rules ({ceRulesQuery.data?.rules.length ?? 72})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === "ia"}
                onClick={() => setSection("ia")}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${section === "ia" ? "bg-primary text-white border-primary" : "bg-white text-text border-border"
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
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
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
