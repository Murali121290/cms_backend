import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Upload, Download, Search, Plus, Trash2, Edit2, Loader2,
  FileSpreadsheet, Users, Globe, AlertCircle, Check, X, BookOpen,
} from 'lucide-react'
import { termListsApi, type TermList, type Term, type ImportResult } from '@/api/termListsApi'
import { useRBAC } from '@/hooks/useRBAC'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string }

type UploadStatus = 'queued' | 'uploading' | 'success' | 'error'
interface UploadRow {
  id: number
  name: string
  size: number
  status: UploadStatus
  message?: string
  result?: ImportResult
}

export function TermLibraryPage() {
  const navigate = useNavigate()
  const { roles } = useRBAC()
  useDocumentTitle('Term Library — S4 Carlisle CMS')
  const canEdit = useMemo(() => {
    const normalised = roles.map((r) => r.toLowerCase().replace(/[\s-]/g, ''))
    return (
      normalised.includes('admin') ||
      normalised.includes('projectmanager') ||
      normalised.includes('editorialmanager') ||
      normalised.includes('teamleadlanguageediting') ||
      normalised.includes('teamleaderlanguageediting') ||
      normalised.includes('technicaleditor') ||
      normalised.includes('teamleadeditorial')
    )
  }, [roles])

  const [lists, setLists] = useState<TermList[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState<'all' | 'client' | 'generic'>('all')
  const [selected, setSelected] = useState<TermList | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastSeq = useRef(0)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<TermList | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  function pushToast(kind: Toast['kind'], text: string) {
    const id = ++toastSeq.current
    setToasts((p) => [...p, { id, kind, text }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3400)
  }

  async function refresh() {
    setLoading(true)
    try {
      const items = await termListsApi.list({ include_inactive: false })
      setLists(items)
    } catch (err: any) {
      pushToast('error', err?.response?.data?.detail || 'Failed to load term lists')
    } finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  async function performDelete(tl: TermList) {
    setDeletingId(tl.id)
    try {
      await termListsApi.remove(tl.id)
      pushToast('success', `Deleted '${tl.name}' and ${tl.term_count} term${tl.term_count === 1 ? '' : 's'}`)
      setConfirmDelete(null)
      // If the drawer was open on this list, close it.
      if (selected?.id === tl.id) setSelected(null)
      await refresh()
    } catch (err: any) {
      pushToast('error', err?.response?.data?.detail || 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return lists.filter((tl) => {
      if (scopeFilter !== 'all' && tl.scope !== scopeFilter) return false
      if (q && !tl.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [lists, search, scopeFilter])

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white px-6 py-5 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate('/settings')}
            title="Back to Settings"
            className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition">
            <ArrowLeft size={16} />
          </button>
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg">
            <BookOpen size={22} />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Term Library</h1>
            <p className="text-sm text-indigo-200/80">Client-specific and generic term lists for Language Editing.</p>
          </div>
          {canEdit && (
            <button onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-slate-900 font-semibold hover:shadow-lg transition">
              <Plus size={14} /> New term list
            </button>
          )}
        </div>
      </header>

      {!canEdit && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-sm text-amber-900 flex items-center gap-2">
          <AlertCircle size={14} /> View-only. Only Admin / Project Manager can create or edit term lists.
        </div>
      )}

      <div className="max-w-7xl mx-auto px-6 py-5">
        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap mb-5">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search term lists by name…"
              className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm bg-white focus:ring-2 focus:ring-violet-200" />
          </div>
          <div className="flex gap-1.5 bg-white border border-slate-200 rounded-xl p-1">
            {(['all', 'client', 'generic'] as const).map((s) => (
              <button key={s} onClick={() => setScopeFilter(s)}
                className={`px-3 py-1 rounded-lg text-xs font-medium ${
                  scopeFilter === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}>
                {s === 'all' ? `All ${lists.length}` : s === 'client' ? 'Client-specific' : 'Generic'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-slate-500 py-20 text-center">
            <Loader2 className="animate-spin inline mr-2" size={16} /> Loading…
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((tl) => (
              <TermListCard
                key={tl.id}
                list={tl}
                canEdit={canEdit}
                onOpen={() => setSelected(tl)}
                onDelete={() => setConfirmDelete(tl)}
              />
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full text-center py-16 bg-white border rounded-2xl text-slate-500">
                No term lists match the filter.
              </div>
            )}
          </div>
        )}
      </div>

      {selected && (
        <TermListDetailDrawer
          list={selected} canEdit={canEdit}
          onClose={() => { setSelected(null); refresh() }}
          onToast={pushToast}
          onDelete={() => setConfirmDelete(selected)}
        />
      )}

      {confirmDelete && (
        <DeleteTermListDialog
          list={confirmDelete}
          busy={deletingId === confirmDelete.id}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => performDelete(confirmDelete)}
        />
      )}

      {showCreate && canEdit && (
        <CreateTermListModal
          onClose={() => setShowCreate(false)}
          onCreated={(tl) => { setShowCreate(false); refresh(); pushToast('success', `Created '${tl.name}'`) }}
          onToast={pushToast} />
      )}

      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <div key={t.id}
            className={`px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${
              t.kind === 'success' ? 'bg-emerald-600 text-white' :
              t.kind === 'error'   ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'
            }`}>
            {t.kind === 'success' ? <Check size={14} /> : t.kind === 'error' ? <AlertCircle size={14} /> : null}
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}

function TermListCard({ list, canEdit, onOpen, onDelete }: {
  list: TermList
  canEdit: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const scopeMeta = list.scope === 'generic'
    ? { Icon: Globe, label: 'Generic', cls: 'bg-sky-100 text-sky-700' }
    : { Icon: Users, label: 'Client', cls: 'bg-violet-100 text-violet-700' }
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      className="relative text-left bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-lg hover:border-violet-300 transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center">
          <FileSpreadsheet size={20} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 ${scopeMeta.cls}`}>
            <scopeMeta.Icon size={10} /> {scopeMeta.label}
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              title="Delete this term list"
              aria-label={`Delete term list ${list.name}`}
              data-testid={`termlist-delete-${list.id}`}
              className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg transition"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      <h3 className="font-semibold text-slate-900 mt-3 line-clamp-1">{list.name}</h3>
      {list.description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{list.description}</p>}
      <div className="mt-3 flex items-center gap-3 text-xs text-slate-600">
        <span className="font-semibold text-slate-900">{list.term_count}</span>
        <span className="text-slate-400">terms</span>
        {list.source_file && (
          <span className="text-slate-400 truncate" title={list.source_file}>· {list.source_file}</span>
        )}
      </div>
    </div>
  )
}

function DeleteTermListDialog({ list, busy, onCancel, onConfirm }: {
  list: TermList
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[60] flex items-center justify-center p-6"
      onClick={busy ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-termlist-title"
    >
      <div
        className="bg-white rounded-2xl p-6 w-[480px] max-w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0">
            <AlertCircle size={20} />
          </div>
          <div className="flex-1">
            <h3 id="delete-termlist-title" className="font-semibold text-lg text-slate-900">
              Delete '{list.name}'?
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              This permanently removes the term list and <strong>{list.term_count}</strong>{' '}
              imported term{list.term_count === 1 ? '' : 's'}.
              {list.assigned_project_ids && list.assigned_project_ids.length > 0 && (
                <> It will also unassign the list from <strong>{list.assigned_project_ids.length}</strong>{' '}
                project{list.assigned_project_ids.length === 1 ? '' : 's'}.</>
              )}
              {' '}Related findings in past language reviews will be detached but not deleted.
              This action cannot be undone.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50"
            data-testid="delete-termlist-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 inline-flex items-center gap-1.5"
            data-testid="delete-termlist-confirm"
          >
            {busy ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
            Delete permanently
          </button>
        </div>
      </div>
    </div>
  )
}

function TermListDetailDrawer({ list, canEdit, onClose, onToast, onDelete }: {
  list: TermList
  canEdit: boolean
  onClose: () => void
  onToast: (k: Toast['kind'], t: string) => void
  onDelete: () => void
}) {
  const [terms, setTerms] = useState<Term[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const replaceFileRef = useRef<HTMLInputElement | null>(null)
  const uploadSeq = useRef(0)
  const LIMIT = 50

  async function loadTerms() {
    setLoading(true)
    try {
      const data = await termListsApi.terms(list.id, { search: search || undefined, limit: LIMIT, offset })
      setTerms(data.items)
      setTotal(data.total)
    } catch (err: any) {
      onToast('error', err?.response?.data?.detail || 'Failed to load terms')
    } finally { setLoading(false) }
  }
  useEffect(() => { loadTerms() /* eslint-disable-next-line */ }, [list.id, search, offset])

  function queueFiles(files: File[]): UploadRow[] {
    const accepted: UploadRow[] = []
    const rejected: { name: string; reason: string }[] = []
    // Build a set of (name,size) already queued or completed to warn on
    // obvious duplicate picks — the real de-dup happens server-side on
    // term content via UNIQUE(term_list_id, term).
    const existing = new Set(uploads.map((u) => `${u.name}:${u.size}`))
    const seenInPick = new Set<string>()
    for (const file of files) {
      const lower = (file.name || '').toLowerCase()
      if (!lower.endsWith('.xlsx') && !lower.endsWith('.xlsm')) {
        rejected.push({ name: file.name, reason: 'Only .xlsx / .xlsm files are supported' })
        continue
      }
      const key = `${file.name}:${file.size}`
      if (seenInPick.has(key) || existing.has(key)) {
        rejected.push({ name: file.name, reason: 'Already in upload list — skipped to avoid duplicate import' })
        continue
      }
      seenInPick.add(key)
      accepted.push({
        id: ++uploadSeq.current,
        name: file.name,
        size: file.size,
        status: 'queued',
      })
    }
    for (const r of rejected) onToast('error', `${r.name}: ${r.reason}`)
    if (accepted.length) setUploads((p) => [...p, ...accepted])
    // Caller needs the matched (file, row) pairs; return the rows and
    // let the caller zip against the original File[] by name+size.
    return accepted
  }

  async function uploadQueue(files: File[], rows: UploadRow[], replace: boolean) {
    setUploading(true)
    try {
      // Sequential to preserve the backend's per-list dedup semantics:
      // UNIQUE(term_list_id, term) only sees committed rows, so running
      // concurrent imports against the same list would race on the
      // dedup check and risk IntegrityError or lost reports.
      for (const row of rows) {
        const file = files.find((f) => f.name === row.name && f.size === row.size)
        if (!file) continue
        setUploads((p) => p.map((u) => u.id === row.id ? { ...u, status: 'uploading' } : u))
        try {
          const result = await termListsApi.importExcel(list.id, file, replace)
          setUploads((p) => p.map((u) => u.id === row.id
            ? {
                ...u,
                status: 'success',
                result,
                message: `+${result.inserted} new, ${result.skipped_already_present} already present, ${result.skipped_duplicates_in_file} dup in file`,
              }
            : u,
          ))
          // After the first replace, subsequent files should append —
          // otherwise each file would wipe the previous one.
          replace = false
        } catch (err: any) {
          const msg = err?.response?.data?.detail || err?.message || 'Import failed'
          setUploads((p) => p.map((u) => u.id === row.id
            ? { ...u, status: 'error', message: msg }
            : u,
          ))
        }
      }
      await loadTerms()
      // Read the just-settled statuses from the functional updater so
      // the toast reflects the final state rather than a stale closure.
      setUploads((p) => {
        const ok = p.filter((u) => rows.some((r) => r.id === u.id) && u.status === 'success').length
        const fail = p.filter((u) => rows.some((r) => r.id === u.id) && u.status === 'error').length
        if (ok > 0) onToast('success', `Imported ${ok} file${ok === 1 ? '' : 's'}${fail > 0 ? ` (${fail} failed)` : ''}`)
        else if (fail > 0) onToast('error', `${fail} file${fail === 1 ? '' : 's'} failed to import`)
        return p
      })
    } finally {
      setUploading(false)
    }
  }

  async function handleUploadFiles(files: File[], replace: boolean) {
    const rows = queueFiles(files)
    if (rows.length === 0) return
    if (replace && files.length > 1) {
      onToast('info', 'Replace applies to the first file only; the rest append.')
    }
    await uploadQueue(files, rows, replace)
  }

  function clearFinishedUploads() {
    setUploads((p) => p.filter((u) => u.status === 'uploading' || u.status === 'queued'))
  }

  async function handleDeleteTerm(t: Term) {
    if (!confirm(`Delete term '${t.term}'?`)) return
    try {
      await termListsApi.deleteTerm(list.id, t.id)
      onToast('success', 'Term deleted')
      loadTerms()
    } catch (err: any) {
      onToast('error', err?.response?.data?.detail || 'Delete failed')
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 flex justify-end" onClick={onClose}>
      <aside className="w-[720px] max-w-full h-full bg-white shadow-2xl flex flex-col"
             onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center">
            <FileSpreadsheet size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-slate-900 truncate">{list.name}</h2>
            <p className="text-xs text-slate-500">
              {list.scope} · {list.term_count} terms
              {list.source_file && ` · ${list.source_file}`}
            </p>
          </div>
          <button onClick={() => termListsApi.downloadExcel(list.id, list.name)}
            className="text-xs px-2.5 py-1.5 rounded-lg border bg-white hover:bg-slate-50 inline-flex items-center gap-1">
            <Download size={12} /> Excel
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={onDelete}
              title="Delete this term list"
              data-testid="termlist-delete-drawer"
              className="text-xs px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 inline-flex items-center gap-1"
            >
              <Trash2 size={12} /> Delete
            </button>
          )}
          <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-slate-100 text-slate-500 flex items-center justify-center">
            <X size={14} />
          </button>
        </header>

        {canEdit && (
          <div
            className={`px-6 py-3 border-b bg-slate-50/70 flex flex-col gap-3 ${dragOver ? 'ring-2 ring-violet-400 ring-inset bg-violet-50/70' : ''}`}
            onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
            onDragLeave={(e) => {
              // Only clear when leaving the outer container, not child
              // drags — compare related target.
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const files = Array.from(e.dataTransfer.files || [])
              if (files.length) void handleUploadFiles(files, false)
            }}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xlsm"
                multiple
                hidden
                data-testid="termlist-upload-input"
                onChange={(e) => {
                  const picked = Array.from(e.target.files || [])
                  if (picked.length) void handleUploadFiles(picked, false)
                  if (fileRef.current) fileRef.current.value = ''
                }}
              />
              <input
                ref={replaceFileRef}
                type="file"
                accept=".xlsx,.xlsm"
                multiple
                hidden
                onChange={(e) => {
                  const picked = Array.from(e.target.files || [])
                  if (picked.length) void handleUploadFiles(picked, true)
                  if (replaceFileRef.current) replaceFileRef.current.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                data-testid="termlist-upload-button"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="animate-spin" size={12} /> : <Upload size={12} />}
                Upload Excel (append)
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!confirm('Replace will DELETE all existing terms in this list before importing the first selected file. Continue?')) return
                  replaceFileRef.current?.click()
                }}
                disabled={uploading}
                className="text-xs px-2.5 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-rose-700 disabled:opacity-50"
              >
                Replace (danger)
              </button>
              <span className="text-xs text-slate-500">
                Select or drop one or more .xlsx / .xlsm files
              </span>
              {uploads.length > 0 && !uploading && (
                <button
                  type="button"
                  onClick={clearFinishedUploads}
                  className="ml-auto text-[11px] text-slate-500 hover:text-slate-800 underline decoration-dotted"
                >
                  Clear finished
                </button>
              )}
            </div>

            {uploads.length > 0 && (
              <ul className="space-y-1.5" data-testid="termlist-upload-list">
                {uploads.map((u) => (
                  <li
                    key={u.id}
                    data-testid={`termlist-upload-row-${u.id}`}
                    data-status={u.status}
                    className="flex items-center gap-2 text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5"
                  >
                    <FileSpreadsheet size={12} className="text-slate-400 flex-shrink-0" />
                    <span className="font-mono truncate min-w-0 flex-1" title={u.name}>{u.name}</span>
                    {u.status === 'queued' && (
                      <span className="text-slate-500">Queued…</span>
                    )}
                    {u.status === 'uploading' && (
                      <span className="text-violet-700 inline-flex items-center gap-1">
                        <Loader2 className="animate-spin" size={10} /> Uploading
                      </span>
                    )}
                    {u.status === 'success' && (
                      <span className="text-emerald-700 inline-flex items-center gap-1">
                        <Check size={10} /> {u.message}
                      </span>
                    )}
                    {u.status === 'error' && (
                      <span className="text-rose-700 inline-flex items-center gap-1" title={u.message}>
                        <AlertCircle size={10} /> {u.message}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="px-6 py-3 border-b flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => { setOffset(0); setSearch(e.target.value) }}
              placeholder={`Search ${list.term_count} terms…`}
              className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm" />
          </div>
          <span className="text-xs text-slate-500">
            {total} match{total !== 1 ? 'es' : ''} · showing {offset + 1}–{Math.min(offset + LIMIT, total)}
          </span>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="text-slate-500 py-10 text-center">
              <Loader2 className="animate-spin inline mr-2" size={14} /> Loading…
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50/95 backdrop-blur text-xs uppercase text-slate-500 border-b">
                <tr>
                  <th className="px-5 py-2 text-left font-medium">Term</th>
                  <th className="px-3 py-2 text-left font-medium w-16">Group</th>
                  <th className="px-3 py-2 text-left font-medium w-16">Style</th>
                  {canEdit && <th className="px-3 py-2 w-20"></th>}
                </tr>
              </thead>
              <tbody>
                {terms.map((t) => (
                  <tr key={t.id} className="border-b hover:bg-violet-50/40">
                    <td className="px-5 py-2 font-mono text-slate-800">{t.term}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{t.group_id ?? '—'}.{t.order_in_group}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {t.is_italic && <em>I</em>}{t.is_bold && <strong>B</strong>}
                      {!t.is_italic && !t.is_bold && '—'}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => handleDeleteTerm(t)}
                          className="text-slate-400 hover:text-rose-600 p-1 rounded">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {total > LIMIT && (
          <div className="px-6 py-3 border-t flex items-center justify-between text-xs text-slate-600 bg-slate-50">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0}
              className="px-2.5 py-1 rounded border bg-white disabled:opacity-40">← Prev</button>
            <span>{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= total}
              className="px-2.5 py-1 rounded border bg-white disabled:opacity-40">Next →</button>
          </div>
        )}
      </aside>
    </div>
  )
}

function CreateTermListModal({ onClose, onCreated, onToast }: {
  onClose: () => void; onCreated: (tl: TermList) => void; onToast: (k: Toast['kind'], t: string) => void
}) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [scope, setScope] = useState<'client' | 'generic'>('client')
  const [clientId, setClientId] = useState<string>('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim()) { onToast('error', 'Name is required'); return }
    if (scope === 'client' && !clientId.trim()) { onToast('error', 'Client ID required for client-specific list'); return }
    setSaving(true)
    try {
      const body: any = { name: name.trim(), description: desc.trim() || undefined, scope }
      if (scope === 'client') body.client_id = parseInt(clientId, 10)
      const tl = await termListsApi.create(body)
      onCreated(tl)
    } catch (err: any) {
      onToast('error', err?.response?.data?.detail || 'Create failed')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-[480px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg mb-1">Create term list</h3>
        <p className="text-xs text-slate-500 mb-4">After creating, upload an Excel to populate the terms.</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-700">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. LWW Nursing Education"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700">Description (optional)</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)}
              placeholder="One-line description"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700">Scope</label>
            <div className="mt-1 flex gap-2">
              {(['client', 'generic'] as const).map((s) => (
                <button key={s} onClick={() => setScope(s)}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
                    scope === s ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-700'
                  }`}>
                  {s === 'client' ? 'Client-specific' : 'Generic'}
                </button>
              ))}
            </div>
          </div>
          {scope === 'client' && (
            <div>
              <label className="text-xs font-medium text-slate-700">Client ID</label>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)}
                placeholder="e.g. 11 (Wolters Kluwer)"
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border text-sm">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold disabled:opacity-50">
            {saving ? <Loader2 className="animate-spin inline" size={14} /> : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TermLibraryPage
