/**
 * ChapterFilePage
 * Enterprise file manager for a chapter.
 * Left: folder sidebar  |  Right: TanStack Table file listing
 */
import { useState, useMemo, useEffect, useRef } from 'react'
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
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  ArrowLeft, Upload, ChevronRight, MoreVertical,
  FileText, Image, Layers, Code2, FolderOpen, File, Archive,
  Download, Trash2, Eye, Zap, ChevronUp, ChevronDown,
  Search, X, Loader2, CheckCircle2,
} from 'lucide-react'
import { FOLDER_CONFIG, COLUMN_DEFINITIONS, getProcessingActions, fileTypeIcon } from '@/config/fileManagerConfig'
import type { FolderKey, ColumnKey } from '@/config/fileManagerConfig'
import { BulkUploadModal } from '@/components/BulkUploadModal'
import apiClient from '@/api/client'
import { toast } from '@/store/useToastStore'

// ── Types ──────────────────────────────────────────────────────────────────

export interface FileRow {
  id:          string       // unique: subfolder + file_name
  subfolder:   string
  file_name:   string
  file_size:   string
  size_bytes:  number
  uploaded_by: string
  uploaded_on: string
  path:        string
  // dynamic metadata
  pageCount?:        number
  dpi?:              number
  width?:            number
  height?:           number
  validationStatus?: string
  colorProfile?:     string
  xmlType?:          string
  packageStatus?:    string
  reviewer?:         string
  reviewStatus?:     string
}

interface ChapterFilePageProps {
  chapterFolderData: {
    chapter_name: string
    folder:       string
    files:        Record<string, Array<{
      file_name:   string
      path:        string
      file_size:   string
      size_bytes:  number
      uploaded_by: string
      uploaded_on: string
    }>>
  } | null
  projectId:    number
  chapterId:    number
  chapterName:  string
  chapterTitle: string | null
  clientId?:    string
  clientName?:  string
  projectName?: string
  stageName:    string
  isAssigned:   boolean
  onRefresh?:   () => void
  onProceed?:   () => void
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
    case 'FileText':       return <FileText      size={size} style={s} className="flex-shrink-0"/>
    case 'Image':          return <Image         size={size} style={s} className="flex-shrink-0"/>
    case 'Layers':         return <Layers        size={size} style={s} className="flex-shrink-0"/>
    case 'Code2':          return <Code2         size={size} style={s} className="flex-shrink-0"/>
    case 'FolderOpen':     return <FolderOpen    size={size} style={s} className="flex-shrink-0"/>
    case 'ClipboardCheck': return <CheckCircle2  size={size} style={s} className="flex-shrink-0"/>
    case 'Archive':        return <Archive       size={size} style={s} className="flex-shrink-0"/>
    default:               return <File          size={size} style={s} className="flex-shrink-0"/>
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
      onChange={onChange ?? (() => {})} onClick={onClick}
      className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer flex-shrink-0"/>
  )
}

// ── Column helper ──────────────────────────────────────────────────────────

const col = createColumnHelper<FileRow>()

// ── Actions dropdown ───────────────────────────────────────────────────────

