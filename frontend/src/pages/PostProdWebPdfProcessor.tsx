import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2, Lock, Unlock, ShieldAlert, AlertCircle,
  Edit,
  Filter,
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  User as UserIcon,
  XCircle,
  ChevronUp,
  ChevronDown,
  Play,
  Bookmark,
  FileText,
  SlidersHorizontal,
  ShieldCheck,
  Layers,
  Type,
  AlignLeft,
  FileCheck2,
  GripVertical,
  ChevronRight,
  Folder,
  CornerDownRight,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/store/useToastStore';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSessionStore } from '@/stores/sessionStore';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { useRBAC } from '@/hooks/useRBAC';
import { getUserDisplayName } from '@/utils/userUtils';
import { formatDateTime } from '@/utils/dateUtils';
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  listProjectFiles,
  mergeProjectFiles,
  trimProjectPDF,
  generateBookmarks,
  getExistingBookmarksInfo,
  acceptExistingBookmarks,
  type ExistingBookmarksInfo,
  getBookmarks,
  updateBookmarks,
  generateLinks,
  getExistingTocLinksInfo,
  acceptExistingTocLinks,
  type ExistingTocLinksInfo,
  generateLinkManual,
  generateUrlLinks,
  generateEmailLinks,
  generateEndnoteLinks,
  generateCrossrefLinks,
  generateIndexLinks,
  generateGlossaryLinks,
  runValidationDiff,
  type ValidationDiffReport,
  type UrlLinkDetail,
  type EmailLinkDetail,
  type EndnoteDetail,
  type CrossrefDetail,
  type IndexLinkDetail,
  type GlossaryLinkDetail,
  type BookmarkItem,
  type WebPdfProject,
  type ProjectFile,
} from '@/api/webPdfProcessor';
import { usersApi, type User } from '@/api/users';

interface ClientCompany {
  id: number;
  company?: string;
  name_company?: string;
  first_name?: string;
  surname?: string;
  division?: string;
}

// ── Validation Badge ──────────────────────────────────────────────────────────

function ValidationBadge({ status }: { status: string | null }) {
  if (!status || status === 'Yet to start') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-muted/20 text-muted">
        Yet to start
      </span>
    );
  }
  if (status === 'Completed') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
        Completed
      </span>
    );
  }
  if (status === 'In-Progress') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20">
        In-Progress
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-muted/20 text-muted">
      {status}
    </span>
  );
}

// ── Assignee Dropdown ────────────────────────────────────────────────────────

