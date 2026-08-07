import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Clock,
  BookOpen,
  Filter,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { EpubCheckReport } from '@/api/epubValidator';

interface Props {
  report: EpubCheckReport;
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

export function EpubCheckReportModal({ report, folderName, onClose }: Props) {
  const [filter, setFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');

  const passed = report.status === 'pass' && report.totals.error === 0;

  const filteredMessages = useMemo(() => {
    if (filter === 'all') return report.messages;
    if (filter === 'error') return report.messages.filter((m) => m.category === 'Error');
    if (filter === 'warning') return report.messages.filter((m) => m.category === 'Warning');
    return report.messages.filter((m) => m.category === 'Info');
  }, [report.messages, filter]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 sm:p-6 overflow-y-auto">
      <motion.div
        className="bg-card rounded-2xl shadow-2xl border border-border w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden font-sans"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl flex items-center justify-center ${
                passed
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
              }`}
            >
              {passed ? (
                <CheckCircle2 className="w-6 h-6 shrink-0" />
              ) : (
                <AlertTriangle className="w-6 h-6 shrink-0" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-lg text-foreground font-serif">
                  W3C EPUBCheck Report
                </h2>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${
                    passed
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                  }`}
                >
                  {passed ? 'Passed' : 'Failed'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <BookOpen className="w-3.5 h-3.5" />
                <span className="font-medium text-foreground">{folderName}</span>
                <span>•</span>
                <Clock className="w-3.5 h-3.5" />
                <span>Checked {formatWhen(report.ran_at)} ({report.duration_seconds}s)</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-background/50">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-border bg-card shadow-2xs">
              <div className="text-xs text-muted-foreground font-medium">Total Messages</div>
              <div className="text-2xl font-bold text-foreground mt-1">
                {report.totals.total}
              </div>
            </div>

            <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 shadow-2xs">
              <div className="text-xs text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5" /> Errors
              </div>
              <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
                {report.totals.error}
              </div>
            </div>

            <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 shadow-2xs">
              <div className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Warnings
              </div>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                {report.totals.warning}
              </div>
            </div>

            <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 shadow-2xs">
              <div className="text-xs text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" /> Info
              </div>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                {report.totals.info}
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Filter by:</span>
              <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    filter === 'all'
                      ? 'bg-card text-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All ({report.totals.total})
                </button>
                <button
                  onClick={() => setFilter('error')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    filter === 'error'
                      ? 'bg-card text-rose-600 dark:text-rose-400 shadow-2xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Errors ({report.totals.error})
                </button>
                <button
                  onClick={() => setFilter('warning')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    filter === 'warning'
                      ? 'bg-card text-amber-600 dark:text-amber-400 shadow-2xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Warnings ({report.totals.warning})
                </button>
                <button
                  onClick={() => setFilter('info')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    filter === 'info'
                      ? 'bg-card text-blue-600 dark:text-blue-400 shadow-2xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Info ({report.totals.info})
                </button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Showing {filteredMessages.length} item{filteredMessages.length !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Messages List */}
          <div className="space-y-3">
            {filteredMessages.length === 0 ? (
              <div className="p-8 text-center bg-card rounded-xl border border-border">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                <p className="text-sm font-medium text-foreground">No issues found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  EPUBCheck did not flag any {filter !== 'all' ? filter : ''} messages for this publication.
                </p>
              </div>
            ) : (
              filteredMessages.map((msg, idx) => (
                <div
                  key={`${msg.id}-${idx}`}
                  className="p-4 rounded-xl bg-card border border-border hover:border-primary/30 transition-all space-y-2 shadow-2xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider shrink-0 mt-0.5 ${
                          msg.category === 'Error'
                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                            : msg.category === 'Warning'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                            : 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                        }`}
                      >
                        {msg.category}
                      </span>
                      <span className="font-mono text-xs font-bold text-foreground bg-muted/60 px-2 py-0.5 rounded shrink-0">
                        {msg.id}
                      </span>
                    </div>

                    {(msg.file_path || msg.line_number) && (
                      <div className="text-xs font-mono text-muted-foreground bg-muted/40 px-2 py-0.5 rounded shrink-0">
                        {msg.file_path ? msg.file_path : ''}
                        {msg.line_number ? ` (L${msg.line_number}${msg.column_number ? `:C${msg.column_number}` : ''})` : ''}
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-foreground/90 leading-relaxed font-sans pl-0.5">
                    {msg.message}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-card flex justify-end shrink-0">
          <Button onClick={onClose} variant="secondary">
            Close Report
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
