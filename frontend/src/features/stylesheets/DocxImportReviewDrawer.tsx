import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, Loader, X } from "lucide-react";

import { applyDocxImport, dismissDocxImport } from "@/api/stylesheets";
import type {
  DocxImportChange,
  DocxImportKind,
  DocxImportPreviewResponse,
  DocxImportSection,
  StylesheetSummary,
} from "@/types/api";

/**
 * Review the changes an editor made in the S4C Editorial Style Sheet (.docx) and apply the
 * ticked ones. Nothing is saved until "Apply". The server re-reads the .docx on apply.
 */

const SECTIONS: { key: DocxImportSection; title: string }[] = [
  { key: "rules", title: "House style rules" },
  { key: "words", title: "Word list" },
  { key: "orgs", title: "Organization names" },
  { key: "abbr", title: "Abbreviations and symbols" },
  { key: "settings", title: "Units and conventions" },
];

const KIND_TAG: Record<DocxImportKind, { label: string; cls: string }> = {
  changed: { label: "Changed", cls: "bg-[#EAF1FB] text-[#1E5AA8]" },
  edited: { label: "Changed", cls: "bg-[#EAF1FB] text-[#1E5AA8]" },
  enabled: { label: "Enabled", cls: "bg-emerald-50 text-emerald-700" },
  added: { label: "Added", cls: "bg-emerald-50 text-emerald-700" },
  disabled: { label: "Disabled", cls: "bg-red-50 text-red-700" },
  removed: { label: "Removed", cls: "bg-red-50 text-red-700" },
  unresolved: { label: "Choose", cls: "bg-amber-50 text-amber-700" },
  conflict: { label: "Conflict", cls: "bg-purple-50 text-purple-700" },
};

interface Props {
  isOpen: boolean;
  projectId: number;
  stylesheetName: string;
  preview: DocxImportPreviewResponse | null;
  isLoading?: boolean;
  onClose: () => void;
  onApplied: (stylesheet: StylesheetSummary, applied: number) => void;
  onDismissed?: () => void;
}

function errorText(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { detail?: unknown; message?: string } }; message?: string };
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  return e?.response?.data?.message || e?.message || fallback;
}

