/**
 * ChapterFilePage
 * Self-loading enterprise file manager for a chapter.
 * Reads projectId / chapterId / clientId from URL params.
 * Fetches FileRecord[] from GET /projects/{id}/chapters/{id}/files.
 * All 17 action buttons are enabled when db_id is populated from the API.
 */
import { useState, useMemo, useEffect, useRef, cloneElement } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  ArrowDownToLine, ArrowLeft, BookCheck, ChevronRight, ChevronUp, ChevronDown,
  Code2, Download, ExternalLink, Eye, File, FileCode, FileOutput, FilePen, FileText,
  FolderOpen, History, Image, Languages, Layers, Loader2, LogIn, LogOut,
  ScanLine, Search, ShieldCheck, Sparkles, Trash2,
  Upload, Wrench, X, CheckCircle2, Archive,
} from 'lucide-react'
import { FOLDER_CONFIG, COLUMN_DEFINITIONS, fileTypeIcon, isProcessingActionVisibleForStage } from '@/config/fileManagerConfig'
import type { FolderKey, ColumnKey, ProcessingActionKey } from '@/config/fileManagerConfig'
import { BulkUploadModal } from '@/components/BulkUploadModal'
import { FileDetailPanel } from '@/features/projects/components/FileDetailPanel'
import { ReferenceCheckModal } from '@/features/projects/components/ReferenceCheckModal'
import { TagSetSelectModal } from '@/features/projects/components/TagSetSelectModal'
import {
  startLanguageEdit,
  startPpdGeneration, startPermissionsCheck, startCreditExtraction,
  startBiasScan, startWordToXml, getProcessingStatus,
} from '@/api/processing'
import { deleteFile } from '@/api/files'
import { useChapterFilesQuery } from '@/features/projects/useChapterFilesQuery'
import { uiPaths } from '@/utils/appPaths'
import { openInWordWithFallback } from '@/utils/openInWord'
import apiClient from '@/api/client'
import { toast } from '@/store/useToastStore'
import type { FileRecord } from '@/types/api'
import { useRBAC } from '@/hooks/useRBAC'

// ── Types ──────────────────────────────────────────────────────────────────

export interface FileRow {
  id: string    // unique key: "{subfolder}::{file_name}"
  db_id?: number    // numeric DB file ID — required for all processing/edit actions
  subfolder: string
  file_name: string
  file_size: string
  size_bytes: number
  uploaded_by: string
  uploaded_on: string
  path: string
  // Lock / processing status — sourced from FileRecord.lock
  isLocked?: boolean
  lockedBy?: string | null
  lockedAt?: string | null
  webdavLocked?: boolean
  webdavLockedBy?: string | null
  webdavLockedAt?: string | null
  pageCount?: number
  dpi?: number
  width?: number
  height?: number
  validationStatus?: string
  colorProfile?: string
  xmlType?: string
  packageStatus?: string
  reviewer?: string
  reviewStatus?: string
}

interface LegacyFileEntry {
  file_name: string
  path: string
  file_size: string
  size_bytes: number
  uploaded_by: string
  uploaded_on: string
}

interface ChapterFilePageProps {
  // All props are optional — component self-loads from URL params when absent
  chapterFolderData?: {
    chapter_name: string
    folder: string
    files: Record<string, LegacyFileEntry[]>
  } | null
  projectId?: number
  chapterId?: number
  chapterName?: string
  chapterTitle?: string | null
  clientId?: string
  clientName?: string
  projectName?: string
  stageName?: string
  isAssigned?: boolean
  onRefresh?: () => void
  onProceed?: () => void
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Builds the ChapterEditorPage ".../view/{subfolder}/{filename}" URL for a row.
// Shared by openEditor() (double-click) and the filename-cell single-click
// handler, so the two never drift apart again.
function buildFileViewPath(row: FileRow, pid: number, cid: number, cliId?: string) {
  const base = cliId
    ? `/clients/${cliId}/projects/${pid}/chapters/${cid}`
    : `/projects/${pid}/chapters/${cid}`
  return `${base}/view/${encodeURIComponent(row.subfolder)}/${encodeURIComponent(row.file_name)}`
}

function categoryToFolderKey(category: string): FolderKey {
  const c = category.toLowerCase()
  if (c === 'manuscript') return 'manuscript'
  if (c === 'art') return 'art'
  if (c === 'indesign') return 'indesign'
  if (c === 'proof') return 'proof'
  if (c === 'xml') return 'xml'
  if (c === 'backup') return 'backup'
  return 'misc'
}

function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function FolderIcon({ name, size = 14, color }: { name: string; size?: number; color?: string }) {
  const s = color ? { color } : {}
  switch (name) {
    case 'FileText': return <FileText size={size} style={s} className="flex-shrink-0" />
    case 'Image': return <Image size={size} style={s} className="flex-shrink-0" />
    case 'Layers': return <Layers size={size} style={s} className="flex-shrink-0" />
    case 'Code2': return <Code2 size={size} style={s} className="flex-shrink-0" />
    case 'FolderOpen': return <FolderOpen size={size} style={s} className="flex-shrink-0" />
    case 'ClipboardCheck': return <CheckCircle2 size={size} style={s} className="flex-shrink-0" />
    case 'Archive': return <Archive size={size} style={s} className="flex-shrink-0" />
    default: return <File size={size} style={s} className="flex-shrink-0" />
  }
}

function IndeterminateCheckbox({ checked, indeterminate, onChange, onClick }: {
  checked: boolean; indeterminate?: boolean
  onChange?: React.ChangeEventHandler<HTMLInputElement>
  onClick?: React.MouseEventHandler<HTMLInputElement>
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !checked && (indeterminate ?? false)
  }, [checked, indeterminate])
  return (
    <input ref={ref} type="checkbox" checked={checked}
      onChange={onChange ?? (() => { })} onClick={onClick}
      className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer flex-shrink-0" />
  )
}

