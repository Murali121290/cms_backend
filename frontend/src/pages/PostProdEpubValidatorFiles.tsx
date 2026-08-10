import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  FileCode2,
  Braces,
  Image as ImageIcon,
  Play,
  Loader2,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Download,
  ShieldCheck,
  CheckSquare,
  Eye,
  User,
  LayoutGrid,
  List,
  BookMarked,
  X as XIcon,
} from 'lucide-react';
import { XHTMLCard, xhtmlCardVariants } from '@/components/epub_validator/XHTMLCard';
import { ValidationDetailModal } from '@/components/epub_validator/ValidationDetailModal';
import { AccessibilityReportModal } from '@/components/epub_validator/AccessibilityReportModal';
import { EpubCheckReportModal } from '@/components/epub_validator/EpubCheckReportModal';
import type { Tab as ModalTab } from '@/components/epub_validator/ValidationDetailModal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { toast } from '@/store/useToastStore';
import { useSessionStore } from '@/stores/sessionStore';
import {
  getFiles,
  validateFolder,
  validateFile,
  exportEpub,
  getCachedAceReport,
  runAceReport,
  getCachedEpubCheckReport,
  runEpubCheckReport,
  type EpubCheckReport,
  listProjects,
  getLatestValidation,
  type EvProject,
} from '@/api/epubValidator';
import { useEpubBookStore } from '@/hooks/useEpubBookStore';
import { cn, formatDate, titleCase } from '@/utils/epubValidatorUtils';
import type { AceReport, ValidationApiResponse, XHTMLFile, XHTMLFileStatus } from '@/types/epubValidator';

// ─── Stagger animation ────────────────────────────────────────────────────────

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};

// ─── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number;
  total: number;
  icon: React.ComponentType<{ className?: string }>;
  barColor: string;
  valueColor: string;
  isActive?: boolean;
  onClick?: () => void;
}

function StatCard({ label, value, total, icon: Icon, barColor, valueColor, isActive, onClick }: StatCardProps) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <Card
      onClick={onClick}
      className={cn(
        'overflow-hidden shadow-xs border border-border/80',
        onClick && 'cursor-pointer transition-all duration-150',
        onClick && !isActive && 'hover:shadow-sm hover:-translate-y-0.5 bg-card',
        isActive && 'ring-2 ring-primary bg-card shadow-sm -translate-y-0.5',
      )}
    >
      <CardBody className="p-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <Icon className={cn('w-3.5 h-3.5', valueColor)} />
        </div>
        <p className={cn('text-xl font-bold font-serif tabular-nums leading-tight', valueColor)}>{value}</p>
        <div className="mt-2 h-1 w-full rounded-full bg-muted overflow-hidden">
          <motion.div
            className={cn('h-full rounded-full', barColor)}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
          />
        </div>
      </CardBody>
    </Card>
  );
}