export function DocxImportReviewDrawer({
  isOpen,
  projectId,
  stylesheetName,
  preview,
  isLoading = false,
  onClose,
  onApplied,
  onDismissed,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolutions, setResolutions] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<DocxImportSection | "all">("all");
  const [busy, setBusy] = useState<"apply" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset when a new preview arrives
  useEffect(() => {
    if (!preview) return;
    setSelected(new Set(preview.changes.filter((c) => c.default_selected).map((c) => c.id)));
    const init: Record<string, number> = {};
    for (const c of preview.changes) {
      if (c.kind === "unresolved" && c.sno != null && c.best_option != null) init[String(c.sno)] = c.best_option;
    }
    setResolutions(init);
    setFilter("all");
    setError(null);
  }, [preview]);

  const changes = preview?.changes ?? [];
  const bySection = useMemo(() => {
    const m = new Map<DocxImportSection, DocxImportChange[]>();
    for (const c of changes) m.set(c.section, [...(m.get(c.section) ?? []), c]);
    return m;
  }, [changes]);

  if (!isOpen) return null;

  const missingChoice = changes.filter(
    (c) => c.kind === "unresolved" && selected.has(c.id) && c.sno != null && !resolutions[String(c.sno)],
  );
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleSection = (items: DocxImportChange[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = items.every((c) => next.has(c.id));
      for (const c of items) {
        if (allOn) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });

  const apply = async () => {
    if (!preview) return;
    setBusy("apply");
    setError(null);
    try {
      const res = await applyDocxImport(projectId, preview.stylesheet_id, {
        source: preview.source,
        upload_token: preview.upload_token,
        filename: preview.source === "ce_support" ? preview.filename : null,
        accepted: [...selected],
        resolutions,
      });
      onApplied(res.stylesheet, res.applied.length);
    } catch (err) {
      setError(errorText(err, "The changes could not be applied."));
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async () => {
    if (!preview) return;
    if (preview.source !== "ce_support") {
      onClose();
      return;
    }
    setBusy("dismiss");
    try {
      await dismissDocxImport(projectId, preview.stylesheet_id, preview.filename);
      onDismissed?.();
    } catch (err) {
      setError(errorText(err, "Could not dismiss the changes."));
    } finally {
      setBusy(null);
    }
  };

  const counts = {
    rules: bySection.get("rules")?.length ?? 0,
    lists: (bySection.get("words")?.length ?? 0) + (bySection.get("orgs")?.length ?? 0),
    abbr: bySection.get("abbr")?.length ?? 0,
    choice: changes.filter((c) => c.kind === "unresolved" || c.kind === "conflict").length,
  };
  const nSelected = changes.filter((c) => selected.has(c.id)).length;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/40" onClick={busy ? undefined : onClose} />
      <aside className="absolute top-0 right-0 bottom-0 w-full max-w-[880px] bg-slate-50 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-navy-100 px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-navy-900">Review changes from Style Sheet (.docx)</h2>
              <p className="text-xs text-navy-500 mt-0.5">
                Tick the changes to apply to <b className="text-navy-800">{stylesheetName}</b>. Nothing is saved until you click Apply.
              </p>
            </div>
            <button type="button" onClick={onClose} className="ml-auto p-1 text-navy-400 hover:text-navy-700" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
          {preview && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[11.5px] text-navy-500">
              <span>File <b className="font-mono text-navy-800">{preview.filename}</b></span>
              <span>Source <b className="text-navy-800">{preview.source === "ce_support" ? "CE support / Style sheet template" : "Uploaded"}</b></span>
              {preview.format === "customer" ? (
                <span><b className="text-navy-800">Customer style sheet</b> (not an S4C export)</span>
              ) : (
                <span>
                  Exported from <b className="font-mono text-navy-800">
                    stylesheet #{preview.exported_from_id ?? "?"} · {(preview.base_hash ?? "—").slice(0, 12)}
                  </b>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {isLoading || !preview ? (
            <div className="flex items-center gap-2 text-sm text-navy-500 p-8 justify-center">
              <Loader className="w-4 h-4 animate-spin" /> Reading the style sheet…
            </div>
          ) : (
            <>
              {preview.stale && (
                <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 mb-3 text-[13px] text-amber-900">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <div>
                    <b>This .docx was exported from an older version of the stylesheet.</b>{" "}
                    {preview.snapshot
                      ? "Only edits made in the .docx are listed; changes made in the app since then are kept unless marked Conflict and ticked."
                      : "Review each change carefully."}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {[
                  [counts.rules, "rule changes"],
                  [counts.lists, "word / org list"],
                  [counts.abbr, "abbreviations"],
                  [counts.choice, "need a decision"],
                ].map(([n, label]) => (
                  <div key={String(label)} className="bg-white border border-navy-100 rounded-lg p-2.5 text-center">
                    <div className="text-xl font-bold text-[#F28C28]">{n}</div>
                    <div className="text-[11px] text-navy-500">{label}</div>
                  </div>
                ))}
              </div>

              {changes.length === 0 ? (
                <div className="bg-white border border-navy-100 rounded-lg p-8 text-center text-sm text-navy-600">
                  No changes found — the .docx matches the stylesheet.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <FilterChip on={filter === "all"} onClick={() => setFilter("all")} label={`All (${changes.length})`} />
                    {SECTIONS.filter((s) => bySection.has(s.key)).map((s) => (
                      <FilterChip
                        key={s.key}
                        on={filter === s.key}
                        onClick={() => setFilter(s.key)}
                        label={`${s.title} (${bySection.get(s.key)!.length})`}
                      />
                    ))}
                  </div>

                  {SECTIONS.filter((s) => bySection.has(s.key) && (filter === "all" || filter === s.key)).map((s, i) => {
                    const items = bySection.get(s.key)!;
                    const allOn = items.every((c) => selected.has(c.id));
                    return (
                      <section key={s.key} className="bg-white border border-navy-100 rounded-xl mb-3 overflow-hidden">
                        <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-[#EAF1FB] border-b border-navy-100">
                          <h3 className="text-[13.5px] font-bold text-[#1E5AA8]">{i + 1} · {s.title}</h3>
                          <span className="text-xs text-navy-500">{items.length} change{items.length === 1 ? "" : "s"}</span>
                          <button type="button" onClick={() => toggleSection(items)} className="ml-auto text-xs text-[#1E5AA8] hover:underline">
                            {allOn ? "Untick all" : "Tick all"}
                          </button>
                        </div>
                        {items.map((c) => (
                          <ChangeRow
                            key={c.id}
                            change={c}
                            checked={selected.has(c.id)}
                            onToggle={() => toggle(c.id)}
                            resolution={c.sno != null ? resolutions[String(c.sno)] : undefined}
                            onResolve={(opt) =>
                              setResolutions((prev) => ({ ...prev, [String(c.sno)]: opt }))
                            }
                          />
                        ))}
                      </section>
                    );
                  })}
                </>
              )}

              {preview.warnings.length > 0 && (
                <div className="flex gap-2.5 rounded-lg border border-navy-100 bg-white p-3 text-[13px] text-navy-700">
                  <Info className="w-4 h-4 shrink-0 mt-0.5 text-navy-400" />
                  <div>
                    <b>{preview.warnings.length} note{preview.warnings.length === 1 ? "" : "s"}</b>
                    <ul className="list-disc pl-4 mt-1 space-y-0.5">
                      {preview.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-white border-t border-navy-100 px-6 py-3 flex flex-wrap items-center gap-2.5">
          <div className="text-[13px] text-navy-500">
            <b className="text-navy-900">{nSelected}</b> of {changes.length} changes selected
            {missingChoice.length > 0 && (
              <span className="text-amber-700"> · {missingChoice.map((c) => c.target).join(", ")} need{missingChoice.length === 1 ? "s" : ""} an option</span>
            )}
            {error && <span className="block text-red-700">{error}</span>}
          </div>
          <div className="flex-1" />
          {preview?.source === "ce_support" && changes.length > 0 && (
            <button
              type="button"
              onClick={dismiss}
              disabled={busy !== null}
              className="h-9 px-3 text-sm rounded-md text-navy-600 hover:bg-navy-50 disabled:opacity-50"
            >
              {busy === "dismiss" ? "Dismissing…" : "Dismiss .docx changes"}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy !== null} className="h-9 px-4 text-sm rounded-md border border-navy-200 bg-white hover:bg-navy-50 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={busy !== null || nSelected === 0 || missingChoice.length > 0 || !preview}
            className="h-9 px-4 text-sm font-semibold rounded-md bg-[#1E5AA8] text-white hover:bg-[#184a8c] disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy === "apply" && <Loader className="w-4 h-4 animate-spin" />}
            Apply {nSelected} change{nSelected === 1 ? "" : "s"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function FilterChip({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-[12.5px] border ${on ? "bg-[#1E5AA8] border-[#1E5AA8] text-white" : "bg-white border-navy-200 text-navy-700 hover:bg-navy-50"}`}
    >
      {label}
    </button>
  );
}

function ChangeRow({
  change: c,
  checked,
  onToggle,
  resolution,
  onResolve,
}: {
  change: DocxImportChange;
  checked: boolean;
  onToggle: () => void;
  resolution?: number;
  onResolve: (option: number) => void;
}) {
  const tag = KIND_TAG[c.kind] ?? KIND_TAG.changed;
  const isRule = c.section === "rules";
  return (
    <div className={`grid grid-cols-[24px_76px_1fr] gap-2.5 items-start px-3.5 py-3 border-t border-navy-50 first:border-t-0 ${checked ? "" : "opacity-60"}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 w-4 h-4 accent-[#1E5AA8]" />
      <span className={`text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded text-center ${tag.cls}`}>{tag.label}</span>
      <div className="min-w-0">
        <div className="font-semibold text-sm text-navy-900">
          {isRule && <span className="font-mono text-navy-400 mr-1.5">{c.target}</span>}
          {c.title}
        </div>
        {c.kind === "unresolved" ? (
          <div className="mt-1">
            <div className="text-xs text-navy-500">
              The .docx says <span className="font-mono text-navy-800">“{c.docx_text}”</span>. Choose the option it means:
            </div>
            <select
              value={resolution ?? ""}
              onChange={(e) => onResolve(Number(e.target.value))}
              className="mt-1.5 w-full max-w-md border border-amber-300 rounded-md px-2 py-1.5 text-sm bg-white"
            >
              <option value="">— Select an option —</option>
              {c.candidates.map((o) => (
                <option key={o.option} value={o.option}>
                  Option {o.option} · {o.label}
                  {o.preview && o.preview !== o.label ? ` (${o.preview})` : ""}
                </option>
              ))}
            </select>
            {c.before && <div className="text-xs text-navy-400 mt-1">Current: {c.before}</div>}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-sm">
              {c.before && (
                <span className={c.kind === "removed" || c.kind === "disabled" || c.after ? "font-mono text-red-700 line-through" : "font-mono"}>
                  {c.before}
                </span>
              )}
              {c.before && c.after && <span className="text-navy-400">→</span>}
              {c.after && <span className="font-mono font-bold text-[#1E5AA8]">{c.after}</span>}
            </div>
            {c.detail && <div className="text-xs text-navy-500 mt-1">{c.detail}</div>}
          </>
        )}
      </div>
    </div>
  );
}
