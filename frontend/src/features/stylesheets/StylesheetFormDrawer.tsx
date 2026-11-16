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
  StyleProfile,
} from "@/types/api";
import { CERulesEditor } from "./CERulesEditor";
import { useCeRulesQuery, useIATemplateQuery } from "./useStylesheetsQuery";
import { parseDocxStylesheet, getSpringerPreset } from "@/api/stylesheets";
import { StyleProfilePanel } from "./StyleProfilePanel";

interface StylesheetFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  editingStylesheet: StylesheetSummary | null;
  mutations: {
    create: { mutate: (payload: StylesheetCreateRequest) => void; isPending: boolean };
    update: { mutate: (params: { id: number; payload: StylesheetUpdateRequest }) => void; isPending: boolean };
  };
  iaTemplate?: IATemplateRow[];
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
  const [ceRules, setCeRules] = useState<CERuleSettings>({});
  const [section, setSection] = useState<"ce" | "profile">("ce");
  const [styleProfile, setStyleProfile] = useState<StyleProfile>({});
  const [isUploadingDocx, setIsUploadingDocx] = useState(false);
  const [isLoadingSpringer, setIsLoadingSpringer] = useState(false);
  const [docxImportData, setDocxImportData] = useState<DocxStylesheetParseResponse | null>(null);
  const [showDocxDetails, setShowDocxDetails] = useState(false);
  const [isApplyingBookType, setIsApplyingBookType] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ceRulesQuery = useCeRulesQuery();

  // Total style profile items count for badge
  const totalProfileItems = useMemo(() => {
    const redFlagsCount = (styleProfile.red_flags as Array<any>)?.length ?? 0;
    const avoidWordsCount = Object.keys(styleProfile.avoid_words ?? {}).length;
    const replacementsCount = styleProfile.word_replacements?.length ?? 0;
    const wordsCount = styleProfile.word_list?.length ?? 0;
    return redFlagsCount + avoidWordsCount + replacementsCount + wordsCount;
  }, [styleProfile]);

  useEffect(() => {
    if (editingStylesheet) {
      setName(editingStylesheet.name);
      setDescription(editingStylesheet.description || "");
      setCeRules(editingStylesheet.ce_rules ?? {});
      setStyleProfile((editingStylesheet.style_profile as StyleProfile) ?? {});
      setSection("ce");
    } else {
      setName("");
      setDescription("");
      setCeRules({});
      setStyleProfile({});
      setSection("ce");
    }
    setIsFullPage(true);
    setDocxImportData(null);
    setShowDocxDetails(false);
  }, [editingStylesheet, isOpen]);

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
      setStyleProfile(res.style_profile ?? {});

      // Switch to Editorial Rules tab so user immediately sees imported rules
      setSection("ce");
    } catch (err: any) {
      console.error("Failed to parse DOCX stylesheet:", err);
      alert(err?.response?.data?.message || err?.message || "Failed to parse editorial style sheet (.docx).");
    } finally {
      setIsUploadingDocx(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Book type / list style: re-apply only the Springer overlay rules and lists
  const handleBookTypeChange = async (bookType: string, listStyle: string) => {
    try {
      setIsApplyingBookType(true);
      const res = await getSpringerPreset(bookType, listStyle);
      const overlay = ["8", "118", "121"];
      setCeRules((prev) => {
        const next = { ...prev };
        for (const sno of overlay) {
          const item = res.ce_rules?.[sno];
          if (item) next[sno] = { enabled: item.enabled, option: item.option, severity: item.severity as CESeverity };
        }
        return next;
      });
      const overlayFinds = new Set(["ECG", "mmHg", "mm Hg"]);
      setStyleProfile((prev) => ({
        ...prev,
        book_type: bookType,
        list_style: listStyle,
        unit_style: { ...(prev.unit_style ?? {}), ...(res.style_profile?.unit_style ?? {}) },
        word_replacements: [
          ...(prev.word_replacements ?? []).filter((w) => !overlayFinds.has(w.find)),
          ...((res.style_profile?.word_replacements ?? []) as { find: string; replace: string; note?: string }[]).filter(
            (w) => overlayFinds.has(w.find),
          ),
        ],
      }));
    } catch (err) {
      console.error("Failed to apply Springer book type:", err);
    } finally {
      setIsApplyingBookType(false);
    }
  };

  const handleLoadSpringerPreset = async () => {
    try {
      setIsLoadingSpringer(true);
      const res = await getSpringerPreset(styleProfile.book_type ?? "standard", styleProfile.list_style ?? "narrative");
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
      setStyleProfile(res.style_profile ?? {});

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
        style_profile: res.style_profile,
        unresolved_specs: [],
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
      ce_rules: ceRules,
      style_profile: styleProfile,
    };

    if (editingStylesheet) {
      mutations.update.mutate({
        id: editingStylesheet.id,
        payload: {
          name: payload.name,
          description: payload.description,
          ce_rules: payload.ce_rules,
          style_profile: payload.style_profile,
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
                Editorial Rules ({ceRulesQuery.data?.rules.length ?? 118})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === "profile"}
                onClick={() => setSection("profile")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${section === "profile"
                    ? "bg-white text-slate-900 shadow-xs font-semibold"
                    : "text-slate-600 hover:text-slate-900"
                  }`}
              >
                <span>Style Profile &amp; Red Flags</span>
                {totalProfileItems > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    {totalProfileItems}
                  </span>
                )}
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
                          {r.source_label.startsWith("Springer default") ? (
                            <span className="ml-1 text-[9px] font-bold uppercase text-sky-700 bg-sky-50 border border-sky-200 px-1 rounded">default</span>
                          ) : (
                            <span className="ml-1 text-[9px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 rounded">from sheet</span>
                          )}
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

          {section === "profile" ? (
            <StyleProfilePanel
              profile={styleProfile}
              unresolved={docxImportData?.unresolved_specs ?? []}
              onChange={setStyleProfile}
              onBookTypeChange={handleBookTypeChange}
              isApplyingBookType={isApplyingBookType}
            />
          ) : (
            <div>
              {ceRulesQuery.isPending ? (
                <div className="p-12 text-center text-sm text-muted">Loading editorial rules catalog…</div>
              ) : ceRulesQuery.isError ? (
                <div className="p-12 text-center text-sm text-red-600">The editorial rules catalog could not be loaded. Close and reopen to try again.</div>
              ) : (
                <CERulesEditor
                  rules={ceRulesQuery.data.rules}
                  settings={ceRules}
                  onChange={setCeRules}
                  isFullPage={true}
                />
              )}
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

            <div className="flex flex-wrap gap-1.5" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={section === "ce"}
                onClick={() => setSection("ce")}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${section === "ce" ? "bg-primary text-white border-primary" : "bg-white text-text border-border"
                  }`}
              >
                Editorial Rules ({ceRulesQuery.data?.rules.length ?? 118})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === "profile"}
                onClick={() => setSection("profile")}
                className={`px-3 py-1 rounded-full text-xs font-medium border flex items-center gap-1 ${section === "profile" ? "bg-primary text-white border-primary" : "bg-white text-text border-border"
                  }`}
              >
                <span>Style profile</span>
                {totalProfileItems > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900">
                    {totalProfileItems}
                  </span>
                )}
              </button>
            </div>

            {section === "profile" ? (
              <StyleProfilePanel
                profile={styleProfile}
                unresolved={docxImportData?.unresolved_specs ?? []}
                onChange={setStyleProfile}
                onBookTypeChange={handleBookTypeChange}
                isApplyingBookType={isApplyingBookType}
              />
            ) : (
              <div className="space-y-2">
                {ceRulesQuery.isPending ? (
                  <p className="text-xs text-muted">Loading editorial rules…</p>
                ) : ceRulesQuery.isError ? (
                  <p className="text-xs text-red-600">The editorial rules could not be loaded. Close and reopen the stylesheet to try again.</p>
                ) : (
                  <CERulesEditor
                    rules={ceRulesQuery.data.rules}
                    settings={ceRules}
                    onChange={setCeRules}
                    isFullPage={false}
                  />
                )}
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
