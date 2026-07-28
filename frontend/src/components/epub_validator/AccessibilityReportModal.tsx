import { motion } from 'framer-motion';
import { X, ShieldCheck, ShieldAlert, ExternalLink } from 'lucide-react';
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

export function AccessibilityReportModal({ report, folderName, onClose }: Props) {
  const totalViolations = report.violations.length;
  const passed = report.status === 'pass' && totalViolations === 0;
  const reportUrl = `/api/v2/post-prod/epub-validator/ace/${encodeURIComponent(folderName)}/report/report.html`;
  const coverage = report.coverage;
  const wcag = report.wcag_breakdown ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <motion.div
        className="bg-background rounded-2xl shadow-2xl border border-border w-full max-w-6xl h-[92vh] flex flex-col"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.18 }}
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-border">
          <div className="flex items-start gap-3 min-w-0">
            {passed ? (
              <ShieldCheck className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground">
                Accessibility Report
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ran {formatWhen(report.ran_at)} · took {report.duration_seconds}s ·
                {' '}powered by DAISY ACE
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <a
              href={reportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open in new tab <ExternalLink className="w-3 h-3" />
            </a>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Summary panel — shows accurate context so a passing (all-zero) run doesn't look empty */}
        <div className="px-5 py-4 border-b border-border bg-muted/30">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs uppercase text-muted-foreground tracking-wide">Result</div>
              <div className={passed ? 'text-emerald-600 font-semibold text-lg' : 'text-amber-600 font-semibold text-lg'}>
                {passed ? 'Passed' : `${totalViolations} violation${totalViolations !== 1 ? 's' : ''}`}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Conformance {report.conformance_level}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground tracking-wide">Coverage</div>
              <div className="text-lg font-semibold text-foreground">
                {coverage?.files_checked ?? '—'} files
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {coverage?.images_inspected ?? 0} images inspected
                {coverage && coverage.images_missing_alt > 0 && (
                  <span className="text-amber-600"> · {coverage.images_missing_alt} without alt</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground tracking-wide">Violation impact</div>
              <div className="text-sm font-medium text-foreground">
                {report.totals.critical} critical · {report.totals.serious} serious
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {report.totals.moderate} moderate · {report.totals.minor} minor
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground tracking-wide">A11y metadata</div>
              <div className="text-sm font-medium text-foreground">
                {report.metadata.accessibility_features.length} features declared
              </div>
              {coverage?.accessibility_metadata_missing && coverage.accessibility_metadata_missing.length > 0 && (
                <div className="text-xs text-amber-600 mt-0.5">
                  missing: {coverage.accessibility_metadata_missing.slice(0, 2).join(', ')}
                  {coverage.accessibility_metadata_missing.length > 2 && ' …'}
                </div>
              )}
            </div>
          </div>

          {wcag.some((r) => r.total > 0) && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-xs uppercase text-muted-foreground tracking-wide mb-1">
                Violations by ruleset
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {wcag.filter((r) => r.total > 0).map((r) => (
                  <span key={r.ruleset} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                    {r.ruleset}: <strong>{r.total}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {passed && (
            <p className="mt-3 text-xs text-emerald-700">
              DAISY ACE + axe-core ran {coverage?.files_checked ?? 0} content documents and found no WCAG 2.0 / 2.1 / 2.2, EPUB, or Best Practice violations.
            </p>
          )}
        </div>

        <iframe
          src={reportUrl}
          title="DAISY ACE Report"
          className="flex-1 w-full rounded-b-2xl border-0 bg-white"
        />
      </motion.div>
    </div>
  );
}