function FileActionsMenu({
  row, onView, onDelete, stageName, isAssigned,
}: {
  row:        FileRow
  onView:     (row: FileRow) => void
  onDelete:   (row: FileRow) => void
  stageName:  string
  isAssigned: boolean
}) {
  const actions = getProcessingActions(stageName)

  const disabledCls = 'opacity-40 pointer-events-none cursor-not-allowed'

  return (
    <DropdownMenu.Root>
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <DropdownMenu.Trigger asChild>
              <button className="p-1 rounded text-muted hover:text-text hover:bg-surface transition-colors">
                <MoreVertical size={14}/>
              </button>
            </DropdownMenu.Trigger>
          </Tooltip.Trigger>
          <Tooltip.Content side="left" className="bg-text text-card text-[11px] px-2 py-1 rounded">More actions</Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 w-48 bg-card rounded-xl shadow-xl border border-border overflow-hidden py-1 text-xs"
        >
          {/* View — always enabled */}
          <DropdownMenu.Item
            onSelect={() => onView(row)}
            className="flex items-center gap-2 px-3 py-2 cursor-pointer text-text hover:bg-accent hover:text-primary focus:bg-accent focus:text-primary outline-none"
          >
            <Eye size={12} className="text-muted"/> View / Edit
          </DropdownMenu.Item>

          {/* Delete — disabled when unassigned */}
          <DropdownMenu.Item
            disabled={!isAssigned}
            onSelect={() => isAssigned && onDelete(row)}
            className={`flex items-center gap-2 px-3 py-2 text-red-600 outline-none ${isAssigned ? 'cursor-pointer hover:bg-red-50 focus:bg-red-50' : disabledCls}`}
          >
            <Trash2 size={12} className="text-red-400"/> Delete
          </DropdownMenu.Item>

          {/* Process — disabled when unassigned */}
          {actions.length > 0 && (
            <>
              <DropdownMenu.Separator className="my-1 border-t border-border"/>
              <div className={`px-3 py-1 text-[10px] font-semibold text-muted uppercase tracking-wider ${!isAssigned ? 'opacity-40' : ''}`}>Process</div>
              {actions.map(a => (
                <DropdownMenu.Item key={a}
                  disabled={!isAssigned}
                  onSelect={() => { if (!isAssigned) return; toast.success(`Queued: ${a} for ${row.file_name}`); console.info('[Process]', a, row) }}
                  className={`flex items-center gap-2 px-3 py-2 text-text outline-none ${isAssigned ? 'cursor-pointer hover:bg-accent hover:text-primary focus:bg-accent focus:text-primary' : disabledCls}`}
                >
                  <Zap size={12} className="text-muted"/> {a}
                </DropdownMenu.Item>
              ))}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function ChapterFilePage({
  chapterFolderData, projectId, chapterId, chapterName, chapterTitle,
  clientId, clientName, projectName, stageName, isAssigned, onRefresh, onProceed,
}: ChapterFilePageProps) {
  const navigate = useNavigate()
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>()
  const pid = routeProjectId ? Number(routeProjectId) : projectId

  const FOLDER_KEYS = Object.keys(FOLDER_CONFIG) as FolderKey[]
  const [searchParams, setSearchParams] = useSearchParams()
  const activeFolderParam = searchParams.get('folder') as FolderKey | null
  const activeFolder: FolderKey =
    activeFolderParam && activeFolderParam in FOLDER_CONFIG ? activeFolderParam : 'manuscript'

  const setActiveFolder = (key: FolderKey) => {
    setSearchParams(prev => { prev.set('folder', key); return prev }, { replace: true })
  }
  const [sorting,       setSorting]       = useState<SortingState>([])
  const [rowSelection,  setRowSelection]  = useState<Record<string, boolean>>({})
  const [downloadBusy,  setDownloadBusy]  = useState(false)

  // Reset selection when folder changes
  useEffect(() => { setRowSelection({}) }, [activeFolder])
  const [globalFilter, setGlobalFilter] = useState('')
  const [showBulkUpload, setShowBulkUpload] = useState(false)

  // Build file rows for the active folder
  const rows = useMemo<FileRow[]>(() => {
    if (!chapterFolderData) return []
    const sfLabel = FOLDER_CONFIG[activeFolder].label
    const files   = chapterFolderData.files[sfLabel] ?? []
    return files.map(f => ({
      id:          `${sfLabel}::${f.file_name}`,
      subfolder:   sfLabel,
      file_name:   f.file_name,
      file_size:   f.file_size,
      size_bytes:  f.size_bytes,
      uploaded_by: f.uploaded_by,
      uploaded_on: f.uploaded_on,
      path:        f.path,
    }))
  }, [chapterFolderData, activeFolder])

  // File counts per folder
  const fileCounts = useMemo(() => {
    const m: Record<string, number> = {}
    if (chapterFolderData) {
      FOLDER_KEYS.forEach(k => {
        const sf = FOLDER_CONFIG[k].label
        m[k] = chapterFolderData.files[sf]?.length ?? 0
      })
    }
    return m
  }, [chapterFolderData])

  // Navigate to editor (full-screen viewer)
  function openEditor(row: FileRow) {
    const base = clientId
      ? `/clients/${clientId}/projects/${pid}/chapters/${chapterId}`
      : `/projects/${pid}/chapters/${chapterId}`
    navigate(`${base}/view/${encodeURIComponent(row.subfolder)}/${encodeURIComponent(row.file_name)}`)
  }


  // Delete placeholder
  function handleDelete(row: FileRow) {
    toast.success(`Delete '${row.file_name}' — API not yet implemented`)
    console.info('[Delete placeholder]', row)
  }

  // ── Columns ────────────────────────────────────────────────────────────

  const dynamicCols = useMemo(() => {
    // Columns already covered by the static columns array (file_name, file_size, etc.)
    const BASE: Set<ColumnKey> = new Set(['fileName', 'size', 'uploadedBy', 'uploadedOn'])

    const RENDERERS: Partial<Record<ColumnKey, ReturnType<typeof col.display>>> = {
      pageCount: col.display({
        id: 'pageCount',
        header: COLUMN_DEFINITIONS.pageCount.header,
        size: COLUMN_DEFINITIONS.pageCount.width,
        cell: ({ row }) => {
          const v = row.original.pageCount
          return v != null
            ? <span className="text-muted tabular-nums">{v}</span>
            : <span className="text-muted opacity-50">—</span>
        },
      }),
      fileType: col.display({
        id: 'fileType',
        header: COLUMN_DEFINITIONS.fileType.header,
        size: COLUMN_DEFINITIONS.fileType.width,
        cell: ({ row }) => {
          const ext = row.original.file_name.split('.').pop()?.toUpperCase() ?? ''
          return ext
            ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface border border-border text-muted">{ext}</span>
            : <span className="text-muted opacity-50">—</span>
        },
      }),
      dimensions: col.display({
        id: 'dimensions',
        header: COLUMN_DEFINITIONS.dimensions.header,
        size: COLUMN_DEFINITIONS.dimensions.width,
        cell: ({ row }) => {
          const { width, height } = row.original
          return <span className="text-muted">{width && height ? `${width} × ${height}` : '—'}</span>
        },
      }),
      dpi: col.display({
        id: 'dpi',
        header: COLUMN_DEFINITIONS.dpi.header,
        size: COLUMN_DEFINITIONS.dpi.width,
        cell: ({ row }) => <span className="text-muted">{row.original.dpi ?? '—'}</span>,
      }),
      colorProfile: col.display({
        id: 'colorProfile',
        header: COLUMN_DEFINITIONS.colorProfile.header,
        size: COLUMN_DEFINITIONS.colorProfile.width,
        cell: ({ row }) => <span className="text-muted">{row.original.colorProfile ?? '—'}</span>,
      }),
      packageStatus: col.display({
        id: 'packageStatus',
        header: COLUMN_DEFINITIONS.packageStatus.header,
        size: COLUMN_DEFINITIONS.packageStatus.width,
        cell: ({ row }) => {
          const v = row.original.packageStatus
          if (!v) return <span className="text-muted opacity-50">—</span>
          return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface border border-border text-muted">{v}</span>
        },
      }),
      reviewer: col.display({
        id: 'reviewer',
        header: COLUMN_DEFINITIONS.reviewer.header,
        size: COLUMN_DEFINITIONS.reviewer.width,
        cell: ({ row }) => <span className="text-muted">{row.original.reviewer ?? '—'}</span>,
      }),
      reviewStatus: col.display({
        id: 'reviewStatus',
        header: COLUMN_DEFINITIONS.reviewStatus.header,
        size: COLUMN_DEFINITIONS.reviewStatus.width,
        cell: ({ row }) => {
          const v = row.original.reviewStatus
          if (!v) return <span className="text-muted opacity-50">—</span>
          const cls = v === 'approved' ? 'bg-emerald-100 text-emerald-700'
            : v === 'rejected' ? 'bg-red-100 text-red-700'
            : 'bg-amber-100 text-amber-700'
          return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{v}</span>
        },
      }),
      xmlType: col.display({
        id: 'xmlType',
        header: COLUMN_DEFINITIONS.xmlType.header,
        size: COLUMN_DEFINITIONS.xmlType.width,
        cell: ({ row }) => <span className="text-muted">{row.original.xmlType ?? '—'}</span>,
      }),
      validationStatus: col.display({
        id: 'validationStatus',
        header: COLUMN_DEFINITIONS.validationStatus.header,
        size: COLUMN_DEFINITIONS.validationStatus.width,
        cell: ({ row }) => {
          const v = row.original.validationStatus
          if (!v) return <span className="text-muted opacity-50">—</span>
          const cls = v === 'valid' ? 'bg-emerald-100 text-emerald-700'
            : v === 'invalid' ? 'bg-red-100 text-red-700'
            : 'bg-amber-100 text-amber-700'
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
      id:   'select',
      size: 40,
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
      cell: i => {
        const ext = i.getValue().split('.').pop() ?? ''
        const { icon, color } = fileTypeIcon(ext)
        return (
          <div className="flex items-center gap-2">
            <FolderIcon name={icon} size={14} color={color}/>
            <span className="font-medium text-text truncate max-w-[2000px]" title={i.getValue()}>{i.getValue()}</span>
          </div>
        )
      },
    }),
    col.accessor('file_size', {
      header: 'Size',
      cell:   i => <span className="text-muted text-[11px]">{i.getValue() || '—'}</span>,
    }),
    col.accessor('uploaded_by', {
      header: 'Uploaded By',
      cell:   i => <span className="text-muted text-[11px] truncate block max-w-[120px]">{i.getValue() || '—'}</span>,
    }),
    col.accessor('uploaded_on', {
      header: 'Uploaded On',
      cell:   i => <span className="text-muted text-[11px] whitespace-nowrap">{i.getValue() ? fmtDate(i.getValue()) : '—'}</span>,
    }),
    ...dynamicCols,
    ...(activeFolder !== 'backup' ? [col.display({
      id:   'actions',
      header: 'Actions',
      size: 100,
      cell: i => (
        <div className="flex items-center justify-end gap-1">
          <FileActionsMenu
            row={i.row.original}
            onView={openEditor}
            onDelete={handleDelete}
            stageName={stageName}
            isAssigned={isAssigned}
          />
        </div>
      ),
    })] : []),
  ], [dynamicCols, pid, chapterFolderData, stageName, isAssigned, activeFolder]) // eslint-disable-line

  const table = useReactTable({
    data:                 rows,
    columns,
    getRowId:             row => row.id,
    state:                { sorting, globalFilter, rowSelection },
    onSortingChange:      setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    enableRowSelection:   true,
    getCoreRowModel:      getCoreRowModel(),
    getSortedRowModel:    getSortedRowModel(),
    getFilteredRowModel:  getFilteredRowModel(),
  })

  const selectedRows  = table.getSelectedRowModel().rows.map(r => r.original)
  const selectedCount = selectedRows.length

  async function handleBulkDownload() {
    if (selectedCount === 0 || !chapterFolderData || downloadBusy) return

    if (selectedCount === 1) {
      const row = selectedRows[0]
      const a = document.createElement('a')
      a.href = `/api/uploads/${pid}/chapter/${chapterFolderData.chapter_name}/${row.subfolder}/${encodeURIComponent(row.file_name)}/download`
      a.download = row.file_name
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      return
    }

    setDownloadBusy(true)
    try {
      const res = await apiClient.post(
        `/uploads/${pid}/chapter/${chapterFolderData.chapter_name}/bulk-download`,
        { files: selectedRows.map(r => ({ subfolder: r.subfolder, file_name: r.file_name })) },
        { responseType: 'blob' },
      )
      const url = URL.createObjectURL(new Blob([res.data as BlobPart], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${chapterFolderData.chapter_name}_${FOLDER_CONFIG[activeFolder].label}.zip`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Bulk download failed')
    } finally {
      setDownloadBusy(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background select-none">

      {/* ══ HEADER ═══════════════════════════════════════════════════════════ */}
      <header className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border flex-shrink-0 shadow-sm">
        {/* Back */}
        <button onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors">
          <ArrowLeft size={16}/>
        </button>

        {/* Breadcrumb: Client › Project › Chapter */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {clientName && (
            <>
              <span className="text-xs text-muted truncate max-w-[120px]" title={clientName}>{clientName}</span>
              <ChevronRight size={11} className="text-muted flex-shrink-0 opacity-50"/>
            </>
          )}
          {projectName && (
            <>
              <span className="text-xs text-muted truncate max-w-[140px]" title={projectName}>{projectName}</span>
              <ChevronRight size={11} className="text-muted flex-shrink-0 opacity-50"/>
            </>
          )}
          <span className="text-sm font-bold text-text truncate">{chapterTitle || chapterName}</span>
          <span className="text-[10px] text-muted flex-shrink-0">({chapterName})</span>
          {stageName && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent text-primary border border-primary/20 flex-shrink-0">{stageName}</span>
          )}
          {!isAssigned && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex-shrink-0">
              <Eye size={10}/> View Only
            </span>
          )}
        </div>

        {/* Search */}
        <div className="relative w-48 flex-shrink-0">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"/>
          <input value={globalFilter} onChange={e => setGlobalFilter(e.target.value)}
            placeholder="Search files…"
            className="w-full pl-7 pr-7 py-1.5 text-xs bg-surface border border-border rounded-lg text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary/30"/>
          {globalFilter && <button onClick={() => setGlobalFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"><X size={11}/></button>}
        </div>

        {/* Bulk Download — always visible, enabled when files selected */}
        {chapterFolderData && FOLDER_CONFIG[activeFolder].allowDownload && (
          <button
            onClick={() => selectedCount > 0 ? void handleBulkDownload() : undefined}
            disabled={downloadBusy}
            title={selectedCount === 0 ? 'Select files to download' : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors shadow-sm relative
              ${selectedCount > 0 && !downloadBusy
                ? 'border-primary text-primary hover:bg-accent'
                : 'border-border text-muted opacity-50 cursor-not-allowed'}`}
          >
            {downloadBusy
              ? <Loader2 size={12} className="animate-spin"/>
              : <Download size={12}/>
            }
            {downloadBusy ? 'Downloading…' : selectedCount > 1 ? 'Download ZIP' : 'Bulk Download'}
            {selectedCount > 0 && !downloadBusy && (
              <span className="absolute -top-1.5 -right-1.5 text-[9px] font-bold px-1 py-0.5 rounded-full bg-primary text-white leading-none min-w-[16px] text-center">
                {selectedCount}
              </span>
            )}
          </button>
        )}

        {/* Bulk Upload */}
        {chapterFolderData && FOLDER_CONFIG[activeFolder].allowUpload && (
          <button
            onClick={() => setShowBulkUpload(true)}
            disabled={!isAssigned}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors shadow-sm
              ${isAssigned
                ? 'bg-primary hover:bg-primary/90'
                : 'bg-primary/30 opacity-50 cursor-not-allowed'}`}
          >
            <Upload size={12}/> Bulk Upload
          </button>
        )}

        {/* Proceed */}
        {onProceed && (
          <button
            onClick={isAssigned ? onProceed : undefined}
            disabled={!isAssigned}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors shadow-sm
              ${isAssigned ? 'bg-primary hover:bg-primary/90 cursor-pointer' : 'bg-primary/30 opacity-50 cursor-not-allowed'}`}>
            Proceed <ChevronRight size={12}/>
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
            const cfg    = FOLDER_CONFIG[k]
            const count  = fileCounts[k] ?? 0
            const active = k === activeFolder
            return (
              <button key={k} onClick={() => { setActiveFolder(k); setSorting([]); setGlobalFilter('') }}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left border-l-2 transition-colors
                  ${active ? 'bg-accent text-primary border-primary font-semibold' : 'text-muted hover:bg-card border-transparent'}`}>
                <FolderIcon name={cfg.icon} size={14} color={active ? 'var(--color-primary)' : 'var(--color-muted)'}/>
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
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Folder breadcrumb */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card flex-shrink-0">
            <FolderIcon name={FOLDER_CONFIG[activeFolder].icon} size={13} color="var(--color-muted)"/>
            <span className="text-xs font-semibold text-text">{FOLDER_CONFIG[activeFolder].label}</span>
            <span className="text-xs text-muted">({table.getFilteredRowModel().rows.length} files)</span>
          </div>

          {/* Selection strip — sticky count + clear */}
          {selectedCount > 0 && (
            <div className="sticky top-0 z-20 flex items-center gap-2 px-4 py-1.5 bg-primary/5 border-b border-primary/20 flex-shrink-0">
              <span className="text-[11px] font-semibold text-primary flex-1">
                {selectedCount} file{selectedCount > 1 ? 's' : ''} selected — use "Bulk Download" in the toolbar
              </span>
              <button
                onClick={() => setRowSelection({})}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-muted hover:text-text transition-colors"
              >
                <X size={11}/> Clear
              </button>
            </div>
          )}

          {/* Table */}
          <div className="flex-1 overflow-auto">
            {table.getFilteredRowModel().rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <FolderOpen size={40} className="text-muted opacity-40 mb-3"/>
                <p className="text-sm font-medium text-muted">
                  {globalFilter ? `No files match "${globalFilter}"` : `No files in ${FOLDER_CONFIG[activeFolder].label}`}
                </p>
                {!globalFilter && chapterFolderData && FOLDER_CONFIG[activeFolder].allowUpload && isAssigned && (
                  <button
                    onClick={() => setShowBulkUpload(true)}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-accent transition-colors"
                  >
                    <Upload size={11}/> Upload first file
                  </button>
                )}
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-surface border-b border-border">
                  {table.getHeaderGroups().map(hg => (
                    <tr key={hg.id}>
                      {hg.headers.map(h => (
                        <th key={h.id}
                          style={{ width: h.getSize() === 150 ? undefined : h.getSize() }}
                          className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted uppercase tracking-wider whitespace-nowrap select-none"
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          <div className="flex items-center gap-1">
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {h.column.getCanSort() && (
                              <span className="text-muted opacity-50">
                                {h.column.getIsSorted() === 'asc' ? <ChevronUp size={11}/> :
                                 h.column.getIsSorted() === 'desc' ? <ChevronDown size={11}/> :
                                 <ChevronUp size={11} className="opacity-20"/>}
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
                    <tr key={row.id}
                      className="hover:bg-accent/30 transition-colors group cursor-default"
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
      </div>

      {/* ── Bulk Upload Modal ────────────────────────────────────────────── */}
      <BulkUploadModal
        open={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        projectId={pid}
        chapterName={chapterFolderData?.chapter_name ?? ''}
        subfolder={FOLDER_CONFIG[activeFolder].label}
        stageName={stageName}
        existingFileNames={rows.map(r => r.file_name)}
        onComplete={() => { setShowBulkUpload(false); onRefresh?.() }}
      />
    </div>
  )
}