// ── Column helper ──────────────────────────────────────────────────────────

const col = createColumnHelper<FileRow>()

// ── Actions dropdown ───────────────────────────────────────────────────────

type ConfirmStep = {
  actionName: string
  jobFn: () => Promise<unknown>
  // When set, fire() polls /processing-status after the job starts so a
  // background failure (e.g. an unreachable PPH server) surfaces as a toast
  // instead of silently leaving the user with only the "started" message.
  pollFileId?: number
  pollProcessType?: string
}

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 600_000 // 10 minutes, matches structuring's poll timeout

function IconTooltipButton({
  title, onClick, className, children, asChild,
}: {
  title: string
  onClick?: () => void
  className: string
  children: React.ReactElement
  asChild?: boolean
}) {
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          {asChild
            ? cloneElement(children, {
                className: `inline-flex p-1 rounded transition-colors ${className}`,
              })
            : (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onClick?.() }}
                className={`p-1 rounded transition-colors ${className}`}
              >
                {children}
              </button>
            )}
        </Tooltip.Trigger>
        <Tooltip.Content side="top" className="bg-text text-card text-[11px] px-2 py-1 rounded">{title}</Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

function ProcessingActionsMenu({
  row, onOpenReferenceCheck, stageName, isAssigned, projectId, chapterId,
}: {
  row: FileRow | null
  onOpenReferenceCheck: (file: FileRecord) => void
  stageName: string
  isAssigned: boolean
  projectId: number
  chapterId: number
}) {
  const navigate = useNavigate()
  const [confirmStep, setConfirmStep] = useState<ConfirmStep | null>(null)
  const [tagSetModalOpen, setTagSetModalOpen] = useState(false)
  const queryClient = useQueryClient()
  const invalidateFiles = () =>
    queryClient.invalidateQueries({ queryKey: ['chapter-files', projectId, chapterId] })

  const fid = row?.db_id
  const fname = row?.file_name.toLowerCase() ?? ''

  // Gate stage-specific processing actions to the stage they actually belong to.
  // The stage-to-action mapping lives in fileManagerConfig.ts (PROCESSING_ACTION_STAGE_MAP) —
  // edit that config to add/reassign a processing action, no changes needed here.
  const showAction = (action: ProcessingActionKey) => isProcessingActionVisibleForStage(action, stageName)

  const btnCls = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-primary/30 text-primary hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition-colors'

  async function fire(label: string, fn: () => Promise<unknown>, pollFileId?: number, pollProcessType?: string) {
    try {
      await fn()
      toast.success(`${label} started for ${row?.file_name}`)
      // Refetch immediately so the row flips to "Processing…" without a manual refresh.
      void invalidateFiles()
    } catch {
      toast.error(`Failed: ${label}`)
      return
    }

    if (!pollFileId || !pollProcessType) return

    const startedAt = Date.now()
    const interval = setInterval(async () => {
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        clearInterval(interval)
        toast.error(`${label} timed out for ${row?.file_name}`)
        void invalidateFiles()
        return
      }
      try {
        const result = await getProcessingStatus(pollFileId, pollProcessType)
        if (result.status === 'failed') {
          clearInterval(interval)
          toast.error(`${label} failed for ${row?.file_name}: ${result.error ?? 'Unknown error'}`)
          void invalidateFiles()
        } else if (result.status === 'completed') {
          clearInterval(interval)
          toast.success(`${label} completed for ${row?.file_name}`)
          void invalidateFiles()
        }
      } catch {
        // Transient poll error — let the timeout handle a genuinely stuck job.
      }
    }, POLL_INTERVAL_MS)
  }

  async function handleConvert(kind: 'indesign-to-word' | 'pdf-to-word', label: string) {
    if (!fid) return
    if (!window.confirm(`Are you sure you want to convert this ${label} to Word?`)) return
    try {
      const res = await fetch(`/api/v1/conversion/${kind}/${fid}`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        toast.success(data.message || `Successfully converted ${label} to Word!`)
        void invalidateFiles()
      } else {
        toast.error(data.detail || 'Failed to convert file')
      }
    } catch (e: any) {
      toast.error(`Error connecting to server: ${e.message}`)
    }
  }

  if (!isAssigned) return null

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        {showAction('structuring') && (
          <button disabled={!fid} className={btnCls} onClick={() => setTagSetModalOpen(true)}>
            <Layers size={12} className="text-amber-500" /> Structuring
          </button>
        )}

        {showAction('referenceReview') && (
          <button
            disabled={!fid || !fname.endsWith('.docx')}
            className={btnCls}
            onClick={() => fid && navigate(uiPaths.referenceReview(projectId, chapterId, fid))}
          >
            <BookCheck size={12} /> Reference Review
          </button>
        )}

        {showAction('languageEdit') && (
          <button
            disabled={!fid}
            className={btnCls}
            onClick={() => fid && void fire('Language Edit', () => startLanguageEdit(fid))}
          >
            <Languages size={12} /> Language Edit
          </button>
        )}

        {showAction('technicalEdit') && (
          <button
            disabled={!fid}
            className={btnCls}
            onClick={() => fid && navigate(uiPaths.technicalReview(projectId, chapterId, fid))}
          >
            <Wrench size={12} /> Technical Edit
          </button>
        )}

        {showAction('referenceValidation') && (
          <button
            disabled={!fid || !row}
            className={btnCls}
            onClick={() => row && fid && onOpenReferenceCheck({
              id: fid,
              filename: row.file_name,
              project_id: projectId,
              chapter_id: chapterId,
              file_type: '',
              category: row.subfolder,
              uploaded_at: row.uploaded_on,
              version: 1,
              lock: { is_locked: false, locked_by: null, locked_at: null },
              available_actions: [],
            } as unknown as FileRecord)}
          >
            <BookCheck size={12} /> Reference Validation
          </button>
        )}

        {/* <button
          disabled={!fid || !fname.endsWith('.indd')}
          className={btnCls}
          onClick={() => void handleConvert('indesign-to-word', 'InDesign file')}
        >
          <FileOutput size={12} className="text-amber-500" /> InDesign to Word
        </button>

        <button
          disabled={!fid || !fname.endsWith('.pdf')}
          className={btnCls}
          onClick={() => void handleConvert('pdf-to-word', 'PDF file')}
        >
          <FileOutput size={12} className="text-amber-500" /> PDF to Word
        </button> */}

        {showAction('manuscriptAnalysis') && (
          <button
            disabled={!fid}
            className={btnCls}
            onClick={() => fid && setConfirmStep({ actionName: 'Manuscript Analysis', jobFn: () => startPpdGeneration(fid), pollFileId: fid, pollProcessType: 'ppd' })}
          >
            <FileOutput size={12} /> Manuscript
          </button>
        )}

        {showAction('permissionsCheck') && (
          <button
            disabled={!fid}
            className={btnCls}
            onClick={() => fid && setConfirmStep({ actionName: 'Permissions Check', jobFn: () => startPermissionsCheck(fid) })}
          >
            <ShieldCheck size={12} /> Permissions Check
          </button>
        )}

        {showAction('aiCreditExtraction') && (
          <button
            disabled={!fid}
            className={btnCls}
            onClick={() => fid && setConfirmStep({ actionName: 'AI Credit Extraction', jobFn: () => startCreditExtraction(fid), pollFileId: fid, pollProcessType: 'credit_extractor_ai' })}
          >
            <Sparkles size={12} /> AI Credit Extraction
          </button>
        )}

        {showAction('biasScan') && (
          <button
            disabled={!fid}
            className={btnCls}
            onClick={() => fid && setConfirmStep({ actionName: 'Bias Scan', jobFn: () => startBiasScan(fid), pollFileId: fid, pollProcessType: 'bias_scan' })}
          >
            <ScanLine size={12} /> Bias Scan
          </button>
        )}

        {showAction('wordToXml') && (
          <button
            disabled={!fid}
            className={btnCls}
            onClick={() => fid && setConfirmStep({ actionName: 'Word to XML', jobFn: () => startWordToXml(fid), pollFileId: fid, pollProcessType: 'word_to_xml' })}
          >
            <FileCode size={12} /> Word to XML
          </button>
        )}
      </div>

      {confirmStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setConfirmStep(null)}>
          <div className="bg-card rounded-xl shadow-xl border border-border p-4 w-72" onClick={e => e.stopPropagation()}>
            <p className="text-[11px] text-muted mb-1">{confirmStep.actionName} on:</p>
            <p className="text-[11px] font-mono text-text truncate mb-3" title={row?.file_name}>{row?.file_name}</p>
            <div className="flex gap-2">
              <button
                className="flex-1 py-1.5 rounded-lg bg-surface border border-border text-[11px] text-muted hover:bg-accent"
                onClick={() => setConfirmStep(null)}
              >Cancel</button>
              <button
                className="flex-1 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-semibold flex items-center justify-center gap-1"
                onClick={() => {
                  const s = confirmStep
                  setConfirmStep(null)
                  void fire(s.actionName, s.jobFn, s.pollFileId, s.pollProcessType)
                }}
              >
                Confirm <ChevronRight size={11} />
              </button>
            </div>
          </div>
        </div>
      )}

      {fid && row && (
        <TagSetSelectModal
          fileId={fid}
          fileName={row.file_name}
          isOpen={tagSetModalOpen}
          onClose={() => setTagSetModalOpen(false)}
        />
      )}
    </>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function ChapterFilePage({
  chapterFolderData,
  projectId: propProjectId,
  chapterId: propChapterId,
  chapterName: propChapterName,
  chapterTitle: propChapterTitle,
  clientId: propClientId,
  clientName: propClientName,
  projectName: propProjectName,
  stageName: propStageName,
  isAssigned: propIsAssigned,
  onRefresh,
  onProceed,
}: ChapterFilePageProps) {
  const navigate = useNavigate()
  const { isAdmin: isAdminUser } = useRBAC()

  // ── Resolve IDs from URL params (preferred) or props (fallback) ──────────
  const {
    projectId: routeProjectId,
    chapterId: routeChapterId,
    clientId: routeClientId,
  } = useParams<{ projectId?: string; chapterId?: string; clientId?: string }>()

  const pid = routeProjectId ? Number(routeProjectId) : (propProjectId ?? 0)
  const cid = routeChapterId ? Number(routeChapterId) : (propChapterId ?? 0)
  const cliId = routeClientId ?? propClientId

  // ── Fetch chapter files from API ─────────────────────────────────────────
  const filesQuery = useChapterFilesQuery(pid || null, cid || null)

  // Derive metadata from API response when not passed as props
  const chapterMeta = filesQuery.data?.chapter
  const resolvedChapterName = propChapterName ?? chapterMeta?.number ?? `Chapter ${cid}`
  const resolvedChapterTitle = propChapterTitle ?? chapterMeta?.title ?? null
  const resolvedStageName = propStageName ?? ''
  const resolvedIsAssigned = propIsAssigned ?? true
  const resolvedClientName = propClientName ?? ''
  const resolvedProjectName = propProjectName ?? filesQuery.data?.project?.title ?? ''
  const resolvedChapterLabel = filesQuery.data?.chapter?.number ?? String(cid)

  const FOLDER_KEYS = Object.keys(FOLDER_CONFIG) as FolderKey[]
  const [searchParams, setSearchParams] = useSearchParams()
  const activeFolderParam = searchParams.get('folder') as FolderKey | null
  const activeFolder: FolderKey =
    activeFolderParam && activeFolderParam in FOLDER_CONFIG ? activeFolderParam : 'manuscript'

  const setActiveFolder = (key: FolderKey) => {
    setSearchParams(prev => { prev.set('folder', key); return prev }, { replace: true })
  }

  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [selectedFile, setSelectedFile] = useState<FileRow | null>(null)
  const [refCheckFile, setRefCheckFile] = useState<FileRecord | null>(null)
  const [globalFilter, setGlobalFilter] = useState('')
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<FileRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => { setRowSelection({}) }, [activeFolder])

  // ── Build FileRow[] — prefer API data (has db_id) over legacy prop ───────
  const rows = useMemo<FileRow[]>(() => {
    const sfLabel = FOLDER_CONFIG[activeFolder].label

    if (filesQuery.data?.files?.length) {
      return filesQuery.data.files
        .filter(f => categoryToFolderKey(f.category) === activeFolder)
        .map(f => ({
          id: `${sfLabel}::${f.filename}`,
          db_id: f.id,
          subfolder: sfLabel,
          file_name: f.filename,
          file_size: f.file_size || '—',
          size_bytes: f.size_bytes || 0,
          uploaded_by: f.uploaded_by || '—',
          uploaded_on: f.uploaded_at,
          path: '',
          isLocked: f.lock?.is_checked_out ?? false,
          lockedBy: f.lock?.checked_out_by_username ?? null,
          lockedAt: f.lock?.checked_out_at ?? null,
          webdavLocked: f.lock?.webdav_locked ?? false,
          webdavLockedBy: f.lock?.webdav_locked_by ?? null,
          webdavLockedAt: f.lock?.webdav_locked_at ?? null,
          pageCount: f.page_count ?? undefined,
        }))
    }

    if (!chapterFolderData) return []
    return (chapterFolderData.files[sfLabel] ?? []).map(f => ({
      id: `${sfLabel}::${f.file_name}`,
      subfolder: sfLabel,
      file_name: f.file_name,
      file_size: f.file_size,
      size_bytes: f.size_bytes,
      uploaded_by: f.uploaded_by,
      uploaded_on: f.uploaded_on,
      path: f.path,
    }))
  }, [filesQuery.data, chapterFolderData, activeFolder])

  // ── File counts per folder tab ───────────────────────────────────────────
  const fileCounts = useMemo(() => {
    const m: Record<string, number> = {}
    FOLDER_KEYS.forEach(k => {
      if (filesQuery.data?.files)
        m[k] = filesQuery.data.files.filter(f => categoryToFolderKey(f.category) === k).length
      else if (chapterFolderData)
        m[k] = chapterFolderData.files[FOLDER_CONFIG[k].label]?.length ?? 0
      else
        m[k] = 0
    })
    return m
  }, [filesQuery.data, chapterFolderData]) // eslint-disable-line

  // Open docx viewer (full-screen viewer page)
  function openEditor(row: FileRow) {
    if (!resolvedIsAssigned) return
    if (row.db_id && /\.(jpe?g|png|gif|webp|tiff?|bmp|eps)$/i.test(row.file_name)) {
      navigate(`/projects/${pid}/image-review?fileId=${row.db_id}`)
      return
    }
    navigate(buildFileViewPath(row, pid, cid, cliId))
  }

  function handleDelete(row: FileRow) {
    setDeleteConfirmRow(row)
  }

  async function confirmDelete() {
    if (!deleteConfirmRow?.db_id) return
    setDeleteLoading(true)
    try {
      await deleteFile(deleteConfirmRow.db_id)
      toast.success(`'${deleteConfirmRow.file_name}' deleted`)
      setDeleteConfirmRow(null)
      void filesQuery.refetch()
    } catch {
      toast.error(`Failed to delete '${deleteConfirmRow.file_name}'`)
    } finally {
      setDeleteLoading(false)
    }
  }

  // ── Dynamic columns (folder-specific metadata) ───────────────────────────
  const dynamicCols = useMemo(() => {
    const BASE: Set<ColumnKey> = new Set(['fileName', 'size', 'uploadedBy', 'uploadedOn'])

    const RENDERERS: Partial<Record<ColumnKey, ReturnType<typeof col.display>>> = {
      pageCount: col.display({
        id: 'pageCount', header: COLUMN_DEFINITIONS.pageCount.header, size: COLUMN_DEFINITIONS.pageCount.width,
        cell: ({ row }) => {
          const v = row.original.pageCount
          return v != null ? <span className="text-muted tabular-nums">{v}</span> : <span className="text-muted opacity-50">—</span>
        },
      }),
      fileType: col.display({
        id: 'fileType', header: COLUMN_DEFINITIONS.fileType.header, size: COLUMN_DEFINITIONS.fileType.width,
        cell: ({ row }) => {
          const ext = row.original.file_name.split('.').pop()?.toUpperCase() ?? ''
          return ext ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface border border-border text-muted">{ext}</span> : <span className="text-muted opacity-50">—</span>
        },
      }),
      dimensions: col.display({
        id: 'dimensions', header: COLUMN_DEFINITIONS.dimensions.header, size: COLUMN_DEFINITIONS.dimensions.width,
        cell: ({ row }) => {
          const { width, height } = row.original
          return <span className="text-muted">{width && height ? `${width} × ${height}` : '—'}</span>
        },
      }),
      dpi: col.display({
        id: 'dpi', header: COLUMN_DEFINITIONS.dpi.header, size: COLUMN_DEFINITIONS.dpi.width,
        cell: ({ row }) => <span className="text-muted">{row.original.dpi ?? '—'}</span>,
      }),
      colorProfile: col.display({
        id: 'colorProfile', header: COLUMN_DEFINITIONS.colorProfile.header, size: COLUMN_DEFINITIONS.colorProfile.width,
        cell: ({ row }) => <span className="text-muted">{row.original.colorProfile ?? '—'}</span>,
      }),
      packageStatus: col.display({
        id: 'packageStatus', header: COLUMN_DEFINITIONS.packageStatus.header, size: COLUMN_DEFINITIONS.packageStatus.width,
        cell: ({ row }) => {
          const v = row.original.packageStatus
          return v
            ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface border border-border text-muted">{v}</span>
            : <span className="text-muted opacity-50">—</span>
        },
      }),
      reviewer: col.display({
        id: 'reviewer', header: COLUMN_DEFINITIONS.reviewer.header, size: COLUMN_DEFINITIONS.reviewer.width,
        cell: ({ row }) => <span className="text-muted">{row.original.reviewer ?? '—'}</span>,
      }),
      reviewStatus: col.display({
        id: 'reviewStatus', header: COLUMN_DEFINITIONS.reviewStatus.header, size: COLUMN_DEFINITIONS.reviewStatus.width,
        cell: ({ row }) => {
          const v = row.original.reviewStatus
          if (!v) return <span className="text-muted opacity-50">—</span>
          const cls = v === 'approved' ? 'bg-emerald-100 text-emerald-700' : v === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
          return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{v}</span>
        },
      }),
      xmlType: col.display({
        id: 'xmlType', header: COLUMN_DEFINITIONS.xmlType.header, size: COLUMN_DEFINITIONS.xmlType.width,
        cell: ({ row }) => <span className="text-muted">{row.original.xmlType ?? '—'}</span>,
      }),
      validationStatus: col.display({
        id: 'validationStatus', header: COLUMN_DEFINITIONS.validationStatus.header, size: COLUMN_DEFINITIONS.validationStatus.width,
        cell: ({ row }) => {
          const v = row.original.validationStatus
          if (!v) return <span className="text-muted opacity-50">—</span>
          const cls = v === 'valid' ? 'bg-emerald-100 text-emerald-700' : v === 'invalid' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
          return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{v}</span>
        },
      }),
    }

    return FOLDER_CONFIG[activeFolder].columns
      .filter(key => !BASE.has(key) && key in RENDERERS)
      .map(key => RENDERERS[key]!)
  }, [activeFolder])

  const columns = useMemo(() => [
    col.display({
      id: 'select', size: 40,
      header: ({ table }) => (
        <IndeterminateCheckbox
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
          onClick={e => e.stopPropagation()}
        />
      ),
      cell: ({ row }) => (
        <IndeterminateCheckbox
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={e => e.stopPropagation()}
        />
      ),
    }),
    col.accessor('file_name', {
      header: 'File Name',
      cell: ({ row, getValue }) => {
        const name = getValue()
        const ext = name.split('.').pop() ?? ''
        const { icon, color } = fileTypeIcon(ext)
        const fid = row.original.db_id
        const isImageRow = /\.(jpe?g|png|gif|webp|tiff?|bmp|eps)$/i.test(name)
        const isDocxRow = /\.docx?$/i.test(name)
        const openTarget = isImageRow
          ? `/projects/${pid}/image-review?fileId=${fid}`
          : isDocxRow
            ? `${uiPaths.structuringReview(pid, cid, fid)}?tab=editor`
            : buildFileViewPath(row.original, pid, cid, cliId)
        return (
          <div className="flex items-center gap-2">
            <FolderIcon name={icon} size={14} color={color} />
            {fid ? (
              <button
                type="button"
                disabled={!resolvedIsAssigned}
                onClick={e => {
                  e.stopPropagation()
                  navigate(openTarget)
                }}
                title={name}
                className={resolvedIsAssigned
                  ? "font-medium text-text truncate max-w-[2000px] text-left hover:text-primary hover:underline cursor-pointer"
                  : "font-medium text-text opacity-50 truncate max-w-[2000px] text-left cursor-not-allowed"}
              >
                {name}
              </button>
            ) : (
              <span className="font-medium text-text truncate max-w-[2000px]" title={name}>{name}</span>
            )}
          </div>
        )
      },
    }),
    col.accessor('file_size', {
      header: 'Size',
      cell: i => <span className="text-muted text-[11px]">{i.getValue() || '—'}</span>,
    }),
    col.accessor('uploaded_by', {
      header: 'Uploaded By',
      cell: i => <span className="text-muted text-[11px] truncate block max-w-[120px]">{i.getValue() || '—'}</span>,
    }),
    col.accessor('uploaded_on', {
      header: 'Uploaded On',
      cell: i => <span className="text-muted text-[11px] whitespace-nowrap">{i.getValue() ? fmtDate(i.getValue()) : '—'}</span>,
    }),
    // ── Status column (includes lock info) ────────────────────────────────
    col.display({
      id: 'status',
      header: 'Status',
      size: 160,
      cell: ({ row }) => {
        const { isLocked, lockedBy, lockedAt, webdavLocked, webdavLockedBy, webdavLockedAt } = row.original
        return (
          <div className="flex flex-col gap-1">
            {isLocked ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap w-fit">
                <Loader2 size={9} className="animate-spin flex-shrink-0" />
                Processing…
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap w-fit">
                <CheckCircle2 size={9} className="flex-shrink-0" />
                Ready
              </span>
            )}
            {isLocked && (
              <div className="flex flex-col gap-0.5">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 whitespace-nowrap">
                  <LogOut size={9} className="flex-shrink-0" />
                  {lockedBy ?? 'Unknown'}
                </span>
                {lockedAt && (
                  <span className="text-[10px] text-muted whitespace-nowrap">{fmtDate(lockedAt)}</span>
                )}
              </div>
            )}
            {webdavLocked && (
              <div className="flex flex-col gap-0.5">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 whitespace-nowrap">
                  <ExternalLink size={9} className="flex-shrink-0" />
                  {webdavLockedBy ?? 'Unknown'} (Word)
                </span>
                {webdavLockedAt && (
                  <span className="text-[10px] text-muted whitespace-nowrap">{fmtDate(webdavLockedAt)}</span>
                )}
              </div>
            )}
          </div>
        )
      },
    }),
    ...dynamicCols,
    ...(activeFolder !== 'backup' ? [col.display({
      id: 'actions', header: () => <div className="text-center">Actions</div>, size: 130,
      cell: i => {
        const r = i.row.original
        const fid = r.db_id
        return (
          <div className="flex items-center justify-center gap-1">
            {resolvedIsAssigned && (
              <IconTooltipButton
                title="Edit"
                onClick={() => {
                  const isDocx = /\.docx?$/i.test(r.file_name)
                  if (isDocx && fid) {
                    void openInWordWithFallback(fid, r.file_name)
                  } else {
                    openEditor(r)
                  }
                }}
                className="text-muted hover:text-text hover:bg-surface"
              >
                <FilePen size={13} />
              </IconTooltipButton>
            )}
            {fid && (
              <IconTooltipButton
                title="Download"
                asChild
                className="text-muted hover:text-text hover:bg-surface"
              >
                <a href={`/api/v2/files/${fid}/download`} download onClick={e => e.stopPropagation()}>
                  <ArrowDownToLine size={13} />
                </a>
              </IconTooltipButton>
            )}
            {isAdminUser && (
              <IconTooltipButton
                title="Delete"
                onClick={() => handleDelete(r)}
                className="text-muted hover:text-text hover:bg-surface"
              >
                <Trash2 size={13} />
              </IconTooltipButton>
            )}
          </div>
        )
      },
    })] : []),
    col.display({
      id: 'history', header: 'History', size: 70,
      cell: ({ row }) => (
        <div className="flex items-center justify-center">
          <Tooltip.Provider>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  className="p-1 rounded text-muted hover:text-text hover:bg-surface transition-colors"
                  onClick={() => setSelectedFile(row.original)}
                >
                  <History size={14} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content side="left" className="bg-text text-card text-[11px] px-2 py-1 rounded">View Meta &amp; Version Details</Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
        </div>
      ),
    }),
  ], [dynamicCols, pid, cid, resolvedStageName, resolvedIsAssigned, activeFolder]) // eslint-disable-line

  const table = useReactTable({
    data: rows,
    columns,
    getRowId: row => row.id,
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const selectedRows = table.getSelectedRowModel().rows.map(r => r.original)
  const selectedCount = selectedRows.length

  async function handleBulkDownload() {
    if (selectedCount === 0 || downloadBusy) return
    const chapterLabel = chapterFolderData?.chapter_name ?? resolvedChapterLabel

    if (selectedCount === 1) {
      const row = selectedRows[0]
      if (row.db_id) {
        const a = document.createElement('a')
        a.href = `/api/v2/files/${row.db_id}/download`
        a.download = row.file_name
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
      } else if (chapterFolderData) {
        const a = document.createElement('a')
        a.href = `/api/uploads/${pid}/chapter/${chapterFolderData.chapter_name}/${row.subfolder}/${encodeURIComponent(row.file_name)}/download`
        a.download = row.file_name
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
      }
      return
    }

    if (!chapterFolderData) {
      toast.error('Bulk ZIP download requires folder data — use individual download for now')
      return
    }

    setDownloadBusy(true)
    try {
      const res = await apiClient.post(
        `/uploads/${pid}/chapter/${chapterLabel}/bulk-download`,
        { files: selectedRows.map(r => ({ subfolder: r.subfolder, file_name: r.file_name })) },
        { responseType: 'blob' },
      )
      const url = URL.createObjectURL(new Blob([res.data as BlobPart], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${chapterLabel}_${FOLDER_CONFIG[activeFolder].label}.zip`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Bulk download failed')
    } finally {
      setDownloadBusy(false)
    }
  }

  // ── Loading / error states ───────────────────────────────────────────────
  if (filesQuery.isLoading && !chapterFolderData) {
    return (
      <div className="flex items-center justify-center flex-1 h-full gap-2 text-muted text-sm">
        <Loader2 className="animate-spin w-5 h-5 text-primary" />
        Loading chapter files…
      </div>
    )
  }
  if (filesQuery.isError && !chapterFolderData) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 h-full gap-3">
        <p className="text-sm text-red-500">Failed to load chapter files.</p>
        <button className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:bg-surface" onClick={() => void filesQuery.refetch()}>
          Retry
        </button>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-background select-none">

      {/* ══ HEADER ═══════════════════════════════════════════════════════════ */}
      <header className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border flex-shrink-0 shadow-sm">
        <button onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors">
          <ArrowLeft size={16} />
        </button>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {resolvedClientName && (
            <>
              <span className="text-xs text-muted truncate max-w-[120px]" title={resolvedClientName}>{resolvedClientName}</span>
              <ChevronRight size={11} className="text-muted flex-shrink-0 opacity-50" />
            </>
          )}
          {resolvedProjectName && (
            <>
              <span className="text-xs text-muted truncate max-w-[140px]" title={resolvedProjectName}>{resolvedProjectName}</span>
              <ChevronRight size={11} className="text-muted flex-shrink-0 opacity-50" />
            </>
          )}
          <span className="text-sm font-bold text-text truncate">{resolvedChapterTitle || resolvedChapterName}</span>
          <span className="text-[10px] text-muted flex-shrink-0">({resolvedChapterName})</span>
          {resolvedStageName && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent text-primary border border-primary/20 flex-shrink-0">{resolvedStageName}</span>
          )}
          {!resolvedIsAssigned && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex-shrink-0">
              <Eye size={10} /> View Only
            </span>
          )}
        </div>

        {/* Search */}
        <div className="relative w-48 flex-shrink-0">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input value={globalFilter} onChange={e => setGlobalFilter(e.target.value)}
            placeholder="Search files…"
            className="w-full pl-7 pr-7 py-1.5 text-xs bg-surface border border-border rounded-lg text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary/30" />
          {globalFilter && <button onClick={() => setGlobalFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"><X size={11} /></button>}
        </div>

        {/* Bulk Download */}
        {FOLDER_CONFIG[activeFolder].allowDownload && (
          <button
            onClick={() => selectedCount > 0 ? void handleBulkDownload() : undefined}
            disabled={downloadBusy}
            title={selectedCount === 0 ? 'Select files to download' : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors shadow-sm relative
              ${selectedCount > 0 && !downloadBusy
                ? 'border-primary text-primary hover:bg-accent'
                : 'border-border text-muted opacity-50 cursor-not-allowed'}`}
          >
            {downloadBusy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {downloadBusy ? 'Downloading…' : selectedCount > 1 ? 'Download ZIP' : 'Bulk Download'}
            {selectedCount > 0 && !downloadBusy && (
              <span className="absolute -top-1.5 -right-1.5 text-[9px] font-bold px-1 py-0.5 rounded-full bg-primary text-white leading-none min-w-[16px] text-center">
                {selectedCount}
              </span>
            )}
          </button>
        )}

        {/* Bulk Upload */}
        {FOLDER_CONFIG[activeFolder].allowUpload && (
          <button
            onClick={() => setShowBulkUpload(true)}
            disabled={!resolvedIsAssigned}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors shadow-sm
              ${resolvedIsAssigned ? 'bg-primary hover:bg-primary/90' : 'bg-primary/30 opacity-50 cursor-not-allowed'}`}
          >
            <Upload size={12} /> Bulk Upload
          </button>
        )}

        {/* Refresh */}
        {filesQuery.data && (
          <button
            onClick={() => void filesQuery.refetch()}
            className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors"
            title="Refresh files"
          >
            <Loader2 size={14} className={filesQuery.isFetching ? 'animate-spin text-primary' : ''} />
          </button>
        )}

        {/* Proceed */}
        {onProceed && (
          <button
            onClick={resolvedIsAssigned ? onProceed : undefined}
            disabled={!resolvedIsAssigned}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors shadow-sm
              ${resolvedIsAssigned ? 'bg-primary hover:bg-primary/90 cursor-pointer' : 'bg-primary/30 opacity-50 cursor-not-allowed'}`}
          >
            Proceed <ChevronRight size={12} />
          </button>
        )}
      </header>

      {/* ══ BODY ═════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
        <nav className="w-52 flex-shrink-0 border-r border-border bg-surface overflow-y-auto">
          <div className="px-4 pt-4 pb-2">
            <p className="text-[10px] font-bold text-muted uppercase tracking-widest">Folders</p>
          </div>
          {FOLDER_KEYS.map(k => {
            const cfg = FOLDER_CONFIG[k]
            const count = fileCounts[k] ?? 0
            const active = k === activeFolder
            return (
              <button key={k} onClick={() => { setActiveFolder(k); setSorting([]); setGlobalFilter('') }}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left border-l-2 transition-colors
                  ${active ? 'bg-accent text-primary border-primary font-semibold' : 'text-muted hover:bg-card border-transparent'}`}>
                <FolderIcon name={cfg.icon} size={14} color={active ? 'var(--color-primary)' : 'var(--color-muted)'} />
                <span className="text-xs flex-1">{cfg.label}</span>
                {count > 0 && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none
                    ${active ? 'bg-primary/10 text-primary' : 'bg-border text-muted'}`}>{count}</span>
                )}
              </button>
            )
          })}
        </nav>

        {/* ── FILE TABLE ───────────────────────────────────────────────────── */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Folder breadcrumb bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card flex-shrink-0">
              <FolderIcon name={FOLDER_CONFIG[activeFolder].icon} size={13} color="var(--color-muted)" />
              <span className="text-xs font-semibold text-text">{FOLDER_CONFIG[activeFolder].label}</span>
              <span className="text-xs text-muted">({table.getFilteredRowModel().rows.length} files)</span>
              {filesQuery.isFetching && <Loader2 size={11} className="animate-spin text-muted ml-1" />}
              <div className="flex-1" />
              {resolvedIsAssigned && (
                <ProcessingActionsMenu
                  row={selectedCount === 1 ? selectedRows[0] : null}
                  onOpenReferenceCheck={setRefCheckFile}
                  stageName={resolvedStageName}
                  isAssigned={resolvedIsAssigned}
                  projectId={pid}
                  chapterId={cid}
                />
              )}
            </div>

            {/* Selection strip */}
            {selectedCount > 0 && (
              <div className="sticky top-0 z-20 flex items-center gap-2 px-4 py-1.5 bg-primary/5 border-b border-primary/20 flex-shrink-0">
                <span className="text-[11px] font-semibold text-primary flex-1">
                  {selectedCount} file{selectedCount > 1 ? 's' : ''} selected
                </span>
                <button onClick={() => setRowSelection({})} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-muted hover:text-text">
                  <X size={11} /> Clear
                </button>
              </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {table.getFilteredRowModel().rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                  <FolderOpen size={40} className="text-muted opacity-40 mb-3" />
                  <p className="text-sm font-medium text-muted">
                    {globalFilter
                      ? `No files match "${globalFilter}"`
                      : `No files in ${FOLDER_CONFIG[activeFolder].label}`}
                  </p>
                  {!globalFilter && FOLDER_CONFIG[activeFolder].allowUpload && resolvedIsAssigned && (
                    <button
                      onClick={() => setShowBulkUpload(true)}
                      className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-accent"
                    >
                      <Upload size={11} /> Upload first file
                    </button>
                  )}
                </div>
              ) : (
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-10 bg-surface border-b border-border">
                    {table.getHeaderGroups().map(hg => (
                      <tr key={hg.id}>
                        {hg.headers.map(h => (
                          <th
                            key={h.id}
                            style={{ width: h.getSize() === 150 ? undefined : h.getSize() }}
                            className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted uppercase tracking-wider whitespace-nowrap select-none"
                            onClick={h.column.getToggleSortingHandler()}
                          >
                            <div className="flex items-center gap-1">
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {h.column.getCanSort() && (
                                <span className="text-muted opacity-50">
                                  {h.column.getIsSorted() === 'asc' ? <ChevronUp size={11} /> :
                                    h.column.getIsSorted() === 'desc' ? <ChevronDown size={11} /> :
                                      <ChevronUp size={11} className="opacity-20" />}
                                </span>
                              )}
                            </div>
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody className="divide-y divide-border">
                    {table.getRowModel().rows.map(row => (
                      <tr
                        key={row.id}
                        className="hover:bg-accent/30 transition-colors cursor-default"
                        onDoubleClick={() => openEditor(row.original)}
                      >
                        {row.getVisibleCells().map(cell => (
                          <td key={cell.id} className="px-3 py-2.5 text-xs overflow-hidden">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── Detail Panel ─────────────────────────────────────────────── */}
          {selectedFile && (
            <FileDetailPanel
              file={selectedFile}
              onClose={() => setSelectedFile(null)}
            />
          )}
        </div>
      </div>

      {/* ── Bulk Upload Modal ────────────────────────────────────────────── */}
      <BulkUploadModal
        open={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        projectId={pid}
        chapterId={cid}
        chapterName={chapterFolderData?.chapter_name ?? resolvedChapterLabel}
        subfolder={FOLDER_CONFIG[activeFolder].label}
        stageName={resolvedStageName}
        existingFileNames={rows.map(r => r.file_name)}
        onComplete={() => { setShowBulkUpload(false); onRefresh?.(); void filesQuery.refetch() }}
      />

      {/* ── Reference Check Modal ────────────────────────────────────────── */}
      {refCheckFile && (
        <ReferenceCheckModal
          key={refCheckFile.id}
          file={refCheckFile}
          isOpen={refCheckFile !== null}
          onClose={() => setRefCheckFile(null)}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirmRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !deleteLoading && setDeleteConfirmRow(null)}>
          <div className="bg-card border border-border rounded-xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                <Trash2 size={16} className="text-red-600" />
              </div>
              <div>
                <p className="font-semibold text-text text-sm">Delete file?</p>
                <p className="text-xs text-muted mt-0.5">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-muted mb-5 break-all bg-surface rounded-lg px-3 py-2 font-mono text-xs">
              {deleteConfirmRow.file_name}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirmRow(null)}
                disabled={deleteLoading}
                className="px-4 py-1.5 text-sm rounded-lg border border-border text-muted hover:text-text hover:border-text/20 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmDelete()}
                disabled={deleteLoading}
                className="px-4 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {deleteLoading ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
