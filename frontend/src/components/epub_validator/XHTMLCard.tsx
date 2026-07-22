import { motion } from 'framer-motion';
import { FileCode2, Braces, Eye, Play, Clock, CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
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
    className: 'bg-slate-100 text-slate-500 border-slate-200',
  },
  passed: {
    label: 'PASSED',
    Icon: CheckCircle2,
    className: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  },
  warning: {
    label: 'WARNING',
    Icon: AlertTriangle,
    className: 'bg-amber-50 text-amber-600 border-amber-200',
  },
  failed: {
    label: 'FAILED',
    Icon: XCircle,
    className: 'bg-red-50 text-red-600 border-red-200',
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
  if (status === 'failed')   return `${errors} error${errors !== 1 ? 's' : ''}`;
  return `${warnings} warning${warnings !== 1 ? 's' : ''}`;
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export const xhtmlCardVariants = {
  hidden: { opacity: 0, y: 16 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

interface XHTMLCardProps {
  file: XHTMLFile;
  variant?: 'xhtml' | 'css';
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

  return (
    <motion.div variants={xhtmlCardVariants} whileHover={{ y: -2, transition: { duration: 0.12 } }}>
      <Card className="hover:shadow-md transition-shadow duration-200 h-full flex flex-col">
        <CardBody className="pt-4 flex-1 flex flex-col">
          {/* Icon row + status badge */}
          <div className="flex items-start justify-between mb-3">
            <div className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0',
              isCss ? 'bg-violet-500/10' : 'bg-primary/10',
            )}>
              {isCss
                ? <Braces className="w-5 h-5 text-violet-500" />
                : <FileCode2 className="w-5 h-5 text-primary" />}
            </div>
            {!isCss && <StatusBadge status={status} />}
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

          {/* Status text (XHTML only) / hint (CSS) */}
          <p
            onClick={!isCss ? onOpen : undefined}
            className={cn(
              'text-xs mb-4',
              !isCss && 'cursor-pointer',
              !isCss && status === 'failed'  ? 'text-red-500 font-semibold'     :
              !isCss && status === 'warning' ? 'text-amber-600 font-semibold'   :
              !isCss && status === 'passed'  ? 'text-emerald-600 font-semibold' :
              'text-muted-foreground',
            )}
          >
            {isCss ? 'Stylesheet — view & edit source' : statusText(status, errors, warnings)}
          </p>

          {/* Buttons */}
          <div className="flex gap-2 mt-auto">
            {isCss ? (
              <Button
                size="sm"
                className="flex-1 gap-1.5 text-xs shadow-sm"
                onClick={onOpen}
                aria-label={`Open source for ${file.file_name}`}
              >
                <Braces className="w-3.5 h-3.5" />
                View Source
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1.5 text-xs shadow-sm"
                  onClick={onPreview}
                  aria-label={`Preview ${file.file_name}`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  Preview
                </Button>
                <Button
                  size="sm"
                  className="flex-1 gap-1.5 text-xs shadow-sm"
                  onClick={onValidate}
                  disabled={isValidating}
                  aria-label={`Validate ${file.file_name}`}
                >
                  {isValidating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  {isValidating ? 'Validating…' : 'Validate'}
                </Button>
              </>
            )}
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}
