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

        <iframe
          src={reportUrl}
          title="DAISY ACE Report"
          className="flex-1 w-full rounded-b-2xl border-0 bg-white"
        />
      </motion.div>
    </div>
  );
}