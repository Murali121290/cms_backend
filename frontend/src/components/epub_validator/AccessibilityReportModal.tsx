import { motion } from 'framer-motion';
import {
  X,
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
  Clock,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { AceReport } from '@/types/epubValidator';

interface Props {
  report: AceReport;
  folderName: string;
  onClose: () => void;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

export function AccessibilityReportModal({ report, folderName, onClose }: Props) {
  const violations = report?.violations ?? [];
  const totalViolations = violations.length;
  const isFatal = report?.status === 'fatal';
  const passed = !isFatal && report?.status === 'pass' && totalViolations === 0;
  const reportUrl = `/api/v2/post-prod/epub-validator/ace/${encodeURIComponent(folderName)}/report/report.html`;
  const coverage = report?.coverage;
  const wcag = report?.wcag_breakdown ?? [];
  const metadata = report?.metadata ?? {
    title: null,
    language: null,
    identifier: null,
    accessibility_features: [],
    accessibility_summary: null,
    conforms_to: [],
  };
  const features = metadata.accessibility_features ?? [];
  const outline = coverage?.outline_summary;
  const missing = coverage?.accessibility_metadata_missing ?? [];
  const totals = report?.totals ?? { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const hasViolationBreakdown = wcag.some((r) => r.total > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        className="bg-background rounded-2xl shadow-2xl border border-border w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.18 }}
      >
        {/* Compact header — everything summary lives here (≤ ~18% of modal height) */}
        <div
          className={
            passed
              ? 'border-b border-emerald-200 bg-gradient-to-r from-emerald-50/60 via-white to-white'
              : isFatal
              ? 'border-b border-red-200 bg-gradient-to-r from-red-50/60 via-white to-white'
              : 'border-b border-amber-200 bg-gradient-to-r from-amber-50/60 via-white to-white'
          }
        >
          {/* Row 1: identity + result pill + actions */}
          <div className="flex items-center gap-3 px-5 pt-3">
            <div
              className={
                passed
                  ? 'w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm shadow-emerald-500/40 shrink-0'
                  : isFatal
                  ? 'w-8 h-8 rounded-full bg-red-500 flex items-center justify-center shadow-sm shadow-red-500/40 shrink-0'
                  : 'w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center shadow-sm shadow-amber-500/40 shrink-0'
              }
            >
              {passed ? (
                <ShieldCheck className="w-4 h-4 text-white" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-white" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-base font-semibold text-foreground truncate">
                  {metadata.title || folderName}
                </h2>
                <span
                  className={
                    passed
                      ? 'shrink-0 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold'
                      : isFatal
                      ? 'shrink-0 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-300 font-semibold'
                      : 'shrink-0 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 font-semibold'
                  }
                >
                  {passed ? 'Passed' : isFatal ? 'Failed to Run' : `${totalViolations} violation${totalViolations !== 1 ? 's' : ''}`} · {report?.conformance_level || 'N/A'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                {report?.ran_at && (
                  <span className="inline-flex items-center gap-1" title={formatWhen(report.ran_at)}>
                    <Clock className="w-3 h-3" /> {relativeTime(report.ran_at)} · {report.duration_seconds ?? 0}s
                  </span>
                )}
                {metadata.language && (
                  <span>Lang: <span className="text-foreground font-medium">{metadata.language}</span></span>
                )}
                {metadata.identifier && (
                  <span
                    className="font-mono truncate max-w-[18rem]"
                    title={metadata.identifier}
                  >
                    {metadata.identifier}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!isFatal && (
                <>
                  <a
                    href={`/api/v2/post-prod/epub-validator/ace/${encodeURIComponent(folderName)}/download-zip`}
                    download={`${folderName}-ace-report.zip`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition shadow-xs"
                    aria-label="Download ACE report zip"
                  >
                    <Download className="w-3.5 h-3.5" /> Download ZIP
                  </a>
                  <a
                    href={reportUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-border hover:bg-muted transition"
                  >
                    Open full report <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              )}
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                <X className="w-4 h-4" />
              </Button>
            </div>

          </div>

          {/* Row 2: single-line metrics strip */}
          {!isFatal && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 text-xs">
              <Metric label="Documents" value={coverage?.files_checked ?? 0} />
              <Metric
                label="Images"
                value={coverage?.images_inspected ?? 0}
                hint={
                  coverage && coverage.images_missing_alt > 0
                    ? { text: `${coverage.images_missing_alt} no alt`, tone: 'amber' }
                    : undefined
                }
              />
              <Metric label="Headings" value={outline?.headings ?? 0} />
              <Metric label="TOC" value={outline?.toc_entries ?? 0} />

              <span className="text-muted-foreground">·</span>

              <ImpactPill label="Critical" count={totals.critical} tone="high" />
              <ImpactPill label="Serious" count={totals.serious} tone="high" />
              <ImpactPill label="Moderate" count={totals.moderate} tone="mid" />
              <ImpactPill label="Minor" count={totals.minor} tone="mid" />

              {(features.length > 0 || missing.length > 0) && (
                <>
                  <span className="text-muted-foreground">·</span>
                  {features.length > 0 && (
                    <details name="ace-popover" className="relative group">
                      <summary className="cursor-pointer list-none inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition">
                        {features.length} a11y features
                        <span className="text-[10px] group-open:hidden">▸</span>
                        <span className="text-[10px] hidden group-open:inline">▾</span>
                      </summary>
                      <div className="absolute z-20 mt-1 left-0 w-[22rem] max-w-[calc(100vw-3rem)] rounded-md border border-border bg-popover shadow-lg p-2">
                        <div className="flex flex-wrap gap-1">
                          {features.map((f) => (
                            <span
                              key={f}
                              className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-medium"
                            >
                              {f}
                            </span>
                                                      ))}
                        </div>
                      </div>
                    </details>
                  )}
                  {missing.length > 0 && (
                    <details name="ace-popover" className="relative group">
                      <summary
                        className="cursor-pointer list-none inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition"
                        title={missing.join(', ')}
                      >
                        {missing.length} optional metadata
                        <span className="text-[10px] group-open:hidden">▸</span>
                        <span className="text-[10px] hidden group-open:inline">▾</span>
                      </summary>
                      <div className="absolute z-20 mt-1 right-0 w-[22rem] max-w-[calc(100vw-3rem)] rounded-md border border-border bg-popover shadow-lg p-2">
                        <ul className="text-[11px] text-amber-800 space-y-0.5 font-mono">
                          {missing.map((f) => (
                            <li key={f}>· {f}</li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  )}
                </>
              )}

              {hasViolationBreakdown && (
                <>
                  <span className="text-muted-foreground">·</span>
                  {wcag.filter((r) => r.total > 0).map((r) => (
                    <span
                      key={r.ruleset}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200"
                    >
                      {r.ruleset}: <strong>{r.total}</strong>
                    </span>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Report surface */}
        {isFatal ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4 bg-muted/20">
            <ShieldAlert className="w-12 h-12 text-red-500" />
            <h3 className="text-lg font-bold text-foreground">Accessibility Check Encountered an Error</h3>
            <p className="text-xs text-red-800 bg-red-50 p-4 rounded-lg border border-red-200 max-w-2xl font-mono text-left overflow-auto max-h-48 whitespace-pre-wrap">
              {(report as any)?.message || 'ACE did not produce a report.'}
            </p>
            <p className="text-xs text-muted-foreground">
              Click &quot;Re-run accessibility&quot; to attempt the check again with updated settings.
            </p>
          </div>
        ) : (
          <iframe
            src={reportUrl}
            title="DAISY ACE Report"
            className="flex-1 w-full border-0 bg-white"
          />
        )}
      </motion.div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: { text: string; tone: 'amber' | 'red' };
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-semibold text-foreground">{value}</span>
      <span className="text-muted-foreground">{label}</span>
      {hint && (
        <span
          className={
            hint.tone === 'amber'
              ? 'ml-1 text-amber-600 font-medium'
              : 'ml-1 text-red-600 font-medium'
          }
        >
          ({hint.text})
        </span>
      )}
    </span>
  );
}

function ImpactPill({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'high' | 'mid';
}) {
  const clean = count === 0;
  const cls = clean
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : tone === 'high'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-orange-50 text-orange-700 border-orange-200';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] font-medium ${cls}`}>
      <span className="font-bold">{count}</span>
      {label}
    </span>
  );
}