function AssigneeDropdown({
  value,
  onChange,
  users,
}: {
  value: string;
  onChange: (val: string) => void;
  users: User[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', onClickOutside);
    if (!isOpen) setSearchQuery('');
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isOpen]);

  const activeUsers = users.filter((u) => u.active_status);

  const filteredUsers = activeUsers.filter((u) => {
    if (!searchQuery) return true;
    const display = getUserDisplayName(u);
    return display.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const currentLabel = (() => {
    if (!value) return '— Unassigned —';
    const u = activeUsers.find((u) => u.user_name === value);
    if (!u) return value;
    return getUserDisplayName(u);
  })();

  return (
    <div className="relative flex items-center" ref={popoverRef}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setIsOpen((prev) => !prev); }}
        className={`flex items-center justify-between min-w-[130px] max-w-[200px] text-[11px] bg-transparent border rounded-md pl-2 pr-6 py-0.5 text-primary font-medium focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors relative ${isOpen ? 'border-primary ring-1 ring-primary/40' : 'border-transparent hover:border-border'
          } cursor-pointer`}
        title={currentLabel}
      >
        <span className="truncate leading-tight block w-full text-left">{currentLabel}</span>
        <span
          className="pointer-events-none absolute right-1.5 text-muted transition-transform duration-200 flex-shrink-0 text-[9px]"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
        >▾</span>
      </button>

      {isOpen && (
        <div className="absolute top-[calc(100%+6px)] left-0 min-w-[200px] w-max max-w-[260px] bg-card border border-border shadow-[0_12px_40px_-8px_rgba(0,0,0,0.18)] rounded-xl py-1.5 z-[200] max-h-72 flex flex-col backdrop-blur-3xl ring-1 ring-black/5">
          {/* Search */}
          <div className="px-1.5 pb-1 mb-1 border-b border-border/50 shrink-0 space-y-1">
            <div className="relative px-1 pt-1 pb-1">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search assignee..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-muted/50 border-none text-[11px] rounded-md pl-6 pr-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            {/* Unassigned option */}
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground rounded-md transition-all flex items-center gap-2 group"
              onClick={(e) => { e.stopPropagation(); setIsOpen(false); if (value !== '') onChange(''); }}
            >
              <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${value === '' ? 'text-primary' : 'text-transparent'}`}>
                {value === '' && <CheckCircle2 size={12} strokeWidth={3} />}
              </div>
              <span className="group-hover:translate-x-0.5 transition-transform duration-200">— Unassigned —</span>
            </button>
          </div>

          {/* User list */}
          <div className="px-1.5 flex flex-col gap-0.5 overflow-y-auto">
            {filteredUsers.length === 0 ? (
              <div className="text-[11px] text-muted-foreground px-2.5 py-3 text-center">No results found</div>
            ) : (
              filteredUsers.map((u) => {
                const label = u.first_name || u.last_name
                  ? `${u.first_name || ''} ${u.last_name || ''}`.trim()
                  : u.user_name;
                const isSelected = value === u.user_name;
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={`w-full text-left px-2.5 py-1.5 text-[11px] transition-all rounded-md flex items-center gap-2 group ${isSelected
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground hover:bg-muted/40'
                      }`}
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); if (value !== u.user_name) onChange(u.user_name); }}
                  >
                    <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'text-primary' : 'text-transparent'}`}>
                      {isSelected && <CheckCircle2 size={12} strokeWidth={3} />}
                      {!isSelected && <UserIcon size={12} strokeWidth={2} className="opacity-0 group-hover:opacity-40 text-muted-foreground transition-opacity" />}
                    </div>
                    <span className={`truncate transition-transform duration-200 ${!isSelected && 'group-hover:translate-x-0.5'}`}>{label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Project Card ──────────────────────────────────────────────────────────────

interface ProjectCardProps {
  project: WebPdfProject;
  users: User[];
  onDelete: (id: number) => void;
  onEdit: (project: WebPdfProject) => void;
  onRefresh: () => void;
  onSelect: (project: WebPdfProject) => void;
}

function ProjectCard({ project, users, onDelete, onEdit, onRefresh, onSelect }: ProjectCardProps) {
  const viewer = useSessionStore((s) => s.viewer);
  const { isTeamLead } = useRBAC();
  const myUsername = (viewer?.username || '').trim().toLowerCase();

  const handleCardClick = () => {
    const assigned = (project.assignee || '').trim().toLowerCase();

    if (!assigned) {
      toast.error('This project is not assigned to anyone. Assign it to open it.');
      return;
    }

    if (assigned && myUsername && assigned !== myUsername) {
      const assignedUser = users.find((u) =>
        (u.user_name || '').toLowerCase() === assigned ||
        String(u.id) === assigned
      );
      const assigneeName = assignedUser
        ? ((assignedUser.first_name || assignedUser.last_name)
          ? `${assignedUser.first_name || ''} ${assignedUser.last_name || ''}`.trim()
          : assignedUser.user_name)
        : project.assignee;
      toast.error(`This project is assigned to ${assigneeName}. You cannot open it.`);
      return;
    }

    onSelect(project);
  };

  const handleAssigneeChange = async (newAssignee: string) => {
    try {
      await updateProject(project.id, { assignee: newAssignee });
      let displayName = 'Unassigned';
      if (newAssignee) {
        const user = users.find((u) => u.user_name === newAssignee || String(u.id) === newAssignee);
        if (user) {
          displayName = user.first_name || user.last_name
            ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
            : user.user_name;
        } else {
          displayName = newAssignee;
        }
      }
      toast.success(`Assigned to ${displayName} successfully`);
      onRefresh();
    } catch (err) {
      console.error('Failed to update assignee', err);
      toast.error('Failed to update assignee');
    }
  };

  return (
    <div
      onClick={handleCardClick}
      className="p-4 rounded-xl border bg-card border-border cursor-pointer shadow-sm hover:shadow-md hover:border-primary/40 transition-all duration-300 flex flex-col justify-between group"
    >
      <div>
        {/* Header row */}
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <h3
              className="font-semibold text-sm text-text truncate m-0 group-hover:text-primary transition-colors"
              title={project.project_name}
            >
              {project.project_name}
            </h3>
            <p className="text-[11px] text-muted mt-0.5">
              {project.client} {project.client_code && `(${project.client_code})`}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(project); }}
              className="text-muted hover:text-primary transition-colors p-1 rounded hover:bg-primary/10"
              title="Edit Assignee"
            >
              <Edit size={14} />
            </button>
            {isTeamLead && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(project.id); }}
                className="text-muted hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30"
                title="Delete Project"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Assignee + Status badge / Download row */}
        <div className="mt-3 flex items-center justify-between text-[11px] gap-2">
          <div className="flex items-center gap-1 text-muted min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
            <UserIcon size={12} className="text-muted/70 shrink-0" />
            <AssigneeDropdown
              value={project.assignee || ''}
              onChange={handleAssigneeChange}
              users={users}
            />
          </div>
          {(() => {
            const isCompleted =
              project.status === 'Glossary Linked' ||
              project.validation_status === 'Completed' ||
              project.validation_status === 'Passed' ||
              project.validation_status === 'pass' ||
              project.validation_status === 'validated' ||
              !!project.completed_at;

            if (isCompleted) {
              return (
                <a
                  href={`/api/v2/post-prod/web-pdf-processor/projects/${project.id}/final-pdf`}
                  download
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 border border-emerald-500/30 transition-colors shrink-0"
                  title="Download Final Web PDF"
                >
                  <Download size={11} />
                  <span>Download</span>
                </a>
              );
            }

            return <ValidationBadge status={project.validation_status} />;
          })()}
        </div>

        {/* Progress bar visual indicator */}
        <div className="mt-3">
          {(() => {
            const statusSteps: { [key: string]: number } = {
              'Merged': 1,
              'Trimmed': 2,
              'Fonts Checked': 3,
              'Security Checked': 4,
              'Bookmarked': 5,
              'TOC Linked': 6,
              'URL Linked': 7,
              'Email Linked': 8,
              'Endnote Linked': 9,
              'Crossref Linked': 10,
              'Index Linked': 11,
              'Glossary Linked': 12,
              'Validated': 13,
            };
            const isProjectCompleted =
              project.status === 'Glossary Linked' ||
              project.status === 'Validated' ||
              project.validation_status === 'Completed' ||
              project.validation_status === 'Passed' ||
              project.validation_status === 'pass' ||
              project.validation_status === 'validated' ||
              !!project.completed_at;
            let currentStep = statusSteps[project.status] || 0;
            // If project is marked completed or validated, ensure 13/13 is represented
            if (isProjectCompleted && currentStep < 13) {
              currentStep = 13;
            }
            const progressPercent = Math.min((currentStep / 13) * 100, 100);

            return (
              <>
                <div className="flex items-center justify-between text-[10px] text-muted font-bold mb-1">
                  <span>Progress</span>
                  <span>{currentStep}/13 Steps · {Math.round(progressPercent)}%</span>
                </div>
                <div className="h-2 w-full bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-500 rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Timeline Dates: Assigned, Started, Completed */}
      {(project.assigned_at || project.started_at || project.completed_at) && (
        <div className="mt-2.5 pt-2 border-t border-border/40 grid grid-cols-2 gap-y-1 gap-x-2 text-[10px]">
          {project.assigned_at && (
            <div className="flex flex-col">
              <span className="text-muted/70 text-[9px]">Assigned</span>
              <span className="text-text font-medium truncate" title={formatDateTime(project.assigned_at)}>
                {formatDateTime(project.assigned_at)}
              </span>
            </div>
          )}
          {project.started_at && (
            <div className="flex flex-col">
              <span className="text-muted/70 text-[9px]">Started</span>
              <span className="text-blue-600 font-medium truncate" title={formatDateTime(project.started_at)}>
                {formatDateTime(project.started_at)}
              </span>
            </div>
          )}
          {project.completed_at && (
            <div className="flex flex-col col-span-2">
              <span className="text-muted/70 text-[9px]">Completed</span>
              <span className="text-emerald-600 font-medium truncate" title={formatDateTime(project.completed_at)}>
                {formatDateTime(project.completed_at)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-2 border-t border-border/60 flex items-center justify-between text-[10px] text-muted font-medium">
        <span>
          Created: {formatDateTime(project.uploaded_at)}
        </span>
        <span className={project.status === 'Merged' ? 'text-emerald-600' : ''}>
          {project.status === 'Merged' ? '✓ Merged' : 'Ready'}
        </span>
      </div>
    </div>
  );
}

// ── Category Label ────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  FC: { label: 'Cover', color: 'bg-violet-500/10 text-violet-600 border-violet-500/20' },
  FM: { label: 'Front Matter', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  TEXT: { label: 'Chapter', color: 'bg-primary/10 text-primary border-primary/20' },
  BM: { label: 'Back Matter', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  BC: { label: 'Back Cover', color: 'bg-pink-500/10 text-pink-600 border-pink-500/20' },
};

// ── Main page ─────────────────────────────────────────────────────────────────

export function PostProdWebPdfProcessor() {
  useDocumentTitle('Web PDF Processor — S4Carlisle CMS');
  const navigate = useNavigate();
  const { isTeamLead } = useRBAC();
  const { projectId } = useParams<{ projectId: string }>();

  const [projects, setProjects] = useState<WebPdfProject[]>([]);
  const [clients, setClients] = useState<ClientCompany[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Workspace state
  const [selectedProject, setSelectedProject] = useState<WebPdfProject | null>(null);
  const [projectFiles, setProjectFiles] = useState<(ProjectFile & { selected: boolean })[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [merging, setMerging] = useState(false);

  // Trim
  const [trimMode, setTrimMode] = useState('trimbox');
  const [trimMargins, setTrimMargins] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const [standardizeSize, setStandardizeSize] = useState(false);
  const [removeMarks, setRemoveMarks] = useState(false);
  const [trimming, setTrimming] = useState(false);
  const [showCustomTrim, setShowCustomTrim] = useState(false);

  // Fonts Check
  const [activeStep, setActiveStep] = useState(1);
  const [checkingFonts, setCheckingFonts] = useState(false);
  const [fixingFonts, setFixingFonts] = useState(false);
  const [fontsStatus, setFontsStatus] = useState<any>(null);
  const [checkingSecurity, setCheckingSecurity] = useState(false);
  const [securityStatus, setSecurityStatus] = useState<any>(null);

  const [showEditBookmarksModal, setShowEditBookmarksModal] = useState(false);
  const [editingBookmarksList, setEditingBookmarksList] = useState<BookmarkItem[]>([]);
  const [loadingBookmarks, setLoadingBookmarks] = useState(false);
  const [savingBookmarks, setSavingBookmarks] = useState(false);
  const [draggedBookmarkIndex, setDraggedBookmarkIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Bookmarks
  const [generatingBookmarks, setGeneratingBookmarks] = useState(false);
  const [acceptingExistingBookmarks, setAcceptingExistingBookmarks] = useState(false);
  const [existingBookmarksInfo, setExistingBookmarksInfo] = useState<ExistingBookmarksInfo | null>(null);
  const [checkingExistingBookmarks, setCheckingExistingBookmarks] = useState(false);
  const [includeSubheadings, setIncludeSubheadings] = useState(true);
  const [bookmarksStatus, setBookmarksStatus] = useState<any>(null);

  // TOC Links (Step 6)
  const [generatingLinks, setGeneratingLinks] = useState(false);
  const [analyzingLinks, setAnalyzingLinks] = useState(false);
  const [linkType, setLinkType] = useState<'one_way' | 'two_way' | 'none'>('one_way');
  const [preserveExistingLinks, setPreserveExistingLinks] = useState(true);
  const [existingTocLinksInfo, setExistingTocLinksInfo] = useState<ExistingTocLinksInfo | null>(null);
  const [acceptingExistingTocLinks, setAcceptingExistingTocLinks] = useState(false);
  const [linksStatus, setLinksStatus] = useState<any>(null);
  const [linksAnalysisStatus, setLinksAnalysisStatus] = useState<any>(null);

  // URL Links (Step 7)
  const [urlLinksAnalysis, setUrlLinksAnalysis] = useState<any>(null);
  const [analyzingUrlLinks, setAnalyzingUrlLinks] = useState(false);
  const [applyingUrlLinks, setApplyingUrlLinks] = useState(false);
  const [colorUrls, setColorUrls] = useState(false);

  // Email Links (Step 8)
  const [emailLinksAnalysis, setEmailLinksAnalysis] = useState<any>(null);
  const [analyzingEmailLinks, setAnalyzingEmailLinks] = useState(false);
  const [applyingEmailLinks, setApplyingEmailLinks] = useState(false);
  const [colorEmails, setColorEmails] = useState(false);

  // Endnote Links (Step 9)
  const [endnoteLinksAnalysis, setEndnoteLinksAnalysis] = useState<any>(null);
  const [analyzingEndnoteLinks, setAnalyzingEndnoteLinks] = useState(false);
  const [applyingEndnoteLinks, setApplyingEndnoteLinks] = useState(false);

  // Cross-Reference Links (Step 10)
  const [crossrefLinksAnalysis, setCrossrefLinksAnalysis] = useState<any>(null);
  const [analyzingCrossrefLinks, setAnalyzingCrossrefLinks] = useState(false);
  const [applyingCrossrefLinks, setApplyingCrossrefLinks] = useState(false);

  // Index Links (Step 11)
  const [indexLinksAnalysis, setIndexLinksAnalysis] = useState<any>(null);
  const [analyzingIndexLinks, setAnalyzingIndexLinks] = useState(false);
  const [applyingIndexLinks, setApplyingIndexLinks] = useState(false);

  // Glossary Links (Step 12)
  const [glossaryLinksAnalysis, setGlossaryLinksAnalysis] = useState<any>(null);
  const [analyzingGlossaryLinks, setAnalyzingGlossaryLinks] = useState(false);
  const [applyingGlossaryLinks, setApplyingGlossaryLinks] = useState(false);

  // Final Validation Diff (Step 13)
  const [validationDiffReport, setValidationDiffReport] = useState<ValidationDiffReport | null>(null);
  const [runningValidationDiff, setRunningValidationDiff] = useState(false);

  const [pdfRefreshKey, setPdfRefreshKey] = useState(Date.now());
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [highlightSearch, setHighlightSearch] = useState<string | null>(null);

  const PDF_AVAILABLE_STATUSES = [
    'Merged',
    'Trimmed',
    'Fonts Checked',
    'Security Checked',
    'Bookmarked',
    'TOC Linked',
    'URL Linked',
    'Email Linked',
    'Endnote Linked',
    'Crossref Linked',
    'Index Linked',
    'Glossary Linked',
  ];

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<number | null>(null);
  const [editingProject, setEditingProject] = useState<WebPdfProject | null>(null);
  const [editAssignee, setEditAssignee] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Form
  const [customerName, setCustomerName] = useState('');
  const [clientCode, setClientCode] = useState('');
  const [projectName, setProjectName] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');

  // ── Data fetching ───────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;

    const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number = 10000): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      ]);
    };

    const load = async () => {
      try {
        const [projectsData, clientsRes, usersList] = await Promise.all([
          withTimeout(listProjects()),
          withTimeout(fetch('/api/v2/clients/active').then(r => r.ok ? r.json() : null)),
          withTimeout(usersApi.list()).catch(() => []),
        ]);

        if (mounted) {
          setProjects(projectsData || []);
          if (clientsRes) {
            setClients(clientsRes.sort((a: any, b: any) => (a.company || '').localeCompare(b.company || '')));
          }
          setUsers(usersList || []);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Failed to load data', err);
        // Set empty defaults so page still shows (just no projects)
        if (mounted) {
          setProjects([]);
          setUsers([]);
          setLoadError(`Failed to load projects: ${errMsg}`);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => { mounted = false; };
  }, []);

  // Sync selectedProject based on URL param
  useEffect(() => {
    if (!projects.length) return;

    if (projectId) {
      const p = projects.find(proj => proj.id === Number(projectId));
      if (p && (!selectedProject || selectedProject.id !== p.id)) {
        // Load project files when URL changes
        setSelectedProject(p);

        // Auto-select next pending step based on current status
        if (p.status === 'Bookmarked') setActiveStep(6);
        else if (p.status === 'Security Checked') setActiveStep(5);
        else if (p.status === 'Fonts Checked') setActiveStep(4);
        else if (p.status === 'Trimmed') setActiveStep(3);
        else if (p.status === 'Merged') setActiveStep(2);
        else setActiveStep(1);

        setProjectFiles([]);
        setLoadingFiles(true);

        // Load project files
        listProjectFiles(p.id)
          .then(files => {
            setProjectFiles(files.map(f => ({ ...f, selected: true })));
          })
          .catch(err => {
            toast.error(err.message || 'Failed to load project files');
          })
          .finally(() => setLoadingFiles(false));

      }
    } else {
      setSelectedProject(null);
      setProjectFiles([]);
    }
  }, [projectId, projects]);

  const fetchProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  // Pre-load existing bookmarks and TOC links info on project select
  useEffect(() => {
    if (!selectedProject?.id) return;
    getExistingBookmarksInfo(selectedProject.id)
      .then((info) => setExistingBookmarksInfo(info))
      .catch(() => setExistingBookmarksInfo(null));
    getExistingTocLinksInfo(selectedProject.id)
      .then((info) => setExistingTocLinksInfo(info))
      .catch(() => setExistingTocLinksInfo(null));
  }, [selectedProject?.id]);

  // Reset step inputs and state when selected project changes
  useEffect(() => {
    setLinkType('one_way');
    setPreserveExistingLinks(true);
    setLinksStatus(null);
    setLinksAnalysisStatus(null);
  }, [selectedProject?.id]);

  // ── Lazy load analysis when step is opened ──────────────────────────────
  useEffect(() => {
    if (!selectedProject) return;

    const loadStepAnalysis = async () => {
      const stepMap: { [key: number]: { step: string; setter: any } } = {
        3: { step: 'fonts_check', setter: setFontsStatus },
        4: { step: 'security_check', setter: setSecurityStatus },
        5: { step: 'bookmarks', setter: setBookmarksStatus },
        6: { step: 'toc_links', setter: setLinksAnalysisStatus },
        7: { step: 'url_links', setter: setUrlLinksAnalysis },
        8: { step: 'email_links', setter: setEmailLinksAnalysis },
        9: { step: 'endnote_links', setter: setEndnoteLinksAnalysis },
        10: { step: 'crossref_links', setter: setCrossrefLinksAnalysis },
        11: { step: 'index_links', setter: setIndexLinksAnalysis },
        12: { step: 'glossary_links', setter: setGlossaryLinksAnalysis },
        13: { step: 'final_validation', setter: setValidationDiffReport },
      };

      // Also check existing bookmarks info when step 5 is active
      if (activeStep === 5) {
        setCheckingExistingBookmarks(true);
        getExistingBookmarksInfo(selectedProject.id)
          .then((info) => setExistingBookmarksInfo(info))
          .catch(() => setExistingBookmarksInfo(null))
          .finally(() => setCheckingExistingBookmarks(false));
      }

      // Check existing TOC links info when step 6 is active
      if (activeStep === 6) {
        getExistingTocLinksInfo(selectedProject.id)
          .then((info) => setExistingTocLinksInfo(info))
          .catch(() => setExistingTocLinksInfo(null));
      }

      const config = stepMap[activeStep];
      if (!config) return;

      console.log(`Loading ${config.step} analysis for project ${selectedProject.id}`);

      try {
        const response = await fetch(
          `/api/v2/post-prod/web-pdf-processor/projects/${selectedProject.id}/step-analysis/${config.step}`
        );
        if (response.ok) {
          const data = await response.json();
          console.log(`Loaded ${config.step}:`, data);
          if (data) {
            // Add success flag for UI to display analysis
            const analysisData = { ...data, success: true };
            config.setter(analysisData);

            // Sync linkType radio button with the loaded analysis if present
            if (config.step === 'toc_links') {
              if (data.link_type) {
                setLinkType(data.link_type);
              } else if (data.two_way_links && data.two_way_links > 0) {
                setLinkType('two_way');
              } else {
                setLinkType('one_way');
              }
            }
          }
        } else {
          console.warn(`Failed to load ${config.step}: ${response.status}`);
        }
      } catch (err) {
        console.error(`Error loading ${config.step}:`, err);
      }
    };

    loadStepAnalysis();
  }, [activeStep, selectedProject?.id]);

  // ── Derived metrics ─────────────────────────────────────────────────────

  const totalCount = projects.length;
  const passedCount = projects.filter(
    (p) => p.validation_status === 'pass' || p.validation_status === 'validated',
  ).length;
  const failedCount = projects.filter(
    (p) => p.validation_status === 'fail' || p.validation_status === 'failed',
  ).length;

  // ── Handlers ────────────────────────────────────────────────────────────



  const handleSelectProject = async (p: WebPdfProject) => {
    navigate(`/post-production/web-pdf-processor/${p.id}`);
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) { setErrorMsg('Project Name is required'); return; }
    if (!customerName) { setErrorMsg('Please select a client'); return; }
    if (!zipFile) { setErrorMsg('Please choose a ZIP file'); return; }

    setUploading(true);
    setErrorMsg(null);

    const formData = new FormData();
    formData.append('client', customerName);
    formData.append('client_code', clientCode);
    formData.append('project_name', projectName.trim());
    formData.append('file', zipFile);

    try {
      await createProject(formData);
      toast.success('Project created and ZIP uploaded successfully!');
      setShowAddModal(false);
      setProjectName(''); setCustomerName(''); setClientCode(''); setZipFile(null);
      fetchProjects();
    } catch (err: any) {
      setErrorMsg(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (projectToDelete === null) return;
    try {
      await deleteProject(projectToDelete);
      toast.success('Project deleted successfully');
      if (selectedProject?.id === projectToDelete) setSelectedProject(null);
      setProjectToDelete(null);
      fetchProjects();
    } catch {
      toast.error('Failed to delete project');
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject) return;
    setSavingEdit(true);
    try {
      await updateProject(editingProject.id, { assignee: editAssignee });
      toast.success('Project updated');
      setEditingProject(null);
      fetchProjects();
    } catch {
      toast.error('Failed to update project');
    } finally {
      setSavingEdit(false);
    }
  };

  const moveFile = (index: number, dir: 'up' | 'down') => {
    const next = dir === 'up' ? index - 1 : index + 1;
    if (next < 0 || next >= projectFiles.length) return;
    const list = [...projectFiles];
    [list[index], list[next]] = [list[next], list[index]];
    setProjectFiles(list);
  };

  const toggleFile = (index: number) => {
    const list = [...projectFiles];
    list[index].selected = !list[index].selected;
    setProjectFiles(list);
  };

  const changeCategory = (index: number, cat: ProjectFile['category']) => {
    const list = [...projectFiles];
    list[index].category = cat;

    if (cat === 'FC') {
      const item = list.splice(index, 1)[0];
      list.unshift(item);
    } else if (cat === 'BC') {
      const item = list.splice(index, 1)[0];
      list.push(item);
    }

    setProjectFiles(list);
  };

  const handleMerge = async () => {
    if (!selectedProject) return;
    const selectedFiles = projectFiles
      .filter((f) => f.selected)
      .map((f) => ({
        filename: f.filename,
        absolute_path: f.absolute_path,
        category: f.category,
      }));
    if (selectedFiles.length === 0) {
      toast.error('Select at least one PDF file to merge.');
      return;
    }
    setMerging(true);
    try {
      await mergeProjectFiles(selectedProject.id, selectedFiles);
      toast.success('PDF files merged and auto-trimmed to TrimBox!');
      setPdfRefreshKey(Date.now());
      setSelectedProject(prev => prev ? { ...prev, status: "Trimmed" } : prev);
      fetchProjects();
      setActiveStep(3);
    } catch (err: any) {
      toast.error(err.message || 'Failed to merge PDF files.');
    } finally {
      setMerging(false);
    }
  };

  const handleTrim = async () => {
    if (!selectedProject) return;
    setTrimming(true);
    try {
      await trimProjectPDF(selectedProject.id, {
        mode: trimMode,
        margins: trimMode === 'fixed' ? [trimMargins.top, trimMargins.right, trimMargins.bottom, trimMargins.left] : undefined,
        standardize_size: standardizeSize,
        remove_marks: removeMarks,
      });
      toast.success('PDF trimmed successfully!');
      setPdfRefreshKey(Date.now()); setSelectedProject(prev => prev ? { ...prev, status: "Trimmed" } : prev);
      setPdfRefreshKey(Date.now()); setSelectedProject(prev => prev ? { ...prev, status: "Trimmed" } : prev);
      fetchProjects();
      setActiveStep(3);

      // Force iframe refresh by updating the project slightly or we can just rely on the key/src reload
    } catch (err: any) {
      toast.error(err.message || 'Failed to trim PDF.');
    } finally {
      setTrimming(false);
    }
  };


  const handleCheckSecurity = async () => {
    if (!selectedProject) return;
    setCheckingSecurity(true);
    setSecurityStatus(null);
    try {
      const res = await fetch(`/api/v2/post-prod/web-pdf-processor/projects/${selectedProject.id}/security-status`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Failed to check security');
      }
      const data = await res.json();
      setSecurityStatus(data);
      toast.success('Security check completed');
      setSelectedProject(prev => prev ? { ...prev, status: 'Security Checked' } : prev);
      fetchProjects();
      setActiveStep(5);
    } catch (err: any) {
      toast.error(err.message || 'Failed to check security');
    } finally {
      setCheckingSecurity(false);
    }
  };

  const handleGenerateBookmarks = async () => {
    if (!selectedProject) return;
    setGeneratingBookmarks(true);
    setBookmarksStatus(null);
    try {
      const data = await generateBookmarks(selectedProject.id, includeSubheadings);
      setBookmarksStatus(data);
      toast.success('Bookmarks generated successfully!');

      // Update selected project state
      setSelectedProject(prev => prev ? { ...prev, status: 'Bookmarked' } : prev);
      setPdfRefreshKey(Date.now());
      fetchProjects();
      setActiveStep(6);
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate bookmarks.');
    } finally {
      setGeneratingBookmarks(false);
    }
  };

  const handleAcceptExistingBookmarks = async () => {
    if (!selectedProject) return;
    setAcceptingExistingBookmarks(true);
    try {
      const data = await acceptExistingBookmarks(selectedProject.id);
      setBookmarksStatus(data);
      toast.success('Existing bookmarks set as default!');

      // Update selected project state
      setSelectedProject(prev => prev ? { ...prev, status: 'Bookmarked' } : prev);
      setPdfRefreshKey(Date.now());
      fetchProjects();
      setActiveStep(6);
    } catch (err: any) {
      toast.error(err.message || 'Failed to set existing bookmarks');
    } finally {
      setAcceptingExistingBookmarks(false);
    }
  };

  const handleOpenEditBookmarks = async () => {
    if (!selectedProject) return;
    setShowEditBookmarksModal(true);
    setLoadingBookmarks(true);
    try {
      const bm = await getBookmarks(selectedProject.id);
      setEditingBookmarksList(bm);
    } catch (err: any) {
      toast.error(err.message || 'Failed to fetch bookmarks');
      setShowEditBookmarksModal(false);
    } finally {
      setLoadingBookmarks(false);
    }
  };

  const handleSaveBookmarks = async () => {
    if (!selectedProject) return;
    setSavingBookmarks(true);
    try {
      await updateBookmarks(selectedProject.id, editingBookmarksList);
      toast.success('Bookmarks updated!');
      setPdfRefreshKey((prev) => prev + 1);
      setShowEditBookmarksModal(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update bookmarks');
    } finally {
      setSavingBookmarks(false);
    }
  };

  const handleBookmarkDragStart = (e: React.DragEvent, index: number) => {
    setDraggedBookmarkIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleBookmarkDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleBookmarkDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedBookmarkIndex === null || draggedBookmarkIndex === dropIndex) {
      setDraggedBookmarkIndex(null);
      setDragOverIndex(null);
      return;
    }

    const list = [...editingBookmarksList];
    const [draggedItem] = list.splice(draggedBookmarkIndex, 1);
    list.splice(dropIndex, 0, draggedItem);
    setEditingBookmarksList(list);
    setDraggedBookmarkIndex(null);
    setDragOverIndex(null);
  };

  const handleBookmarkDragEnd = () => {
    setDraggedBookmarkIndex(null);
    setDragOverIndex(null);
  };

  const moveBookmark = (index: number, direction: 'up' | 'down') => {
    const list = [...editingBookmarksList];
    if (direction === 'up' && index > 0) {
      [list[index - 1], list[index]] = [list[index], list[index - 1]];
    } else if (direction === 'down' && index < list.length - 1) {
      [list[index + 1], list[index]] = [list[index], list[index + 1]];
    }
    setEditingBookmarksList(list);
  };

  const changeBookmarkLevel = (index: number, change: number) => {
    const list = [...editingBookmarksList];
    const prevLevel = index > 0 ? list[index - 1].level : 0;
    const maxAllowedLevel = prevLevel + 1; // Can never skip a parent level in PDF hierarchy

    let newLevel = list[index].level + change;
    if (change > 0 && newLevel > maxAllowedLevel) {
      newLevel = maxAllowedLevel;
    }
    if (newLevel < 1) {
      newLevel = 1;
    }

    list[index] = { ...list[index], level: newLevel };

    // Cascade sanitize subsequent items so no item skips a level
    let currentMax = newLevel;
    for (let i = index + 1; i < list.length; i++) {
      if (list[i].level > currentMax + 1) {
        list[i] = { ...list[i], level: currentMax + 1 };
      }
      currentMax = list[i].level;
    }

    setEditingBookmarksList(list);
  };

  const removeBookmark = (index: number) => {
    const list = [...editingBookmarksList];
    list.splice(index, 1);
    setEditingBookmarksList(list);
  };

  const bookmarkContainerRef = useRef<HTMLDivElement>(null);

  const addBookmark = (index?: number) => {
    const list = [...editingBookmarksList];
    const targetIndex = (index !== undefined && index >= 0) ? index : list.length - 1;
    const sourceBm = targetIndex >= 0 ? list[targetIndex] : null;
    const insertAt = targetIndex >= 0 ? targetIndex + 1 : 0;

    const newBm: BookmarkItem = {
      title: 'New Bookmark',
      level: sourceBm ? sourceBm.level : 1,
      page: sourceBm ? sourceBm.page : (previewPage ?? 1)
    };

    list.splice(insertAt, 0, newBm);
    setEditingBookmarksList(list);

    // Scroll to the newly added bookmark and focus its title input
    setTimeout(() => {
      if (bookmarkContainerRef.current) {
        const items = bookmarkContainerRef.current.querySelectorAll<HTMLInputElement>('input[data-bookmark-title]');
        if (items.length > insertAt) {
          const input = items[insertAt];
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
          input.focus();
          input.select();
        }
      }
    }, 100);
  };

  // ── QUICK BOOKMARK SHORTCUT (Ctrl + B / Cmd + B for Windows & Mac) ────────
  // When text is selected/copied, pressing Ctrl+B appends it directly into the
  // Edit Bookmarks list without any modal popup! The page input is auto-focused for quick entry.
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Trigger on Ctrl+B (Windows/Linux) or Cmd+B (Mac)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        if (!selectedProject) return;

        e.preventDefault();

        // 1. Try to read highlighted selection from window
        let text = window.getSelection()?.toString().trim() || '';

        // 2. If nothing highlighted in window (e.g. selected inside PDF viewer), try reading clipboard
        if (!text && navigator.clipboard && navigator.clipboard.readText) {
          try {
            text = (await navigator.clipboard.readText()).trim();
          } catch {}
        }

        if (text) {
          text = text.replace(/\s+/g, ' ');
        }

        // Open Step 5 & Edit Bookmarks if not already open
        setActiveStep(5);
        let list = [...editingBookmarksList];
        if (!showEditBookmarksModal || list.length === 0) {
          try {
            setLoadingBookmarks(true);
            list = await getBookmarks(selectedProject.id);
          } catch {} finally {
            setLoadingBookmarks(false);
          }
        }
        setShowEditBookmarksModal(true);

        const newTitle = text || 'New Bookmark';
        const lastPage = list.length > 0 ? list[list.length - 1].page : 1;

        const newBm: BookmarkItem = {
          title: newTitle,
          level: 1,
          page: lastPage,
        };

        const updatedList = [...list, newBm];
        setEditingBookmarksList(updatedList);
        toast.success(`Added "${newTitle}" to bookmarks! Adjust page and click Save Changes.`);

        // Auto-scroll and focus on the newly added item's page input
        setTimeout(() => {
          const pageInputs = document.querySelectorAll<HTMLInputElement>('input[data-bookmark-page]');
          if (pageInputs.length > 0) {
            const lastInput = pageInputs[pageInputs.length - 1];
            lastInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            lastInput.focus();
            lastInput.select();
          }
        }, 150);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [selectedProject, showEditBookmarksModal, editingBookmarksList]);

  const handleAnalyzeLinks = async (explicitLinkType?: any) => {
    if (!selectedProject) return;
    const targetType = (typeof explicitLinkType === 'string' && ['one_way', 'two_way', 'none'].includes(explicitLinkType))
      ? explicitLinkType
      : linkType;
    setAnalyzingLinks(true);
    setLinksAnalysisStatus(null);
    setLinksStatus(null);
    try {
      const targetLinkType: 'one_way' | 'two_way' = targetType === 'two_way' ? 'two_way' : 'one_way';
      const result = await generateLinks(selectedProject.id, targetLinkType, true, preserveExistingLinks);
      setLinksAnalysisStatus(result);
      toast.success('Link analysis complete');
      if (result.not_linked === 0 || result.total_links === 0) {
        setActiveStep(7);
      }
    } catch (err: any) {
      setLinksAnalysisStatus({ success: false, error: err.message });
      toast.error(err.message || 'Failed to analyze links');
    } finally {
      setAnalyzingLinks(false);
    }
  };

  const handleApplyLinks = async () => {
    if (!selectedProject) return;
    setGeneratingLinks(true);
    setLinksStatus(null);
    try {
      const result = await generateLinks(selectedProject.id, linkType === 'none' ? 'one_way' : linkType, false, preserveExistingLinks);
      setLinksStatus(result);
      setPdfRefreshKey((prev) => prev + 1);
      setSelectedProject(prev => prev ? { ...prev, status: 'TOC Linked' } : prev);
      toast.success(`Successfully generated ${result.total_links} internal links`);
      fetchProjects();
      setActiveStep(7);
      // Re-run analysis automatically
      handleAnalyzeLinks();
    } catch (err: any) {
      setLinksStatus({ success: false, error: err.message });
      toast.error(err.message || 'Failed to generate links');
    } finally {
      setGeneratingLinks(false);
    }
  };

  const handleAcceptExistingTocLinks = async () => {
    if (!selectedProject) return;
    setAcceptingExistingTocLinks(true);
    try {
      const result = await acceptExistingTocLinks(selectedProject.id);
      setLinksStatus({ success: true, total_links: result.total_links });
      setSelectedProject(prev => prev ? { ...prev, status: 'TOC Linked' } : prev);
      setPdfRefreshKey(Date.now());
      fetchProjects();
      toast.success('Existing TOC links set as default!');
      setActiveStep(7);
    } catch (err: any) {
      toast.error(err.message || 'Failed to accept existing TOC links');
    } finally {
      setAcceptingExistingTocLinks(false);
    }
  };

  const handleManualLink = async (link: any, index: number) => {
    if (!selectedProject) return;
    try {
      await generateLinkManual(selectedProject.id, link.type, link.title, link.source_page, link.target_page);
      toast.success('Link created manually');

      // Update UI optimistically
      const updatedStatus = { ...linksAnalysisStatus };
      if (updatedStatus.details) {
        updatedStatus.details[index].is_linked = true;
      }
      setLinksAnalysisStatus(updatedStatus);
      setPdfRefreshKey((prev) => prev + 1);
    } catch (err: any) {
      toast.error(err.message || 'Failed to manually link');
    }
  };

  const handleAnalyzeUrlLinks = async () => {
    if (!selectedProject) return;
    setAnalyzingUrlLinks(true);
    setUrlLinksAnalysis(null);
    try {
      const result = await generateUrlLinks(selectedProject.id, true);
      setUrlLinksAnalysis(result);
      setPdfRefreshKey((prev) => prev + 1);
      if (result.not_linked === 0) {
        setSelectedProject(prev => prev ? { ...prev, status: 'URL Linked' } : prev);
        setActiveStep(8);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to analyze URL links');
    } finally {
      setAnalyzingUrlLinks(false);
    }
  };

  const handleApplyUrlLinks = async () => {
    if (!selectedProject) return;
    setApplyingUrlLinks(true);
    try {
      const result = await generateUrlLinks(selectedProject.id, false, colorUrls);
      setUrlLinksAnalysis(result);
      setPdfRefreshKey((prev) => prev + 1);
      setSelectedProject(prev => prev ? { ...prev, status: 'URL Linked' } : prev);
      toast.success(`Hyperlinked ${result.not_linked} URL(s) successfully${colorUrls ? ' with link blue color' : ''}`);
      setActiveStep(8);
    } catch (err: any) {
      toast.error(err.message || 'Failed to apply URL links');
    } finally {
      setApplyingUrlLinks(false);
    }
  };

  const handleAnalyzeEmailLinks = async () => {
    if (!selectedProject) return;
    setAnalyzingEmailLinks(true);
    setEmailLinksAnalysis(null);
    try {
      const result = await generateEmailLinks(selectedProject.id, true);
      setEmailLinksAnalysis(result);
      setPdfRefreshKey((prev) => prev + 1);
      if (result.not_linked === 0) {
        setSelectedProject(prev => prev ? { ...prev, status: 'Email Linked' } : prev);
        setActiveStep(9);
      }
      toast.success('Email scan complete');
    } catch (err: any) {
      toast.error(err.message || 'Failed to analyze emails');
    } finally {
      setAnalyzingEmailLinks(false);
    }
  };

  const handleApplyEmailLinks = async () => {
    if (!selectedProject) return;
    setApplyingEmailLinks(true);
    try {
      const result = await generateEmailLinks(selectedProject.id, false, colorEmails);
      setEmailLinksAnalysis(result);
      setPdfRefreshKey((prev) => prev + 1);
      setSelectedProject(prev => prev ? { ...prev, status: 'Email Linked' } : prev);
      toast.success(`Hyperlinked ${result.not_linked} email(s) successfully${colorEmails ? ' with link blue color' : ''}`);
      setActiveStep(9);
    } catch (err: any) {
      toast.error(err.message || 'Failed to apply email links');
    } finally {
      setApplyingEmailLinks(false);
    }
  };

  const handleAnalyzeEndnoteLinks = async () => {
    if (!selectedProject) return;
    setAnalyzingEndnoteLinks(true);
    setEndnoteLinksAnalysis(null);
    try {
      const result = await generateEndnoteLinks(selectedProject.id, true);
      setEndnoteLinksAnalysis(result);
      if (result.not_linked === 0) {
        setSelectedProject(prev => prev ? { ...prev, status: 'Endnote Linked' } : prev);
        setActiveStep(10);
      }
      toast.success('Endnote scan complete');
    } catch (err: any) {
      toast.error(err.message || 'Failed to analyze endnotes');
    } finally {
      setAnalyzingEndnoteLinks(false);
    }
  };

  const handleApplyEndnoteLinks = async () => {
    if (!selectedProject) return;
    setApplyingEndnoteLinks(true);
    try {
      const result = await generateEndnoteLinks(selectedProject.id, false);
      setEndnoteLinksAnalysis(result);
      setPdfRefreshKey((prev) => prev + 1);
      setSelectedProject(prev => prev ? { ...prev, status: 'Endnote Linked' } : prev);
      toast.success(`Created ${result.not_linked} endnote link(s) successfully`);
      setActiveStep(10);
    } catch (err: any) {
      toast.error(err.message || 'Failed to apply endnote links');
    } finally {
      setApplyingEndnoteLinks(false);
    }
  };

  const handleAnalyzeCrossrefLinks = async () => {
    if (!selectedProject) return;
    setAnalyzingCrossrefLinks(true);
    setCrossrefLinksAnalysis(null);
    try {
      const result = await generateCrossrefLinks(selectedProject.id, true);
      setCrossrefLinksAnalysis(result);
      if (result.not_linked === 0) {
        setSelectedProject(prev => prev ? { ...prev, status: 'Crossref Linked' } : prev);
        setActiveStep(11);
      }
      toast.success('Cross-reference scan complete');
    } catch (err: any) {
      toast.error(err.message || 'Failed to analyze cross-references');
    } finally {
      setAnalyzingCrossrefLinks(false);
    }
  };

  const handleApplyCrossrefLinks = async () => {
    if (!selectedProject) return;
    setApplyingCrossrefLinks(true);
    try {
      const result = await generateCrossrefLinks(selectedProject.id, false);
      setCrossrefLinksAnalysis(result);
      setPdfRefreshKey((prev) => prev + 1);
      setSelectedProject(prev => prev ? { ...prev, status: 'Crossref Linked' } : prev);
      toast.success(`Applied cross-reference links - ${result.linked} linked, ${result.not_linked} remaining`);
      setActiveStep(11);
    } catch (err: any) {
      toast.error(err.message || 'Failed to apply cross-reference links');
    } finally {
      setApplyingCrossrefLinks(false);
    }
  };

  const handleAnalyzeIndexLinks = async () => {
    if (!selectedProject) return;
    setAnalyzingIndexLinks(true);
    setIndexLinksAnalysis(null);
    try {
      const result = await generateIndexLinks(selectedProject.id, true);
      setIndexLinksAnalysis(result);
      if (result.not_linked === 0 && result.total_references > 0) {
        setSelectedProject(prev => prev ? { ...prev, status: 'Index Linked' } : prev);
        setActiveStep(12);
      }
      toast.success('Index references scan complete');
    } catch (err: any) {
      toast.error(err.message || 'Failed to analyze index references');
    } finally {
      setAnalyzingIndexLinks(false);
    }
  };

  const handleApplyIndexLinks = async () => {
    if (!selectedProject) return;
    setApplyingIndexLinks(true);
    try {
      const result = await generateIndexLinks(selectedProject.id, false);
      setIndexLinksAnalysis(result);
      setPdfRefreshKey((prev) => prev + 1);
      setSelectedProject(prev => prev ? { ...prev, status: 'Index Linked' } : prev);
      toast.success(`Applied index hyperlinks - ${result.linked} linked`);
      setActiveStep(12);
    } catch (err: any) {
      toast.error(err.message || 'Failed to apply index hyperlinks');
    } finally {
      setApplyingIndexLinks(false);
    }
  };

  const handleAnalyzeGlossaryLinks = async () => {
    if (!selectedProject) return;
    setAnalyzingGlossaryLinks(true);
    setGlossaryLinksAnalysis(null);
    try {
      const result = await generateGlossaryLinks(selectedProject.id, true);
      setGlossaryLinksAnalysis(result);
      if (result.not_linked === 0 && result.total_terms > 0) {
        setSelectedProject(prev => prev ? { ...prev, status: 'Glossary Linked' } : prev);
        setActiveStep(13);
      }
      toast.success('Glossary terms scan complete');
    } catch (err: any) {
      toast.error(err.message || 'Failed to analyze glossary terms');
    } finally {
      setAnalyzingGlossaryLinks(false);
    }
  };

  const handleApplyGlossaryLinks = async () => {
    if (!selectedProject) return;
    setApplyingGlossaryLinks(true);
    try {
      const result = await generateGlossaryLinks(selectedProject.id, false);
      setGlossaryLinksAnalysis(result);
      setPdfRefreshKey((prev) => prev + 1);
      setSelectedProject(prev => prev ? { ...prev, status: 'Glossary Linked' } : prev);
      toast.success(`Applied glossary hyperlinks - ${result.linked} linked`);
      setActiveStep(13);
    } catch (err: any) {
      toast.error(err.message || 'Failed to apply glossary hyperlinks');
    } finally {
      setApplyingGlossaryLinks(false);
    }
  };

  const handleRunValidationDiff = async () => {
    if (!selectedProject) return;
    setRunningValidationDiff(true);
    setValidationDiffReport(null);
    try {
      const report = await runValidationDiff(selectedProject.id);
      setValidationDiffReport(report);
      if (report.status === 'passed') {
        toast.success(`Validation Passed! Integrity score: ${report.integrity_score}%`);
      } else if (report.status === 'warnings') {
        toast.warning(`Validation Completed with warnings. Score: ${report.integrity_score}%`);
      } else {
        toast.error(`Validation Discrepancies detected. Score: ${report.integrity_score}%`);
      }
      fetchProjects();
    } catch (err: any) {
      toast.error(err.message || 'Failed to run validation diff');
    } finally {
      setRunningValidationDiff(false);
    }
  };

  const handleCheckFonts = async () => {
    if (!selectedProject) return;
    setCheckingFonts(true);
    setFontsStatus(null);
    try {
      const res = await fetch(`/api/v2/post-prod/web-pdf-processor/projects/${selectedProject.id}/fonts-status`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Failed to check fonts');
      }
      const data = await res.json();
      setFontsStatus(data);
      toast.success('Font check completed');
      setSelectedProject(prev => prev ? { ...prev, status: 'Fonts Checked' } : prev);
      fetchProjects();
      if (data.all_embedded) {
        setActiveStep(4);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to check fonts');
    } finally {
      setCheckingFonts(false);
    }
  };

  const handleFixFonts = async () => {
    if (!selectedProject) return;
    setFixingFonts(true);
    try {
      const res = await fetch(`/api/v2/post-prod/web-pdf-processor/projects/${selectedProject.id}/fix-fonts`, {
        method: 'POST'
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Failed to fix fonts');
      }
      const data = await res.json();
      setFontsStatus(data);
      if (data.all_embedded) {
        toast.success('All fonts successfully embedded!');
        setActiveStep(4);
      } else {
        toast.warning('Some fonts could not be fully embedded');
      }
      setPdfRefreshKey(Date.now());
      setSelectedProject(prev => prev ? { ...prev, status: 'Fonts Checked' } : prev);
      fetchProjects();
    } catch (err: any) {
      toast.error(err.message || 'Failed to fix fonts');
    } finally {
      setFixingFonts(false);
    }
  };

  // ── Filtered list ───────────────────────────────────────────────────────

  const filteredProjects = projects.filter((p) => {
    const searchMatch =
      p.project_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.client_code || '').toLowerCase().includes(searchQuery.toLowerCase());

    let statusMatch = true;
    if (statusFilter === 'passed') statusMatch = p.validation_status === 'pass' || p.validation_status === 'validated';
    else if (statusFilter === 'failed') statusMatch = p.validation_status === 'fail' || p.validation_status === 'failed';
    else if (statusFilter === 'unvalidated') statusMatch = !p.validation_status;

    let assigneeMatch = true;
    if (assigneeFilter !== 'all') {
      if (assigneeFilter === 'unassigned') assigneeMatch = !p.assignee;
      else assigneeMatch = (p.assignee || '').toLowerCase() === assigneeFilter.toLowerCase();
    }

    return searchMatch && statusMatch && assigneeMatch;
  });

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <header className="px-6 py-4 border-b border-border/80 flex items-center justify-between bg-card shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={() => {
              if (selectedProject) {
                navigate('/post-production/web-pdf-processor');
                setFontsStatus(null);
                setActiveStep(1);
              } else {
                navigate('/post-production');
              }
            }}
            className="p-1.5 h-auto rounded-lg text-muted hover:text-text hover:bg-border/60 shrink-0"
          >
            <ArrowLeft size={16} />
          </Button>
          <div>
            <h1 className="text-base font-semibold m-0 text-text">
              {selectedProject ? selectedProject.project_name : 'Web PDF Processor'}
            </h1>
            <p className="text-xs text-muted m-0 mt-0.5">
              {selectedProject
                ? `${selectedProject.client}${selectedProject.client_code ? ` (${selectedProject.client_code})` : ''} • Step 1: Merge PDFs`
                : 'Upload, extract and audit Web PDF projects and configurations'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!selectedProject && isTeamLead && (
            <Button
              onClick={() => setShowAddModal(true)}
              leftIcon={<Plus size={15} />}
            >
              Create Project
            </Button>
          )}
        </div>
      </header>

      {/* ── WORKSPACE (split-screen) ───────────────────────────────────────── */}
      {selectedProject ? (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[420px_1fr] divide-y lg:divide-y-0 lg:divide-x divide-border overflow-hidden">

          {/* RIGHT — PDF Preview */}
          <div className="flex flex-col p-6 overflow-hidden bg-background order-1 lg:order-2">
            <h2 className="text-sm font-bold text-text mb-3 flex items-center gap-2 shrink-0">
              <FileText size={16} className="text-primary" />
              {selectedProject ? `${selectedProject.status === 'Bookmarked' ? 'Bookmarked' : selectedProject.status === 'Trimmed' ? 'Trimmed' : selectedProject.status === 'Fonts Checked' ? 'Fonts Checked' : selectedProject.status === 'Security Checked' ? 'Security Checked' : 'Merged'} PDF Preview` : 'PDF Preview'}
              {PDF_AVAILABLE_STATUSES.includes(selectedProject.status) && (
                <>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                    ✓ {selectedProject.status}
                  </span>
                  <div className="ml-auto flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveStep(5);
                        handleOpenEditBookmarks();
                      }}
                      className="text-xs text-primary hover:text-primary/80 font-semibold flex items-center gap-1 bg-primary/10 hover:bg-primary/20 px-2 py-0.5 rounded border border-primary/20 transition-colors"
                      title="Open Drag & Drop Bookmark Level Manager"
                    >
                      <Bookmark size={12} />
                      Edit Bookmarks
                    </button>
                    <a
                      href={`/api/v2/post-prod/web-pdf-processor/projects/${selectedProject.id}/final-pdf${selectedProject.status === 'Bookmarked' ? '#pagemode=bookmarks' : ''}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:text-primary/80 font-semibold"
                    >
                      ↗ Open
                    </a>
                  </div>
                </>
              )}
            </h2>

            <div className="flex-1 rounded-xl overflow-hidden bg-card border border-border relative flex">
              {/* SLIDE-OUT INTERACTIVE BOOKMARK SIDEBAR OVER THE PREVIEW */}
              {showEditBookmarksModal && (
                <div className="w-[300px] sm:w-[340px] shrink-0 border-r border-[#3a3b3c] bg-[#1e1f20] text-gray-200 flex flex-col z-20 shadow-2xl animate-in slide-in-from-left duration-200">
                  <div className="p-3 border-b border-[#3a3b3c] flex items-center justify-between bg-[#2a2b2d]">
                    <div className="flex items-center gap-2">
                      <Bookmark size={15} className="text-primary" />
                      <span className="text-xs font-bold text-white uppercase tracking-wider">Bookmarks</span>
                      <span className="text-[10px] font-mono bg-[#1e1f20] px-1.5 py-0.5 rounded text-gray-400 border border-[#3a3b3c]">
                        {editingBookmarksList.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        onClick={handleSaveBookmarks}
                        disabled={savingBookmarks}
                        className="text-[11px] h-6 px-2.5 font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        {savingBookmarks ? <RefreshCw size={11} className="animate-spin mr-1" /> : null}
                        Save
                      </Button>
                      <button
                        type="button"
                        onClick={() => setShowEditBookmarksModal(false)}
                        className="p-1 hover:bg-[#3a3b3c] rounded text-gray-400 hover:text-white transition-colors"
                        title="Close bookmark editor"
                      >
                        <XCircle size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Subtitle helper */}
                  <div className="px-3 py-1.5 bg-[#252627] border-b border-[#3a3b3c] flex items-center justify-between text-[10px] text-gray-400">
                    <span>Drag ⋮⋮ to reorder • ◀ ▶ to change levels</span>
                    <button
                      type="button"
                      onClick={() => addBookmark()}
                      className="text-primary hover:text-primary/80 font-bold hover:underline cursor-pointer flex items-center gap-0.5"
                    >
                      + Add
                    </button>
                  </div>

                  {/* Scrollable draggable bookmarks tree */}
                  <div ref={bookmarkContainerRef} className="flex-1 overflow-y-auto p-2 space-y-1 select-none">
                    {loadingBookmarks ? (
                      <div className="py-16 flex flex-col items-center justify-center gap-2 text-gray-400">
                        <RefreshCw size={20} className="animate-spin text-primary" />
                        <span className="text-xs">Loading bookmarks...</span>
                      </div>
                    ) : editingBookmarksList.length === 0 ? (
                      <div className="p-6 text-center text-gray-400 text-xs flex flex-col items-center gap-2">
                        <span>No bookmarks found.</span>
                        <button
                          type="button"
                          onClick={() => addBookmark()}
                          className="px-2.5 py-1 text-xs bg-primary/20 hover:bg-primary/30 text-primary border border-primary/40 rounded font-semibold cursor-pointer"
                        >
                          + Add First Bookmark
                        </button>
                      </div>
                    ) : (
                      editingBookmarksList.map((bm, index) => {
                        const isDragging = draggedBookmarkIndex === index;
                        const isDragOver = dragOverIndex === index && draggedBookmarkIndex !== index;
                        const levelColors = [
                          'text-blue-400 border-blue-500/40 bg-blue-500/10',
                          'text-purple-400 border-purple-500/40 bg-purple-500/10',
                          'text-amber-400 border-amber-500/40 bg-amber-500/10',
                          'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
                          'text-rose-400 border-rose-500/40 bg-rose-500/10',
                        ];
                        const badgeClass = levelColors[(bm.level - 1) % levelColors.length];

                        return (
                          <div
                            key={index}
                            draggable
                            onDragStart={(e) => handleBookmarkDragStart(e, index)}
                            onDragOver={(e) => handleBookmarkDragOver(e, index)}
                            onDrop={(e) => handleBookmarkDrop(e, index)}
                            onDragEnd={handleBookmarkDragEnd}
                            onClick={() => setPreviewPage(bm.page)}
                            className={`group flex items-center gap-1.5 p-1 rounded border transition-all cursor-pointer ${
                              isDragging ? 'opacity-30 border-dashed border-primary bg-primary/10' :
                              isDragOver ? 'border-primary ring-2 ring-primary/40 bg-[#2f3133]' :
                              'border-transparent hover:border-[#3a3b3c] hover:bg-[#2a2b2d] bg-[#242526]'
                            }`}
                            style={{ paddingLeft: `${Math.max(4, (bm.level - 1) * 14 + 4)}px` }}
                          >
                            {/* Drag Handle */}
                            <div
                              className="cursor-grab active:cursor-grabbing p-0.5 text-gray-500 group-hover:text-gray-300 shrink-0"
                              title="Drag up or down to reorder"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <GripVertical size={13} />
                            </div>

                            {/* Level Badge + Indent / Outdent Controls */}
                            <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <span className={`text-[9px] font-bold px-1 rounded border ${badgeClass} font-mono`}>
                                L{bm.level}
                              </span>
                              <button
                                type="button"
                                onClick={() => changeBookmarkLevel(index, -1)}
                                disabled={bm.level <= 1}
                                className="p-0.5 text-gray-400 hover:text-white hover:bg-[#3a3b3c] rounded disabled:opacity-20"
                                title="Promote (Level Up / Outdent)"
                              >
                                <ArrowLeft size={10} />
                              </button>
                              <button
                                type="button"
                                onClick={() => changeBookmarkLevel(index, 1)}
                                disabled={bm.level >= 6}
                                className="p-0.5 text-gray-400 hover:text-white hover:bg-[#3a3b3c] rounded disabled:opacity-20 rotate-180"
                                title="Demote (Indent / Child)"
                              >
                                <ArrowLeft size={10} />
                              </button>
                            </div>

                            {/* Bookmark Title */}
                            <input
                              type="text"
                              data-bookmark-title
                              value={bm.title}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const list = [...editingBookmarksList];
                                list[index].title = e.target.value;
                                setEditingBookmarksList(list);
                              }}
                              className="flex-1 min-w-0 text-xs px-1.5 py-0.5 bg-transparent hover:bg-[#1a1b1c] focus:bg-[#1a1b1c] border border-transparent hover:border-[#3a3b3c] focus:border-primary rounded outline-none text-gray-100 font-medium truncate"
                            />

                            {/* Page Number Editable Input */}
                            <div
                              className="flex items-center bg-[#1a1b1c] hover:bg-[#252627] px-1 py-0.5 rounded border border-[#3a3b3c] hover:border-gray-500 focus-within:border-primary shrink-0 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                              title="Click to edit target page number"
                            >
                              <span className="text-[10px] font-mono text-gray-500 mr-0.5">p.</span>
                              <input
                                type="number"
                                min="1"
                                data-bookmark-page
                                value={bm.page}
                                onChange={(e) => {
                                  const list = [...editingBookmarksList];
                                  list[index].page = parseInt(e.target.value) || 1;
                                  setEditingBookmarksList(list);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    setPreviewPage(bm.page);
                                  }
                                }}
                                className="w-10 text-[10px] font-mono font-bold text-gray-200 bg-transparent outline-none text-center"
                              />
                            </div>

                            {/* Add below button on hover */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                addBookmark(index);
                              }}
                              className="p-1 text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Add new bookmark below"
                            >
                              <Plus size={11} />
                            </button>

                            {/* Delete button on hover */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeBookmark(index);
                              }}
                              className="p-1 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Delete bookmark"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {PDF_AVAILABLE_STATUSES.includes(selectedProject.status) ? (
                <iframe
                  key={`${selectedProject.id}-${selectedProject.status}-${pdfRefreshKey}-${previewPage ?? 'root'}-${highlightSearch ?? 'none'}`}
                  src={`/api/v2/post-prod/web-pdf-processor/projects/${selectedProject.id}/final-pdf?t=${pdfRefreshKey}#page=${previewPage ?? 1}${highlightSearch ? `&search=${encodeURIComponent(highlightSearch)}` : ''}${(!previewPage && selectedProject.status === 'Bookmarked' && !showEditBookmarksModal) ? '&pagemode=bookmarks' : ''}`}
                  className="w-full h-full border-0 flex-1"
                  title={`${selectedProject.status} PDF Preview`}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                  <FolderOpen size={48} className="text-muted/30 mb-4" />
                  <h3 className="text-sm font-semibold text-text m-0">No Merged PDF Yet</h3>
                  <p className="text-xs text-muted max-w-xs mt-2">
                    Categorize and order the files on the right panel, then click <strong>Merge &amp; Convert</strong> to generate the combined book PDF.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* LEFT — Stepper Panel */}
          <div className="flex flex-col overflow-hidden bg-card order-2 lg:order-1">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">

              {/* Step 1: Merge PDFs */}
              <div className={`border border-border rounded-xl overflow-hidden bg-background transition-colors ${activeStep === 1 ? 'ring-1 ring-primary border-primary/50' : ''}`}>
                <button
                  onClick={() => setActiveStep(activeStep === 1 ? 0 : 1)}
                  className="w-full flex items-center justify-between p-4 bg-muted/5 hover:bg-muted/10 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${PDF_AVAILABLE_STATUSES.includes(selectedProject.status)
                        ? 'bg-emerald-500/20 text-emerald-600'
                        : activeStep === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                      {PDF_AVAILABLE_STATUSES.includes(selectedProject.status) ? <CheckCircle2 size={14} /> : '1'}
                    </div>
                    <h2 className="text-sm font-bold text-text m-0">Merge PDF</h2>
                  </div>
                  {activeStep === 1 ? <ChevronUp size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
                </button>

                {activeStep === 1 && (
                  <div className="p-4 border-t border-border flex flex-col gap-4 max-h-[600px]">
                    <div className="flex items-start justify-between shrink-0 gap-3">
                      <p className="text-[11px] text-muted m-0">
                        Auto-detected below. Check/uncheck, reorder, or re-categorize files, then merge.
                      </p>
                      <Button
                        onClick={handleMerge}
                        disabled={merging || loadingFiles}
                        leftIcon={merging ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                        className="text-xs font-semibold h-8 px-4 shrink-0"
                      >
                        {merging ? 'Merging...' : 'Merge & Convert'}
                      </Button>
                    </div>

                    {/* Category legend */}
                    <div className="flex flex-wrap gap-1.5 shrink-0">
                      {Object.entries(CATEGORY_LABELS).map(([cat, { label, color }]) => (
                        <span key={cat} className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${color}`}>
                          {cat} — {label}
                        </span>
                      ))}
                    </div>

                    {/* File list */}
                    {loadingFiles ? (
                      <div className="flex-1 flex items-center justify-center text-xs text-muted">
                        <RefreshCw size={18} className="animate-spin mr-2" />
                        Scanning package files...
                      </div>
                    ) : (
                      <div className="flex-1 overflow-y-auto rounded-xl border border-border divide-y divide-border/50">
                        {projectFiles.length === 0 ? (
                          <div className="p-8 text-center text-xs text-muted">
                            No PDF files found in this package's extract folder.
                          </div>
                        ) : (
                          projectFiles.map((file, idx) => {
                            const catStyle = CATEGORY_LABELS[file.category] || CATEGORY_LABELS.TEXT;
                            return (
                              <div
                                key={file.relative_path}
                                className={`p-3 flex items-center gap-3 text-xs transition-colors ${file.selected ? 'bg-card' : 'bg-muted/10'
                                  }`}
                              >
                                {/* Checkbox */}
                                <input
                                  type="checkbox"
                                  checked={file.selected}
                                  onChange={() => toggleFile(idx)}
                                  className="rounded border-border text-primary focus:ring-primary w-4 h-4 cursor-pointer shrink-0"
                                />

                                {/* File info */}
                                <div className={`min-w-0 flex-1 ${!file.selected ? 'opacity-50' : ''}`}>
                                  <p className="font-semibold text-text truncate m-0" title={file.filename}>
                                    {file.filename}
                                  </p>
                                  <p className="text-[10px] text-muted m-0 mt-0.5">
                                    {(file.size / 1024 / 1024).toFixed(2)} MB
                                  </p>
                                </div>

                                {/* Category selector */}
                                <select
                                  value={file.category}
                                  onChange={(e) => changeCategory(idx, e.target.value as ProjectFile['category'])}
                                  className={`text-[11px] font-semibold rounded-lg border py-1 px-2 focus:outline-none bg-background ${catStyle.color}`}
                                  disabled={!file.selected}
                                >
                                  <option value="FC">Cover (FC)</option>
                                  <option value="FM">Front Matter (FM)</option>
                                  <option value="TEXT">Chapter (TEXT)</option>
                                  <option value="BM">Back Matter (BM)</option>
                                  <option value="BC">Back Cover (BC)</option>
                                </select>

                                {/* Order controls */}
                                <div className="flex flex-col shrink-0">
                                  <button
                                    onClick={() => moveFile(idx, 'up')}
                                    disabled={idx === 0}
                                    className="p-0.5 hover:bg-border/60 rounded text-muted hover:text-text disabled:opacity-25 transition-colors"
                                  >
                                    <ChevronUp size={14} />
                                  </button>
                                  <button
                                    onClick={() => moveFile(idx, 'down')}
                                    disabled={idx === projectFiles.length - 1}
                                    className="p-0.5 hover:bg-border/60 rounded text-muted hover:text-text disabled:opacity-25 transition-colors"
                                  >
                                    <ChevronDown size={14} />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Step 2: Trim PDF */}
              <div className={`border border-border rounded-xl overflow-hidden bg-background transition-colors ${activeStep === 2 ? 'ring-1 ring-primary border-primary/50' : ''}`}>
                <button
                  onClick={() => {
                    if (PDF_AVAILABLE_STATUSES.includes(selectedProject.status)) {
                      setActiveStep(activeStep === 2 ? 0 : 2);
                    }
                  }}
                  disabled={!PDF_AVAILABLE_STATUSES.includes(selectedProject.status)}
                  className="w-full flex items-center justify-between p-4 bg-muted/5 hover:bg-muted/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${['Trimmed', 'Fonts Checked', 'Security Checked', 'Bookmarked', 'TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status)
                        ? 'bg-emerald-500/20 text-emerald-600'
                        : activeStep === 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                      {['Trimmed', 'Fonts Checked', 'Security Checked', 'Bookmarked', 'TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? <CheckCircle2 size={14} /> : '2'}
                    </div>
                    <h2 className="text-sm font-bold text-text m-0">Trim PDF</h2>
                  </div>
                  {activeStep === 2 ? <ChevronUp size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
                </button>

                {activeStep === 2 && (
                  <div className="p-4 border-t border-border flex flex-col gap-4">
                    {/* Default Auto-Trim Summary with Toggle */}
                    <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                        <div>
                          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 m-0">
                            Auto-trimmed to PDF TrimBox
                          </p>
                          <p className="text-[10px] text-muted m-0">
                            TrimBox bounds applied during merge. Toggle below only if you need custom trim adjustments.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowCustomTrim(!showCustomTrim)}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-muted/10 text-text transition-colors shrink-0 flex items-center gap-1.5"
                      >
                        <SlidersHorizontal size={13} className="text-primary" />
                        {showCustomTrim ? 'Hide Settings' : 'Customize Trim'}
                      </button>
                    </div>

                    {showCustomTrim && (
                      <div className="p-3 rounded-lg border border-border/80 bg-muted/5 space-y-4">
                        <div className="flex items-start justify-between shrink-0 gap-3">
                          <p className="text-[11px] text-muted m-0">
                            Select a custom trim mode or adjust margins to re-crop the PDF pages.
                          </p>
                          <Button
                            onClick={handleTrim}
                            disabled={trimming}
                            leftIcon={trimming ? <RefreshCw size={14} className="animate-spin" /> : <Edit size={14} />}
                            className="text-xs font-semibold h-8 px-4 shrink-0"
                          >
                            {trimming ? 'Trimming...' : 'Re-Trim PDF'}
                          </Button>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <label className="text-[11px] font-semibold text-text block mb-1">Crop Mode</label>
                            <select
                              value={trimMode}
                              onChange={(e) => setTrimMode(e.target.value)}
                              className="w-full text-xs p-2 rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              <option value="trimbox">PDF TrimBox (Default)</option>
                              <option value="auto">Auto Fix Bounds</option>
                              <option value="fixed">Fixed Margins</option>
                              <option value="bleedbox">PDF BleedBox</option>
                            </select>
                          </div>

                          {trimMode === 'fixed' && (
                            <div className="grid grid-cols-2 gap-3 p-3 rounded border border-border bg-muted/10">
                              <div>
                                <label className="text-[10px] font-semibold text-muted block mb-1">Top Margin</label>
                                <input
                                  type="number"
                                  value={trimMargins.top}
                                  onChange={(e) => setTrimMargins({ ...trimMargins, top: Number(e.target.value) })}
                                  className="w-full text-xs p-1.5 rounded border border-border bg-background"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-semibold text-muted block mb-1">Right Margin</label>
                                <input
                                  type="number"
                                  value={trimMargins.right}
                                  onChange={(e) => setTrimMargins({ ...trimMargins, right: Number(e.target.value) })}
                                  className="w-full text-xs p-1.5 rounded border border-border bg-background"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-semibold text-muted block mb-1">Bottom Margin</label>
                                <input
                                  type="number"
                                  value={trimMargins.bottom}
                                  onChange={(e) => setTrimMargins({ ...trimMargins, bottom: Number(e.target.value) })}
                                  className="w-full text-xs p-1.5 rounded border border-border bg-background"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-semibold text-muted block mb-1">Left Margin</label>
                                <input
                                  type="number"
                                  value={trimMargins.left}
                                  onChange={(e) => setTrimMargins({ ...trimMargins, left: Number(e.target.value) })}
                                  className="w-full text-xs p-1.5 rounded border border-border bg-background"
                                />
                              </div>
                            </div>
                          )}

                          <label className="flex items-center gap-2 mt-4 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={standardizeSize}
                              onChange={(e) => setStandardizeSize(e.target.checked)}
                              className="rounded border-border text-primary focus:ring-primary w-4 h-4"
                            />
                            <div>
                              <p className="text-xs font-semibold text-text m-0">Standardize Size</p>
                              <p className="text-[10px] text-muted m-0">Ensures all pages end up the same dimension.</p>
                            </div>
                          </label>

                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={removeMarks}
                              onChange={(e) => setRemoveMarks(e.target.checked)}
                              className="rounded border-border text-primary focus:ring-primary w-4 h-4"
                            />
                            <div>
                              <p className="text-xs font-semibold text-text m-0">Remove Marks outside bounds</p>
                              <p className="text-[10px] text-muted m-0">Sanitizes crop box edge artifacts.</p>
                            </div>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Step 3: Check Fonts */}
              <div className={`border border-border rounded-xl overflow-hidden bg-background transition-colors ${activeStep === 3 ? 'ring-1 ring-primary border-primary/50' : ''}`}>
                <button
                  onClick={() => {
                    if (PDF_AVAILABLE_STATUSES.includes(selectedProject.status)) {
                      setActiveStep(activeStep === 3 ? 0 : 3);
                    }
                  }}
                  disabled={!PDF_AVAILABLE_STATUSES.includes(selectedProject.status)}
                  className="w-full flex items-center justify-between p-4 bg-muted/5 hover:bg-muted/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${(fontsStatus && fontsStatus.all_embedded) || ['Fonts Checked', 'Security Checked', 'Bookmarked', 'TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status)
                        ? 'bg-emerald-500/20 text-emerald-600'
                        : fontsStatus && !fontsStatus.all_embedded
                          ? 'bg-amber-500/20 text-amber-600'
                          : activeStep === 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                      {fontsStatus ? (
                        fontsStatus.all_embedded ? <CheckCircle2 size={14} /> : <XCircle size={14} />
                      ) : ['Fonts Checked', 'Security Checked', 'Bookmarked', 'TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? (
                        <CheckCircle2 size={14} />
                      ) : '3'}
                    </div>
                    <h2 className="text-sm font-bold text-text m-0">Check Fonts</h2>
                  </div>
                  {activeStep === 3 ? <ChevronUp size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
                </button>

                {activeStep === 3 && (
                  <div className="p-4 border-t border-border flex flex-col gap-4">
                    <div className="flex items-start justify-between shrink-0 gap-3">
                      <p className="text-[11px] text-muted m-0">
                        Check if all fonts in the current PDF are fully embedded.
                      </p>
                      <Button
                        onClick={handleCheckFonts}
                        disabled={checkingFonts}
                        leftIcon={checkingFonts ? <RefreshCw size={14} className="animate-spin" /> : <FileText size={14} />}
                        className="text-xs font-semibold h-8 px-4 shrink-0"
                      >
                        {checkingFonts ? 'Checking...' : 'Check Fonts'}
                      </Button>
                    </div>

                    {fontsStatus && (
                      <div className={`p-4 rounded-lg border ${fontsStatus.all_embedded ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' : 'bg-amber-500/10 border-amber-500/20 text-amber-700'}`}>
                        <div className="flex items-center gap-2 mb-2">
                          {fontsStatus.all_embedded ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                          <h4 className="font-bold text-sm m-0">
                            {fontsStatus.all_embedded ? 'All Fonts Embedded' : 'Missing Embedded Fonts'}
                          </h4>
                        </div>
                        <p className="text-xs m-0 mb-3 opacity-90">
                          Total Fonts Detected: {fontsStatus.total_fonts}
                        </p>

                        {!fontsStatus.all_embedded && fontsStatus.missing_fonts.length > 0 && (
                          <div className="bg-background/50 p-3 rounded border border-amber-500/20">
                            <div className="flex items-center justify-between mb-2">
                              <h5 className="text-[10px] uppercase tracking-wider font-bold m-0">Unembedded Fonts</h5>
                              <Button
                                onClick={handleFixFonts}
                                disabled={fixingFonts || checkingFonts}
                                leftIcon={fixingFonts ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
                                className="text-[11px] font-semibold h-7 px-3 bg-amber-600 hover:bg-amber-700 text-white border-none"
                              >
                                {fixingFonts ? 'Embedding Fonts...' : 'Fix & Embed Fonts'}
                              </Button>
                            </div>
                            <ul className="list-disc pl-4 text-xs space-y-1">
                              {fontsStatus.missing_fonts.map((f: string, i: number) => (
                                <li key={i}>{f}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Step 4: Check Security */}
              <div className={`border border-border rounded-xl overflow-hidden bg-background transition-colors ${activeStep === 4 ? 'ring-1 ring-primary border-primary/50' : ''}`}>
                <button
                  onClick={() => {
                    if (PDF_AVAILABLE_STATUSES.includes(selectedProject.status)) {
                      setActiveStep(activeStep === 4 ? 0 : 4);
                    }
                  }}
                  disabled={!PDF_AVAILABLE_STATUSES.includes(selectedProject.status)}
                  className="w-full flex items-center justify-between p-4 bg-muted/5 hover:bg-muted/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${(securityStatus && securityStatus.is_free_of_protection) || ['Security Checked', 'Bookmarked', 'TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status)
                        ? 'bg-emerald-500/20 text-emerald-600'
                        : securityStatus && !securityStatus.is_free_of_protection
                          ? 'bg-amber-500/20 text-amber-600'
                          : activeStep === 4 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                      {securityStatus ? (
                        securityStatus.is_free_of_protection ? <CheckCircle2 size={14} /> : <XCircle size={14} />
                      ) : ['Security Checked', 'Bookmarked', 'TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? (
                        <CheckCircle2 size={14} />
                      ) : '4'}
                    </div>
                    <h2 className="text-sm font-bold text-text m-0">Check Security</h2>
                  </div>
                  {activeStep === 4 ? <ChevronUp size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
                </button>

                {activeStep === 4 && (
                  <div className="p-4 border-t border-border flex flex-col gap-4">
                    <div className="flex items-start justify-between shrink-0 gap-3">
                      <p className="text-[11px] text-muted m-0">
                        Check if the current PDF is free of password protection and encryption.
                      </p>
                      <Button
                        onClick={handleCheckSecurity}
                        disabled={checkingSecurity}
                        leftIcon={checkingSecurity ? <RefreshCw size={14} className="animate-spin" /> : <ShieldAlert size={14} />}
                        className="text-xs font-semibold h-8 px-4 shrink-0"
                      >
                        {checkingSecurity ? 'Checking...' : 'Check Security'}
                      </Button>
                    </div>

                    {securityStatus && (
                      <div className={`p-4 rounded-lg border ${securityStatus.is_free_of_protection ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' : 'bg-amber-500/10 border-amber-500/20 text-amber-700'}`}>
                        <div className="flex items-center gap-2 mb-2">
                          {securityStatus.is_free_of_protection ? <Unlock size={16} /> : <Lock size={16} />}
                          <h4 className="font-bold text-sm m-0">
                            {securityStatus.is_free_of_protection ? 'Free of Password Protection' : 'Security Protection Detected!'}
                          </h4>
                        </div>

                        {!securityStatus.is_free_of_protection && (
                          <div className="bg-background/50 p-3 rounded border border-amber-500/20 mt-3">
                            <ul className="list-disc pl-4 text-xs space-y-1">
                              {securityStatus.needs_pass && <li>Needs Password to open.</li>}
                              {securityStatus.is_encrypted && <li>File is Encrypted.</li>}
                              {securityStatus.error && <li className="text-red-500">{securityStatus.error}</li>}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Step 5: Generate Bookmarks */}
              <div className={`border border-border rounded-xl overflow-hidden bg-background transition-colors ${activeStep === 5 ? 'ring-1 ring-primary border-primary/50' : ''}`}>
                <button
                  onClick={() => {
                    if (PDF_AVAILABLE_STATUSES.includes(selectedProject.status)) {
                      setActiveStep(activeStep === 5 ? 0 : 5);
                    }
                  }}
                  disabled={!PDF_AVAILABLE_STATUSES.includes(selectedProject.status)}
                  className="w-full flex items-center justify-between p-4 bg-muted/5 hover:bg-muted/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${bookmarksStatus && bookmarksStatus.success || ['Bookmarked', 'TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status)
                      ? 'bg-emerald-500/20 text-emerald-600'
                      : activeStep === 5 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                      {bookmarksStatus ? (
                        bookmarksStatus.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />
                      ) : ['Bookmarked', 'TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? (
                        <CheckCircle2 size={14} />
                      ) : '5'}
                    </div>
                    <h2 className="text-sm font-bold text-text m-0">Generate Bookmarks</h2>
                  </div>
                  {activeStep === 5 ? <ChevronUp size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
                </button>

                {activeStep === 5 && (
                  <div className="p-4 border-t border-border flex flex-col gap-4">
                    {/* If existing bookmarks detected in PDF, present the choice */}
                    {existingBookmarksInfo && existingBookmarksInfo.has_existing_bookmarks && (
                      <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 flex flex-col gap-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Bookmark size={15} className="text-primary" />
                            <span className="text-xs font-semibold text-text">
                              Existing Bookmarks Detected
                            </span>
                          </div>
                          <span className="text-[10px] font-bold bg-primary/15 text-primary px-2 py-0.5 rounded-full">
                            {existingBookmarksInfo.count} items
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={handleAcceptExistingBookmarks}
                            disabled={acceptingExistingBookmarks || generatingBookmarks}
                            leftIcon={acceptingExistingBookmarks ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                            className="text-xs font-medium h-7 px-3 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                          >
                            {acceptingExistingBookmarks ? 'Saving...' : 'Set as Default'}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={handleGenerateBookmarks}
                            disabled={generatingBookmarks || acceptingExistingBookmarks}
                            leftIcon={generatingBookmarks ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                            className="text-xs font-medium h-7 px-3"
                          >
                            {generatingBookmarks ? 'Generating...' : 'Scan & Re-generate'}
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between shrink-0 gap-3">
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-text">
                        <input
                          type="checkbox"
                          checked={includeSubheadings}
                          onChange={(e) => setIncludeSubheadings(e.target.checked)}
                          className="rounded border-border bg-background focus:ring-primary accent-primary w-3.5 h-3.5"
                        />
                        Include Chapter Subheadings (H3)
                      </label>
                      {(!existingBookmarksInfo || !existingBookmarksInfo.has_existing_bookmarks) && (
                        <Button
                          onClick={handleGenerateBookmarks}
                          disabled={generatingBookmarks}
                          leftIcon={generatingBookmarks ? <RefreshCw size={14} className="animate-spin" /> : <FileText size={14} />}
                          className="text-xs font-semibold h-8 px-4 shrink-0"
                        >
                          {generatingBookmarks ? 'Generating...' : (bookmarksStatus?.success || ['Bookmarked', 'TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? 'Re-generate' : 'Generate')}
                        </Button>
                      )}
                    </div>

                    {bookmarksStatus && (
                      <div className={`p-4 rounded-lg border ${bookmarksStatus.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' : 'bg-amber-500/10 border-amber-500/20 text-amber-700'}`}>
                        <div className="flex items-center gap-2 mb-2">
                          {bookmarksStatus.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                          <h4 className="font-bold text-sm m-0">
                            {bookmarksStatus.success ? 'Bookmarks Generated' : 'Error Generating Bookmarks'}
                          </h4>
                        </div>

                        {bookmarksStatus.success ? (
                          <div className="bg-background/50 p-3 rounded border border-emerald-500/20 mt-3 flex items-center gap-4 text-xs font-medium">
                            <div className="flex flex-col gap-1">
                              <span className="text-muted-foreground">TOC Detected</span>
                              <span className="text-text">{bookmarksStatus.toc_entries_detected} entries</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-muted-foreground">Bookmarks Created</span>
                              <span className="text-text">{bookmarksStatus.bookmarks_generated} items</span>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-background/50 p-3 rounded border border-amber-500/20 mt-3 text-xs text-red-500">
                            {bookmarksStatus.error || "Unknown error"}
                          </div>
                        )}
                      </div>
                    )}

                    {(['Bookmarked', 'TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) || bookmarksStatus?.success || existingBookmarksInfo?.has_existing_bookmarks) && (
                      <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted">
                          <span className="flex items-center gap-1 font-mono text-[10px] bg-muted/30 px-1.5 py-0.5 rounded border border-border/60">
                            <kbd className="font-semibold text-text">Ctrl</kbd>+<kbd className="font-semibold text-text">B</kbd>
                          </span>
                          <span className="text-[10px] text-muted/60">/</span>
                          <span className="flex items-center gap-0.5 font-mono text-[10px] bg-muted/30 px-1.5 py-0.5 rounded border border-border/60">
                            <kbd className="font-semibold text-text">⌘B</kbd>
                          </span>
                          <span className="text-[11px] text-muted ml-0.5">Quick add</span>
                        </div>
                        <Button
                          variant={showEditBookmarksModal ? "primary" : "secondary"}
                          size="sm"
                          onClick={() => {
                            if (showEditBookmarksModal) {
                              setShowEditBookmarksModal(false);
                            } else {
                              handleOpenEditBookmarks();
                            }
                          }}
                          leftIcon={<Edit size={13} />}
                          className="text-xs h-7 px-2.5 font-medium"
                        >
                          {showEditBookmarksModal ? 'Editing Bookmarks' : 'Edit Bookmarks'}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Step 6: Generate TOC Links */}
              <div className={`border border-border rounded-xl overflow-hidden bg-background transition-colors ${activeStep === 6 ? 'ring-1 ring-primary border-primary/50' : ''}`}>
                <button
                  onClick={() => {
                    if (['Bookmarked', 'TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) || bookmarksStatus?.success) setActiveStep(activeStep === 6 ? 0 : 6);
                  }}
                  disabled={!['Bookmarked', 'TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) && !bookmarksStatus?.success}
                  className="w-full flex items-center justify-between p-4 bg-muted/5 hover:bg-muted/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${linksStatus && linksStatus.success || ['TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status)
                      ? 'bg-emerald-500/20 text-emerald-600'
                      : activeStep === 6 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                      {linksStatus ? (
                        <CheckCircle2 size={14} className="text-emerald-500" />
                      ) : ['TOC Linked', 'URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? (
                        <CheckCircle2 size={14} className="text-emerald-500" />
                      ) : (
                        "6"
                      )}
                    </div>
                    <h3 className={`font-bold m-0 text-left ${activeStep === 6 ? 'text-primary' : 'text-text'}`}>
                      Generate TOC Links
                    </h3>
                  </div>
                  {activeStep === 6 ? <ChevronUp size={20} className="text-muted" /> : <ChevronDown size={20} className="text-muted" />}
                </button>

                {activeStep === 6 && (
                  <div className="p-4 border-t border-border space-y-4">
                    <p className="text-sm text-muted">
                      Automatically create clickable links in the PDF from the Table of Contents to the corresponding chapters.
                    </p>

                    {/* Preservation toggle: Keep existing vs Rebuild all */}
                    <div className="space-y-2 p-3 bg-muted/10 rounded-lg border border-border/50">
                      <label className="text-xs font-bold text-muted uppercase tracking-wider block">Linking Mode</label>
                      <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="radio"
                            name="preserve_mode"
                            checked={preserveExistingLinks}
                            onChange={() => setPreserveExistingLinks(true)}
                            className="text-primary accent-primary"
                          />
                          <div>
                            <span className={preserveExistingLinks ? 'font-semibold text-text block' : 'text-text block'}>
                              Keep Existing Links &amp; Link Remaining Entries (Recommended)
                            </span>
                            <span className="text-[11px] text-muted block">
                              Preserves all existing valid links already in the PDF and only creates links for unlinked entries.
                            </span>
                          </div>
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="radio"
                            name="preserve_mode"
                            checked={!preserveExistingLinks}
                            onChange={() => setPreserveExistingLinks(false)}
                            className="text-primary accent-primary"
                          />
                          <div>
                            <span className={!preserveExistingLinks ? 'font-semibold text-text block' : 'text-text block'}>
                              Recreate All Links from Scratch
                            </span>
                            <span className="text-[11px] text-muted block">
                              Replaces all internal TOC links with a freshly generated set.
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-muted uppercase tracking-wider block">Link Type for Remaining Entries</label>

                      <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/10 p-2 rounded transition-colors">
                          <input type="radio" name="link_type" value="none" checked={linkType === 'none'} onChange={() => { setLinkType('none'); handleAnalyzeLinks('none'); }} className="text-primary accent-primary" />
                          <span className={linkType === 'none' ? 'font-medium' : ''}>No Links</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/10 p-2 rounded transition-colors">
                          <input type="radio" name="link_type" value="one_way" checked={linkType === 'one_way'} onChange={() => { setLinkType('one_way'); handleAnalyzeLinks('one_way'); }} className="text-primary accent-primary" />
                          <div>
                            <span className={linkType === 'one_way' ? 'font-medium block' : 'block'}>One-Way Links</span>
                            <span className="text-xs text-muted block">Table of Contents entries link to the respective chapters.</span>
                          </div>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/10 p-2 rounded transition-colors">
                          <input type="radio" name="link_type" value="two_way" checked={linkType === 'two_way'} onChange={() => { setLinkType('two_way'); handleAnalyzeLinks('two_way'); }} className="text-primary accent-primary" />
                          <div>
                            <span className={linkType === 'two_way' ? 'font-medium block' : 'block'}>Two-Way Links</span>
                            <span className="text-xs text-muted block">TOC links to chapters AND chapter titles link back to the TOC.</span>
                          </div>
                        </label>
                      </div>
                    </div>

                    {linksAnalysisStatus && linksAnalysisStatus.success && (
                      <div className="p-3 bg-blue-500/10 border border-blue-500/20 text-blue-700 rounded text-sm mt-3 mb-2 space-y-1">
                        <p className="font-bold">Analysis Report:</p>
                        <ul className="list-disc pl-5">
                          <li>One-Way Links to create: {linksAnalysisStatus.one_way_links}</li>
                          {linkType === 'two_way' && <li>Two-Way (Back) Links to create: {linksAnalysisStatus.two_way_links}</li>}
                          <li className="font-medium">Total Links: {linksAnalysisStatus.total_links}</li>
                        </ul>

                        {linksAnalysisStatus.details && linksAnalysisStatus.details.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-blue-500/20 max-h-48 overflow-y-auto">
                            <table className="w-full text-xs text-left">
                              <thead className="sticky top-0 bg-blue-50/90 text-blue-800">
                                <tr>
                                  <th className="pb-1">Title</th>
                                  <th className="pb-1 w-16">Type</th>
                                  <th className="pb-1 w-12 text-center">From</th>
                                  <th className="pb-1 w-12 text-center">To</th>
                                  <th className="pb-1 w-16 text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {linksAnalysisStatus.details.map((link: any, i: number) => (
                                  <tr key={i} className="border-b border-blue-500/10 last:border-0">
                                    <td className="py-1 truncate max-w-[150px] pr-2" title={link.title}>{link.title}</td>
                                    <td className="py-1">{link.type === 'one_way' ? 'TOC→Ch' : 'Ch→TOC'}</td>
                                    <td className="py-1 text-center">{link.source_page}</td>
                                    <td className="py-1 text-center">{link.target_page}</td>
                                    <td className="py-1 text-center">
                                      {link.is_linked ? (
                                        <span className="text-emerald-600 font-bold" title="Already linked">✓</span>
                                      ) : (
                                        <button
                                          onClick={() => handleManualLink(link, i)}
                                          className="text-xs px-2 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                                          title="Fix / Link manually"
                                        >
                                          Link
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-3 mt-4">
                      <Button
                        onClick={() => handleAnalyzeLinks()}
                        disabled={analyzingLinks || generatingLinks || linkType === 'none'}
                        variant={linksAnalysisStatus ? 'outline' : 'primary'}
                        leftIcon={analyzingLinks ? <RefreshCw size={16} className="animate-spin" /> : <FileText size={16} />}
                        className="flex-1"
                      >
                        {analyzingLinks ? 'Analyzing...' : 'Analyze Links'}
                      </Button>

                      <Button
                        onClick={handleApplyLinks}
                        disabled={generatingLinks || analyzingLinks || !linksAnalysisStatus || linkType === 'none'}
                        leftIcon={generatingLinks ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                        className="flex-1"
                      >
                        {generatingLinks ? 'Applying Links...' : 'Apply / Fix'}
                      </Button>
                    </div>

                    {linksStatus && linksStatus.error && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 rounded text-sm mt-3">
                        {linksStatus.error}
                      </div>
                    )}
                    {linksAnalysisStatus && linksAnalysisStatus.error && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 rounded text-sm mt-3">
                        {linksAnalysisStatus.error}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Step 7: URL Hyperlinking */}
              <div className="border border-border/40 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors"
                  onClick={() => setActiveStep(activeStep === 7 ? 0 : 7)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${['URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? 'bg-emerald-500/20 text-emerald-600' : 'bg-primary/10 text-primary'}`}>
                      {['URL Linked', 'Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? <CheckCircle2 size={14} /> : '7'}
                    </div>
                    <span className="font-medium text-sm">URL Hyperlinking</span>
                    {urlLinksAnalysis && (
                      <span className="text-xs bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full">
                        {urlLinksAnalysis.total_urls} URLs · {urlLinksAnalysis.not_linked} unlinked
                      </span>
                    )}
                  </div>
                  <ChevronDown size={16} className={`transition-transform ${activeStep === 7 ? 'rotate-180' : ''}`} />
                </button>

                {activeStep === 7 && (
                  <div className="p-4 border-t border-border/30 space-y-4">
                    <p className="text-xs text-muted">
                      Scan the PDF for plain-text web addresses and convert them into active clickable hyperlinks.
                    </p>

                    {/* Summary */}
                    {urlLinksAnalysis && (
                      <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg space-y-1 text-sm text-blue-800">
                        <p className="font-semibold">URL Report:</p>
                        <ul className="list-disc list-inside space-y-0.5">
                          <li>Total URLs found: <strong>{urlLinksAnalysis.total_urls}</strong></li>
                          <li className="text-emerald-700">Already linked: <strong>{urlLinksAnalysis.already_linked}</strong></li>
                          <li className="text-red-600">Not linked (needs fix): <strong>{urlLinksAnalysis.not_linked}</strong></li>
                        </ul>
                      </div>
                    )}

                    {/* URL Table */}
                    {urlLinksAnalysis?.details?.length > 0 && (
                      <div className="max-h-72 overflow-y-auto rounded border border-blue-200 text-xs">
                        <table className="w-full border-collapse">
                          <thead className="sticky top-0 bg-blue-50/90 text-blue-800">
                            <tr>
                              <th className="text-left p-2 border-b border-blue-200">URL</th>
                              <th className="p-2 border-b border-blue-200 w-12 text-center">Page</th>
                              <th className="p-2 border-b border-blue-200 w-20 text-center">PDF Link</th>
                              <th className="p-2 border-b border-blue-200 w-28 text-center">URL Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {urlLinksAnalysis.details.map((item: UrlLinkDetail, i: number) => {
                              const isSelected = previewPage === item.page && highlightSearch === item.display_text;
                              return (
                                <tr
                                  key={i}
                                  onClick={() => {
                                    setPreviewPage(item.page);
                                    setHighlightSearch(item.display_text || item.url);
                                  }}
                                  className={`border-b border-blue-100 last:border-0 cursor-pointer transition-colors ${isSelected ? 'bg-blue-100/70 font-medium' : 'hover:bg-blue-50/50'}`}
                                  title="Click to view and highlight on PDF page"
                                >
                                  <td className="p-2 max-w-[160px]">
                                    <span className="truncate block text-blue-700 underline decoration-blue-300 underline-offset-2" title={item.url}>{item.display_text}</span>
                                  </td>
                                  <td className="p-2 text-center font-semibold text-blue-800">{item.page}</td>
                                  <td className="p-2 text-center">
                                    {item.is_linked ? (
                                      <span className="text-emerald-600 font-bold" title="Hyperlinked in PDF">✓ Linked</span>
                                    ) : (
                                      <span className="text-red-500 font-bold" title="Not hyperlinked in PDF">✗ Not linked</span>
                                    )}
                                  </td>
                                  <td className="p-2 text-center">
                                    {item.http_ok ? (
                                      <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                                        {item.http_status} {item.http_description}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-red-500 font-semibold" title={item.http_description}>
                                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span>
                                        {item.http_status ? `${item.http_status} ${item.http_description}` : item.http_description}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {urlLinksAnalysis?.total_urls === 0 && (
                      <p className="text-sm text-muted text-center py-2">No plain-text URLs found in the PDF.</p>
                    )}

                    {/* Color URLs Toggle */}
                    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/10">
                      <div>
                        <p className="text-xs font-semibold text-text m-0">Change URL Text Color</p>
                        <p className="text-[10px] text-muted m-0">
                          {colorUrls
                            ? 'URL text will be colored link blue (#0f73bf) upon applying links.'
                            : 'Keep existing text color in the PDF (no font color change).'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setColorUrls(!colorUrls)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${colorUrls ? 'bg-primary' : 'bg-muted/40'}`}
                        role="switch"
                        aria-checked={colorUrls}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${colorUrls ? 'translate-x-4' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-3 mt-2">
                      <Button
                        onClick={handleAnalyzeUrlLinks}
                        disabled={analyzingUrlLinks || applyingUrlLinks}
                        variant={urlLinksAnalysis ? 'outline' : 'primary'}
                        leftIcon={analyzingUrlLinks ? <RefreshCw size={16} className="animate-spin" /> : <FileText size={16} />}
                        className="flex-1"
                      >
                        {analyzingUrlLinks ? 'Analyzing...' : 'Analyze URLs'}
                      </Button>

                      <Button
                        onClick={handleApplyUrlLinks}
                        disabled={applyingUrlLinks || analyzingUrlLinks || !urlLinksAnalysis || urlLinksAnalysis.not_linked === 0}
                        leftIcon={applyingUrlLinks ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                        className="flex-1"
                      >
                        {applyingUrlLinks ? 'Applying...' : 'Apply / Fix'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 8: Email Hyperlinking */}
              <div className="border border-border/40 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors"
                  onClick={() => setActiveStep(activeStep === 8 ? 0 : 8)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${['Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? 'bg-emerald-500/20 text-emerald-600' : 'bg-primary/10 text-primary'}`}>
                      {['Email Linked', 'Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? <CheckCircle2 size={14} /> : '8'}
                    </div>
                    <span className="font-medium text-sm">Email Hyperlinking</span>
                    {emailLinksAnalysis && (
                      <span className="text-xs bg-purple-500/10 text-purple-600 px-2 py-0.5 rounded-full">
                        {emailLinksAnalysis.total_emails} Emails · {emailLinksAnalysis.not_linked} unlinked
                      </span>
                    )}
                  </div>
                  <ChevronDown size={16} className={`transition-transform ${activeStep === 8 ? 'rotate-180' : ''}`} />
                </button>

                {activeStep === 8 && (
                  <div className="p-4 border-t border-border/30 space-y-4">
                    <p className="text-xs text-muted">
                      Scan the PDF for plain-text email addresses and convert them into active mailto: hyperlinks.
                    </p>

                    {/* Status Legend */}
                    <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-lg text-xs space-y-1">
                      <p className="font-semibold text-purple-800">Status Guide:</p>
                      <div className="space-y-1 ml-2">
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-600 font-bold">✓ Linked</span>
                          <span className="text-muted">= Already a clickable mailto: hyperlink in PDF</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-red-500 font-bold">✗ Not linked</span>
                          <span className="text-muted">= Plain text email, needs "Apply/Fix" to make it clickable</span>
                        </div>
                      </div>
                    </div>

                    {/* Summary */}
                    {emailLinksAnalysis && (
                      <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-lg space-y-1 text-sm text-purple-800">
                        <p className="font-semibold">Email Report:</p>
                        <ul className="list-disc list-inside space-y-0.5">
                          <li>Total emails found: <strong>{emailLinksAnalysis.total_emails}</strong></li>
                          <li className="text-emerald-700">Already linked: <strong>{emailLinksAnalysis.already_linked}</strong></li>
                          <li className="text-red-600">Not linked (needs fix): <strong>{emailLinksAnalysis.not_linked}</strong></li>
                        </ul>
                      </div>
                    )}

                    {/* Email Table */}
                    {emailLinksAnalysis?.details?.length > 0 && (
                      <div className="max-h-72 overflow-y-auto rounded border border-purple-200 text-xs">
                        <table className="w-full border-collapse">
                          <thead className="sticky top-0 bg-purple-50/90 text-purple-800">
                            <tr>
                              <th className="text-left p-2 border-b border-purple-200">Email Address</th>
                              <th className="p-2 border-b border-purple-200 w-12 text-center">Page</th>
                              <th className="p-2 border-b border-purple-200 text-center">
                                <div className="flex flex-col items-center gap-1">
                                  <span>Link Status</span>
                                  <span className="font-normal text-purple-600 text-[9px]">(Clickable?)</span>
                                </div>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {emailLinksAnalysis.details.map((item: EmailLinkDetail, i: number) => (
                              <tr key={i} className="border-b border-purple-100 last:border-0 hover:bg-purple-50/30">
                                <td className="p-2 max-w-[200px]">
                                  <span className="truncate block text-purple-700" title={item.email}>{item.email}</span>
                                </td>
                                <td className="p-2 text-center text-muted">{item.page}</td>
                                <td className="p-2 text-center">
                                  {item.is_linked ? (
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-emerald-600 font-bold">✓ Linked</span>
                                      <span className="text-[9px] text-emerald-600/70">Clickable</span>
                                    </div>
                                  ) : (
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-red-500 font-bold">✗ Not linked</span>
                                      <span className="text-[9px] text-red-500/70">Needs fix</span>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {emailLinksAnalysis?.total_emails === 0 && (
                      <p className="text-sm text-muted text-center py-2">No email addresses found in the PDF.</p>
                    )}

                    {/* Color Emails Toggle */}
                    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/10">
                      <div>
                        <p className="text-xs font-semibold text-text m-0">Change Email Text Color</p>
                        <p className="text-[10px] text-muted m-0">
                          {colorEmails
                            ? 'Email text will be colored link blue (#0f73bf) upon applying links.'
                            : 'Keep existing text color in the PDF (no font color change).'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setColorEmails(!colorEmails)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${colorEmails ? 'bg-primary' : 'bg-muted/40'}`}
                        role="switch"
                        aria-checked={colorEmails}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${colorEmails ? 'translate-x-4' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-3 mt-2">
                      <Button
                        onClick={handleAnalyzeEmailLinks}
                        disabled={analyzingEmailLinks || applyingEmailLinks}
                        variant={emailLinksAnalysis ? 'outline' : 'primary'}
                        leftIcon={analyzingEmailLinks ? <RefreshCw size={16} className="animate-spin" /> : <FileText size={16} />}
                        className="flex-1"
                      >
                        {analyzingEmailLinks ? 'Analyzing...' : 'Analyze Emails'}
                      </Button>

                      <Button
                        onClick={handleApplyEmailLinks}
                        disabled={applyingEmailLinks || analyzingEmailLinks || !emailLinksAnalysis || emailLinksAnalysis.not_linked === 0}
                        leftIcon={applyingEmailLinks ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                        className="flex-1"
                      >
                        {applyingEmailLinks ? 'Applying...' : 'Apply / Fix'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 9: Endnote Links */}
              <div className="border border-border/40 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors"
                  onClick={() => setActiveStep(activeStep === 9 ? 0 : 9)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${['Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? 'bg-emerald-500/20 text-emerald-600' : 'bg-primary/10 text-primary'}`}>
                      {['Endnote Linked', 'Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? <CheckCircle2 size={14} /> : '9'}
                    </div>
                    <span className="font-medium text-sm">Endnote Links</span>
                    {endnoteLinksAnalysis && (
                      <span className="text-xs bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded-full">
                        {endnoteLinksAnalysis.total_notes} Notes · {endnoteLinksAnalysis.not_linked} unlinked
                      </span>
                    )}
                  </div>
                  <ChevronDown size={16} className={`transition-transform ${activeStep === 9 ? 'rotate-180' : ''}`} />
                </button>

                {activeStep === 9 && (
                  <div className="p-4 border-t border-border/30 space-y-4">
                    <p className="text-xs text-muted">
                      Create bidirectional links between superscript note references and their corresponding endnotes.
                    </p>

                    {/* Status Legend */}
                    <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg text-xs space-y-1">
                      <p className="font-semibold text-blue-800">Link Status:</p>
                      <div className="space-y-1 ml-2">
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-600 font-bold">✓ Linked</span>
                          <span className="text-muted">= Bidirectional links created (ref ↔ endnote)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-red-500 font-bold">✗ Not linked</span>
                          <span className="text-muted">= Missing links, needs "Apply/Fix"</span>
                        </div>
                      </div>
                    </div>

                    {/* Summary */}
                    {endnoteLinksAnalysis && (
                      <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg space-y-1 text-sm text-blue-800">
                        <p className="font-semibold">Endnote Report:</p>
                        <ul className="list-disc list-inside space-y-0.5">
                          <li>Total notes found: <strong>{endnoteLinksAnalysis.total_notes}</strong></li>
                          <li className="text-emerald-700">Already linked: <strong>{endnoteLinksAnalysis.linked}</strong></li>
                          <li className="text-red-600">Not linked (needs fix): <strong>{endnoteLinksAnalysis.not_linked}</strong></li>
                        </ul>
                      </div>
                    )}

                    {/* Endnote Table */}
                    {endnoteLinksAnalysis?.details?.length > 0 && (
                      <div className="max-h-72 overflow-y-auto rounded border border-blue-200 text-xs">
                        <table className="w-full border-collapse">
                          <thead className="sticky top-0 bg-blue-50/90 text-blue-800">
                            <tr>
                              <th className="text-left p-2 border-b border-blue-200 w-12 text-center">Note#</th>
                              <th className="p-2 border-b border-blue-200 w-20 text-center">Reference Page</th>
                              <th className="p-2 border-b border-blue-200 w-20 text-center">Definition Page</th>
                              <th className="p-2 border-b border-blue-200">
                                <div className="flex flex-col items-center gap-1">
                                  <span>Link Status</span>
                                  <span className="font-normal text-blue-600 text-[9px]">(Bidirectional?)</span>
                                </div>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {endnoteLinksAnalysis.details.map((item: EndnoteDetail, i: number) => (
                              <tr key={i} className="border-b border-blue-100 last:border-0 hover:bg-blue-50/30">
                                <td className="p-2 text-center font-bold text-blue-700">{item.note_number}</td>
                                <td className="p-2 text-center text-muted">{item.reference_page || '-'}</td>
                                <td className="p-2 text-center text-muted">{item.definition_page || '-'}</td>
                                <td className="p-2 text-center">
                                  {item.is_linked ? (
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-emerald-600 font-bold">✓ Linked</span>
                                      <span className="text-[9px] text-emerald-600/70">Active</span>
                                    </div>
                                  ) : (
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-red-500 font-bold">✗ Not linked</span>
                                      <span className="text-[9px] text-red-500/70">{item.status || 'Needs fix'}</span>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {endnoteLinksAnalysis?.total_notes === 0 && (
                      <p className="text-sm text-muted text-center py-2">No endnotes found in the PDF.</p>
                    )}

                    {/* Buttons */}
                    <div className="flex gap-3 mt-2">
                      <Button
                        onClick={handleAnalyzeEndnoteLinks}
                        disabled={analyzingEndnoteLinks || applyingEndnoteLinks}
                        variant={endnoteLinksAnalysis ? 'outline' : 'primary'}
                        leftIcon={analyzingEndnoteLinks ? <RefreshCw size={16} className="animate-spin" /> : <FileText size={16} />}
                        className="flex-1"
                      >
                        {analyzingEndnoteLinks ? 'Analyzing...' : 'Analyze Notes'}
                      </Button>

                      <Button
                        onClick={handleApplyEndnoteLinks}
                        disabled={applyingEndnoteLinks || analyzingEndnoteLinks || !endnoteLinksAnalysis || endnoteLinksAnalysis.not_linked === 0}
                        leftIcon={applyingEndnoteLinks ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                        className="flex-1"
                      >
                        {applyingEndnoteLinks ? 'Applying...' : 'Apply / Fix'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 10: Cross-Reference Links */}
              <div className="border border-border/40 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors"
                  onClick={() => setActiveStep(activeStep === 10 ? 0 : 10)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${['Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? 'bg-emerald-500/20 text-emerald-600' : 'bg-primary/10 text-primary'}`}>
                      {['Crossref Linked', 'Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? <CheckCircle2 size={14} /> : '10'}
                    </div>
                    <span className="font-medium text-sm">Cross-Reference Links</span>
                    {crossrefLinksAnalysis && (
                      <span className="text-xs bg-indigo-500/10 text-indigo-600 px-2 py-0.5 rounded-full">
                        {crossrefLinksAnalysis.total_references} Refs · {crossrefLinksAnalysis.not_linked} unlinked
                      </span>
                    )}
                  </div>
                  <ChevronDown size={16} className={`transition-transform ${activeStep === 10 ? 'rotate-180' : ''}`} />
                </button>

                {activeStep === 10 && (
                  <div className="p-4 border-t border-border/30 space-y-4">
                    <p className="text-xs text-muted">
                      Create links for cross-references to Figures, Tables, Chapters, and Pages throughout the document.
                    </p>

                    {/* Status Legend */}
                    <div className="p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-lg text-xs space-y-1">
                      <p className="font-semibold text-indigo-800">Link Status:</p>
                      <div className="space-y-1 ml-2">
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-600 font-bold">✓ Linked</span>
                          <span className="text-muted">= Cross-reference link created (to target)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-red-500 font-bold">✗ Not linked</span>
                          <span className="text-muted">= Missing links, needs "Apply/Fix"</span>
                        </div>
                      </div>
                    </div>

                    {/* Summary */}
                    {crossrefLinksAnalysis && (
                      <div className="p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-lg space-y-1 text-sm text-indigo-800">
                        <p className="font-semibold">Cross-Reference Report:</p>
                        <ul className="list-disc list-inside space-y-0.5">
                          <li>Total references found: <strong>{crossrefLinksAnalysis.total_references}</strong></li>
                          <li className="text-emerald-700">Already linked: <strong>{crossrefLinksAnalysis.linked}</strong></li>
                          <li className="text-red-600">Not linked (needs fix): <strong>{crossrefLinksAnalysis.not_linked}</strong></li>
                        </ul>
                      </div>
                    )}

                    {/* Cross-Reference Table */}
                    {crossrefLinksAnalysis?.details?.length > 0 && (
                      <div className="max-h-72 overflow-y-auto rounded border border-indigo-200 text-xs">
                        <table className="w-full border-collapse">
                          <thead className="sticky top-0 bg-indigo-50/90 text-indigo-800">
                            <tr>
                              <th className="text-left p-2 border-b border-indigo-200 text-center">Type</th>
                              <th className="p-2 border-b border-indigo-200">Reference Text</th>
                              <th className="p-2 border-b border-indigo-200 w-16 text-center">Ref Page</th>
                              <th className="p-2 border-b border-indigo-200">Target</th>
                              <th className="p-2 border-b border-indigo-200 w-16 text-center">Target Page</th>
                              <th className="p-2 border-b border-indigo-200">Link Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {crossrefLinksAnalysis.details.map((item: CrossrefDetail, i: number) => (
                              <tr key={i} className="border-b border-indigo-100 last:border-0 hover:bg-indigo-50/30">
                                <td className="p-2 text-center">
                                  <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-medium capitalize">
                                    {item.type}
                                  </span>
                                </td>
                                <td className="p-2 text-muted truncate">{item.reference_text}</td>
                                <td className="p-2 text-center text-muted">{item.reference_page || '-'}</td>
                                <td className="p-2 text-muted truncate">{item.target_identifier}</td>
                                <td className="p-2 text-center text-muted">{item.target_page || '-'}</td>
                                <td className="p-2 text-center">
                                  {item.is_linked ? (
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-emerald-600 font-bold">✓ Linked</span>
                                      <span className="text-[9px] text-emerald-600/70">Active</span>
                                    </div>
                                  ) : (
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-red-500 font-bold">✗ Not linked</span>
                                      <span className="text-[9px] text-red-500/70">Needs fix</span>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {crossrefLinksAnalysis?.total_references === 0 && (
                      <p className="text-sm text-muted text-center py-2">No cross-references found in the PDF.</p>
                    )}

                    {/* Buttons */}
                    <div className="flex gap-3 mt-2">
                      <Button
                        onClick={handleAnalyzeCrossrefLinks}
                        disabled={analyzingCrossrefLinks || applyingCrossrefLinks}
                        variant={crossrefLinksAnalysis ? 'outline' : 'primary'}
                        leftIcon={analyzingCrossrefLinks ? <RefreshCw size={16} className="animate-spin" /> : <FileText size={16} />}
                        className="flex-1"
                      >
                        {analyzingCrossrefLinks ? 'Analyzing...' : 'Analyze References'}
                      </Button>

                      <Button
                        onClick={handleApplyCrossrefLinks}
                        disabled={applyingCrossrefLinks || analyzingCrossrefLinks || !crossrefLinksAnalysis || crossrefLinksAnalysis.not_linked === 0}
                        leftIcon={applyingCrossrefLinks ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                        className="flex-1"
                      >
                        {applyingCrossrefLinks ? 'Applying...' : 'Apply / Fix'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── STEP 11: INDEX HYPERLINKING ── */}
              <div className="border border-border/40 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors"
                  onClick={() => setActiveStep(activeStep === 11 ? 0 : 11)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${['Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? 'bg-emerald-500/20 text-emerald-600' : 'bg-primary/10 text-primary'}`}>
                      {['Index Linked', 'Glossary Linked'].includes(selectedProject.status) ? <CheckCircle2 size={14} /> : '11'}
                    </div>
                    <span className="font-medium text-sm">Index Hyperlinking</span>
                    {indexLinksAnalysis && (
                      <span className="text-xs bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full">
                        {indexLinksAnalysis.total_references} Refs · {indexLinksAnalysis.not_linked} unlinked
                      </span>
                    )}
                  </div>
                  <ChevronDown size={16} className={`transition-transform ${activeStep === 11 ? 'rotate-180' : ''}`} />
                </button>

                {activeStep === 11 && (
                  <div className="p-4 border-t border-border/30 space-y-4">
                    <p className="text-xs text-muted">
                      Scan the Index pages for printed page numbers and ranges (e.g., 155, 157–8) and create clickable links directly to their destination pages.
                    </p>

                    {/* Status Legend */}
                    <div className="p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-lg text-xs space-y-1">
                      <p className="font-semibold text-indigo-800">Link Status:</p>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-600 font-bold">✓ Linked</span>
                          <span className="text-muted">= Clickable link created directly to target page</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-red-500 font-bold">✗ Not linked</span>
                          <span className="text-muted">= Unlinked page number, needs "Apply / Fix"</span>
                        </div>
                      </div>
                    </div>

                    {/* Analysis Summary */}
                    {indexLinksAnalysis && (
                      <div className="p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-lg space-y-1 text-sm text-indigo-800">
                        <p className="font-semibold">Index Report:</p>
                        <ul className="list-disc list-inside space-y-0.5">
                          <li>Total index page references: <strong>{indexLinksAnalysis.total_references}</strong></li>
                          {indexLinksAnalysis.index_pages?.length > 0 && (
                            <li>Index pages: <strong>Pages {indexLinksAnalysis.index_pages[0]}–{indexLinksAnalysis.index_pages[indexLinksAnalysis.index_pages.length - 1]}</strong></li>
                          )}
                          <li className="text-emerald-700">Already linked: <strong>{indexLinksAnalysis.linked}</strong></li>
                          <li className="text-red-600">Not linked (needs fix): <strong>{indexLinksAnalysis.not_linked}</strong></li>
                        </ul>
                      </div>
                    )}

                    {/* Details Table */}
                    {indexLinksAnalysis?.details?.length > 0 && (
                      <div className="max-h-72 overflow-y-auto rounded border border-indigo-200 text-xs">
                        <table className="w-full border-collapse">
                          <thead className="sticky top-0 bg-indigo-50/90 text-indigo-800">
                            <tr>
                              <th className="text-left p-2 border-b border-indigo-200">Index Entry / Term</th>
                              <th className="p-2 border-b border-indigo-200 w-24 text-center">Reference</th>
                              <th className="p-2 border-b border-indigo-200 w-20 text-center">Index Pg</th>
                              <th className="p-2 border-b border-indigo-200 w-20 text-center">Target Pg</th>
                              <th className="p-2 border-b border-indigo-200 w-24 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {indexLinksAnalysis.details.slice(0, 500).map((item: IndexLinkDetail, i: number) => (
                              <tr key={i} className="border-b border-indigo-100 last:border-0 hover:bg-indigo-50/30">
                                <td className="p-2 text-text font-medium truncate max-w-[180px]">{item.term}</td>
                                <td className="p-2 text-center text-indigo-700 font-semibold">{item.page_reference}</td>
                                <td className="p-2 text-center text-muted">{item.source_page}</td>
                                <td className="p-2 text-center text-emerald-700 font-semibold">{item.target_page}</td>
                                <td className="p-2 text-center">
                                  {item.is_linked ? (
                                    <span className="text-emerald-600 font-bold">✓ Linked</span>
                                  ) : (
                                    <span className="text-red-500 font-bold">✗ Not linked</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {indexLinksAnalysis?.total_references === 0 && (
                      <p className="text-sm text-muted text-center py-2">No Index section found in this PDF.</p>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3 mt-2">
                      <Button
                        onClick={handleAnalyzeIndexLinks}
                        disabled={analyzingIndexLinks || applyingIndexLinks}
                        variant={indexLinksAnalysis ? 'outline' : 'primary'}
                        leftIcon={analyzingIndexLinks ? <RefreshCw size={16} className="animate-spin" /> : <FileText size={16} />}
                        className="flex-1"
                      >
                        {analyzingIndexLinks ? 'Analyzing...' : 'Analyze Index'}
                      </Button>

                      <Button
                        onClick={handleApplyIndexLinks}
                        disabled={applyingIndexLinks || analyzingIndexLinks || !indexLinksAnalysis || indexLinksAnalysis.not_linked === 0}
                        leftIcon={applyingIndexLinks ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                        className="flex-1"
                      >
                        {applyingIndexLinks ? 'Applying...' : 'Apply / Fix'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── STEP 12: GLOSSARY HYPERLINKING ── */}
              <div className="border border-border/40 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors"
                  onClick={() => setActiveStep(activeStep === 12 ? 0 : 12)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${selectedProject.status === 'Glossary Linked' ? 'bg-emerald-500/20 text-emerald-600' : 'bg-primary/10 text-primary'}`}>
                      {selectedProject.status === 'Glossary Linked' ? <CheckCircle2 size={14} /> : '12'}
                    </div>
                    <span className="font-medium text-sm">Glossary Hyperlinking</span>
                    {glossaryLinksAnalysis && (
                      <span className="text-xs bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full">
                        {glossaryLinksAnalysis.total_terms} Terms · {glossaryLinksAnalysis.not_linked} unlinked
                      </span>
                    )}
                  </div>
                  <ChevronDown size={16} className={`transition-transform ${activeStep === 12 ? 'rotate-180' : ''}`} />
                </button>

                {activeStep === 12 && (
                  <div className="p-4 border-t border-border/30 space-y-4">
                    <p className="text-xs text-muted">
                      Scan the chapter body pages for key terms defined in the Glossary and create clickable links directly to their definition in the Glossary.
                    </p>

                    {/* Status Legend */}
                    <div className="p-3 bg-teal-500/5 border border-teal-500/20 rounded-lg text-xs space-y-1">
                      <p className="font-semibold text-teal-800">Link Status:</p>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-600 font-bold">✓ Linked</span>
                          <span className="text-muted">= Clickable link created directly to Glossary definition</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-red-500 font-bold">✗ Not linked</span>
                          <span className="text-muted">= Unlinked term, needs "Apply / Fix"</span>
                        </div>
                      </div>
                    </div>

                    {/* Analysis Summary */}
                    {glossaryLinksAnalysis && (
                      <div className="p-3 bg-teal-500/5 border border-teal-500/20 rounded-lg space-y-1 text-sm text-teal-800">
                        <p className="font-semibold">Glossary Report:</p>
                        <ul className="list-disc list-inside space-y-0.5">
                          <li>Total body term occurrences: <strong>{glossaryLinksAnalysis.total_terms}</strong></li>
                          {glossaryLinksAnalysis.glossary_pages?.length > 0 && (
                            <li>Glossary pages: <strong>Pages {glossaryLinksAnalysis.glossary_pages[0]}–{glossaryLinksAnalysis.glossary_pages[glossaryLinksAnalysis.glossary_pages.length - 1]}</strong></li>
                          )}
                          <li className="text-emerald-700">Already linked: <strong>{glossaryLinksAnalysis.linked}</strong></li>
                          <li className="text-red-600">Not linked (needs fix): <strong>{glossaryLinksAnalysis.not_linked}</strong></li>
                        </ul>
                      </div>
                    )}

                    {/* Details Table */}
                    {glossaryLinksAnalysis?.details?.length > 0 && (
                      <div className="max-h-72 overflow-y-auto rounded border border-teal-200 text-xs">
                        <table className="w-full border-collapse">
                          <thead className="sticky top-0 bg-teal-50/90 text-teal-800">
                            <tr>
                              <th className="text-left p-2 border-b border-teal-200">Key Term</th>
                              <th className="p-2 border-b border-teal-200 w-24 text-center">Body Pg</th>
                              <th className="p-2 border-b border-teal-200 w-24 text-center">Glossary Pg</th>
                              <th className="p-2 border-b border-teal-200 w-24 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {glossaryLinksAnalysis.details.slice(0, 500).map((item: GlossaryLinkDetail, i: number) => (
                              <tr key={i} className="border-b border-teal-100 last:border-0 hover:bg-teal-50/30">
                                <td className="p-2 text-text font-medium truncate max-w-[200px]" title={item.term}>
                                  {item.body_term || item.term}
                                </td>
                                <td className="p-2 text-center text-teal-700 font-semibold">{item.body_page}</td>
                                <td className="p-2 text-center text-emerald-700 font-semibold">{item.glossary_page}</td>
                                <td className="p-2 text-center">
                                  {item.is_linked ? (
                                    <span className="text-emerald-600 font-bold">✓ Linked</span>
                                  ) : (
                                    <span className="text-red-500 font-bold">✗ Not linked</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {glossaryLinksAnalysis?.total_terms === 0 && (
                      <p className="text-sm text-muted text-center py-2">No Glossary section or key terms found in this PDF.</p>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3 mt-2">
                      <Button
                        onClick={handleAnalyzeGlossaryLinks}
                        disabled={analyzingGlossaryLinks || applyingGlossaryLinks}
                        variant={glossaryLinksAnalysis ? 'outline' : 'primary'}
                        leftIcon={analyzingGlossaryLinks ? <RefreshCw size={16} className="animate-spin" /> : <FileText size={16} />}
                        className="flex-1"
                      >
                        {analyzingGlossaryLinks ? 'Analyzing...' : 'Analyze Glossary'}
                      </Button>

                      <Button
                        onClick={handleApplyGlossaryLinks}
                        disabled={applyingGlossaryLinks || analyzingGlossaryLinks || !glossaryLinksAnalysis || glossaryLinksAnalysis.not_linked === 0}
                        leftIcon={applyingGlossaryLinks ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                        className="flex-1"
                      >
                        {applyingGlossaryLinks ? 'Applying...' : 'Apply / Fix'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 13: Final Inspection & Differential Validation */}
              <div className={`border border-border rounded-xl overflow-hidden bg-background transition-colors ${activeStep === 13 ? 'ring-1 ring-primary border-primary/50' : ''}`}>
                <button
                  onClick={() => setActiveStep(activeStep === 13 ? 0 : 13)}
                  className="w-full flex items-center justify-between p-4 bg-muted/5 hover:bg-muted/10 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      validationDiffReport && validationDiffReport.status === 'passed'
                        ? 'bg-emerald-500/20 text-emerald-600'
                        : activeStep === 13 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}>
                      {validationDiffReport && validationDiffReport.status === 'passed' ? <CheckCircle2 size={14} /> : '13'}
                    </div>
                    <h2 className="text-sm font-bold text-text m-0">Quality &amp; Differential Validation</h2>
                  </div>
                  {activeStep === 13 ? <ChevronUp size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
                </button>

                {activeStep === 13 && (
                  <div className="p-4 border-t border-border flex flex-col gap-4">
                    <div className="flex items-start justify-between shrink-0 gap-3">
                      <p className="text-[11px] text-muted m-0">
                        Audit final PDF against original baseline for text, font, and layout integrity.
                      </p>
                      <Button
                        onClick={handleRunValidationDiff}
                        disabled={runningValidationDiff}
                        leftIcon={runningValidationDiff ? <RefreshCw size={14} className="animate-spin" /> : <FileText size={14} />}
                        className="text-xs font-semibold h-8 px-4 shrink-0"
                      >
                        {runningValidationDiff ? 'Validating...' : (validationDiffReport ? 'Re-validate' : 'Validate')}
                      </Button>
                    </div>

                    {validationDiffReport && (
                      <div className={`p-4 rounded-lg border ${
                        validationDiffReport.status === 'passed'
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
                          : validationDiffReport.status === 'warnings'
                          ? 'bg-amber-500/10 border-amber-500/20 text-amber-700'
                          : 'bg-destructive/10 border-destructive/20 text-destructive'
                      }`}>
                        <div className="flex items-center gap-2 mb-2 font-bold text-sm">
                          {validationDiffReport.status === 'passed' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                          <h4 className="font-bold text-sm m-0">
                            {validationDiffReport.status === 'passed' ? 'Validation Passed' : 'Validation Discrepancies Found'}
                          </h4>
                        </div>

                        <div className="bg-background/50 p-3 rounded border border-emerald-500/20 mt-3 grid grid-cols-2 gap-3 text-xs font-medium">
                          <div className="flex flex-col gap-1">
                            <span className="text-muted-foreground text-[10px]">Integrity Score</span>
                            <span className="text-text font-bold text-sm">{validationDiffReport.integrity_score}%</span>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-muted-foreground text-[10px]">Audited Pages</span>
                            <span className="text-text">{validationDiffReport.total_pages_analyzed} pages</span>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-muted-foreground text-[10px]">Text &amp; Fonts</span>
                            <span className={validationDiffReport.text_discrepancies_count === 0 ? "text-emerald-600 font-semibold" : "text-destructive font-semibold"}>
                              {validationDiffReport.text_discrepancies_count === 0 ? '✓ Intact' : `${validationDiffReport.text_discrepancies_count} Issues`}
                            </span>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-muted-foreground text-[10px]">Layout Alignment</span>
                            <span className={validationDiffReport.alignment_drifts_count === 0 ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>
                              {validationDiffReport.alignment_drifts_count === 0 ? '✓ 0pt Drift' : `${validationDiffReport.alignment_drifts_count} Shifted`}
                            </span>
                          </div>
                        </div>

                        {validationDiffReport.text_discrepancies?.length > 0 && (
                          <div className="mt-3 space-y-1.5 border-t border-destructive/20 pt-2 text-[11px]">
                            <span className="font-semibold text-destructive block">Altered Pages (Text/Fonts):</span>
                            {validationDiffReport.text_discrepancies.map((td, idx) => (
                              <div key={idx} className="bg-background/70 p-2 rounded border border-border/50 text-[10px]">
                                <div className="flex justify-between font-semibold mb-0.5">
                                  <span>Page {td.page}</span>
                                  <span className="text-destructive">{td.issue}</span>
                                </div>
                                <p className="m-0 text-muted truncate"><strong>Baseline:</strong> {td.sample_baseline}</p>
                                <p className="m-0 text-text truncate"><strong>Final:</strong> {td.sample_final}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {validationDiffReport.alignment_drifts?.length > 0 && (
                          <div className="mt-3 space-y-1.5 border-t border-amber-500/20 pt-2 text-[11px]">
                            <span className="font-semibold text-amber-700 dark:text-amber-400 block">Layout Shifts / Alignment Drift:</span>
                            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                              {validationDiffReport.alignment_drifts.map((ad: any, idx: number) => (
                                <div key={idx} className="bg-background/70 p-2 rounded border border-border/50 text-[10px] flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-text">Page {ad.page}</span>
                                    <span className="text-muted">{ad.issue}</span>
                                  </div>
                                  <span className="text-amber-600 font-bold px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                                    Max drift: {ad.max_drift_pt} pt
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {validationDiffReport.font_discrepancies?.length > 0 && (
                          <div className="mt-3 space-y-1.5 border-t border-destructive/20 pt-2 text-[11px]">
                            <span className="font-semibold text-destructive block">Font Set Discrepancies:</span>
                            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                              {validationDiffReport.font_discrepancies.map((fd: any, idx: number) => (
                                <div key={idx} className="bg-background/70 p-2 rounded border border-border/50 text-[10px]">
                                  <div className="flex justify-between font-semibold mb-0.5">
                                    <span>Page {fd.page}</span>
                                    <span className="text-destructive">{fd.issue}</span>
                                  </div>
                                  {fd.missing_fonts?.length > 0 && (
                                    <p className="m-0 text-muted"><strong>Missing:</strong> {fd.missing_fonts.join(', ')}</p>
                                  )}
                                  {fd.new_fonts?.length > 0 && (
                                    <p className="m-0 text-text"><strong>Added/Replaced:</strong> {fd.new_fonts.join(', ')}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      ) : (
        /* ── PROJECTS LISTING ───────────────────────────────────────────── */
        <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6 overflow-y-auto">
          {/* Metrics */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-border bg-card shadow-sm flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <p className="text-xs font-medium text-muted uppercase tracking-wider m-0">Total Projects</p>
                <h3 className="text-2xl font-bold text-text m-0 mt-1">{totalCount}</h3>
              </div>
            </div>
            <div className="p-4 rounded-xl border border-border bg-card shadow-sm flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <p className="text-xs font-medium text-muted uppercase tracking-wider m-0">Passed Validations</p>
                <h3 className="text-2xl font-bold text-text m-0 mt-1">{passedCount}</h3>
              </div>
            </div>
            <div className="p-4 rounded-xl border border-border bg-card shadow-sm flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-red-500/10 text-red-600 flex items-center justify-center shrink-0">
                <XCircle size={20} />
              </div>
              <div>
                <p className="text-xs font-medium text-muted uppercase tracking-wider m-0">Failed Validations</p>
                <h3 className="text-2xl font-bold text-text m-0 mt-1">{failedCount}</h3>
              </div>
            </div>
          </section>

          {/* Filter bar */}
          <section className="p-4 rounded-xl border border-border bg-card shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-80 shrink-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Search project, client code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 w-full text-xs rounded-lg border border-border bg-background text-text focus:ring-1 focus:ring-primary focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto justify-end flex-wrap">
              <div className="flex items-center gap-2">
                <Filter size={12} className="text-muted" />
                <span className="text-xs text-muted">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="text-xs rounded-lg border border-border bg-background text-text py-1 px-2.5 focus:outline-none"
                >
                  <option value="all">All</option>
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                  <option value="unvalidated">Not Validated</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">Assignee:</span>
                <select
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                  className="text-xs rounded-lg border border-border bg-background text-text py-1 px-2.5 focus:outline-none"
                >
                  <option value="all">All</option>
                  <option value="unassigned">Unassigned</option>
                  {Array.from(new Set(projects.map((p) => p.assignee).filter(Boolean))).map((u) => (
                    <option key={u} value={u || ''}>{u}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Cards */}
          {loading ? (
            <div className="h-64 flex items-center justify-center text-xs text-muted">
              <RefreshCw size={20} className="animate-spin mr-2" /> Loading projects...
            </div>
          ) : loadError ? (
            <div className="h-64 flex flex-col items-center justify-center border border-dashed border-red-500/50 rounded-xl bg-red-50 dark:bg-red-950/20 p-6 text-center">
              <AlertCircle size={36} className="text-red-600 dark:text-red-400 mb-2" />
              <h4 className="text-sm font-semibold text-red-700 dark:text-red-300 m-0">{loadError}</h4>
              <Button
                onClick={() => { setLoadError(null); setLoading(true); fetchProjects(); }}
                variant="outline"
                className="text-xs mt-4"
              >
                Retry
              </Button>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center border border-dashed border-border rounded-xl bg-card p-6 text-center">
              <FolderOpen size={36} className="text-muted/60 mb-2" />
              <h4 className="text-sm font-semibold text-text m-0">No Projects Found</h4>
              <p className="text-xs text-muted m-0 mt-1 max-w-sm">
                Create a project and upload a ZIP package containing the PDF source files.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProjects.map((proj) => (
                <ProjectCard
                  key={proj.id}
                  project={proj}
                  users={users}
                  onDelete={(id) => setProjectToDelete(id)}
                  onEdit={(p) => { setEditingProject(p); setEditAssignee(p.assignee || ''); }}
                  onRefresh={fetchProjects}
                  onSelect={handleSelectProject}
                />
              ))}
            </div>
          )}
        </main>
      )}

      {/* ── CREATE PROJECT MODAL ──────────────────────────────────────────── */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Create Web PDF Project">
        <form onSubmit={handleCreateProject} className="space-y-4 pt-1">
          {errorMsg && (
            <div className="p-3 text-xs bg-red-500/10 border border-red-500/20 text-red-600 rounded-lg">
              {errorMsg}
            </div>
          )}

          <Select
            id="clientCompany"
            label="Client Company"
            value={customerName}
            onChange={e => {
              const selectedVal = e.target.value;
              setCustomerName(selectedVal);
              const matched = clients.find(c => c.company === selectedVal);
              if (matched && matched.division) {
                setClientCode(matched.division);
              } else {
                setClientCode('');
              }
            }}
            options={clients.map((c) => ({ label: c.company || '', value: c.company || '' }))}
            placeholder="— Select Client —"
            required
          />

          <Input
            id="clientCode"
            label="Client Code / Division"
            value={clientCode}
            readOnly
            placeholder="Auto-populated from client selection"
            className="bg-muted/40 text-text/80 cursor-not-allowed"
          />

          <Input
            id="projectName"
            label="Project Name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. pelagic-guide-book-v2"
            required
          />

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text block">ZIP File Upload *</label>
            <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-border border-dashed rounded-lg cursor-pointer bg-background hover:bg-card transition-colors">
              <Upload className="w-7 h-7 mb-2 text-muted" />
              <p className="text-xs text-text font-semibold">
                {zipFile ? zipFile.name : 'Click to upload ZIP package'}
              </p>
              <p className="text-[10px] text-muted mt-0.5">Must be a .zip file containing PDF files</p>
              <input
                type="file"
                accept=".zip"
                onChange={(e) => setZipFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={() => setShowAddModal(false)} className="text-xs font-semibold">
              Cancel
            </Button>
            <Button type="submit" disabled={uploading} leftIcon={uploading ? <RefreshCw className="w-3 h-3 animate-spin" /> : undefined} className="text-xs font-semibold">
              {uploading ? 'Uploading...' : 'Create & Upload'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── EDIT MODAL ────────────────────────────────────────────────────── */}
      <Modal isOpen={!!editingProject} onClose={() => setEditingProject(null)} title="Edit Project Assignee">
        <form onSubmit={handleSaveEdit} className="space-y-4 pt-1">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text block">Assignee</label>
            <select
              value={editAssignee}
              onChange={(e) => setEditAssignee(e.target.value)}
              className="w-full text-xs p-2 rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Unassigned</option>
              {users.filter((u) => u.active_status).map((u) => (
                <option key={u.id} value={u.user_name}>{u.user_name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={() => setEditingProject(null)} className="text-xs font-semibold">
              Cancel
            </Button>
            <Button type="submit" disabled={savingEdit} className="text-xs font-semibold">
              {savingEdit ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── DELETE CONFIRM ────────────────────────────────────────────────── */}
      <Modal isOpen={projectToDelete !== null} onClose={() => setProjectToDelete(null)} title="Delete Project">
        <div className="space-y-4 pt-1">
          <p className="text-xs text-text">
            Are you sure? The database record will be soft-deleted. Project files on disk will remain intact.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setProjectToDelete(null)} className="text-xs font-semibold">
              Cancel
            </Button>
            <Button
              onClick={handleDeleteConfirm}
              variant="ghost"
              className="text-xs font-semibold bg-red-500/10 text-red-600 hover:bg-red-500/20"
            >
              Confirm Delete
            </Button>
          </div>
        </div>
      </Modal>



    </div>
  );
}
