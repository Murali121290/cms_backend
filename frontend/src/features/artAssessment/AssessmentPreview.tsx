import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { parseAssessmentExcel, type ParseAssessmentExcelResponse } from "@/api/files";
import { getApiErrorMessage } from "@/api/client";

/**
 * Preview an uploaded Art Assessment workbook before running Generate.
 *
 * The parse is read-only on the backend. When the user confirms, the parent
 * runs the normal Generate Assessment flow (POST /generate-figure-assessment)
 * — the modal itself never writes to the DB.
 */

interface AssessmentPreviewProps {
  projectId: number;
  chapterId: number;
  fileId: number;
  filename: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  confirmBusy?: boolean;
}

// Human labels for each canonical field. Keep in sync with
// ``ALIAS_REGISTRY`` keys in the backend parser.
const CANONICAL_LABELS: Record<string, string> = {
  chapter_label: "Chapter",
  figure_no: "Figure No.",
  art_name: "Art Name",
  source_status: "Source Status",
  output_color: "Output Color",
  classification: "Classification",
  editorial_instructions: "Editorial Instructions",
  suggested_sizing: "Suggested Sizing",
  billing_status: "Billing Status",
  complexity: "Complexity",
  queries: "Queries",
  queries_detail: "Queries Details",
  query_replies: "Query Replies",
  batch_no: "Batch No.",
  remarks: "Remarks",
  status: "Status",
  part_no: "Part No.",
  type: "Type",
};

function fieldLabel(field: string): string {
  return CANONICAL_LABELS[field] ?? field;
}

// How many figure rows to render by default. Loading all 300+ rows into the
// DOM at once is wasteful — the user can expand to see more.
const DEFAULT_ROW_LIMIT = 50;


