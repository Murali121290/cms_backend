import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Archive, ChevronRight, Code2, Download, Eye, FileText, History, Image, Layers, RefreshCw, Search, Send, Trash2, Upload, FileCheck2,
} from 'lucide-react'
import { journalsApi, type ArticleFileRow, type ArticleFolderKey, type ArticleFolders } from '@/api/journals'
import { getApiErrorMessage } from '@/api/client'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'
import { cn } from '@/utils/cn'
import { shortStage } from './journalUi'

const FOLDER_ICON: Record<ArticleFolderKey, typeof FileText> = {
  manuscript: FileText, art: Image, xml: Code2, indesign: Layers, proof: FileCheck2, delivery: Send, backup: Archive,
}
const UPLOADABLE: Partial<Record<ArticleFolderKey, string>> = {
  manuscript: '.docx,.doc,.pdf', art: '.tif,.tiff,.eps,.png,.jpg,.jpeg,.svg,.ai,.psd', proof: '.pdf',
}
const STATUS_CLASS = {
  ok: 'bg-green-600/10 text-green-700', warn: 'bg-amber-500/15 text-amber-700',
  err: 'bg-danger/10 text-danger', info: 'bg-primary/10 text-primary',
} as const

const fmtSize = (n: number | null) => n == null ? '—' : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`
const fmtDate = (s: string) => new Date(s).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * The article's file manager, opened from the journal's article list before the review page.
 * Files sit in production folders (Manuscript, Art, XML, InDesign, Proof, Final delivery, Backup),
 * each showing the latest version; History restores an older one. Proceed opens the review page.
 */
export function JournalArticleFilesPage() {
  const { articleId } = useParams<{ articleId: string }>()
  const id = Number(articleId)
  const navigate = useNavigate()
  const [data, setData] = useState<ArticleFolders | null>(null)
  const [loading, setLoading] = useState(true)
  const [folder, setFolder] = useState<ArticleFolderKey>('manuscript')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<{ file: ArticleFileRow; versions: (ArticleFileRow & { current?: boolean })[] } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ArticleFileRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pack, setPack] = useState({ include_indesign: true, include_art: true })
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setData(await journalsApi.getFolders(id))
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not load the article files'))
    } finally {
      setLoading(false)
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  const current = data?.folders.find(f => f.key === folder)
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (current?.files ?? []).filter(f => !q || f.filename.toLowerCase().includes(q))
  }, [current, query])

  if (loading) return <FullPageSpinner />
  if (!data) return <EmptyState title="Article not found" description="Open the article from its journal." />
  const { article, journal } = data
  const done = article.status === 'Completed'

  const toggle = (key: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const allSelected = rows.length > 0 && rows.every(r => selected.has(String(r.id)))

  const bulkDownload = async () => {
    if (!selected.size) { toast.error('Select files first'); return }
    setBusy('bulk')
    try {
      const ids = [...selected].map(s => (s === 'working' ? 'working' : Number(s))) as (number | 'working')[]
      saveBlob(await journalsApi.bulkDownload(id, ids), `article_${id}_files.zip`)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not build the zip'))
    } finally {
      setBusy(null)
    }
  }

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy('upload')
    try {
      await journalsApi.uploadArticleFiles(id, [...files])
      toast.success(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`)
      await load()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Upload failed'))
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const openHistory = async (file: ArticleFileRow) => {
    try {
      setHistory({ file, versions: await journalsApi.getFileVersions(id, file.id) })
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not load the history'))
    }
  }

  const restore = async (fileId: number) => {
    try {
      const r = await journalsApi.restoreFile(id, fileId)
      toast.success(r.message)
      setHistory(null)
      await load()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not restore this version'))
    }
  }

  const remove = async () => {
    if (!confirmDelete || confirmDelete.id === 'working') return
    try {
      await journalsApi.deleteFile(id, confirmDelete.id)
      toast.success(`${confirmDelete.filename} deleted`)
      setSelected(prev => { const n = new Set(prev); n.delete(String(confirmDelete.id)); return n })
      setConfirmDelete(null)
      await load()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not delete the file'))
    }
  }

  const view = (file: ArticleFileRow) => {
    if (file.category === 'JATS_XML') navigate(`/journal-article-editor/${id}#xml`)
    else if (file.id === 'working' || file.category === 'XHTML') navigate(`/journal-article-editor/${id}`)
    else window.open(journalsApi.downloadFileUrl(id, file) + (file.id !== 'working' ? '?inline=true' : ''), '_blank')
  }

  const deliver = async () => {
    setBusy('delivery')
    try {
      const r = await journalsApi.createDelivery(id, pack)
      toast.success(`${r.file.filename} built${r.completed ? '. The article is now Completed.' : '.'}`)
      await load()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not build the delivery package'))
    } finally {
      setBusy(null)
    }
  }

  const FolderIcon = FOLDER_ICON[folder]
  const readyToSend = data.delivery_readiness.every(r => r.ok)

  return (
    <div className="p-4 space-y-3 max-w-[1500px] mx-auto">
      <Breadcrumb items={[
        { label: 'Journal Production', href: '/journal-production' },
        ...(journal ? [
          { label: journal.client_code ?? 'Client', href: `/journal-production/clients/${journal.client_id}` },
          { label: journal.journal_code, href: `/journal-production/journals/${journal.id}` },
        ] : []),
        { label: `Article #${article.id}` },
      ]} />

      <header className="bg-card border border-border rounded-lg px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-sm font-semibold truncate max-w-[720px]" title={article.article_title}>{article.article_title}</h1>
            <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap">
              {done ? 'Completed' : article.current_stage}
            </span>
          </div>
          <p className="text-[11px] text-muted font-mono">{article.article_doi ?? 'No DOI'}{journal ? ` · ${journal.journal_title}${journal.volume ? ` · Vol ${journal.volume}` : ''}${journal.issue ? ` Issue ${journal.issue}` : ''}` : ''}</p>
        </div>
        <label className="relative">
          <span className="sr-only">Search files</span>
          <Search className="size-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search files…"
                 className="h-8 w-52 rounded-md border border-border bg-background pl-8 pr-2 text-xs outline-none focus:ring-2 focus:ring-primary/30" />
        </label>
        <Button size="sm" variant="secondary" leftIcon={<Download />} onClick={bulkDownload} isLoading={busy === 'bulk'}>
          Bulk Download{selected.size ? ` (${selected.size})` : ''}
        </Button>
        <Button size="sm" leftIcon={<Upload />} onClick={() => fileInput.current?.click()} isLoading={busy === 'upload'}
                disabled={!UPLOADABLE[folder]} title={UPLOADABLE[folder] ? `Upload to ${current?.label}` : 'Open Manuscript, Art or Proof to upload'}>
          Bulk Upload
        </Button>
        <input ref={fileInput} type="file" multiple hidden accept={UPLOADABLE[folder]} onChange={e => void upload(e.target.files)} />
        <Button size="sm" variant="ghost" aria-label="Refresh" onClick={() => void load()}><RefreshCw className="size-4" /></Button>
        <Button size="sm" onClick={() => navigate(`/journal-article-editor/${id}`)}>
          {done ? 'Open review page' : `Proceed to ${shortStage(article.current_stage)}`} <ChevronRight className="size-4" />
        </Button>
      </header>

      <div className="grid gap-3 md:grid-cols-[210px_minmax(0,1fr)] items-start">
        <nav className="bg-card border border-border rounded-lg p-2 space-y-0.5" aria-label="Folders">
          <p className="px-2 pt-1 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Folders</p>
          {data.folders.map(f => {
            const Icon = FOLDER_ICON[f.key]
            return (
              <button key={f.key} type="button" onClick={() => { setFolder(f.key); setQuery('') }} aria-current={folder === f.key}
                      className={cn('w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-left',
                        folder === f.key ? 'bg-primary/10 font-semibold text-text' : 'hover:bg-surface text-text')}>
                <Icon className="size-4 text-muted" />
                {f.label}
                {f.attention && <span className="size-1.5 rounded-full bg-amber-500" title="Needs attention" />}
                <span className="ml-auto rounded-full bg-surface px-2 text-[11px] text-muted tabular-nums">{f.count}</span>
              </button>
            )
          })}
          <p className="px-2 pt-2 mt-1 border-t border-border text-[11px] text-muted">
            Folders follow the production stages, so the article can be archived and delivered as one set.
          </p>
        </nav>

        <section className="bg-card border border-border rounded-lg min-w-0">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-border">
            <FolderIcon className="size-4 text-muted" />
            <h2 className="text-sm font-semibold">{current?.label}</h2>
            <span className="text-xs text-muted">({rows.length} file{rows.length === 1 ? '' : 's'}) · {current?.hint}</span>
            {folder === 'backup' && (
              <a href={journalsApi.archiveUrl(id)} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <Archive className="size-3.5" /> Download archive (.zip)
              </a>
            )}
          </div>

          {folder === 'delivery' && (
            <div className="m-4 rounded-lg border border-dashed border-border p-3 space-y-2.5">
              <p className="text-sm font-semibold">Delivery package</p>
              <ul className="grid gap-1.5 sm:grid-cols-2 text-xs">
                {data.delivery_readiness.map(r => (
                  <li key={r.key} className="flex items-center gap-2">
                    <span className={cn('font-bold', r.ok ? 'text-green-700' : 'text-danger')}>{r.ok ? '✓' : '✗'}</span>
                    {r.label}{!r.ok && r.detail ? <span className="text-muted">— {r.detail}</span> : null}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={pack.include_indesign}
                  onChange={e => setPack(p => ({ ...p, include_indesign: e.target.checked }))} /> Include InDesign</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={pack.include_art}
                  onChange={e => setPack(p => ({ ...p, include_art: e.target.checked }))} /> Include art</label>
                <Button size="sm" leftIcon={<Send />} onClick={deliver} isLoading={busy === 'delivery'}>Build delivery package</Button>
                {!readyToSend && <span className="text-danger">Building now records the open items with the package.</span>}
              </div>
              <p className="text-[11px] text-muted">The package is saved here for download. Sending it to the client's server is not built yet.</p>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted border-b border-border">
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" aria-label="Select all files in this folder" checked={allSelected}
                           onChange={() => setSelected(prev => {
                             const n = new Set(prev)
                             rows.forEach(r => (allSelected ? n.delete(String(r.id)) : n.add(String(r.id))))
                             return n
                           })} />
                  </th>
                  <th className="px-3 py-2">File name</th><th className="px-3 py-2">Size</th><th className="px-3 py-2">Uploaded by</th>
                  <th className="px-3 py-2">Uploaded on</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Version</th><th className="px-3 py-2">Actions</th><th className="px-3 py-2">History</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-10 text-center text-muted text-sm">
                    {folder === 'delivery' ? 'No package yet. Build it above once the XML, proof and art are final.' : 'No files in this folder yet.'}
                  </td></tr>
                ) : rows.map(f => (
                  <tr key={`${f.folder}-${f.id}`} className="border-b border-border hover:bg-surface/60">
                    <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Select ${f.filename}`} checked={selected.has(String(f.id))} onChange={() => toggle(String(f.id))} /></td>
                    <td className="px-3 py-2.5 min-w-[280px]">
                      <div className="font-medium break-all">{f.filename}</div>
                      {f.note && <div className="text-[11px] text-muted">{f.note}</div>}
                      {!f.exists && <div className="text-[11px] text-danger">Missing on disk</div>}
                    </td>
                    <td className="px-3 py-2.5 text-muted tabular-nums whitespace-nowrap">{fmtSize(f.size)}</td>
                    <td className="px-3 py-2.5">{f.uploaded_by}</td>
                    <td className="px-3 py-2.5 text-muted tabular-nums whitespace-nowrap">{fmtDate(f.uploaded_at)}</td>
                    <td className="px-3 py-2.5"><span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', STATUS_CLASS[f.status.kind])}>{f.status.label}</span></td>
                    <td className="px-3 py-2.5"><span className="rounded border border-border px-1.5 font-mono text-[11px]">{f.type}</span></td>
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold text-primary">v{f.version}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-0.5">
                        <button type="button" className="p-1.5 rounded hover:bg-surface text-muted hover:text-text" title="View" aria-label={`View ${f.filename}`} onClick={() => view(f)}><Eye className="size-4" /></button>
                        <a className="p-1.5 rounded hover:bg-surface text-muted hover:text-text" title="Download" aria-label={`Download ${f.filename}`} href={journalsApi.downloadFileUrl(id, f)}><Download className="size-4" /></a>
                        {!f.protected && f.id !== 'working' && (
                          <button type="button" className="p-1.5 rounded hover:bg-surface text-muted hover:text-danger" title="Delete" aria-label={`Delete ${f.filename}`} onClick={() => setConfirmDelete(f)}><Trash2 className="size-4" /></button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {folder !== 'backup' && (
                        <button type="button" className="p-1.5 rounded hover:bg-surface text-muted hover:text-text" title="Version history" aria-label={`History of ${f.filename}`} onClick={() => void openHistory(f)}>
                          <History className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Modal isOpen={!!history} onClose={() => setHistory(null)} title={history ? `History · ${history.file.filename}` : ''}
             description="Every version is kept. Restoring makes an old version current as the next version; the replaced one moves to Backup.">
        <ol className="space-y-2 max-h-[60vh] overflow-y-auto">
          {[...(history?.versions ?? [])].reverse().map((v, i) => {
            const isCurrent = v.current ?? i === 0
            return (
              <li key={`${v.id}-${v.version}`} className={cn('rounded-md border px-3 py-2 text-sm', isCurrent ? 'border-primary' : 'border-border')}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-primary">v{v.version}</span>
                  <span className={cn('rounded-full px-2 text-[11px] font-semibold', isCurrent ? STATUS_CLASS.ok : STATUS_CLASS.info)}>{isCurrent ? 'Current' : 'In Backup'}</span>
                  <span className="ml-auto text-xs text-muted tabular-nums">{fmtSize(v.size)}</span>
                </div>
                <p className="text-xs text-muted">{v.uploaded_by} · {fmtDate(v.uploaded_at)}</p>
                <div className="flex gap-2 pt-1">
                  <a className="text-xs font-medium text-primary hover:underline" href={journalsApi.downloadFileUrl(id, v)}>Download</a>
                  {!isCurrent && typeof v.id === 'number' && (
                    <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => void restore(v.id as number)}>
                      Restore as v{(history?.versions.at(-1)?.version ?? v.version) + 1}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </Modal>

      <Modal isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete this file?"
             description={confirmDelete ? `${confirmDelete.filename} is removed from the article and from disk. This cannot be undone.` : ''}
             footer={<>
               <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
               <Button variant="danger" onClick={() => void remove()}>Delete file</Button>
             </>} />
    </div>
  )
}
