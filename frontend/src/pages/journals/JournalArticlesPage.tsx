import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, FileText, Settings, Trash2, Upload } from 'lucide-react'
import {
  journalsApi, type ArticleUploadResult, type JournalArticleRow, type JournalIssue, type JournalOverview,
} from '@/api/journals'
import { getApiErrorMessage } from '@/api/client'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { UploadZone } from '@/components/ui/UploadZone'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'
import { cn } from '@/utils/cn'
import { STAGE, StageProgress, advanceError, shortStage, stageNumber } from './journalUi'

const COMPLETED = '__completed__'
const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

export function JournalArticlesPage() {
  const { journalId } = useParams()
  const id = Number(journalId)
  const navigate = useNavigate()
  const [journal, setJournal] = useState<JournalOverview | null>(null)
  const [articles, setArticles] = useState<JournalArticleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [stageFilter, setStageFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const [uploadOpen, setUploadOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<ArticleUploadResult | null>(null)

  const [proceeding, setProceeding] = useState<JournalArticleRow | null>(null)
  const [proceedBusy, setProceedBusy] = useState(false)
  const [blocked, setBlocked] = useState<{ message: string; issues: JournalIssue[] } | null>(null)

  const [deleting, setDeleting] = useState<JournalArticleRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await journalsApi.deleteArticle(deleting.id)
      toast.success(`Deleted “${deleting.article_title}”`)
      setDeleting(null)
      await load()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not delete the article'))
    } finally {
      setDeleteBusy(false)
    }
  }

  const load = useCallback(async () => {
    try {
      const [j, rows] = await Promise.all([journalsApi.getJournal(id), journalsApi.getJournalArticles(id)])
      setJournal(j)
      setArticles(rows)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not load this journal'))
    } finally {
      setLoading(false)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const c: Record<string, number> = { [COMPLETED]: 0 }
    for (const a of articles) {
      const key = a.status === 'Completed' ? COMPLETED : a.current_stage
      c[key] = (c[key] ?? 0) + 1
    }
    return c
  }, [articles])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return articles.filter(a => {
      if (stageFilter === COMPLETED && a.status !== 'Completed') return false
      if (stageFilter && stageFilter !== COMPLETED && (a.status === 'Completed' || a.current_stage !== stageFilter)) return false
      return !q || `${a.article_title} ${a.article_doi ?? ''} ${a.lead_author ?? ''}`.toLowerCase().includes(q)
    })
  }, [articles, stageFilter, query])

  const upload = async () => {
    if (!files.length) return
    setUploading(true)
    try {
      const result = await journalsApi.uploadArticles(id, files)
      setUploadResult(result)
      setFiles([])
      if (result.created.length) toast.success(`${result.created.length} article${result.created.length > 1 ? 's' : ''} added`)
      await load()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Upload failed'))
    } finally {
      setUploading(false)
    }
  }

  const closeUpload = () => { setUploadOpen(false); setUploadResult(null); setFiles([]) }

  const nextStageOf = (a: JournalArticleRow) => {
    const idx = a.stages.findIndex(s => s.stage_name === a.current_stage)
    return idx >= 0 && idx < a.stages.length - 1 ? a.stages[idx + 1].stage_name : null
  }

  const proceed = async () => {
    if (!proceeding) return
    setProceedBusy(true)
    setBlocked(null)
    try {
      const res = await journalsApi.advanceStage(proceeding.id)
      toast.success(res.new_stage ? `Moved to ${shortStage(res.new_stage)}` : 'Article completed its workflow')
      setProceeding(null)
      await load()
    } catch (err) {
      setBlocked(advanceError(err))
    } finally {
      setProceedBusy(false)
    }
  }

  if (loading) return <FullPageSpinner />
  if (!journal) return <EmptyState title="Journal not found" description="It may have been removed." />

  const inProgress = articles.filter(a => a.status !== 'Completed').length

  return (
    <div className="p-6 space-y-5">
      <Breadcrumb items={[
        { label: 'Journal Production', href: '/journal-production' },
        { label: journal.publisher_name ?? 'Client', href: `/journal-production/clients/${journal.client_id}` },
        { label: journal.journal_code },
      ]} />

      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold text-text">{journal.journal_title}</h1>
          <p className="text-sm text-muted flex flex-wrap gap-x-3">
            <span className="font-mono">{journal.journal_code}</span>
            {(journal.volume || journal.issue) && <span>Vol {journal.volume ?? '—'} · Issue {journal.issue ?? '—'}</span>}
            {journal.issn_print && <span>ISSN {journal.issn_print}</span>}
            <span>Workflow: <strong className="text-text font-medium">{journal.workflow_name ?? 'Full production'}</strong></span>
            {journal.journal_manager && <span>Manager: {journal.journal_manager}</span>}
          </p>
        </div>
        <Button variant="secondary" leftIcon={<Settings />} onClick={() => navigate(`/journal-production/journals/${journal.id}/settings`)}>
          Settings
        </Button>
        <Button leftIcon={<Upload />} onClick={() => setUploadOpen(true)}>Upload articles</Button>
      </div>

      {/* Journal setup warnings, each linking to the settings tab that fixes it */}
      {(() => {
        const s = journal.setup
        const needsLayout = journal.stages.some(st => stageNumber(st) === STAGE.INDESIGN)
        const warnings = [
          !s.stylesheet && { text: 'No style sheet: default rules are used', tab: 'style' },
          !s.grammarsheet && journal.stages.some(st => stageNumber(st) === STAGE.LANGUAGE) && { text: 'No grammar sheet', tab: 'grammar' },
          needsLayout && !s.template && { text: 'No InDesign template: Generate InDesign cannot run', tab: 'design' },
        ].filter(Boolean) as { text: string; tab: string }[]
        return (
          <div className="flex flex-wrap gap-2 text-xs">
            {s.template && <Badge variant="success" size="sm">Template {s.template} v{s.template_version}</Badge>}
            {s.stylesheet && <Badge variant="success" size="sm">Style sheet {s.stylesheet}</Badge>}
            {s.grammarsheet && <Badge variant="success" size="sm">Grammar {s.grammarsheet}</Badge>}
            {warnings.map(w => (
              <button key={w.text} type="button" onClick={() => navigate(`/journal-production/journals/${journal.id}/settings#${w.tab}`)}
                      className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-700 px-2 py-0.5 font-semibold hover:underline">
                <AlertTriangle className="size-3" /> {w.text}
              </button>
            ))}
          </div>
        )
      })()}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Articles', articles.length, ''],
          ['In progress', inProgress, 'text-primary'],
          ['Completed', counts[COMPLETED], 'text-green-600'],
          ['Delayed', articles.filter(a => a.delayed).length, 'text-red-500'],
        ].map(([label, value, cls]) => (
          <div key={label as string} className="bg-card border border-border rounded-lg px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
            <div className={cn('text-2xl font-semibold tabular-nums', cls as string)}>{value}</div>
          </div>
        ))}
      </div>

      {/* Workflow rail: one pill per stage in this journal's workflow */}
      <div className="overflow-x-auto">
        <div className="flex items-stretch gap-1 min-w-max" role="group" aria-label="Filter by stage">
          {[...journal.stages, COMPLETED].map((stage, i) => {
            const active = stageFilter === stage
            const n = counts[stage] ?? 0
            return (
              <button
                key={stage}
                type="button"
                aria-pressed={active}
                onClick={() => setStageFilter(active ? null : stage)}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                  active ? 'border-primary bg-primary text-white' : 'border-border bg-card hover:border-primary/40',
                )}
              >
                <span className={cn('font-mono text-xs', active ? 'text-white/80' : 'text-muted')}>
                  {stage === COMPLETED ? '✓' : stageNumber(stage)}
                </span>
                <span className="whitespace-nowrap">{stage === COMPLETED ? 'Completed' : shortStage(stage)}</span>
                <span className={cn('rounded-full px-1.5 text-xs tabular-nums', active ? 'bg-white/20' : n ? 'bg-primary/10 text-primary' : 'text-muted')}>{n}</span>
                {i < journal.stages.length - 1 && <ArrowRight className={cn('size-3.5 ml-1', active ? 'text-white/70' : 'text-muted')} />}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative">
          <span className="sr-only">Search articles</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search title, DOI, author"
            className="h-9 w-72 rounded-md border border-border bg-card px-3 text-sm text-text outline-none focus:ring-2 focus:ring-primary/30"
          />
        </label>
        <span className="text-xs text-muted">{visible.length} of {articles.length} articles</span>
      </div>

      {articles.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No articles yet"
          description="Upload manuscripts (.docx) or article packages (.zip). Each file becomes an article at the first stage of the workflow."
          action={<Button leftIcon={<Upload />} onClick={() => setUploadOpen(true)}>Upload articles</Button>}
        />
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5 w-10">#</th>
                <th className="text-left font-semibold px-4 py-2.5">Article</th>
                <th className="text-left font-semibold px-4 py-2.5">Type</th>
                <th className="text-left font-semibold px-4 py-2.5">Current stage</th>
                <th className="text-left font-semibold px-4 py-2.5">Progress</th>
                <th className="text-left font-semibold px-4 py-2.5">Assignee</th>
                <th className="text-left font-semibold px-4 py-2.5">Due</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a, i) => {
                const done = a.status === 'Completed'
                return (
                  <tr key={a.id} className={cn('border-t border-border', a.delayed && 'bg-red-500/5')}>
                    <td className="px-4 py-3 text-muted tabular-nums">{i + 1}</td>
                    <td className="px-4 py-3 max-w-md">
                      <div className="font-medium text-text line-clamp-2">{a.article_title}</div>
                      <div className="text-xs text-muted font-mono">{a.article_doi ?? 'No DOI yet'}{a.lead_author && <span className="font-sans"> · {a.lead_author}</span>}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{a.article_type}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {done ? <Badge variant="success" size="sm">Completed</Badge> : (
                        <Badge variant="in-progress" size="sm">{a.current_stage}</Badge>
                      )}
                      {a.open_errors > 0 && !done && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-danger">
                          <AlertTriangle className="size-3" /> {a.open_errors} open error{a.open_errors > 1 ? 's' : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3"><StageProgress stages={a.stages} current={a.current_stage} /></td>
                    <td className="px-4 py-3 whitespace-nowrap">{a.current_assignee_name ?? <span className="text-muted">Unassigned</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums">{fmtDate(a.due_date)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {a.delayed ? <Badge variant="error" size="sm">Delayed</Badge> : <Badge variant={done ? 'success' : 'default'} size="sm">{a.status}</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Direct Download Action Menu */}
                        <div className="relative group">
                          <Button size="sm" variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-300 hover:bg-emerald-100">
                            📥 Download ▾
                          </Button>
                          <div className="hidden group-hover:block absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-lg shadow-xl z-30 py-1 text-xs">
                            <button className="w-full px-3 py-1.5 text-left font-medium text-text hover:bg-surface flex items-center justify-between"
                                    onClick={() => window.open(journalsApi.latestFileUrl(a.id, 'docx'), '_blank')}>
                              <span>📄 Word (.docx)</span>
                              <span className="font-mono text-[10px] text-muted">DOCX</span>
                            </button>
                            <button className="w-full px-3 py-1.5 text-left font-medium text-text hover:bg-surface flex items-center justify-between"
                                    onClick={() => window.open(journalsApi.latestFileUrl(a.id, 'xhtml'), '_blank')}>
                              <span>🌐 XHTML (.xhtml)</span>
                              <span className="font-mono text-[10px] text-muted">XHTML</span>
                            </button>
                            <button className="w-full px-3 py-1.5 text-left font-medium text-text hover:bg-surface flex items-center justify-between"
                                    onClick={() => window.open(journalsApi.latestFileUrl(a.id, 'xml'), '_blank')}>
                              <span>🏷️ JATS XML (.xml)</span>
                              <span className="font-mono text-[10px] text-muted">XML</span>
                            </button>
                            <button className="w-full px-3 py-1.5 text-left font-medium text-text hover:bg-surface flex items-center justify-between"
                                    onClick={() => window.open(journalsApi.proofUrl(a.id), '_blank')}>
                              <span>📑 Proof PDF (.pdf)</span>
                              <span className="font-mono text-[10px] text-muted">PDF</span>
                            </button>
                            <button className="w-full px-3 py-1.5 text-left font-medium text-text hover:bg-surface flex items-center justify-between"
                                    onClick={() => window.open(journalsApi.latestFileUrl(a.id, 'indd'), '_blank')}>
                              <span>🎨 InDesign (.indd)</span>
                              <span className="font-mono text-[10px] text-muted">INDD</span>
                            </button>
                          </div>
                        </div>

                        {/* File Replace Menu */}
                        <div className="relative group">
                          <Button size="sm" variant="outline" className="text-blue-700 bg-blue-50 border-blue-300 hover:bg-blue-100">
                            ⬆️ Replace ▾
                          </Button>
                          <div className="hidden group-hover:block absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-lg shadow-xl z-30 py-1 text-xs">
                            <label className="w-full px-3 py-1.5 text-left font-medium text-text hover:bg-surface flex items-center justify-between cursor-pointer">
                              <span>📄 Replace Word</span>
                              <input type="file" accept=".docx" className="hidden" onChange={async (e) => {
                                const f = e.target.files?.[0]
                                if (f) {
                                  try {
                                    const r = await journalsApi.replaceArticleFile(a.id, f)
                                    toast.success(r.message)
                                    await load()
                                  } catch (err) { toast.error(getApiErrorMessage(err, 'Word replace failed')) }
                                }
                              }} />
                            </label>
                            <label className="w-full px-3 py-1.5 text-left font-medium text-text hover:bg-surface flex items-center justify-between cursor-pointer">
                              <span>🏷️ Replace XML</span>
                              <input type="file" accept=".xml,.jats" className="hidden" onChange={async (e) => {
                                const f = e.target.files?.[0]
                                if (f) {
                                  try {
                                    const r = await journalsApi.replaceArticleFile(a.id, f)
                                    toast.success(r.message)
                                    await load()
                                  } catch (err) { toast.error(getApiErrorMessage(err, 'XML replace failed')) }
                                }
                              }} />
                            </label>
                            <label className="w-full px-3 py-1.5 text-left font-medium text-text hover:bg-surface flex items-center justify-between cursor-pointer">
                              <span>🎨 Replace InDesign</span>
                              <input type="file" accept=".indd,.idml" className="hidden" onChange={async (e) => {
                                const f = e.target.files?.[0]
                                if (f) {
                                  try {
                                    const r = await journalsApi.replaceArticleFile(a.id, f)
                                    toast.success(r.message)
                                    await load()
                                  } catch (err) { toast.error(getApiErrorMessage(err, 'InDesign replace failed')) }
                                }
                              }} />
                            </label>
                            <label className="w-full px-3 py-1.5 text-left font-medium text-text hover:bg-surface flex items-center justify-between cursor-pointer">
                              <span>📑 Replace PDF</span>
                              <input type="file" accept=".pdf" className="hidden" onChange={async (e) => {
                                const f = e.target.files?.[0]
                                if (f) {
                                  try {
                                    const r = await journalsApi.replaceArticleFile(a.id, f)
                                    toast.success(r.message)
                                    await load()
                                  } catch (err) { toast.error(getApiErrorMessage(err, 'PDF replace failed')) }
                                }
                              }} />
                            </label>
                          </div>
                        </div>

                        <Button size="sm" variant="secondary" onClick={() => navigate(`/journal-production/articles/${a.id}`)}>Open</Button>
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/journal-article-editor/${a.id}`)}>Review</Button>
                        <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10" aria-label={`Delete ${a.article_title}`}
                                leftIcon={<Trash2 />} onClick={() => setDeleting(a)}>Delete</Button>
                        {!done && (
                          <Button size="sm" onClick={() => { setBlocked(null); setProceeding(a) }}>Proceed</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload articles */}
      <Modal
        isOpen={uploadOpen}
        onClose={closeUpload}
        size="lg"
        title="Upload articles"
        description={`Each .docx or .zip becomes one article. Metadata (title, DOI, authors, abstract) is read from the manuscript. New articles start at ${journal.stages[0] ?? 'the first stage'}.`}
        footer={uploadResult ? <Button onClick={closeUpload}>Done</Button> : (
          <>
            <Button variant="secondary" onClick={closeUpload}>Cancel</Button>
            <Button onClick={upload} isLoading={uploading} disabled={!files.length}>
              Upload {files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : ''}
            </Button>
          </>
        )}
      >
        {uploadResult ? (
          <div className="space-y-3 text-sm">
            {uploadResult.created.length > 0 && (
              <div>
                <p className="font-medium text-text">Added {uploadResult.created.length}</p>
                <ul className="mt-1 space-y-1">
                  {uploadResult.created.map(c => (
                    <li key={c.id} className="text-muted"><span className="text-green-600">✓</span> {c.article_title} <span className="font-mono text-xs">({c.filename})</span></li>
                  ))}
                </ul>
              </div>
            )}
            {uploadResult.failed.length > 0 && (
              <div>
                <p className="font-medium text-danger">Not added {uploadResult.failed.length}</p>
                <ul className="mt-1 space-y-1">
                  {uploadResult.failed.map(f => (
                    <li key={f.filename} className="text-muted"><span className="font-mono text-xs">{f.filename}</span>: {f.error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <UploadZone accept=".docx,.zip" multiple onFiles={fs => setFiles(prev => [...prev, ...fs])} isUploading={uploading}
                        label="Drop manuscripts or article packages here" />
            {files.length > 0 && (
              <ul className="text-sm space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3">
                    <span className="truncate">{f.name}</span>
                    <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>

      {/* Delete article */}
      <Modal
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete article"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} isLoading={deleteBusy}>Delete article</Button>
          </>
        }
      >
        {deleting && (
          <div className="space-y-2 text-sm">
            <p className="font-medium text-text">{deleting.article_title}</p>
            <p className="text-muted">
              This permanently deletes the article: its stages, check results and findings, the uploaded manuscript,
              the working copy, every XHTML/XML/InDesign/proof version and its art files. It cannot be undone.
            </p>
          </div>
        )}
      </Modal>

      {/* Proceed to next stage */}
      <Modal
        isOpen={!!proceeding}
        onClose={() => setProceeding(null)}
        title="Complete stage"
        footer={
          <>
            <Button variant="secondary" onClick={() => setProceeding(null)}>{blocked ? 'Close' : 'Cancel'}</Button>
            {blocked ? (
              <Button onClick={() => proceeding && navigate(`/journal-article-editor/${proceeding.id}`)}>Open article</Button>
            ) : (
              <Button onClick={proceed} isLoading={proceedBusy}>
                {proceeding && nextStageOf(proceeding) ? `Move to ${shortStage(nextStageOf(proceeding)!)}` : 'Complete workflow'}
              </Button>
            )}
          </>
        }
      >
        {proceeding && (
          <div className="space-y-3 text-sm">
            <p className="text-text font-medium">{proceeding.article_title}</p>
            <p className="text-muted">
              Complete <strong className="text-text">{proceeding.current_stage}</strong>
              {nextStageOf(proceeding) ? <> and move to <strong className="text-text">{nextStageOf(proceeding)}</strong>.</> : ' and finish the workflow.'}
            </p>
            {blocked && (
              <div className="rounded-md border border-danger/30 bg-danger/5 p-3" role="alert">
                <p className="font-medium text-danger">{blocked.message}</p>
                {blocked.issues.length > 0 && (
                  <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                    {blocked.issues.map(i => (
                      <li key={i.id} className="text-xs text-text">
                        <span className="font-mono text-muted">{i.rule_id}</span> {i.title}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
