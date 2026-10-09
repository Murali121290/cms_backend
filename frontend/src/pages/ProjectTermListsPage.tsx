import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Save, Loader2, AlertCircle, Lock, Check, X,
  BookOpen, Users, Globe, FileSpreadsheet, ChevronRight,
  Code2, Download, Copy as CopyIcon,
} from 'lucide-react'
import { termListsApi, type TermList } from '@/api/termListsApi'
import { useRBAC } from '@/hooks/useRBAC'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string }

export function ProjectTermListsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { roles } = useRBAC()
  useDocumentTitle('Term Lists — S4 Carlisle CMS')

  const canEdit = useMemo(() => {
    const normalised = roles.map((r) => r.toLowerCase().replace(/\s+/g, ''))
    return normalised.includes('admin') || normalised.includes('projectmanager')
  }, [roles])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [assigned, setAssigned] = useState<TermList[]>([])
  const [available, setAvailable] = useState<TermList[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [initialIds, setInitialIds] = useState<Set<number>>(new Set())
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastSeq = useRef(0)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonText, setJsonText] = useState<string | null>(null)
  const [projectCode, setProjectCode] = useState<string | undefined>()
  const [jsonCopied, setJsonCopied] = useState(false)

  function pushToast(kind: Toast['kind'], text: string) {
    const id = ++toastSeq.current
    setToasts((p) => [...p, { id, kind, text }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3200)
  }

  async function load() {
    if (!projectId) return
    setLoading(true)
    try {
      const data = await termListsApi.projectAssignment(projectId)
      setAssigned(data.assigned)
      setAvailable(data.available)
      const ids = new Set(data.assigned.map((tl) => tl.id))
      setSelectedIds(ids)
      setInitialIds(new Set(ids))
    } catch (err: any) {
      pushToast('error', err?.response?.data?.detail || 'Failed to load term lists')
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [projectId])

  const dirty = useMemo(() => {
    if (selectedIds.size !== initialIds.size) return true
    for (const id of selectedIds) if (!initialIds.has(id)) return true
    return false
  }, [selectedIds, initialIds])

  const combined = useMemo(() => [...assigned, ...available], [assigned, available])

  function toggle(id: number) {
    if (!canEdit) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function save() {
    if (!projectId || !canEdit) return
    setSaving(true)
    try {
      await termListsApi.setProjectAssignment(projectId, Array.from(selectedIds))
      pushToast(
        'success',
        `Saved · ${selectedIds.size} list${selectedIds.size === 1 ? '' : 's'} assigned · selected_terms.json written to CE Support`,
      )
      load()
    } catch (err: any) {
      pushToast('error', err?.response?.data?.detail || 'Save failed')
    } finally { setSaving(false) }
  }

  async function openJson() {
    if (!projectId) return
    setJsonOpen(true); setJsonText(null)
    try {
      const text = await termListsApi.viewProjectJson(projectId)
      setJsonText(text)
      // pull project_code out of the JSON for the filename on download
      try { const parsed = JSON.parse(text); if (parsed?.project_code) setProjectCode(parsed.project_code) } catch { /* ignore */ }
    } catch (err: any) {
      pushToast('error', err?.response?.data?.detail || 'Failed to load JSON')
    }
  }

  async function downloadJson() {
    if (!projectId) return
    try {
      await termListsApi.downloadProjectJson(projectId, projectCode)
      pushToast('success', 'JSON downloaded')
    } catch (err: any) {
      pushToast('error', err?.response?.data?.detail || 'Download failed')
    }
  }

  async function downloadExcel() {
    if (!projectId) return
    try {
      await termListsApi.downloadProjectExcel(projectId, projectCode)
      pushToast('success', 'Excel downloaded')
    } catch (err: any) {
      pushToast('error', err?.response?.data?.detail || 'Download failed')
    }
  }

  function copyJson() {
    if (!jsonText) return
    navigator.clipboard?.writeText(jsonText)
    setJsonCopied(true)
    setTimeout(() => setJsonCopied(false), 1200)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        <Loader2 className="animate-spin mr-2" size={16} /> Loading term lists…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center">
            <ArrowLeft size={16} />
          </button>
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg">
            <BookOpen size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-indigo-200/70 mb-1">
              <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-white">
                Project #{projectId}
              </button>
              <ChevronRight size={11} />
              <span className="text-white font-medium">Term Lists</span>
            </div>
            <h1 className="text-xl font-bold">Project Term Lists</h1>
            <p className="text-sm text-indigo-200/80">
              Term lists assigned here will be highlighted during Language Editing.
            </p>
          </div>
          <button onClick={openJson}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-white border border-white/10"
            title="View the saved selected_terms.json">
            <Code2 size={13} /> View JSON
          </button>
          <button onClick={downloadJson}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-white border border-white/10"
            title="Download selected_terms.json">
            <Download size={13} /> JSON
          </button>
          <button onClick={downloadExcel}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-sm text-white font-medium"
            title="Download Excel of assigned terms">
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button onClick={save} disabled={!canEdit || !dirty || saving}
            className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-semibold text-sm transition ${
              !canEdit || !dirty
                ? 'bg-white/10 text-indigo-300/50 cursor-not-allowed'
                : 'bg-gradient-to-br from-violet-500 to-indigo-500 text-white hover:shadow-lg'
            }`}>
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            Save assignment
          </button>
        </div>
      </header>

      {!canEdit && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-sm text-amber-900 flex items-center gap-2">
          <Lock size={14} /> View-only. Only Admin / Project Manager can change the assignment.
        </div>
      )}

      <main className="max-w-6xl mx-auto px-6 py-6">
        <div className="mb-5 flex items-baseline gap-3">
          <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold">
            {selectedIds.size} selected
          </span>
          <span className="text-xs text-slate-400">· total available: {combined.length}</span>
        </div>

        {combined.length === 0 && (
          <div className="text-center py-16 bg-white border border-slate-200 rounded-2xl">
            <BookOpen className="mx-auto mb-3 text-slate-300" size={32} />
            <p className="text-sm text-slate-600 font-medium">
              No term lists available for this project
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Only generic lists and lists matching this project's client are shown here.
            </p>
            <button onClick={() => navigate('/settings/term-lists')}
              className="mt-4 text-sm text-violet-700 hover:underline">
              Go to Term Library →
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {combined.map((tl) => {
            const picked = selectedIds.has(tl.id)
            const ScopeIcon = tl.scope === 'generic' ? Globe : Users
            return (
              <button key={tl.id} onClick={() => toggle(tl.id)} disabled={!canEdit}
                className={`text-left bg-white border-2 rounded-2xl p-4 transition-all ${
                  picked ? 'border-violet-500 shadow-md ring-2 ring-violet-100' : 'border-slate-200 hover:border-slate-300'
                } ${canEdit ? 'cursor-pointer' : 'cursor-default'}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition ${
                    picked ? 'bg-gradient-to-br from-violet-500 to-indigo-500 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {picked ? <Check size={16} /> : <FileSpreadsheet size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 text-sm truncate">{tl.name}</h3>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-1">
                      <span className="inline-flex items-center gap-1">
                        <ScopeIcon size={10} /> {tl.scope === 'generic' ? 'Generic' : 'Client'}
                      </span>
                      <span>·</span>
                      <span><b className="text-slate-700">{tl.term_count}</b> terms</span>
                    </div>
                    {tl.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{tl.description}</p>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </main>

      {/* View JSON modal */}
      {jsonOpen && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-6"
             onClick={() => setJsonOpen(false)}>
          <div className="w-full max-w-3xl max-h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
               onClick={(e) => e.stopPropagation()}>
            <header className="px-5 py-3.5 border-b flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 text-white flex items-center justify-center">
                  <Code2 size={15} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Selected Terms JSON</h3>
                  <p className="text-xs text-slate-500">
                    {projectCode || `Project ${projectId}`} · <code className="text-[11px]">CE Support / Style sheet template / {projectCode || 'project'}_selected_terms.json</code>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={copyJson} disabled={!jsonText}
                        className="text-xs px-2.5 py-1.5 rounded-md border bg-white hover:bg-slate-50 inline-flex items-center gap-1 disabled:opacity-50">
                  {jsonCopied ? <><Check size={12} className="text-emerald-600" /> Copied</> : <><CopyIcon size={12} /> Copy</>}
                </button>
                <button onClick={downloadJson}
                        className="text-xs px-2.5 py-1.5 rounded-md border bg-white hover:bg-slate-50 inline-flex items-center gap-1">
                  <Download size={12} /> Download
                </button>
                <button onClick={() => setJsonOpen(false)}
                        className="w-7 h-7 rounded-md hover:bg-slate-100 text-slate-500 inline-flex items-center justify-center">
                  <X size={14} />
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-auto bg-slate-950 text-slate-100 font-mono text-xs leading-6 p-4">
              {jsonText === null ? (
                <div className="text-slate-400 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Loading JSON…
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words">{jsonText}</pre>
              )}
            </div>
          </div>
        </div>
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

export default ProjectTermListsPage
