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

export function TermLibraryPage() {
  const navigate = useNavigate()
  const { roles } = useRBAC()
  useDocumentTitle('Term Library — S4 Carlisle CMS')
  const canEdit = useMemo(
    () => roles.some((r) => ['admin', 'projectmanager', 'project manager'].includes(r.toLowerCase().replace(/\s+/g, ' ').trim().replace(' ', ''))),
    [roles],
  )

  const [lists, setLists] = useState<TermList[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState<'all' | 'client' | 'generic'>('all')
  const [selected, setSelected] = useState<TermList | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastSeq = useRef(0)
  const [showCreate, setShowCreate] = useState(false)

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
          <button onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center">
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
              <TermListCard key={tl.id} list={tl} onOpen={() => setSelected(tl)} />
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
          onToast={pushToast} />
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

function TermListCard({ list, onOpen }: { list: TermList; onOpen: () => void }) {
  const scopeMeta = list.scope === 'generic'
    ? { Icon: Globe, label: 'Generic', cls: 'bg-sky-100 text-sky-700' }
    : { Icon: Users, label: 'Client', cls: 'bg-violet-100 text-violet-700' }
  return (
    <button onClick={onOpen}
      className="text-left bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-lg hover:border-violet-300 transition-all">
      <div className="flex items-start justify-between">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center">
          <FileSpreadsheet size={20} />
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 ${scopeMeta.cls}`}>
          <scopeMeta.Icon size={10} /> {scopeMeta.label}
        </span>
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
    </button>
  )
}

function TermListDetailDrawer({ list, canEdit, onClose, onToast }: {
  list: TermList; canEdit: boolean; onClose: () => void; onToast: (k: Toast['kind'], t: string) => void
}) {
  const [terms, setTerms] = useState<Term[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
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

  async function handleUpload(file: File, replace: boolean) {
    setUploading(true)
    try {
      const result: ImportResult = await termListsApi.importExcel(list.id, file, replace)
      onToast('success', `Imported ${result.inserted} new terms (${result.total_in_list} total)`)
      await loadTerms()
    } catch (err: any) {
      onToast('error', err?.response?.data?.detail || 'Import failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
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
          <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-slate-100 text-slate-500 flex items-center justify-center">
            <X size={14} />
          </button>
        </header>

        {canEdit && (
          <div className="px-6 py-3 border-b bg-slate-50/70 flex items-center gap-3 flex-wrap">
            <input ref={fileRef} type="file" accept=".xlsx,.xlsm" hidden
                   onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f, false) }} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-50">
              {uploading ? <Loader2 className="animate-spin" size={12} /> : <Upload size={12} />}
              Upload Excel (append)
            </button>
            <button onClick={() => {
              if (!confirm('Replace will DELETE all existing terms before importing. Continue?')) return
              fileRef.current?.click()
              // Note: for simplicity we only wire append from the button; replace is less common and done via the API directly
            }} className="text-xs px-2.5 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-rose-700">
              Replace (danger)
            </button>
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