export function AssessmentPreview(props: AssessmentPreviewProps) {
  const { projectId, chapterId, fileId, filename, isOpen, onClose, onConfirm, confirmBusy } = props;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseAssessmentExcelResponse | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [rowLimit, setRowLimit] = useState<number>(DEFAULT_ROW_LIMIT);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setParsed(null);
    setExpandedRow(null);
    setRowLimit(DEFAULT_ROW_LIMIT);

    parseAssessmentExcel(projectId, chapterId, fileId)
      .then((res) => {
        if (!cancelled) setParsed(res);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err) ?? "Failed to parse workbook.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId, chapterId, fileId]);

  // Ordered column list: canonical fields in their source order, then unmapped.
  // Picked from parsed.canonical_columns insertion order (matches source column order).
  const canonicalFieldOrder = useMemo(() => {
    if (!parsed) return [] as string[];
    return Object.keys(parsed.canonical_columns);
  }, [parsed]);

  const rowsToShow = useMemo(() => {
    if (!parsed) return [];
    return parsed.rows.slice(0, rowLimit);
  }, [parsed, rowLimit]);

  const projectInfoEntries = useMemo(() => {
    if (!parsed) return [] as Array<[string, string | null]>;
    return Object.entries(parsed.project_info);
  }, [parsed]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      title="Review Art Assessment"
      description={filename}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted">
            {parsed ? (
              <>
                {parsed.rows.length} figure{parsed.rows.length === 1 ? "" : "s"}
                {" · "}
                {Object.keys(parsed.canonical_columns).length} mapped column
                {Object.keys(parsed.canonical_columns).length === 1 ? "" : "s"}
                {parsed.unmapped_columns.length > 0 && (
                  <>
                    {" · "}
                    {parsed.unmapped_columns.length} unmapped preserved
                  </>
                )}
              </>
            ) : loading ? (
              "Parsing workbook…"
            ) : null}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={confirmBusy}
              className="px-4 py-2 text-sm font-medium text-text bg-background border border-border rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              disabled={loading || !!error || !parsed || confirmBusy}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {confirmBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {confirmBusy ? "Generating…" : "Generate Assessment"}
            </button>
          </div>
        </div>
      }
    >
      {/* Body */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-muted">
          <Loader2 size={20} className="animate-spin mr-2" />
          <span>Parsing workbook…</span>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Could not parse workbook</div>
              <div className="mt-1 whitespace-pre-wrap">{error}</div>
            </div>
          </div>
        </div>
      )}

      {parsed && !loading && !error && (
        <div className="space-y-6">
          {/* Project info */}
          {projectInfoEntries.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-text mb-2">Project Info</h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-border bg-background/40 p-3 text-xs">
                {projectInfoEntries.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted">{label.trim() || "—"}</dt>
                    <dd className="text-text break-words">{value ?? <span className="text-muted/60">—</span>}</dd>
                  </div>
                ))}
              </dl>
              {parsed.project_info_sheet && (
                <p className="mt-1 text-[10px] text-muted">
                  from sheet{" "}
                  <span className="font-mono">{parsed.project_info_sheet}</span>
                </p>
              )}
            </section>
          )}

          {/* Column mapping summary */}
          <section>
            <h3 className="text-sm font-semibold text-text mb-2">Column Mapping</h3>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-background text-muted">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Client header</th>
                    <th className="text-left px-3 py-2 font-medium">Mapped to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {Object.entries(parsed.canonical_columns).map(([field, rawHeader]) => (
                    <tr key={field}>
                      <td className="px-3 py-1.5 font-mono text-text">{rawHeader}</td>
                      <td className="px-3 py-1.5 text-text">{fieldLabel(field)}</td>
                    </tr>
                  ))}
                  {parsed.unmapped_columns.map((raw) => (
                    <tr key={`u-${raw}`} className="bg-amber-50/50">
                      <td className="px-3 py-1.5 font-mono text-text">{raw}</td>
                      <td className="px-3 py-1.5 text-amber-800 italic">
                        preserved verbatim (no canonical match)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.data_sheet_name && (
              <p className="mt-1 text-[10px] text-muted">
                data sheet <span className="font-mono">{parsed.data_sheet_name}</span>, header row {parsed.header_row_index}
              </p>
            )}
          </section>

          {/* Warnings */}
          {parsed.warnings.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-text mb-2 flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-amber-600" />
                Warnings ({parsed.warnings.length})
              </h3>
              <ul className="list-disc list-inside space-y-1 text-xs text-amber-800 bg-amber-50 rounded-lg border border-amber-200 p-3">
                {parsed.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Rows */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-text flex items-center gap-1.5">
                <FileSpreadsheet size={14} />
                Figures ({parsed.rows.length})
              </h3>
            </div>
            {parsed.rows.length === 0 ? (
              <p className="text-xs text-muted">No figure rows detected.</p>
            ) : (
              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-background text-muted">
                    <tr>
                      <th className="w-8"></th>
                      <th className="text-left px-2 py-2 font-medium w-10">#</th>
                      {canonicalFieldOrder.map((field) => (
                        <th
                          key={field}
                          className="text-left px-2 py-2 font-medium whitespace-nowrap"
                        >
                          {fieldLabel(field)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rowsToShow.map((row) => {
                      const hasExtras = Object.keys(row.unmapped).length > 0;
                      const open = expandedRow === row.row_index;
                      return (
                        <ExpandableRow
                          key={row.row_index}
                          open={open}
                          onToggle={() => setExpandedRow(open ? null : row.row_index)}
                          hasExtras={hasExtras}
                          row={row}
                          canonicalFieldOrder={canonicalFieldOrder}
                        />
                      );
                    })}
                  </tbody>
                </table>
                {parsed.rows.length > rowLimit && (
                  <div className="px-3 py-2 text-center text-xs border-t border-border bg-background">
                    Showing {rowLimit} of {parsed.rows.length}.{" "}
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setRowLimit((n) => n + 200)}
                    >
                      Show more
                    </button>{" "}
                    ·{" "}
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setRowLimit(parsed.rows.length)}
                    >
                      Show all
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}


interface ExpandableRowProps {
  open: boolean;
  onToggle: () => void;
  hasExtras: boolean;
  row: ParseAssessmentExcelResponse["rows"][number];
  canonicalFieldOrder: string[];
}

function ExpandableRow({ open, onToggle, hasExtras, row, canonicalFieldOrder }: ExpandableRowProps) {
  return (
    <>
      <tr className="hover:bg-background/40">
        <td className="px-1 align-top">
          {hasExtras ? (
            <button
              type="button"
              onClick={onToggle}
              className="p-1 text-muted hover:text-text"
              aria-label={open ? "Hide additional data" : "Show additional data"}
            >
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : null}
        </td>
        <td className="px-2 py-1.5 text-muted">{row.row_index}</td>
        {canonicalFieldOrder.map((field) => {
          const v = row.canonical[field];
          return (
            <td
              key={field}
              className="px-2 py-1.5 align-top whitespace-nowrap"
              title={v ?? ""}
            >
              {v ?? <span className="text-muted/50">—</span>}
            </td>
          );
        })}
      </tr>
      {open && hasExtras && (
        <tr className="bg-background/60">
          <td></td>
          <td colSpan={canonicalFieldOrder.length + 1} className="px-3 py-2">
            <div className="text-[10px] text-muted mb-1.5 uppercase tracking-wide">
              Additional data (preserved verbatim)
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              {Object.entries(row.unmapped).map(([header, value]) => (
                <div key={header} className="contents">
                  <dt className="font-mono text-muted truncate" title={header}>
                    {header}
                  </dt>
                  <dd className="text-text break-words">
                    {value ?? <span className="text-muted/60">—</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