// ─── Skeleton grid ────────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="animate-pulse bg-muted rounded-xl h-44 sm:h-48 md:h-52" />
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function PostProdEpubValidatorFiles() {
  const params = useParams<{ projectId?: string; folderName?: string }>();
  const navigate = useNavigate();
  const { data: projects = [], isLoading: isLoadingProjects } = useQuery<EvProject[]>({
    queryKey: ['epub-projects'],
    queryFn: listProjects,
    staleTime: 30_000,
  });

  const project = useMemo(() => {
    const pId = params.projectId || params.folderName;
    if (!pId) return null;
    return projects.find((p) => String(p.id) === pId || p.folder_name === pId) || null;
  }, [projects, params]);

  const folderName = project ? project.folder_name : (params.folderName || params.projectId || '');

  const viewer = useSessionStore((s) => s.viewer);
  const isSessionLoading = useSessionStore((s) => s.loading);

  useEffect(() => {
    // Skip access check while projects or session are loading
    if (isLoadingProjects || isSessionLoading || !projects || projects.length === 0 || !project) {
      return;
    }

    const assigned = (project.assignee || '').trim().toLowerCase();
    const myUsername = (viewer?.username || '').trim().toLowerCase();

    if (!assigned) {
      toast.error('This project is not assigned to anyone. Assign it to access it.');
      navigate('/post-production/epub-validator');
      return;
    }

    if (assigned && myUsername && assigned !== myUsername) {
      toast.error(`This project is assigned to ${project.assignee}. You cannot access it.`);
      navigate('/post-production/epub-validator');
    }
  }, [project, projects, isLoadingProjects, isSessionLoading, viewer, navigate]);

  // ── Files from API ──────────────────────────────────────────────────────────
  const { data: filesData, isLoading, isError } = useQuery({
    queryKey: ['epub-files', folderName],
    queryFn: () => getFiles(folderName),
    enabled: !!folderName,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const naturalSort = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  const allBackendFiles = useMemo(
    () => (filesData?.files ?? []).sort((a, b) => naturalSort(a.file_name, b.file_name)),
    [filesData],
  );

  const isNavFile = (fileName: string, path?: string) => {
    const name = fileName.toLowerCase();
    const p = (path || '').toLowerCase();
    return name === 'nav.xhtml' || name === 'nav.html' || name === 'nav.htm' || name === 'nav' || p.endsWith('/nav.xhtml');
  };

  const isImageFile = (fileName: string, path?: string) => {
    const name = fileName.toLowerCase();
    const p = (path || '').toLowerCase();
    const imgExts = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.tiff', '.ico', '.eps', '.tif'];
    return imgExts.some((ext) => name.endsWith(ext)) || p.includes('/images/') || p.includes('/img/');
  };

  // 1) Chapters (.xhtml) - exclude nav
  const xhtmlFiles = useMemo(
    () => (filesData?.files ?? [])
      .filter((f) => {
        const name = f.file_name.toLowerCase();
        const isXhtml = name.endsWith('.xhtml') || name.endsWith('.html') || name.endsWith('.htm');
        return isXhtml && !isNavFile(f.file_name, f.path);
      })
      .sort((a, b) => naturalSort(a.file_name, b.file_name)),
    [filesData],
  );

  // 2) CSS (.css)
  const cssFiles = useMemo(
    () => (filesData?.files ?? [])
      .filter((f) => f.file_name.toLowerCase().endsWith('.css'))
      .sort((a, b) => naturalSort(a.file_name, b.file_name)),
    [filesData],
  );

  // 3) Images
  const imageFiles = useMemo(
    () => (filesData?.files ?? [])
      .filter((f) => isImageFile(f.file_name, f.path))
      .sort((a, b) => naturalSort(a.file_name, b.file_name)),
    [filesData],
  );

  // 4) Other files (nav, content.opf, toc.ncx, container.xml, mimetype, etc.)
  const otherFiles = useMemo(
    () => (filesData?.files ?? [])
      .filter((f) => {
        const name = f.file_name.toLowerCase();
        const isXhtmlChapter = (name.endsWith('.xhtml') || name.endsWith('.html') || name.endsWith('.htm')) && !isNavFile(f.file_name, f.path);
        const isCss = name.endsWith('.css');
        const isImg = isImageFile(f.file_name, f.path);
        return !isXhtmlChapter && !isCss && !isImg;
      })
      .sort((a, b) => naturalSort(a.file_name, b.file_name)),
    [filesData],
  );

  // ── Layout mode (grid vs list view) ──────────────────────────────────────────
  const [layoutMode, setLayoutMode] = useState<'grid' | 'list'>('list');

  // ── Validation state (in-memory only, per session) ─────────────────────────
  // Not persisted: opening/reloading a book always starts on the Pending state
  // so the dashboard never shows stale numbers before the user clicks
  // Validate All. Accessibility (ACE) results are cached server-side and are
  // still fetched on mount — see the useEffect further down.
  const [validationData, setValidationData] = useState<ValidationApiResponse | null>(null);

  // One-time cleanup for keys written by an earlier version that persisted
  // validation results. Safe to remove after users have visited once.
  useEffect(() => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('validation:')) localStorage.removeItem(key);
      }
    } catch { /* noop */ }
  }, []);

  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [aceReport, setAceReport] = useState<AceReport | null>(null);
  const [isAceRunning, setIsAceRunning] = useState(false);
  const [aceError, setAceError] = useState<string | null>(null);
  const [aceModalOpen, setAceModalOpen] = useState(false);
  const [aceElapsed, setAceElapsed] = useState(0);
  const aceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [epubCheckReport, setEpubCheckReport] = useState<EpubCheckReport | null>(null);
  const [isEpubCheckRunning, setIsEpubCheckRunning] = useState(false);
  const [epubCheckError, setEpubCheckError] = useState<string | null>(null);
  const [epubCheckModalOpen, setEpubCheckModalOpen] = useState(false);
  const [epubCheckElapsed, setEpubCheckElapsed] = useState(0);
  const epubCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed-time counter while validation runs
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isValidating) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isValidating]);

  useEffect(() => {
    if (!folderName) return;
    getCachedAceReport(folderName).then((r) => { if (r) setAceReport(r); }).catch(() => undefined);
    getCachedEpubCheckReport(folderName).then((r) => { if (r) setEpubCheckReport(r); }).catch(() => undefined);
    getLatestValidation(folderName).then((res) => { if (res) setValidationData(res); }).catch(() => undefined);
  }, [folderName]);

  useEffect(() => {
    if (isAceRunning) {
      setAceElapsed(0);
      aceTimerRef.current = setInterval(() => setAceElapsed((s) => s + 1), 1000);
    } else if (aceTimerRef.current) {
      clearInterval(aceTimerRef.current);
    }
    return () => { if (aceTimerRef.current) clearInterval(aceTimerRef.current); };
  }, [isAceRunning]);

  useEffect(() => {
    if (isEpubCheckRunning) {
      setEpubCheckElapsed(0);
      epubCheckTimerRef.current = setInterval(() => setEpubCheckElapsed((s) => s + 1), 1000);
    } else if (epubCheckTimerRef.current) {
      clearInterval(epubCheckTimerRef.current);
    }
    return () => { if (epubCheckTimerRef.current) clearInterval(epubCheckTimerRef.current); };
  }, [isEpubCheckRunning]);

  const fmtElapsed = (s: number) =>
    s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

  const mergeValidation = (
    existing: ValidationApiResponse | null,
    incoming: ValidationApiResponse,
  ): ValidationApiResponse => {
    if (!existing) return incoming;
    const incomingNames = new Set(incoming.files.map((e) => e.file_details.file_name));
    return {
      ...existing,
      files: [...existing.files.filter((e) => !incomingNames.has(e.file_details.file_name)), ...incoming.files],
    };
  };

  const handleValidateAll = async () => {
    setIsValidating(true);
    setValidationError(null);
    // Reset to Pending so the dashboard reflects "fresh run in progress"
    // immediately instead of showing the previous run's numbers.
    setValidationData(null);
    try {
      const result = await validateFolder(folderName);
      setValidationData(result);
    } catch {
      setValidationError('Validation request failed. Is the backend running?');
    } finally {
      setIsValidating(false);
    }
  };

  // ── Per-file validation ─────────────────────────────────────────────────────
  const [validatingFiles, setValidatingFiles] = useState<Set<string>>(new Set());

  const handleValidateFile = async (fileName: string) => {
    setValidatingFiles((prev) => {
      const next = new Set(prev);
      next.add(fileName);
      return next;
    });
    setValidationError(null);
    setValidationData((prev) => {
      if (!prev) return prev;
      return { ...prev, files: prev.files.filter((e) => e.file_details.file_name !== fileName) };
    });
    try {
      const result = await validateFile(folderName, fileName);
      setValidationData((prev) => mergeValidation(prev, result));
    } catch {
      setValidationError(`Validation failed for ${fileName}. Is the backend running?`);
    } finally {
      setValidatingFiles((prev) => {
        const next = new Set(prev);
        next.delete(fileName);
        return next;
      });
    }
  };

  const handleRunAce = async () => {
    setIsAceRunning(true);
    setAceError(null);
    try {
      const report = await runAceReport(folderName);
      setAceReport(report);
      setAceModalOpen(true);
    } catch (err) {
      setAceError(err instanceof Error ? err.message : 'Accessibility check failed');
    } finally {
      setIsAceRunning(false);
    }
  };

  const handleRunEpubCheck = async () => {
    setIsEpubCheckRunning(true);
    setEpubCheckError(null);
    try {
      const report = await runEpubCheckReport(folderName);
      setEpubCheckReport(report);
      setEpubCheckModalOpen(true);
    } catch (err) {
      setEpubCheckError(err instanceof Error ? err.message : 'EPUBCheck failed');
    } finally {
      setIsEpubCheckRunning(false);
    }
  };

  // ── Aggregate issues per file ───────────────────────────────────────────────
  const fileIssues = useMemo(() => {
    const map = new Map<string, { errors: number; warnings: number }>();
    if (!validationData) return map;

    for (const entry of validationData.files) {
      const name = entry.file_details.file_name;
      // Skip book-level entries — they are shown in the Book Overview Panel, not on file cards
      if (!name || name === '[book-level]' || name === '') continue;
      const agg = map.get(name) ?? { errors: 0, warnings: 0 };
      for (const issue of entry.result.issues) {
        const isError = (issue.category ?? '').toLowerCase() === 'error';
        if (isError) agg.errors++;
        else agg.warnings++;
      }
      map.set(name, agg);
    }


    return map;
  }, [validationData]);

  const getFileStatus = (fileName: string): XHTMLFileStatus => {
    const agg = fileIssues.get(fileName);

    // mimetype and container.xml are validated at book-level by STRUCT validators
    if ((fileName === 'mimetype' || fileName === 'container.xml') && agg === undefined && validationData) {
      // Check if structure validators passed (STRUCT001, STRUCT002)
      const structValidations = validationData.files.filter(f =>
        (f.rule_id === 'STRUCT001' || f.rule_id === 'STRUCT002') &&
        f.result.issues_count === 0
      );
      if (structValidations.length > 0) return 'passed';
    }

    if (agg === undefined) return 'pending';
    if (agg.errors === 0 && agg.warnings === 0) return 'passed';
    if (agg.errors > 0) return 'failed';
    return 'warning';
  };

  // ── Summary stats ───────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const allFiles = allBackendFiles;
    const total = allFiles.length;
    let passed = 0, warnings = 0, failed = 0, pending = 0;
    for (const f of allFiles) {
      const agg = fileIssues.get(f.file_name);
      if (agg === undefined) { pending++; continue; }
      if (agg.errors === 0 && agg.warnings === 0) passed++;
      else if (agg.errors > 0) failed++;
      else warnings++;
    }
    return { total, passed, warnings, failed, pending };
  }, [allBackendFiles, fileIssues]);

  const hasValidated = validationData !== null;

  // ── Category Tab & Status & Rule filters ─────────────────────────────────────
  const [activeCategoryTab, setActiveCategoryTab] = useState<'chapters' | 'css' | 'images' | 'other' | 'all'>('chapters');
  const [activeFilter, setActiveFilter] = useState<XHTMLFileStatus | null>(null);
  const [selectedRuleFilter, setSelectedRuleFilter] = useState<string | null>(null);

  const toggleFilter = (status: XHTMLFileStatus) => {
    setSelectedRuleFilter(null);
    setActiveFilter((prev) => (prev === status ? null : status));
  };

  const [selectedBookRuleId, setSelectedBookRuleId] = useState<string | null>(null);

  const toggleRuleFilter = (ruleKey: string) => {
    setActiveFilter(null);
    setSelectedBookRuleId(null);
    setSelectedRuleFilter((prev) => (prev === ruleKey ? null : ruleKey));
  };

  const toggleBookRule = (ruleKey: string) => {
    setActiveFilter(null);
    setSelectedRuleFilter(null);
    setSelectedBookRuleId((prev) => (prev === ruleKey ? null : ruleKey));
  };

  // Aggregate rules across all validation data entries
  const ruleSummary = useMemo(() => {
    if (!validationData || !validationData.files) {
      return { generalBook: [], general: [], customer: [], totalErrors: 0, totalWarnings: 0, customerName: null };
    }

    type RuleAgg = {
      rule_id: string;
      rule_name: string;
      errors: number;
      warnings: number;
      files: Set<string>;
      hasFileEntries: boolean; // true if at least one non-book-level entry exists
    };
    const generalBookMap = new Map<string, RuleAgg>(); // general book-scope rules
    const generalMap = new Map<string, RuleAgg>(); // file-scope general rules
    const customerMap = new Map<string, RuleAgg>(); // customer rules (both scopes)
    let totalErrors = 0;
    let totalWarnings = 0;
    let custName: string | null = validationData.customer || null;

    for (const entry of validationData.files) {
      const isCustomer = entry.origin === 'customer';
      if (isCustomer && entry.customer && !custName) custName = entry.customer;

      // Detect book-scope entries: [book-level] file_name or empty
      const fname = entry.file_details.file_name;
      const isBookScope = !fname || fname === '[book-level]' || fname === '';

      // Customer rules always go to customerMap regardless of scope.
      // General book-scope rules go to generalBookMap; file-scope general rules go to generalMap.
      const targetMap = isCustomer ? customerMap : isBookScope ? generalBookMap : generalMap;
      const key = entry.rule_id || entry.rule_name;

      const item = targetMap.get(key) ?? {
        rule_id: entry.rule_id,
        rule_name: entry.rule_name,
        errors: 0,
        warnings: 0,
        files: new Set<string>(),
        hasFileEntries: false,
      };

      let entryHasErrors = false;
      let entryHasWarnings = false;

      for (const issue of entry.result.issues) {
        const isErr = (issue.category ?? '').toLowerCase() === 'error';
        if (isErr) {
          item.errors++;
          totalErrors++;
          entryHasErrors = true;
        } else {
          item.warnings++;
          totalWarnings++;
          entryHasWarnings = true;
        }
      }

      if (!isBookScope && (entry.result.issues.length > 0 || entryHasErrors || entryHasWarnings)) {
        item.files.add(fname);
        item.hasFileEntries = true;
      }

      targetMap.set(key, item);
    }

    return {
      generalBook: Array.from(generalBookMap.values()),
      general: Array.from(generalMap.values()),
      customer: Array.from(customerMap.values()),
      totalErrors,
      totalWarnings,
      customerName: custName,
    };
  }, [validationData]);

  // Set of filenames that contain errors/warnings matching the selected rule
  const ruleMatchingFiles = useMemo(() => {
    if (!selectedRuleFilter || !validationData) return null;
    const matching = new Set<string>();
    for (const entry of validationData.files) {
      const key = entry.rule_id || entry.rule_name;
      const name = entry.file_details.file_name;
      // Skip book-level entries — they don't correspond to a file card
      if (!name || name === '[book-level]' || name === '') continue;
      if (key === selectedRuleFilter && entry.result.issues.length > 0) {
        matching.add(name);
      }
    }


    return matching;
  }, [selectedRuleFilter, validationData]);

  const visibleXhtmlFiles = useMemo(() => {
    if (selectedRuleFilter && ruleMatchingFiles) {
      return xhtmlFiles.filter((f) => ruleMatchingFiles.has(f.file_name));
    }
    if (activeFilter) {
      return xhtmlFiles.filter((f) => getFileStatus(f.file_name) === activeFilter);
    }
    return xhtmlFiles;
  }, [xhtmlFiles, activeFilter, selectedRuleFilter, ruleMatchingFiles, fileIssues]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleCssFiles = useMemo(() => {
    if (selectedRuleFilter) return [];
    if (activeFilter) {
      return cssFiles.filter((f) => getFileStatus(f.file_name) === activeFilter);
    }
    return cssFiles;
  }, [cssFiles, activeFilter, selectedRuleFilter]);

  const visibleImageFiles = useMemo(() => {
    if (selectedRuleFilter) return [];
    if (activeFilter) {
      return imageFiles.filter((f) => getFileStatus(f.file_name) === activeFilter);
    }
    return imageFiles;
  }, [imageFiles, activeFilter, selectedRuleFilter]);

  const visibleOtherFiles = useMemo(() => {
    if (selectedRuleFilter && ruleMatchingFiles) {
      return otherFiles.filter((f) => ruleMatchingFiles.has(f.file_name));
    }
    if (activeFilter) {
      return otherFiles.filter((f) => getFileStatus(f.file_name) === activeFilter);
    }
    return otherFiles;
  }, [otherFiles, activeFilter, selectedRuleFilter, ruleMatchingFiles, fileIssues]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalVisibleCount = visibleXhtmlFiles.length + visibleCssFiles.length + visibleImageFiles.length + visibleOtherFiles.length;

  // ── Export state ────────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false);
  const [exportErrorMsg, setExportErrorMsg] = useState<string | null>(null);
  const [exportConfirmMsg, setExportConfirmMsg] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);
  const exportSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (exportSuccessTimer.current) clearTimeout(exportSuccessTimer.current); }, []);

  function triggerDownload(blob: Blob, filename: string = `${folderName}.epub`) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  async function doExport(force: boolean) {
    setIsExporting(true);
    setExportErrorMsg(null);
    try {
      const result = await exportEpub(
        folderName,
        { failed: stats.failed, warnings: stats.warnings, pending: stats.pending },
        force,
      );
      if ('blob' in result) {
        triggerDownload(result.blob, result.filename);
        setExportSuccess(true);
        if (exportSuccessTimer.current) clearTimeout(exportSuccessTimer.current);
        exportSuccessTimer.current = setTimeout(() => setExportSuccess(false), 4000);
      } else if ('status' in result && result.status === 'confirm') {
        setExportConfirmMsg(result.message);
      }
    } catch (err) {
      setExportErrorMsg(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  }

  const handleExport = () => doExport(false);
  const handleExportConfirmed = () => { setExportConfirmMsg(null); doExport(true); };

  // ── Preview modal state ─────────────────────────────────────────────────────
  const [selectedFile, setSelectedFile] = useState<XHTMLFile | null>(null);
  const [modalInitialTab, setModalInitialTab] = useState<ModalTab>('result');
  const [modalAllowedTabs, setModalAllowedTabs] = useState<ModalTab[] | undefined>(undefined);

  const selectedEntries = useMemo(() => {
    if (!selectedFile || !validationData) return [];
    // Only show entries for this specific file — never mix in [book-level] entries
    return validationData.files.filter(
      (e) => e.file_details.file_name === selectedFile.file_name,
    );
  }, [selectedFile, validationData]);


  return (
    <>
      <AnimatePresence>
        {aceModalOpen && aceReport && (
          <AccessibilityReportModal
            report={aceReport}
            folderName={folderName}
            onClose={() => setAceModalOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {epubCheckModalOpen && epubCheckReport && (
          <EpubCheckReportModal
            report={epubCheckReport}
            folderName={folderName}
            onClose={() => setEpubCheckModalOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedFile && (
          <ValidationDetailModal
            key={selectedFile.file_name}
            file={selectedFile}
            folderName={folderName}
            entries={selectedEntries}
            isRevalidating={validatingFiles.has(selectedFile.file_name)}
            initialTab={modalInitialTab}
            allowedTabs={modalAllowedTabs}
            onClose={() => setSelectedFile(null)}
            onRevalidate={
              !modalAllowedTabs || modalAllowedTabs.includes('result')
                ? () => handleValidateFile(selectedFile.file_name)
                : undefined
            }
          />
        )}
      </AnimatePresence>

      {/* ── Export error modal ────────────────────────────────────────────── */}
      <AnimatePresence>
        {exportErrorMsg && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <motion.div
              className="bg-background rounded-2xl shadow-2xl border border-border w-full max-w-md mx-4 p-6"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.18 }}
            >
              <div className="flex items-start gap-3 mb-5">
                <XCircle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
                <div>
                  <h2 className="font-semibold text-foreground font-serif">Export Error</h2>
                  <p className="text-sm text-muted-foreground mt-1 font-sans">{exportErrorMsg}</p>
                </div>
              </div>
              <div className="flex justify-end font-sans">
                <Button onClick={() => setExportErrorMsg(null)}>Close</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Export confirm modal ──────────────────────────────────────────── */}
      <AnimatePresence>
        {exportConfirmMsg && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <motion.div
              className="bg-background rounded-2xl shadow-2xl border border-border w-full max-w-md mx-4 p-6"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.18 }}
            >
              <div className="flex items-start gap-3 mb-5">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <h2 className="font-semibold text-foreground font-serif">Export with Issues?</h2>
                  <p className="text-sm text-muted-foreground mt-1 font-sans">{exportConfirmMsg}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 font-sans">
                <Button variant="outline" onClick={() => setExportConfirmMsg(null)}>
                  Cancel
                </Button>
                <Button onClick={handleExportConfirmed}>Proceed</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <motion.div
        className="space-y-6 max-w-7xl mx-auto p-6 text-text"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.22 }}
      >
        {/* ── Sticky header ──────────────────────────────────────────────────── */}
        <div className="border-b border-border/60 pb-4 flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/post-production/epub-validator')}
              className="shrink-0 h-9 w-9 p-0 rounded-lg mt-0.5"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1
                  className="text-2xl font-bold font-serif text-text tracking-tight truncate m-0"
                  title={project?.project_name || folderName}
                >
                  {project?.project_name || folderName}
                </h1>
                {project && (
                  <span
                    className={`capitalize font-bold px-2 py-0.5 rounded-md text-[9px] border shrink-0 ${project.validation_status === 'pass' || project.validation_status === 'validated' || project.validation_status === 'Completed'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      : project.validation_status === 'in_progress' || project.validation_status === 'in-progress' || project.validation_status === 'In Progress'
                        ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                        : 'bg-primary/10 border-primary/20 text-primary'
                      }`}
                  >
                    {project.validation_status === 'pass' || project.validation_status === 'validated' || project.validation_status === 'Completed'
                      ? 'Completed'
                      : project.validation_status === 'in_progress' || project.validation_status === 'in-progress' || project.validation_status === 'In Progress'
                        ? 'In Progress'
                        : 'Active'}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted mt-1 flex items-center gap-2 flex-wrap font-sans">
                {project ? (
                  <>
                    <span>
                      {project.client} {project.client_code && `(${project.client_code})`}
                    </span>
                    <span className="text-border">·</span>
                    <span className="inline-flex items-center gap-1 text-muted">
                      <User size={12} className="text-muted/70" />
                      <span>{project.assignee || 'Not Assigned'}</span>
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-[11px] font-semibold">{folderName}</span>
                )}
                {validationData && validationData.customer !== undefined && (
                  <>
                    <span className="text-border">·</span>
                    {validationData.customer ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                        title={`Detected customer: ${validationData.customer}`}
                      >
                        {validationData.customer}
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                        title="No customer rules matched — running general rules only"
                      >
                        General only
                      </span>
                    )}
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0 font-sans">
            {/* Main top action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleValidateAll}
                disabled={isValidating || isLoading}
                className="inline-flex flex-row items-center justify-center gap-2 px-4 py-2 h-9 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
              >
                {isValidating ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0 text-white" />
                ) : (
                  <Play className="w-4 h-4 shrink-0 text-white fill-white" />
                )}
                <span className="whitespace-nowrap text-white">
                  {isValidating
                    ? `Validating… ${fmtElapsed(elapsed)}`
                    : hasValidated ? 'Re-run validation' : 'Validate all'}
                </span>
              </button>

              <button
                onClick={handleRunEpubCheck}
                disabled={isEpubCheckRunning || isLoading}
                className="inline-flex flex-row items-center justify-center gap-2 px-4 py-2 h-9 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-primary/10 text-foreground hover:border-primary/40 hover:text-primary transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
              >
                {isEpubCheckRunning ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                ) : (
                  <CheckSquare className="w-4 h-4 shrink-0" />
                )}
                <span className="whitespace-nowrap">
                  {isEpubCheckRunning ? `EPUBCheck… ${fmtElapsed(epubCheckElapsed)}` : epubCheckReport ? 'Re-run EPUBCheck' : 'Run EPUBCheck'}
                </span>
              </button>

              <button
                onClick={handleRunAce}
                disabled={isAceRunning || isLoading}
                className="inline-flex flex-row items-center justify-center gap-2 px-4 py-2 h-9 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-primary/10 text-foreground hover:border-primary/40 hover:text-primary transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
              >
                {isAceRunning ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                ) : (
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                )}
                <span className="whitespace-nowrap">
                  {isAceRunning ? `Checking… ${fmtElapsed(aceElapsed)}` : aceReport ? 'Re-run accessibility' : 'Accessibility check'}
                </span>
              </button>

              <button
                onClick={handleExport}
                disabled={isExporting || isLoading || isValidating}
                className="inline-flex flex-row items-center justify-center gap-2 px-4 py-2 h-9 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-primary/10 text-foreground hover:border-primary/40 hover:text-primary transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
              >
                {isExporting ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                ) : (
                  <Download className="w-4 h-4 shrink-0" />
                )}
                <span className="whitespace-nowrap">{isExporting ? 'Exporting…' : 'Export EPUB'}</span>
              </button>
            </div>


            {/* Secondary row below: View report options */}
            {(aceReport || epubCheckReport) && (
              <div className="flex items-center gap-2 flex-wrap text-xs pt-0.5">
                {aceReport && !isAceRunning && (
                  <button
                    onClick={() => setAceModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-all border border-primary/20"
                  >
                    <Eye className="w-3.5 h-3.5 shrink-0" />
                    <span>View Accessibility Report</span>
                  </button>
                )}

                {epubCheckReport && !isEpubCheckRunning && (
                  <button
                    onClick={() => setEpubCheckModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-all border border-primary/20"
                  >
                    <Eye className="w-3.5 h-3.5 shrink-0" />
                    <span>View EPUBCheck Report</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Indeterminate progress stripe while validating */}
        {isValidating && (
          <div className="h-0.5 w-full bg-muted overflow-hidden relative">
            <motion.div
              className="h-full w-1/3 bg-primary rounded-full absolute"
              animate={{ x: ['-100%', '400%'] }}
              transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
            />
          </div>
        )}

        {/* ── Content ────────────────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Validation error banner */}
          {validationError && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-xs text-danger font-sans">
              <XCircle className="w-4 h-4 flex-shrink-0" />
              {validationError}
            </div>
          )}

          {/* Accessibility check error banner */}
          {aceError && (
            <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-xs text-danger font-sans">
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{aceError}</span>
              </div>
              <button
                onClick={() => setAceError(null)}
                className="text-xs font-semibold hover:underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Export success banner */}
          <AnimatePresence>
            {exportSuccess && (
              <motion.div
                className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900/40 dark:text-emerald-400 font-sans"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                EPUB exported successfully — check your downloads.
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Categorized file cards layout (with Rules Sidebar if validated) ─────────── */}
          {isLoading ? (
            <SkeletonGrid />
          ) : isError || !filesData?.status ? (
            <EmptyState
              icon={FileCode2}
              title="Could not load files"
              description="Make sure the folder is existing and accessible."
              action={
                <Button onClick={() => navigate('/post-production/epub-validator')} className="font-semibold text-xs">
                  Back to Dashboard
                </Button>
              }
            />
          ) : allBackendFiles.length === 0 ? (
            <EmptyState
              icon={FileCode2}
              title="No files found"
              description="This EPUB folder doesn't contain any files."
              action={
                <Button onClick={() => navigate('/post-production/epub-validator')} className="font-semibold text-xs">
                  Back to Dashboard
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col lg:flex-row gap-6 items-start">
              {/* Left Rules Sidebar (Validation Rules with Scroll Option) */}
              {hasValidated && (ruleSummary.generalBook.length > 0 || ruleSummary.general.length > 0 || ruleSummary.customer.length > 0) && (
                <div className="w-full lg:w-80 xl:w-96 shrink-0 bg-card rounded-xl border border-border/80 shadow-sm p-4 space-y-4 font-sans">
                  <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                    <div>
                      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-serif">
                        Validation Rules
                      </h2>
                      <p className="text-[11px] text-muted-foreground mt-0.5 font-sans">
                        Click a rule to explore issues
                      </p>
                    </div>
                    {(selectedRuleFilter || selectedBookRuleId) && (
                      <button
                        onClick={() => { setSelectedRuleFilter(null); setSelectedBookRuleId(null); }}
                        className="text-[11px] text-primary hover:underline font-semibold"
                      >
                        Reset
                      </button>
                    )}
                  </div>

                  <div className="space-y-4 max-h-[calc(100vh-14rem)] min-h-[250px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-border font-sans">

                    {/* ── General Book Rules (book-scope) ───────────────────── */}
                    {ruleSummary.generalBook.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-1.5">
                            <BookMarked className="w-3 h-3 text-slate-500" />
                            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                              General Book
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            ({ruleSummary.generalBook.length})
                          </span>
                        </div>
                        <div className="space-y-1">
                          {ruleSummary.generalBook.map((r) => {
                            const isSelected = selectedBookRuleId === (r.rule_id || r.rule_name);
                            return (
                              <button
                                key={r.rule_id || r.rule_name}
                                onClick={() => toggleBookRule(r.rule_id || r.rule_name)}
                                className={cn(
                                  'w-full text-left p-2.5 rounded-xl transition-all border text-xs flex items-start justify-between gap-2.5',
                                  isSelected
                                    ? 'bg-slate-500/10 border-slate-500/40 ring-1 ring-slate-500/30 text-slate-700 dark:text-slate-300 font-bold shadow-xs'
                                    : 'bg-card hover:bg-slate-500/5 hover:border-slate-500/30 border-border/60 text-foreground transition-all duration-150',
                                )}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {r.rule_id && (
                                      <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-1 py-0.2 rounded shrink-0">
                                        {r.rule_id}
                                      </span>
                                    )}
                                    <p className="font-medium font-serif truncate leading-tight">
                                      {r.rule_name}
                                    </p>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                                    Book-scope rule
                                  </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                                  {r.errors > 0 && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-600 dark:text-red-400">
                                      <XCircle className="w-3 h-3" />
                                      {r.errors}
                                    </span>
                                  )}
                                  {r.warnings > 0 && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                      <AlertTriangle className="w-3 h-3" />
                                      {r.warnings}
                                    </span>
                                  )}
                                  {r.errors === 0 && r.warnings === 0 && (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* ── General File Rules ─────────────────────────────────── */}
                    {ruleSummary.general.length > 0 && (
                      <div className={cn('space-y-1.5', ruleSummary.generalBook.length > 0 && 'pt-2 border-t border-border/40')}>
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-1.5">
                            <FileCode2 className="w-3 h-3 text-foreground/60" />
                            <span className="text-[11px] font-bold text-foreground/80 uppercase tracking-wide">
                              General
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            ({ruleSummary.general.length})
                          </span>
                        </div>
                        <div className="space-y-1">
                          {ruleSummary.general.map((r) => {
                            const isSelected = selectedRuleFilter === (r.rule_id || r.rule_name);
                            return (
                              <button
                                key={r.rule_id || r.rule_name}
                                onClick={() => toggleRuleFilter(r.rule_id || r.rule_name)}
                                className={cn(
                                  'w-full text-left p-2.5 rounded-xl transition-all border text-xs flex items-start justify-between gap-2.5',
                                  isSelected
                                    ? 'bg-primary/10 border-primary/40 ring-1 ring-primary/30 text-primary font-bold shadow-xs'
                                    : 'bg-card hover:bg-primary/5 hover:border-primary/30 hover:text-primary border-border/60 text-foreground transition-all duration-150',
                                )}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {r.rule_id && (
                                      <span className="font-mono text-[10px] font-bold text-muted-foreground bg-muted px-1 py-0.2 rounded shrink-0">
                                        {r.rule_id}
                                      </span>
                                    )}
                                    <p className="font-medium font-serif truncate leading-tight">
                                      {r.rule_name}
                                    </p>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                                    {r.files.size} file{r.files.size !== 1 ? 's' : ''} affected
                                  </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                                  {r.errors > 0 && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-600 dark:text-red-400">
                                      <XCircle className="w-3 h-3" />
                                      {r.errors}
                                    </span>
                                  )}
                                  {r.warnings > 0 && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                      <AlertTriangle className="w-3 h-3" />
                                      {r.warnings}
                                    </span>
                                  )}
                                  {r.errors === 0 && r.warnings === 0 && (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* ── Customer Rules ─────────────────────────────────────── */}
                    {ruleSummary.customer.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-border/40">
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-1.5">
                            <User className="w-3 h-3 text-primary" />
                            <span className="text-[11px] font-bold text-primary uppercase tracking-wide">
                              {ruleSummary.customerName
                                ? `${ruleSummary.customerName.charAt(0).toUpperCase()}${ruleSummary.customerName.slice(1)} Rules`
                                : 'Customer Rules'}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            ({ruleSummary.customer.length})
                          </span>
                        </div>
                        <div className="space-y-1">
                          {ruleSummary.customer.map((r) => {
                            // If this rule has no file-level entries, it's book-scope — use toggleBookRule
                            const isBookOnlyRule = !r.hasFileEntries && (r.errors > 0 || r.warnings > 0);
                            const ruleKey = r.rule_id || r.rule_name;
                            const isSelected = isBookOnlyRule
                              ? selectedBookRuleId === ruleKey
                              : selectedRuleFilter === ruleKey;
                            return (
                              <button
                                key={ruleKey}
                                onClick={() => isBookOnlyRule ? toggleBookRule(ruleKey) : toggleRuleFilter(ruleKey)}
                                className={cn(
                                  'w-full text-left p-2.5 rounded-xl transition-all border text-xs flex items-start justify-between gap-2.5',
                                  isSelected
                                    ? 'bg-primary/10 border-primary/40 ring-1 ring-primary/30 text-primary font-bold shadow-xs'
                                    : 'bg-card hover:bg-primary/5 hover:border-primary/30 hover:text-primary border-border/60 text-foreground transition-all duration-150',
                                )}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {r.rule_id && (
                                      <span className="font-mono text-[10px] font-bold text-primary/80 bg-primary/10 px-1 py-0.2 rounded shrink-0">
                                        {r.rule_id}
                                      </span>
                                    )}
                                    <p className="font-medium font-serif truncate leading-tight">
                                      {r.rule_name}
                                    </p>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                                    {isBookOnlyRule ? 'Book-scope rule' : `${r.files.size} file${r.files.size !== 1 ? 's' : ''} affected`}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                                  {r.errors > 0 && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-600 dark:text-red-400">
                                      <XCircle className="w-3 h-3" />
                                      {r.errors}
                                    </span>
                                  )}
                                  {r.warnings > 0 && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                      <AlertTriangle className="w-3 h-3" />
                                      {r.warnings}
                                    </span>
                                  )}
                                  {r.errors === 0 && r.warnings === 0 && (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Main Right Area: Summary Stats + Top Category Tabs on top, Files below */}
              <div className="flex-1 min-w-0 space-y-6">

                {/* ── Book Overview Panel (shown when a General Book or customer book-scope rule is selected) ─── */}
                {selectedBookRuleId && (() => {
                  const bookEntries = validationData?.files.filter(
                    (e) => (e.rule_id || e.rule_name) === selectedBookRuleId &&
                      (!e.file_details.file_name || e.file_details.file_name === '[book-level]' || e.file_details.file_name === '')
                  ) ?? [];
                  // Look up rule metadata from both generalBook and customer lists
                  const bookRule = [...ruleSummary.generalBook, ...ruleSummary.customer].find(
                    (r) => (r.rule_id || r.rule_name) === selectedBookRuleId
                  );
                  const allIssues = bookEntries.flatMap((e) => e.result.issues);
                  return (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4 shadow-sm font-sans">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-3 gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <BookMarked className="w-4 h-4 text-slate-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-foreground font-serif truncate">
                              {bookRule?.rule_name ?? selectedBookRuleId}
                            </p>
                            <p className="text-[11px] font-mono text-slate-500 mt-0.5">{selectedBookRuleId} · Book-scope</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {(bookRule?.errors ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
                              <XCircle className="w-3 h-3" /> {bookRule!.errors} error{bookRule!.errors !== 1 ? 's' : ''}
                            </span>
                          )}
                          {(bookRule?.warnings ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="w-3 h-3" /> {bookRule!.warnings} warning{bookRule!.warnings !== 1 ? 's' : ''}
                            </span>
                          )}
                          <button
                            onClick={() => setSelectedBookRuleId(null)}
                            className="ml-1 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-foreground transition-colors"
                            title="Close"
                          >
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Issues list */}
                      {allIssues.length === 0 ? (
                        <div className="flex items-center gap-2 py-2 text-[12px] text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" />
                          No issues found for this rule.
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-border">
                          {allIssues.map((issue, idx) => {
                            const isError = (issue.category ?? '').toLowerCase() === 'error';
                            return (
                              <div
                                key={idx}
                                className={cn(
                                  'flex items-start gap-2.5 rounded-lg px-3 py-2 text-xs border',
                                  isError
                                    ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-300'
                                    : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-300',
                                )}
                              >
                                {isError
                                  ? <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-500" />
                                  : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />}
                                <span className="leading-relaxed font-sans">{issue.message}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── 5-stat summary row ─────────────────────────────────────────── */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 font-sans">
                  <StatCard
                    label="Total Files"
                    value={stats.total}
                    total={stats.total}
                    icon={BookOpen}
                    barColor="bg-primary"
                    valueColor="text-foreground"
                  />
                  <StatCard
                    label="Pending"
                    value={stats.pending}
                    total={stats.total}
                    icon={Clock}
                    barColor="bg-slate-400"
                    valueColor={stats.pending > 0 ? 'text-slate-500' : 'text-foreground'}
                    isActive={activeFilter === 'pending'}
                    onClick={() => toggleFilter('pending')}
                  />
                  <StatCard
                    label="Passed"
                    value={stats.passed}
                    total={stats.total}
                    icon={CheckCircle2}
                    barColor="bg-emerald-500"
                    valueColor={hasValidated ? 'text-emerald-600' : 'text-foreground'}
                    isActive={activeFilter === 'passed'}
                    onClick={() => toggleFilter('passed')}
                  />
                  <StatCard
                    label="Warnings"
                    value={stats.warnings}
                    total={stats.total}
                    icon={AlertTriangle}
                    barColor="bg-amber-400"
                    valueColor={hasValidated && stats.warnings > 0 ? 'text-amber-600' : 'text-foreground'}
                    isActive={activeFilter === 'warning'}
                    onClick={() => toggleFilter('warning')}
                  />
                  <StatCard
                    label="Failed"
                    value={stats.failed}
                    total={stats.total}
                    icon={XCircle}
                    barColor="bg-red-500"
                    valueColor={hasValidated && stats.failed > 0 ? 'text-red-500' : 'text-foreground'}
                    isActive={activeFilter === 'failed'}
                    onClick={() => toggleFilter('failed')}
                  />
                </div>
                {/* ── Top Horizontal Category Navigation Tabs ─────────────────────────────────── */}
                <div className="flex items-center gap-2 border-b border-border/80 pb-px font-sans overflow-x-auto scrollbar-none">
                  <button
                    onClick={() => setActiveCategoryTab('chapters')}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 rounded-t-lg',
                      activeCategoryTab === 'chapters'
                        ? 'border-primary text-primary bg-primary/10 shadow-xs'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
                    )}
                  >
                    <BookOpen className="w-4 h-4 text-primary shrink-0" />
                    <span>Chapters</span>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold transition-colors',
                        activeCategoryTab === 'chapters'
                          ? 'bg-primary/20 text-primary'
                          : 'bg-primary/10 text-primary/80',
                      )}
                    >
                      {xhtmlFiles.length}
                    </span>
                  </button>

                  <button
                    onClick={() => setActiveCategoryTab('css')}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 rounded-t-lg',
                      activeCategoryTab === 'css'
                        ? 'border-violet-500 text-violet-600 dark:text-violet-400 bg-violet-500/10 shadow-xs'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
                    )}
                  >
                    <Braces className="w-4 h-4 text-violet-500 shrink-0" />
                    <span>CSS</span>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold transition-colors',
                        activeCategoryTab === 'css'
                          ? 'bg-violet-500/20 text-violet-600 dark:text-violet-400'
                          : 'bg-violet-500/10 text-violet-600/80 dark:text-violet-400/80',
                      )}
                    >
                      {cssFiles.length}
                    </span>
                  </button>

                  <button
                    onClick={() => setActiveCategoryTab('images')}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 rounded-t-lg',
                      activeCategoryTab === 'images'
                        ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 shadow-xs'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
                    )}
                  >
                    <ImageIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Images</span>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold transition-colors',
                        activeCategoryTab === 'images'
                          ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                          : 'bg-emerald-500/10 text-emerald-600/80 dark:text-emerald-400/80',
                      )}
                    >
                      {imageFiles.length}
                    </span>
                  </button>

                  <button
                    onClick={() => setActiveCategoryTab('other')}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 rounded-t-lg',
                      activeCategoryTab === 'other'
                        ? 'border-sky-500 text-sky-600 dark:text-sky-400 bg-sky-500/10 shadow-xs'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
                    )}
                  >
                    <FileCode2 className="w-4 h-4 text-sky-500 shrink-0" />
                    <span>Other Files</span>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold transition-colors',
                        activeCategoryTab === 'other'
                          ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400'
                          : 'bg-sky-500/10 text-sky-600/80 dark:text-sky-400/80',
                      )}
                    >
                      {otherFiles.length}
                    </span>
                  </button>

                  <button
                    onClick={() => setActiveCategoryTab('all')}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 rounded-t-lg sm:ml-auto',
                      activeCategoryTab === 'all'
                        ? 'border-foreground text-foreground bg-muted shadow-xs font-bold'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
                    )}
                  >
                    <span>All Files</span>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold transition-colors',
                        activeCategoryTab === 'all'
                          ? 'bg-primary/20 text-primary'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {allBackendFiles.length}
                    </span>
                  </button>
                </div>

                {(activeFilter || selectedRuleFilter) && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground font-sans bg-muted/40 px-3 py-2 rounded-lg border border-border/50">
                    <span>
                      Showing <span className="font-semibold text-foreground">{totalVisibleCount}</span> file{totalVisibleCount !== 1 ? 's' : ''}
                      {activeFilter && <span> matching status <span className="font-semibold text-foreground">{activeFilter}</span></span>}
                      {selectedRuleFilter && (
                        <span>
                          {' '}matching rule{' '}
                          <span className="font-semibold text-primary">
                            {[...ruleSummary.general, ...ruleSummary.customer].find((r) => (r.rule_id || r.rule_name) === selectedRuleFilter)?.rule_name || selectedRuleFilter}
                          </span>
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => { setActiveFilter(null); setSelectedRuleFilter(null); }}
                      className="text-xs text-primary hover:underline font-semibold"
                    >
                      Clear filter
                    </button>
                  </div>
                )}

                {/* ── Scrollable Files List Area ───────────────────────────────── */}
                <div className="flex-1 overflow-y-auto max-h-[calc(100vh-17rem)] min-h-[350px] pr-2 space-y-6 scrollbar-thin scrollbar-thumb-border font-sans pb-4">
                  {/* ── 1. Chapters Tab View ────────────────────────────────── */}
                  {(activeCategoryTab === 'chapters' || activeCategoryTab === 'all') && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-border/60 pb-2">
                        <div className="flex items-center gap-2">
                          <BookOpen className="w-4 h-4 text-primary" />
                          <h2 className="text-xs font-bold text-foreground uppercase tracking-wider font-serif">
                            Chapters
                          </h2>
                          <span className="text-xs text-muted-foreground font-mono font-semibold">({visibleXhtmlFiles.length})</span>
                        </div>
                      </div>
                      {visibleXhtmlFiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic py-1">No chapter files in this section.</p>
                      ) : (
                        <motion.div
                          className={cn(
                            layoutMode === 'grid'
                              ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
                              : 'space-y-2.5',
                          )}
                          variants={containerVariants}
                          initial="hidden"
                          animate="show"
                        >
                          {visibleXhtmlFiles.map((file, i) => {
                            const status = getFileStatus(file.file_name);
                            const agg = fileIssues.get(file.file_name);
                            return (
                              <motion.div key={`chapter-${file.file_name}-${i}`} variants={xhtmlCardVariants}>
                                <XHTMLCard
                                  file={file}
                                  variant="xhtml"
                                  layoutMode={layoutMode}
                                  status={status}
                                  errors={agg?.errors ?? 0}
                                  warnings={agg?.warnings ?? 0}
                                  isValidating={validatingFiles.has(file.file_name)}
                                  onValidate={() => handleValidateFile(file.file_name)}
                                  onOpen={() => { setModalAllowedTabs(undefined); setModalInitialTab('result'); setSelectedFile(file); }}
                                  onPreview={() => { setModalAllowedTabs(undefined); setModalInitialTab('result'); setSelectedFile(file); }}
                                  index={i}
                                />
                              </motion.div>
                            );
                          })}
                        </motion.div>
                      )}
                    </div>
                  )}

                  {/* ── 2. CSS Tab View ────────────────────────────────────── */}
                  {(activeCategoryTab === 'css' || activeCategoryTab === 'all') && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-border/60 pb-2">
                        <div className="flex items-center gap-2">
                          <Braces className="w-4 h-4 text-violet-500" />
                          <h2 className="text-xs font-bold text-foreground uppercase tracking-wider font-serif">
                            CSS
                          </h2>
                          <span className="text-xs text-muted-foreground font-mono font-semibold">({visibleCssFiles.length})</span>
                        </div>
                      </div>
                      {visibleCssFiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic py-1">No CSS files in this section.</p>
                      ) : (
                        <motion.div
                          className={cn(
                            layoutMode === 'grid'
                              ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
                              : 'space-y-2.5',
                          )}
                          variants={containerVariants}
                          initial="hidden"
                          animate="show"
                        >
                          {visibleCssFiles.map((file, i) => {
                            const agg = fileIssues.get(file.file_name) ?? { errors: 0, warnings: 0 };
                            return (
                            <motion.div key={`css-${file.file_name}-${i}`} variants={xhtmlCardVariants}>
                              <XHTMLCard
                                file={file}
                                variant="css"
                                layoutMode={layoutMode}
                                status={getFileStatus(file.file_name)}
                                errors={agg.errors}
                                warnings={agg.warnings}
                                onOpen={() => { setModalAllowedTabs(['result']); setModalInitialTab('result'); setSelectedFile(file); }}
                                index={i}
                              />
                            </motion.div>
                            );
                          })}
                        </motion.div>
                      )}
                    </div>
                  )}

                  {/* ── 3. Images Tab View ────────────────────────────────────────── */}
                  {(activeCategoryTab === 'images' || activeCategoryTab === 'all') && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-border/60 pb-2">
                        <div className="flex items-center gap-2">
                          <ImageIcon className="w-4 h-4 text-emerald-500" />
                          <h2 className="text-xs font-bold text-foreground uppercase tracking-wider font-serif">
                            Images
                          </h2>
                          <span className="text-xs text-muted-foreground font-mono font-semibold">({visibleImageFiles.length})</span>
                        </div>
                      </div>
                      {visibleImageFiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic py-1">No image files in this section.</p>
                      ) : (
                        <motion.div
                          className={cn(
                            layoutMode === 'grid'
                              ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
                              : 'space-y-2.5',
                          )}
                          variants={containerVariants}
                          initial="hidden"
                          animate="show"
                        >
                          {visibleImageFiles.map((file, i) => {
                            const agg = fileIssues.get(file.file_name) ?? { errors: 0, warnings: 0 };
                            return (
                            <motion.div key={`img-${file.file_name}-${i}`} variants={xhtmlCardVariants}>
                              <XHTMLCard
                                file={file}
                                variant="image"
                                layoutMode={layoutMode}
                                status={getFileStatus(file.file_name)}
                                errors={agg.errors}
                                warnings={agg.warnings}
                                onOpen={() => { setModalAllowedTabs(['result']); setModalInitialTab('result'); setSelectedFile(file); }}
                                onPreview={() => { setModalAllowedTabs(['result']); setModalInitialTab('result'); setSelectedFile(file); }}
                                index={i}
                              />
                            </motion.div>
                            );
                          })}
                        </motion.div>
                      )}
                    </div>
                  )}

                  {/* ── 4. Other files Tab View ────────────────────────────────── */}
                  {(activeCategoryTab === 'other' || activeCategoryTab === 'all') && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-border/60 pb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <FileCode2 className="w-4 h-4 text-sky-500" />
                          <h2 className="text-xs font-bold text-foreground uppercase tracking-wider font-serif">
                            Other Files
                          </h2>
                          <span className="text-xs text-muted-foreground font-mono font-semibold">({visibleOtherFiles.length})</span>
                        </div>
                      </div>
                      {visibleOtherFiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic py-1">No other files in this section.</p>
                      ) : (
                        <motion.div
                          className={cn(
                            layoutMode === 'grid'
                              ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
                              : 'space-y-2.5',
                          )}
                          variants={containerVariants}
                          initial="hidden"
                          animate="show"
                        >
                          {visibleOtherFiles.map((file, i) => {
                            const status = getFileStatus(file.file_name);
                            const agg = fileIssues.get(file.file_name);
                            const canValidate = file.file_name.endsWith('.xml') || file.file_name.endsWith('.opf') || file.file_name.endsWith('.ncx') || file.file_name.endsWith('.xhtml') || file.file_name.endsWith('.html');
                            return (
                              <motion.div key={`other-${file.file_name}-${i}`} variants={xhtmlCardVariants}>
                                <XHTMLCard
                                  file={file}
                                  variant="other"
                                  layoutMode={layoutMode}
                                  status={status}
                                  errors={agg?.errors ?? 0}
                                  warnings={agg?.warnings ?? 0}
                                  isValidating={validatingFiles.has(file.file_name)}
                                  onValidate={canValidate ? () => handleValidateFile(file.file_name) : undefined}
                                  onOpen={() => { setModalAllowedTabs(['result']); setModalInitialTab('result'); setSelectedFile(file); }}
                                  onPreview={() => { setModalAllowedTabs(['result']); setModalInitialTab('result'); setSelectedFile(file); }}
                                  index={i}
                                />
                              </motion.div>
                            );
                          })}
                        </motion.div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
