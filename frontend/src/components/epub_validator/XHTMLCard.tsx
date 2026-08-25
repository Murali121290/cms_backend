import { motion } from 'framer-motion';
import {
  FileCode2,
  Braces,
  Image as ImageIcon,
  BookOpen,
  Eye,
  Play,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
} from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/epubValidatorUtils';
import type { XHTMLFile, XHTMLFileStatus } from '@/types/epubValidator';

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  XHTMLFileStatus,
  { label: string; Icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  pending: {
    label: 'PENDING',
    Icon: Clock,
    className: 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
  },
  passed: {
    label: 'PASSED',
    Icon: CheckCircle2,
    className: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800',
  },
  warning: {
    label: 'WARNING',
    Icon: AlertTriangle,
    className: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
  },
  failed: {
    label: 'FAILED',
    Icon: XCircle,
    className: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800',
  },
};

function StatusBadge({ status }: { status: XHTMLFileStatus }) {
  const { label, Icon, className } = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border',
        className,
      )}
    >
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

// ─── Status body text ────────────────────────────────────────────────────────

function statusText(
  status: XHTMLFileStatus,
  errors: number,
  warnings: number,
): string {
  if (status === 'pending')  return 'Awaiting validation';
  if (status === 'passed')   return 'No issues found';
  const errStr = `${errors} error${errors !== 1 ? 's' : ''}`;
  const warnStr = `${warnings} warning${warnings !== 1 ? 's' : ''}`;
  if (status === 'failed') {
    return warnings > 0 ? `${errStr}, ${warnStr}` : errStr;
  }
  return warnStr;
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export const xhtmlCardVariants = {
  hidden: { opacity: 0, y: 16 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

interface XHTMLCardProps {
  file: XHTMLFile;
  variant?: 'xhtml' | 'css' | 'image' | 'other';
  layoutMode?: 'grid' | 'list';
  status: XHTMLFileStatus;
  errors?: number;
  warnings?: number;
  isValidating?: boolean;
  onValidate?: () => void;
  onPreview?: () => void;
  onOpen: () => void;
  index?: number;
}

export function XHTMLCard({
  file,
  variant = 'xhtml',
  layoutMode = 'grid',
  status,
  errors = 0,
  warnings = 0,
  isValidating = false,
  onValidate,
  onPreview,
  onOpen,
}: XHTMLCardProps) {
  const filePath = file.path ?? file.relative_path ?? '';
  const isCss = variant === 'css';
  const isImage = variant === 'image';
  const isOther = variant === 'other';

  const getIcon = () => {
    if (isCss) return <Braces className="w-4 h-4" />;
    if (isImage) return <ImageIcon className="w-4 h-4" />;
    if (isOther) return <FileCode2 className="w-4 h-4" />;
    return <BookOpen className="w-4 h-4" />;
  };

  const getIconContainerStyle = () => {
    if (isCss) return 'bg-violet-500/10 text-violet-600 dark:text-violet-400';
    if (isImage) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    if (isOther) return 'bg-sky-500/10 text-sky-600 dark:text-sky-400';
    return 'bg-primary/10 text-primary';
  };

  if (layoutMode === 'list') {
    return (
      <motion.div variants={xhtmlCardVariants} whileHover={{ x: 2, transition: { duration: 0.12 } }}>
        <Card className="hover:shadow-md hover:border-primary/30 transition-all duration-150 border border-border/70 bg-card/95 rounded-xl overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between gap-4 font-sans flex-wrap sm:flex-nowrap">
            {/* File Icon & Name & Path */}
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              <div
                className={cn(
                  'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 cursor-pointer transition-transform hover:scale-105',
                  getIconContainerStyle(),
                )}
                onClick={onOpen}
              >
                {getIcon()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
                  <p
                    onClick={onOpen}
                    className="text-xs font-bold text-foreground truncate cursor-pointer hover:text-primary transition-colors font-serif m-0 tracking-tight"
                    title={file.file_name}
                  >
                    {file.file_name}
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground/80 truncate font-mono mt-0.5" title={filePath}>
                  {filePath}
                </p>
              </div>
            </div>

            {/* Errors / Warnings Summary */}
            <div
              onClick={onOpen}
              className="flex items-center gap-2 cursor-pointer text-xs shrink-0 font-medium"
            >
              {errors > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 font-bold text-[11px]">
                  <XCircle className="w-3.5 h-3.5" />
                  {errors} {errors === 1 ? 'Error' : 'Errors'}
                </span>
              )}
              {warnings > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 font-bold text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {warnings} {warnings === 1 ? 'Warning' : 'Warnings'}
                </span>
              )}
              {errors === 0 && warnings === 0 && status === 'passed' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Passed
                </span>
              )}
              {status === 'pending' && (
                <span className="text-slate-400 text-[11px] font-medium flex items-center gap-1 px-2 py-0.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" /> Pending
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0 font-sans">
              {isCss ? (
                <button
                  onClick={onOpen}
                  className="inline-flex flex-row items-center justify-center gap-1.5 px-3.5 py-1.5 h-8.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-primary/10 text-foreground hover:border-primary/40 hover:text-primary transition-all shadow-xs shrink-0 whitespace-nowrap"
                >
                  <Braces className="w-3.5 h-3.5 shrink-0" />
                  <span className="whitespace-nowrap">View Source</span>
                </button>
              ) : isImage ? (
                <>
                  <button
                    onClick={onPreview || onOpen}
                    className="inline-flex flex-row items-center justify-center gap-1.5 px-3.5 py-1.5 h-8.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-primary/10 text-foreground hover:border-primary/40 hover:text-primary transition-all shadow-xs shrink-0 whitespace-nowrap"
                  >
                    <Eye className="w-3.5 h-3.5 shrink-0" />
                    <span className="whitespace-nowrap">View Image</span>
                  </button>
                  {onValidate && (
                    <button
                      onClick={onValidate}
                      disabled={isValidating}
                      aria-label={`Validate ${file.file_name}`}
                      className="inline-flex flex-row items-center justify-center gap-1.5 px-3.5 py-1.5 h-8.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 transition-all shadow-xs disabled:opacity-50 shrink-0 whitespace-nowrap"
                    >
                      {isValidating ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-white" />
                      ) : (
                        <Play className="w-3.5 h-3.5 shrink-0 text-white fill-white" />
                      )}
                      <span className="whitespace-nowrap text-white">{isValidating ? 'Validating…' : 'Validate'}</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    onClick={onPreview || onOpen}
                    aria-label={`Preview ${file.file_name}`}
                    className="inline-flex flex-row items-center justify-center gap-1.5 px-3.5 py-1.5 h-8.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-primary/10 text-foreground hover:border-primary/40 hover:text-primary transition-all shadow-xs shrink-0 whitespace-nowrap"
                  >
                    <Eye className="w-3.5 h-3.5 shrink-0" />
                    <span className="whitespace-nowrap">Preview</span>
                  </button>
                  {onValidate && (
                    <button
                      onClick={onValidate}
                      disabled={isValidating}
                      aria-label={`Validate ${file.file_name}`}
                      className="inline-flex flex-row items-center justify-center gap-1.5 px-3.5 py-1.5 h-8.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 transition-all shadow-xs disabled:opacity-50 shrink-0 whitespace-nowrap"
                    >
                      {isValidating ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-white" />
                      ) : (
                        <Play className="w-3.5 h-3.5 shrink-0 text-white fill-white" />
                      )}
                      <span className="whitespace-nowrap text-white">{isValidating ? 'Validating…' : 'Validate'}</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div variants={xhtmlCardVariants} whileHover={{ y: -2, transition: { duration: 0.12 } }}>
      <Card className="hover:shadow-md transition-shadow duration-200 h-full flex flex-col">
        <CardBody className="pt-4 flex-1 flex flex-col">
          {/* Icon row */}
          <div className="flex items-start justify-between mb-3">
            <div className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0',
              getIconContainerStyle(),
            )}>
              {getIcon()}
            </div>
          </div>

          {/* Filename — clickable to open source/result tab */}
          <p
            onClick={onOpen}
            className="text-sm font-semibold text-foreground truncate mb-0.5 cursor-pointer hover:text-primary transition-colors font-serif"
            title={file.file_name}
          >
            {file.file_name}
          </p>

          {/* Path */}
          <p
            className="text-[11px] text-muted-foreground truncate font-mono mb-3"
            title={filePath}
          >
            {filePath}
          </p>

          {/* Status text / hint */}
          <p
            onClick={!isCss && !isImage ? onOpen : undefined}
            className={cn(
              'text-xs mb-4',
              !isCss && !isImage && 'cursor-pointer',
              !isCss && !isImage && status === 'failed'  ? 'text-red-500 font-semibold'     :
              !isCss && !isImage && status === 'warning' ? 'text-amber-600 font-semibold'   :
              !isCss && !isImage && status === 'passed'  ? 'text-emerald-600 font-semibold' :
              'text-muted-foreground',
            )}
          >
            {isCss
              ? 'Stylesheet — view & edit source'
              : isImage
              ? 'Image asset — graphics'
              : statusText(status, errors, warnings)}
          </p>

          {/* Buttons */}
          <div className="flex items-center gap-2 mt-auto">
            {isCss ? (
              <Button
                size="sm"
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-8.5 text-xs font-semibold px-3 rounded-lg shadow-xs shrink-0 whitespace-nowrap"
                onClick={onOpen}
                aria-label={`Open source for ${file.file_name}`}
              >
                <Braces className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">View Source</span>
              </Button>
            ) : isImage ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 h-8.5 text-xs font-semibold px-3 rounded-lg shadow-xs hover:border-primary/40 hover:text-primary shrink-0 whitespace-nowrap"
                  onClick={onPreview || onOpen}
                  aria-label={`View ${file.file_name}`}
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span className="whitespace-nowrap">View Image</span>
                </Button>
                {onValidate && (
                  <button
                    onClick={onValidate}
                    disabled={isValidating}
                    aria-label={`Validate ${file.file_name}`}
                    className="flex-1 inline-flex flex-row items-center justify-center gap-1.5 h-8.5 text-xs font-semibold px-3 rounded-lg bg-primary text-white hover:bg-primary/90 transition-all shadow-xs disabled:opacity-50 shrink-0 whitespace-nowrap"
                  >
                    {isValidating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-white" />
                    ) : (
                      <Play className="w-3.5 h-3.5 shrink-0 text-white fill-white" />
                    )}
                    <span className="whitespace-nowrap text-white">{isValidating ? 'Validating…' : 'Validate'}</span>
                  </button>
                )}
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 h-8.5 text-xs font-semibold px-3 rounded-lg shadow-xs hover:border-primary/40 hover:text-primary transition-all shrink-0 whitespace-nowrap"
                  onClick={onPreview || onOpen}
                  aria-label={`Preview ${file.file_name}`}
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span className="whitespace-nowrap">Preview</span>
                </Button>
                {onValidate ? (
                  <button
                    onClick={onValidate}
                    disabled={isValidating}
                    aria-label={`Validate ${file.file_name}`}
                    className="flex-1 inline-flex flex-row items-center justify-center gap-1.5 h-8.5 text-xs font-semibold px-3 rounded-lg bg-primary text-white hover:bg-primary/90 transition-all shadow-xs disabled:opacity-50 shrink-0 whitespace-nowrap"
                  >
                    {isValidating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-white" />
                    ) : (
                      <Play className="w-3.5 h-3.5 shrink-0 text-white fill-white" />
                    )}
                    <span className="whitespace-nowrap text-white">{isValidating ? 'Validating…' : 'Validate'}</span>
                  </button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 inline-flex items-center justify-center gap-1.5 h-8.5 text-xs font-semibold px-3 rounded-lg shadow-xs shrink-0 whitespace-nowrap"
                    onClick={onOpen}
                  >
                    <span className="whitespace-nowrap">View Source</span>
                  </Button>
                )}
              </>
            )}
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}

