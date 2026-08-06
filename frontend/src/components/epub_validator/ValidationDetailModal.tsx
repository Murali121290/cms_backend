import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCode2,
  RotateCw,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/epubValidatorUtils';
import { getFileContent, getPdfPage, saveFileContent } from '@/api/epubValidator';
import { SourceEditor } from './SourceEditor';
import type { XHTMLFile, ValidationFileEntry, ValidationIssue } from '@/types/epubValidator';

interface Props {
  file: XHTMLFile;
  folderName: string;
  entries: ValidationFileEntry[];
  isRevalidating?: boolean;
  initialTab?: Tab;
  allowedTabs?: Tab[];
  onClose: () => void;
  onRevalidate?: () => void;
}

export type Tab = 'result' | 'preview' | 'pdf';

type DisplayIssue = ValidationIssue & { _ruleName: string };

// ─── Rule row in left sidebar ────────────────────────────────────────────────

function RuleRow({
  entry,
  isSelected,
  selectedSubRuleName,
  onClick,
  onSubRuleClick,
}: {
  entry: ValidationFileEntry;
  isSelected: boolean;
  selectedSubRuleName: string | null;
  onClick: () => void;
  onSubRuleClick: (name: string) => void;
}) {
  const errors   = entry.result.issues.filter(i => (i.category ?? '').toLowerCase() === 'error').length;
  const warnings = entry.result.issues.filter(i => (i.category ?? '').toLowerCase() !== 'error').length;
  const passed   = entry.result.issues.length === 0;

  const subRuleNames = [...new Set(
    entry.result.issues.map(i => i.rule_name).filter((n): n is string => !!n)
  )];

  return (
    <div>
      <button
        onClick={onClick}
        className={cn(
          'w-full text-left px-3 py-2.5 rounded-lg transition-colors',
          isSelected ? 'bg-primary/10' : 'hover:bg-muted',
        )}
      >
        <div className="flex items-center justify-between gap-1.5 font-serif">
          <span className={cn(
            'text-xs font-medium truncate',
            isSelected ? 'text-primary' : 'text-foreground',
          )}>
            {entry.rule_name}
          </span>
          {passed ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
          ) : errors > 0 ? (
            <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          )}
        </div>
        {!passed && (
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">
            {[
              errors   > 0 && `${errors} error${errors !== 1 ? 's' : ''}`,
              warnings > 0 && `${warnings} warning${warnings !== 1 ? 's' : ''}`,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
      </button>

      {subRuleNames.length > 0 && (
        <div className="ml-3 pl-2 border-l border-border/40 mt-0.5 mb-1 space-y-0.5">
          {subRuleNames.map(name => {
            const subErrors   = entry.result.issues.filter(i => i.rule_name === name && (i.category ?? '').toLowerCase() === 'error').length;
            const subWarnings = entry.result.issues.filter(i => i.rule_name === name && (i.category ?? '').toLowerCase() !== 'error').length;
            const isSubSelected = isSelected && selectedSubRuleName === name;
            return (
              <button
                key={name}
                onClick={(e) => { e.stopPropagation(); onSubRuleClick(name); }}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded transition-colors',
                  isSubSelected ? 'bg-primary/10' : 'hover:bg-muted',
                )}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className={cn(
                    'text-[11px] font-medium truncate',
                    isSubSelected ? 'text-primary' : 'text-foreground',
                  )}>
                    {name}
                  </span>
                  {subErrors > 0
                    ? <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                    : <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                  {[
                    subErrors   > 0 && `${subErrors} error${subErrors !== 1 ? 's' : ''}`,
                    subWarnings > 0 && `${subWarnings} warning${subWarnings !== 1 ? 's' : ''}`,
                  ].filter(Boolean).join(' · ')}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Issue row in right panel ────────────────────────────────────────────────

function IssueRow({ issue, onClick }: { issue: DisplayIssue; onClick?: () => void }) {
  const isError = (issue.category ?? '').toLowerCase() === 'error';
  const hasDiff = issue.expected_text || issue.actual_text;

  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-lg border text-sm overflow-hidden shadow-xs transition-all cursor-pointer hover:shadow-md hover:border-primary/40',
        isError
          ? 'bg-red-50/80 border-red-100 dark:bg-red-950/20 dark:border-red-900/30'
          : 'bg-amber-50/80 border-amber-100 dark:bg-amber-950/20 dark:border-amber-900/30',
      )}
    >
      {/* Main row */}
      <div className="flex items-start gap-3 px-4 py-3">
        {isError ? (
          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className={cn(
              'font-medium text-xs font-serif',
              isError ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400',
            )}>
              {issue.rule_name || issue.type}
            </p>
            {typeof issue.line_number === 'number' && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-colors"
                title="Click to jump to line in source code"
              >
                Line {issue.line_number} →
              </span>
            )}
          </div>
          {issue.message && (
            <p className="text-xs text-muted-foreground mt-0.5 break-words font-sans">{issue.message}</p>
          )}
          {issue.href && (
            <p className="text-xs font-mono text-muted-foreground mt-0.5 break-all opacity-70">{issue.href}</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1 opacity-60 font-mono">{issue._ruleName}</p>
        </div>
        {issue.category && (
          <span className={cn(
            'flex-shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded self-start',
            isError
              ? 'bg-red-100 text-red-600 dark:bg-red-900/40'
              : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40',
          )}>
            {issue.category}
          </span>
        )}
      </div>

      {/* Expected / Actual diff block */}
      {hasDiff && (
        <div className={cn(
          'mx-3 mb-3 rounded-md border overflow-hidden text-xs font-mono',
          isError ? 'bg-red-100/50 border-red-200/60 dark:bg-red-950/40 dark:border-red-900/50' : 'bg-amber-100/50 border-amber-200/60 dark:bg-amber-950/40 dark:border-amber-900/50',
        )}>
          {issue.expected_text && (
            <div className="px-3 py-1.5 flex items-start gap-2 border-b border-inherit">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 shrink-0 w-14 font-sans pt-0.5">Expected</span>
              <span className="text-emerald-800 dark:text-emerald-300 break-words font-mono leading-relaxed">{issue.expected_text}</span>
            </div>
          )}
          {issue.actual_text && (
            <div className="px-3 py-1.5 flex items-start gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 shrink-0 w-14 font-sans pt-0.5">Actual</span>
              <span className="text-red-800 dark:text-red-300 break-words font-mono leading-relaxed">{issue.actual_text}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveRelative(filePath: string, href: string): string {
  const base = filePath.replace(/\\/g, '/');
  const dir  = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  try {
    return new URL(href, `http://x/${dir}`).pathname.slice(1);
  } catch {
    return href;
  }
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export function ValidationDetailModal({ file, folderName, entries, isRevalidating = false, initialTab = 'result', allowedTabs, onClose, onRevalidate }: Props) {
  const visibleTabs: Tab[] = allowedTabs ?? ['result', 'preview'];
  const [activeTab, setActiveTab]       = useState<Tab>(initialTab);
  const [selectedRuleId, setSelectedRule] = useState<string | null>(null);
  const sourceEditorRef = useRef<{ scrollToLine: (lineNum: number) => void } | null>(null);

  // ── Source fetch ─────────────────────────────────────────────────────────────
  const [sourceContent, setSourceContent] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError]     = useState<string | null>(null);

  // ── Source editing ────────────────────────────────────────────────────────────
  const [editedContent, setEditedContent]   = useState<string | null>(null);
  const [isSaving, setIsSaving]             = useState(false);
  const [saveSuccess, setSaveSuccess]       = useState(false);
  const [saveError, setSaveError]           = useState<string | null>(null);
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDirty       = editedContent !== null && editedContent !== sourceContent;
  const displayContent = editedContent ?? sourceContent ?? '';

  const handleIssueClick = (issue: DisplayIssue) => {
    if (activeTab !== 'result' && visibleTabs.includes('result')) {
      setActiveTab('result');
    }
    if (typeof issue.line_number === 'number' && sourceEditorRef.current) {
      sourceEditorRef.current.scrollToLine(issue.line_number);
    }
  };

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  async function handleSave() {
    if (!isDirty || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveFileContent(folderName, filePath, editedContent!);
      setSourceContent(editedContent);  // update baseline
      setEditedContent(null);           // mark clean
      setPreviewUrl(null);              // invalidate cached preview
      setSaveSuccess(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }

  function handleClose() {
    if (isDirty) { setShowCloseWarning(true); } else { onClose(); }
  }

  const filePath = useMemo(() => {
    if (entries.length > 0) return entries[0].file_details.relative_path;
    return file.path ?? file.relative_path ?? file.file_name;
  }, [entries, file]);

  useEffect(() => {
    if (activeTab !== 'result') return;
    if (sourceContent !== null || sourceLoading) return;
    setSourceLoading(true);
    setSourceError(null);
    getFileContent(folderName, filePath)
      .then((text) => setSourceContent(text))
      .catch(() => setSourceError('Could not load file content. Check that the backend exposes GET /files/{folder}/{path}.'))
      .finally(() => setSourceLoading(false));
  }, [activeTab, folderName, filePath, sourceContent, sourceLoading]);

  // ── PDF page lookup ───────────────────────────────────────────────────────────
  const [pdfPage, setPdfPage]             = useState<number | null>(null);
  const [pdfEndPage, setPdfEndPage]       = useState<number | null>(null);
  const [pdfPageLoading, setPdfPageLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== 'pdf' && activeTab !== 'preview') return;
    if (pdfPage !== null || pdfPageLoading) return;
    setPdfPageLoading(true);
    getPdfPage(folderName, file.file_name)
      .then(({ page, end_page }) => { setPdfPage(page); setPdfEndPage(end_page); })
      .catch(() => { setPdfPage(1); setPdfEndPage(1); })
      .finally(() => setPdfPageLoading(false));
  }, [activeTab, folderName, file.file_name, pdfPage, pdfPageLoading]);

  // ── Preview (rendered iframe with inlined CSS + fixed image URLs) ─────────────
  const [previewUrl, setPreviewUrl]         = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError]     = useState<string | null>(null);
  const previewBlobRef = useRef<string | null>(null);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => { if (previewBlobRef.current) URL.revokeObjectURL(previewBlobRef.current); };
  }, []);

  useEffect(() => {
    if (activeTab !== 'preview') return;
    if (previewUrl !== null || previewLoading) return;
    setPreviewLoading(true);
    setPreviewError(null);

    (async () => {
      try {
        let html = await getFileContent(folderName, filePath);

        const norm = filePath.replace(/\\/g, '/');
        const dir  = norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/') + 1) : '';

        // ── 1. Collect all CSS hrefs from <link> tags ─────────────────────
        const cssHrefs = new Set<string>();
        html.replace(/<link\b[^>]*/gi, (tag) => {
          const isSheet = /rel=["']stylesheet["']/i.test(tag) || /type=["']text\/css["']/i.test(tag);
          if (!isSheet) return tag;
          const m = tag.match(/href=["']([^"']+)["']/i);
          if (m && !/^https?:\/\//.test(m[1])) cssHrefs.add(m[1]);
          return tag;
        });

        // ── 2. Fetch every CSS file (parallel) ───────────────────────────
        const cssMap = new Map<string, string>();
        await Promise.all(Array.from(cssHrefs).map(async (href) => {
          try {
            cssMap.set(href, await getFileContent(folderName, resolveRelative(norm, href)));
          } catch { /* skip */ }
        }));

        // ── 3. Replace <link> with <style> so MIME type is never an issue ─
        html = html.replace(/<link\b[^>*]*\/?>/gi, (tag) => {
          const isSheet = /rel=["']stylesheet["']/i.test(tag) || /type=["']text\/css["']/i.test(tag);
          if (!isSheet) return tag;
          const m = tag.match(/href=["']([^"']+)["']/i);
          if (!m) return tag;
          const css = cssMap.get(m[1]);
          return css != null ? `<style type="text/css">\n${css}\n</style>` : tag;
        });

        // ── 4. <base> so images/fonts resolve via backend ─────────────────
        const baseHref = `${window.location.origin}/api/v2/post-prod/epub-validator/file-data/${folderName}/${dir}`;
        html = html.replace(/<base\b[^>]*\/?>/gi, '');
        html = html.replace(
          /(<head\b[^>]*>)/i,
          `$1\n<base href="${baseHref}"/>\n<style type="text/css">a,a:link,a:visited,a:hover,a:active{pointer-events:none!important;cursor:default!important;}</style>`,
        );

        // application/xhtml+xml preserves XML structure (no <a> tag hoisting)
        const blob = new Blob([html], { type: 'application/xhtml+xml' });
        if (previewBlobRef.current) URL.revokeObjectURL(previewBlobRef.current);
        previewBlobRef.current = URL.createObjectURL(blob);
        setPreviewUrl(previewBlobRef.current);
      } catch {
        setPreviewError('Could not generate preview. Is the backend running?');
      } finally {
        setPreviewLoading(false);
      }
    })();
  }, [activeTab, folderName, filePath, previewUrl, previewLoading]);

  const totalErrors = useMemo(
    () => entries.reduce((sum, e) => sum + e.result.issues.filter(i => (i.category ?? '').toLowerCase() === 'error').length, 0),
    [entries],
  );
  const totalWarnings = useMemo(
    () => entries.reduce((sum, e) => sum + e.result.issues.filter(i => (i.category ?? '').toLowerCase() !== 'error').length, 0),
    [entries],
  );

  const [issueFilter, setIssueFilter] = useState<'all' | 'error' | 'warning'>('all');
  const [ruleNameFilter, setRuleNameFilter] = useState<string | null>(null);

  const toggleIssueFilter = (f: 'error' | 'warning') =>
    setIssueFilter((prev) => (prev === f ? 'all' : f));

  const allIssues = useMemo<DisplayIssue[]>(() => {
    if (selectedRuleId) {
      const entry = entries.find(e => e.rule_id === selectedRuleId);
      return (entry?.result.issues ?? []).map(i => ({ ...i, _ruleName: entry?.rule_name ?? '' }));
    }
    return entries.flatMap(e =>
      e.result.issues.map(i => ({ ...i, _ruleName: e.rule_name })),
    );
  }, [entries, selectedRuleId]);

  const displayedIssues = useMemo<DisplayIssue[]>(() => {
    let issues = allIssues;
    if (issueFilter === 'error')   issues = issues.filter(i => (i.category ?? '').toLowerCase() === 'error');
    if (issueFilter === 'warning') issues = issues.filter(i => (i.category ?? '').toLowerCase() !== 'error');
    if (ruleNameFilter)            issues = issues.filter(i => i.rule_name === ruleNameFilter);
    return issues;
  }, [allIssues, issueFilter, ruleNameFilter]);

  const errorCount   = useMemo(() => allIssues.filter(i => (i.category ?? '').toLowerCase() === 'error').length,   [allIssues]);
  const warningCount = useMemo(() => allIssues.filter(i => (i.category ?? '').toLowerCase() !== 'error').length, [allIssues]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleClose}
      />

      {/* Panel */}
      <motion.div
        className="relative z-10 w-full max-w-[95vw] h-[92vh] bg-card rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden"
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <FileCode2 className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate font-serif">{file.file_name}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap font-sans">
                Validation session
                {totalErrors > 0 && (
                  <span className="text-red-500">· {totalErrors} error{totalErrors !== 1 ? 's' : ''}</span>
                )}
                {totalWarnings > 0 && (
                  <span className="text-amber-500">· {totalWarnings} warning{totalWarnings !== 1 ? 's' : ''}</span>
                )}
                {totalErrors === 0 && totalWarnings === 0 && entries.length > 0 && (
                  <span className="text-emerald-500">· all passed</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Save feedback */}
            {saveSuccess && (
              <span className="text-xs text-emerald-600 font-medium flex items-center gap-1 font-sans">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            )}
            {saveError && (
              <span className="text-xs text-red-500 font-medium flex items-center gap-1 font-sans" title={saveError}>
                <XCircle className="w-3.5 h-3.5" /> Save failed
              </span>
            )}
            <button
              type="button"
              className={cn(
                'inline-flex flex-row items-center justify-center gap-2 whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-semibold border border-input bg-background hover:bg-primary/10 hover:border-primary/40 hover:text-primary transition-all shadow-xs disabled:opacity-50 disabled:pointer-events-none',
                isDirty && 'border-primary text-primary bg-primary/5',
              )}
              onClick={handleSave}
              disabled={!isDirty || isSaving}
            >
              {isSaving ? (
                <RotateCw className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <Save className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{isSaving ? 'Saving…' : isDirty ? 'Save*' : 'Save'}</span>
            </button>

            {onRevalidate && (
              <button
                type="button"
                className="inline-flex flex-row items-center justify-center gap-2 whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-semibold border border-input bg-background hover:bg-primary/10 hover:border-primary/40 hover:text-primary transition-all shadow-xs disabled:opacity-50 disabled:pointer-events-none"
                onClick={onRevalidate}
                disabled={isRevalidating}
              >
                <RotateCw className={cn('w-3.5 h-3.5 shrink-0', isRevalidating && 'animate-spin')} />
                <span>{isRevalidating ? 'Validating…' : 'Revalidate'}</span>
              </button>
            )}
            <Button variant="ghost" size="sm" onClick={handleClose} className="ml-1 p-1 h-8 w-8 rounded-md">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* Left sidebar — only on Validation Result tab */}
          {activeTab === 'result' && (
          <div className="w-56 flex-shrink-0 border-r border-border flex flex-col">
            <div className="px-3 pt-3 pb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2">
                Validation Rules
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
              {/* All-issues shortcut */}
              <button
                onClick={() => { setSelectedRule(null); setRuleNameFilter(null); }}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg transition-colors text-xs font-semibold font-serif',
                  selectedRuleId === null
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted text-muted-foreground',
                )}
              >
                All issues
                {(totalErrors + totalWarnings) > 0 && (
                  <span className="ml-1 text-[10px] opacity-70 font-mono">({totalErrors + totalWarnings})</span>
                )}
              </button>

              {entries.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground/60 italic font-sans">
                  No validation data yet.
                </p>
              ) : (
                (() => {
                  // v2 responses tag each entry with origin. If none of the entries
                  // carry the tag we're on legacy — render as a flat list.
                  const hasOrigin = entries.some((e) => e.origin !== undefined);
                  if (!hasOrigin) {
                    return entries.map((entry) => (
                      <RuleRow
                        key={`${entry.rule_id}-${entry.file_details.file_name}`}
                        entry={entry}
                        isSelected={selectedRuleId === entry.rule_id}
                        selectedSubRuleName={selectedRuleId === entry.rule_id ? ruleNameFilter : null}
                        onClick={() => { setSelectedRule(entry.rule_id); setRuleNameFilter(null); }}
                        onSubRuleClick={(name) => { setSelectedRule(entry.rule_id); setRuleNameFilter(name); }}
                      />
                    ));
                  }
                  const generalEntries = entries.filter((e) => e.origin !== 'customer');
                  const customerEntries = entries.filter((e) => e.origin === 'customer');
                  const customerLabel = customerEntries[0]?.customer
                    ? `${customerEntries[0].customer!.charAt(0).toUpperCase()}${customerEntries[0].customer!.slice(1)} Rules`
                    : 'Customer Rules';
                  const renderEntries = (list: ValidationFileEntry[]) =>
                    list.map((entry) => (
                      <RuleRow
                        key={`${entry.rule_id}-${entry.file_details.file_name}`}
                        entry={entry}
                        isSelected={selectedRuleId === entry.rule_id}
                        selectedSubRuleName={selectedRuleId === entry.rule_id ? ruleNameFilter : null}
                        onClick={() => { setSelectedRule(entry.rule_id); setRuleNameFilter(null); }}
                        onSubRuleClick={(name) => { setSelectedRule(entry.rule_id); setRuleNameFilter(name); }}
                      />
                    ));
                  return (
                    <>
                      {generalEntries.length > 0 && (
                        <>
                          <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80">
                            General
                          </p>
                          {renderEntries(generalEntries)}
                        </>
                      )}
                      {customerEntries.length > 0 && (
                        <>
                          <p className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-primary/80">
                            {customerLabel}
                          </p>
                          {renderEntries(customerEntries)}
                        </>
                      )}
                    </>
                  );
                })()
              )}
            </div>
          </div>
          )}

          {/* Right panel */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Tabs */}
            <div className="flex items-center gap-0 px-4 pt-3 border-b border-border flex-shrink-0 font-serif">
              {visibleTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    'px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px',
                    activeTab === tab
                      ? 'text-primary border-primary font-bold'
                      : 'text-muted-foreground border-transparent hover:text-foreground',
                  )}
                >
                  {tab === 'result' ? (<>Validation Result{isDirty && <span className="ml-1 text-amber-500">●</span>}</>)
                    : tab === 'preview' ? 'Preview'
                    : 'PDF'}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto min-h-0 relative">
              <AnimatePresence mode="wait">
                {activeTab === 'result' && (
                  <motion.div
                    key="result"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="h-full flex overflow-hidden font-sans"
                  >
                    {/* Left Column: Validation Findings List */}
                    <div className="w-5/12 h-full border-r border-border flex flex-col min-w-[320px] max-w-[480px]">
                      <div className="px-3.5 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between shrink-0 font-sans">
                        <span className="text-xs font-bold text-foreground font-serif uppercase tracking-wider">
                          Validation Findings ({displayedIssues.length})
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => toggleIssueFilter('error')}
                            className={cn(
                              'px-2 py-0.5 rounded text-[10px] font-bold border transition-all',
                              issueFilter === 'error'
                                ? 'bg-red-500 text-white border-red-500'
                                : 'bg-red-500/10 text-red-600 border-red-500/20 hover:bg-red-500/20',
                            )}
                          >
                            Errors ({errorCount})
                          </button>
                          <button
                            onClick={() => toggleIssueFilter('warning')}
                            className={cn(
                              'px-2 py-0.5 rounded text-[10px] font-bold border transition-all',
                              issueFilter === 'warning'
                                ? 'bg-amber-500 text-white border-amber-500'
                                : 'bg-amber-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/20',
                            )}
                          >
                            Warnings ({warningCount})
                          </button>
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {displayedIssues.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                            <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" />
                            <p className="text-xs font-semibold text-foreground font-serif">No issues found</p>
                            <p className="text-[11px] text-muted-foreground mt-1">All validation checks passed for this file.</p>
                          </div>
                        ) : (
                          displayedIssues.map((issue, i) => (
                            <IssueRow key={i} issue={issue} onClick={() => handleIssueClick(issue)} />
                          ))
                        )}
                      </div>
                    </div>

                    {/* Right Column: Source Code Editor */}
                    <div className="flex-1 h-full flex flex-col min-w-0 bg-background">
                      <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center justify-between shrink-0 font-mono text-xs">
                        <span className="font-semibold text-foreground truncate">{filePath}</span>
                        {isDirty && <span className="text-[10px] font-bold text-amber-500 uppercase font-sans">Unsaved Changes</span>}
                      </div>

                      <div className="flex-1 overflow-hidden relative">
                        {sourceLoading ? (
                          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-xs font-mono">
                            <RotateCw className="w-5 h-5 animate-spin text-primary" />
                            Loading source code…
                          </div>
                        ) : sourceError ? (
                          <div className="p-6 text-red-500 text-xs font-mono">{sourceError}</div>
                        ) : (
                          <SourceEditor
                            ref={sourceEditorRef}
                            value={displayContent}
                            onChange={(val) => setEditedContent(val)}
                            className="h-full"
                            onSave={handleSave}
                          />
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'preview' && (
                  <motion.div
                    key="preview"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="h-full flex"
                  >
                    {/* Left: PDF page */}
                    <div className="w-1/2 h-full border-r border-border flex flex-col">
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground border-b border-border bg-muted/30 flex-shrink-0 flex items-center gap-2">
                        <span>PDF</span>
                        {pdfPage !== null && pdfEndPage !== null && (
                          <span className="normal-case font-normal text-muted-foreground/70">
                            {pdfPage === pdfEndPage
                              ? `p. ${pdfPage}`
                              : `pp. ${pdfPage}–${pdfEndPage}`}
                          </span>
                        )}
                      </div>
                      {pdfPageLoading && (
                        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-sm text-muted-foreground">
                          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Finding page…
                        </div>
                      )}
                      {!pdfPageLoading && pdfPage !== null && (
                        <iframe
                          src={`/api/v2/post-prod/epub-validator/pdf/${folderName}/chapter?file=${encodeURIComponent(file.file_name)}#toolbar=0&navpanes=0&scrollbar=1&pagemode=none&view=FitH`}
                          className="flex-1 w-full border-0"
                          title={`PDF: ${folderName}`}
                        />
                      )}
                    </div>

                    {/* Right: HTML preview */}
                    <div className="w-1/2 h-full flex flex-col">
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground border-b border-border bg-muted/30 flex-shrink-0">
                        HTML
                      </div>
                      {previewLoading && (
                        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-sm text-muted-foreground">
                          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Rendering preview…
                        </div>
                      )}
                      {previewError && (
                        <div className="flex flex-col items-center justify-center flex-1 text-center px-6 gap-2">
                          <XCircle className="w-8 h-8 text-red-400" />
                          <p className="text-sm font-medium text-foreground">Preview failed</p>
                          <p className="text-xs text-muted-foreground">{previewError}</p>
                        </div>
                      )}
                      {previewUrl && !previewLoading && (
                        <iframe
                          src={previewUrl}
                          className="flex-1 w-full border-0 bg-white"
                          sandbox="allow-same-origin"
                          title={`Preview: ${file.file_name}`}
                        />
                      )}
                    </div>
                  </motion.div>
                )}

              </AnimatePresence>
            </div>
          </div>
        </div>
        {/* ── Unsaved-changes close warning ─────────────────────────────── */}
        <AnimatePresence>
          {showCloseWarning && (
            <motion.div
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-2xl"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <motion.div
                className="bg-background rounded-xl shadow-xl border border-border p-6 max-w-sm mx-4 w-full"
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <div className="flex items-start gap-3 mb-5">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-foreground font-serif">Unsaved changes</h3>
                    <p className="text-sm text-muted-foreground mt-1 font-sans">
                      You have unsaved edits in the Source tab. Close anyway and lose your changes?
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 font-sans">
                  <Button variant="outline" onClick={() => setShowCloseWarning(false)}>
                    Keep editing
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => { setShowCloseWarning(false); onClose(); }}
                  >
                    Close anyway
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
