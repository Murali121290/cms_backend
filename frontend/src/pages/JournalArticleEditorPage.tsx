import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { journalReviewPath, type BookReviewKind } from '@/features/journals/useJournalReviewMode'
import { ArrowLeft, Check, Crosshair, Play, Search } from 'lucide-react'
import { journalsApi, type ArticleWorkspace, type JournalIssue, type JournalCheckModule, type PreEditingStepKey } from '@/api/journals'
import { WysiwygEditor, type WysiwygEditorHandle } from '@/features/editor'
import type { Occurrence } from '@/features/editor/OccurrenceHighlight'
import { StylesPanel } from '@/features/structuringReview/components/EditorStylesPanel'
import { useSessionStore } from '@/stores/sessionStore'
import { getApiErrorMessage } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'
import { cn } from '@/utils/cn'
import { STAGE, advanceError, shortStage } from './journals/journalUi'
import { ArticleFilesPanel } from './journals/ArticleFilesPanel'
import { JatsXmlEditor } from '@/features/journals/JatsXmlEditor'
import { PreEditingSteps } from '@/features/journals/PreEditingSteps'

const CHECKS: { key: JournalCheckModule; name: string; stage: number }[] = [
  { key: 'structuring', name: 'Structuring', stage: STAGE.PRE_EDITING },
  { key: 'references', name: 'Reference validation', stage: STAGE.PRE_EDITING },
  { key: 'ia_rules', name: 'IA rules', stage: STAGE.PRE_EDITING },
  { key: 'technical', name: 'Technical checks', stage: STAGE.PRE_EDITING },
  { key: 'language', name: 'Language editing', stage: STAGE.LANGUAGE },
  { key: 'xml', name: 'XML & DTD validation', stage: STAGE.XML },
  { key: 'indesign_qc', name: 'InDesign final QC', stage: STAGE.INDESIGN_QC },
  { key: 'proof', name: 'Proof approval', stage: STAGE.PROOF },
]
const CHECK_NAME = Object.fromEntries(CHECKS.map(c => [c.key, c.name])) as Record<string, string>
const SEVERITY_BADGE = { error: 'error', warning: 'warning', info: 'info' } as const
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const
// Paragraph styles offered in the PARA panel besides those already in the manuscript.
const JOURNAL_STYLES = [
  'Title', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Normal', 'Abstract', 'Keywords',
  'Caption', 'Figure Caption', 'Table Title', 'Reference', 'List Paragraph',
]

type Loc = { para_idx?: number; start?: number; end?: number; surface?: string }
const locOf = (i: JournalIssue) => (i.location ?? {}) as Loc

export function JournalArticleEditorPage() {
  const { articleId } = useParams<{ articleId: string }>()
  const id = Number(articleId)
  const editorRef = useRef<WysiwygEditorHandle>(null)
  const currentUser = useSessionStore(s => s.viewer)?.username

  const [ws, setWs] = useState<ArticleWorkspace | null>(null)
  const [issues, setIssues] = useState<JournalIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [stageBusy, setStageBusy] = useState(false)
  const [blocked, setBlocked] = useState<{ message: string; issues: JournalIssue[] } | null>(null)
  const [trackChanges, setTrackChanges] = useState(true)
  const [customStyles, setCustomStyles] = useState<string[]>([])

  // Findings checklist filters
  const [moduleFilter, setModuleFilter] = useState<'all' | JournalCheckModule>('all')
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const { hash } = useLocation()
  const [sideTab, setSideTab] = useState<'checks' | 'styles' | 'files'>(hash === '#files' ? 'files' : 'checks')

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) { setNotFound(true); setLoading(false); return }
    try {
      const [w, open] = await Promise.all([journalsApi.getWorkspace(id), journalsApi.getIssues(id, { issue_status: 'open' })])
      setWs(w)
      setIssues(open)
    } catch (err) {
      setNotFound(true)
      toast.error(getApiErrorMessage(err, 'Could not load this article'))
    } finally {
      setLoading(false)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  const stageNo = useMemo(() => Number.parseInt(ws?.article.current_stage ?? '1', 10) || 1, [ws])

  const styles = useMemo(() => {
    const inDoc = new Set<string>()
    for (const m of (ws?.xhtml?.content ?? '').matchAll(/data-style-label="([^"]+)"/g)) inDoc.add(m[1])
    return [...new Set([...JOURNAL_STYLES, ...inDoc, ...customStyles])].sort()
  }, [ws, customStyles])

  // Findings that point at exact text become highlighted occurrences in the editor.
  const { occurrences, occIndexByIssue, issueByOcc } = useMemo(() => {
    const occ: Occurrence[] = []
    const byIssue = new Map<number, number>()
    const byOcc: number[] = []
    for (const i of issues) {
      const l = locOf(i)
      if (l.para_idx === undefined || l.start === undefined || l.end === undefined || !l.surface) continue
      byIssue.set(i.id, occ.length)
      byOcc.push(i.id)
      occ.push({ para_index: l.para_idx, match_start: l.start, match_end: l.end, surface: l.surface, category: i.severity })
    }
    return { occurrences: occ, occIndexByIssue: byIssue, issueByOcc: byOcc }
  }, [issues])

  const counts = useMemo(() => {
    const byModule: Record<string, number> = {}
    const bySeverity = { error: 0, warning: 0, info: 0 }
    for (const i of issues) {
      byModule[i.module] = (byModule[i.module] ?? 0) + 1
      bySeverity[i.severity] += 1
    }
    return { byModule, bySeverity }
  }, [issues])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return issues
      .filter(i => moduleFilter === 'all' || i.module === moduleFilter)
      .filter(i => severityFilter === 'all' || i.severity === severityFilter)
      .filter(i => !q || `${i.rule_id} ${i.title} ${i.context_snippet ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (locOf(a).para_idx ?? 1e9) - (locOf(b).para_idx ?? 1e9))
  }, [issues, moduleFilter, severityFilter, query])

  // ── Actions ────────────────────────────────────────────────────────────────
  // ── Pre-Editing steps (Structuring → References → IA rules → Technical), finished one by one ──
  const [stepBusy, setStepBusy] = useState<PreEditingStepKey | null>(null)
  const [selectedStep, setSelectedStep] = useState<PreEditingStepKey | null>(null)
  const stepLabel = (key: PreEditingStepKey) => ws?.pre_editing.steps.find(s => s.key === key)?.label ?? key

  const runStep = useCallback(async (key: PreEditingStepKey) => {
    setStepBusy(key)
    if (key === 'structuring') setRunning(true)
    try {
      const r = await journalsApi.runStep(id, key)
      const st = r.pre_editing.steps.find(s => s.key === key)
      const e = st?.open.error ?? 0
      const w = st?.open.warning ?? 0
      toast.success(`${st?.label ?? key} ran: ${e} error${e === 1 ? '' : 's'}, ${w} warning${w === 1 ? '' : 's'}`)
      setSelectedStep(key)
      setModuleFilter(st?.module ?? 'all')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'The step failed'))
    } finally {
      await load()
      setStepBusy(null)
      setRunning(false)
    }
  }, [id, load])
  const runPreEditing = () => runStep('structuring')

  const finishStep = async (key: PreEditingStepKey, opts: { acceptWarnings?: boolean; runNext?: boolean }) => {
    try {
      const state = await journalsApi.finishStep(id, key, !!opts.acceptWarnings)
      const next = state.steps[state.steps.findIndex(s => s.key === key) + 1]
      toast.success(`${stepLabel(key)} finished`)
      if (next && opts.runNext && next.status === 'ready') {
        await runStep(next.key)
        return
      }
      if (next) {
        setSelectedStep(next.key)
        setModuleFilter(next.module)
      }
      await load()
    } catch (err) {
      toast.error(getApiErrorMessage(err, `Could not finish ${stepLabel(key)}`))
      await load()
    }
  }

  const reopenStep = async (key: PreEditingStepKey) => {
    try {
      await journalsApi.reopenStep(id, key)
      toast.success(`${stepLabel(key)} reopened. The steps after it stay locked until it is finished again.`)
      await load()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not reopen the step'))
    }
  }

  // Structuring starts by itself: run it when the article opens and it never ran; if the upload
  // already started it, poll until it finishes.
  const autoStarted = useRef(false)
  const preState = ws?.pre_editing
  const structuring = preState?.steps[0]
  useEffect(() => {
    if (!preState?.applies || !structuring || autoStarted.current) return
    if (structuring.status === 'ready' && !structuring.ran) {
      autoStarted.current = true
      void runStep('structuring')
    }
  }, [preState?.applies, structuring, runStep])
  useEffect(() => {
    if (structuring?.status !== 'running' || stepBusy) return
    const t = window.setInterval(async () => {
      const state = await journalsApi.getPreEditing(id).catch(() => null)
      if (state && state.steps[0].status !== 'running') {
        window.clearInterval(t)
        await load()
      }
    }, 3000)
    return () => window.clearInterval(t)
  }, [structuring?.status, stepBusy, id, load])
  useEffect(() => {
    if (preState && selectedStep === null) {
      const key = preState.current_step ?? 'technical'
      setSelectedStep(key)
      if (preState.applies) setModuleFilter(preState.steps.find(s => s.key === key)?.module ?? 'all')
    }
  }, [preState, selectedStep])

  const saveEdits = async (html: string) => {
    setSaving(true)
    try {
      const r = await journalsApi.saveXhtml(id, html)
      const errs = (r.open_issues.structuring?.error ?? 0) + (r.open_issues.references?.error ?? 0)
      toast.success(`Saved as version ${r.xhtml_version}. Checks re-run: ${errs ? `${errs} error${errs > 1 ? 's' : ''} open` : 'no errors'}.`)
      await load()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not save your edits'))
      throw err
    } finally {
      setSaving(false)
    }
  }

  const goTo = (issue: JournalIssue) => {
    setSelectedId(issue.id)
    if (occIndexByIssue.has(issue.id)) return // the editor scrolls to the selected occurrence
    const idx = locOf(issue).para_idx
    const root = editorRef.current?.editor?.view.dom as HTMLElement | undefined
    const el = idx !== undefined && root ? root.querySelector<HTMLElement>(`[data-para-idx="${idx}"]`) : null
    if (!el) {
      if (issue.module === 'xml' || idx === undefined) toast.error('This finding has no position in the manuscript text')
      return
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('journal-issue-flash')
    window.setTimeout(() => el.classList.remove('journal-issue-flash'), 1800)
  }

  const resolve = async (issue: JournalIssue, action: 'accept' | 'ignore') => {
    try {
      await journalsApi.updateIssue(id, issue.id, action)
      setIssues(prev => prev.filter(i => i.id !== issue.id))
      const w = await journalsApi.getWorkspace(id)
      setWs(w)
    } catch (err) {
      // 409: a save re-ran the checks and replaced this finding; show the current list instead.
      if ((err as { response?: { status?: number } })?.response?.status === 409) {
        toast.error('The checks were re-run after your last save. The findings list has been refreshed.')
        await load()
        return
      }
      toast.error(getApiErrorMessage(err, 'Could not update the finding'))
    }
  }

  /** Apply a replace suggestion to the text (as a tracked change when TC is on), then mark it accepted. */
  const applyFix = async (issue: JournalIssue) => {
    const idx = occIndexByIssue.get(issue.id)
    const to = issue.suggestion?.to
    if (idx === undefined || to === undefined || !editorRef.current) return
    const ok = editorRef.current.replaceOccurrence(occurrences[idx], to, { asTrackChanges: trackChanges })
    if (ok === false) {
      toast.error('The text has changed; edit it by hand, then save')
      return
    }
    await resolve(issue, 'accept')
    toast.success('Fix applied in the editor. Save to write it to the manuscript.')
  }

  const navigate = useNavigate()
  /** Open the book Structuring / Technical / Language review page on this article's working copy. */
  const openBookReview = async (kind: BookReviewKind) => {
    try {
      const { file_id, project_id } = await journalsApi.ensureReviewFile(id)
      navigate(journalReviewPath(kind, project_id, file_id, id, ws?.journal?.id))
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not open the review page'))
    }
  }

  const [refReport, setRefReport] = useState<number | null>(null)
  // Main view: the WYSIWYG XHTML editor, or (once converted) the JATS XML source editor.
  const [view, setView] = useState<'xhtml' | 'xml'>(hash === '#xml' ? 'xml' : 'xhtml')
  const [jatsVersion, setJatsVersion] = useState(0)
  const stageAction = async (kind: 'jats' | 'indesign' | 'indesign-status' | 'references' | 'references-status') => {
    setStageBusy(true)
    try {
      if (kind === 'references') {
        const r = await journalsApi.processReferences(id)
        toast.success(`Reference processing started (${r.engine === 'pph' ? 'PPH server' : 'local'}). Use "Reference status" to see the result.`)
      } else if (kind === 'references-status') {
        const s = await journalsApi.getReferenceStatus(id)
        setRefReport(s.qa_report?.id ?? s.reports[0]?.id ?? null)
        toast.success(s.status ? `References: ${s.status}` : 'Reference processing has not run yet')
        setModuleFilter('references')
      } else if (kind === 'jats') {
        const r = await journalsApi.convertToJats(id)
        const errors = r.open_issues.xml?.error ?? 0
        toast.success(`JATS XML v${r.file.version} created (${r.converter === 'xslt-server' ? 'XSLT server' : 'built-in converter'}). ${errors ? `${errors} DTD error${errors > 1 ? 's' : ''} to fix.` : 'Valid against the JATS 1.3 DTD.'}`)
        if (r.fallback_reason) toast.error(`XSLT server not used: ${r.fallback_reason}`)
        setModuleFilter('xml')
        setJatsVersion(r.file.version)
        setView('xml')
      } else if (kind === 'indesign') {
        await journalsApi.generateInDesign(id)
        toast.success('InDesign generation started. Use "Check InDesign status" in a few minutes.')
      } else {
        const s = await journalsApi.getInDesignStatus(id)
        toast.success(s.status ?? 'No InDesign job has run yet')
        setModuleFilter('indesign_qc')
      }
      await load()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'The stage action failed'))
    } finally {
      setStageBusy(false)
    }
  }

  const advance = async () => {
    setAdvancing(true)
    setBlocked(null)
    try {
      const res = await journalsApi.advanceStage(id)
      toast.success(res.new_stage ? `Moved to ${shortStage(res.new_stage)}` : 'Article completed its workflow')
      await load()
    } catch (err) {
      setBlocked(advanceError(err))
    } finally {
      setAdvancing(false)
    }
  }

  // Keep the selected card in view when a highlight is clicked in the editor.
  useEffect(() => {
    if (selectedId !== null) document.getElementById(`finding-${selectedId}`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (loading) return <FullPageSpinner />
  if (notFound || !ws) return <EmptyState title="Article not found" description="Check the link, or open the article from its journal." />

  const { article, journal } = ws
  const done = article.status === 'Completed'
  const selectedOcc = selectedId !== null ? occIndexByIssue.get(selectedId) : undefined
  const modulesWithIssues = CHECKS.filter(c => counts.byModule[c.key])
  const xmlView = view === 'xml' && !!ws.jats
  const editorHeight = ws.jats ? 'calc(100vh - 152px)' : 'calc(100vh - 118px)'

  const sidePanel = (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex gap-1 p-2 border-b border-border">
        {(['checks', 'styles', 'files'] as const).map(t => (
          <button key={t} type="button" onClick={() => setSideTab(t)} aria-pressed={sideTab === t}
                  className={cn('px-3 py-1 rounded-full text-xs font-semibold capitalize', sideTab === t ? 'bg-primary text-white' : 'text-muted hover:text-text')}>
            {t}
          </button>
        ))}
      </div>
      {sideTab === 'files' ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ArticleFilesPanel articleId={id} settingsHref={journal ? `/journal-production/journals/${journal.id}/settings#style` : undefined} />
        </div>
      ) : sideTab === 'styles' ? (
        <div className="flex-1 min-h-0">
          <StylesPanel styles={styles} editorRef={editorRef}
                       onAddStyle={s => setCustomStyles(prev => prev.includes(s) ? prev : [...prev, s])} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {(['error', 'warning', 'info'] as const).map(s => (
              <button key={s} type="button" onClick={() => setSeverityFilter(severityFilter === s ? 'all' : s)}
                      className={cn('rounded-lg border p-2 text-left', severityFilter === s ? 'border-primary' : 'border-border')}>
                <div className={cn('text-xl font-semibold tabular-nums', s === 'error' ? 'text-danger' : s === 'warning' ? 'text-amber-600' : 'text-primary')}>
                  {counts.bySeverity[s]}
                </div>
                <div className="text-[11px] uppercase tracking-wide text-muted">{s === 'info' ? 'Suggestions' : `${s}s`}</div>
              </button>
            ))}
          </div>
          {CHECKS.filter(c => ws.stages.some(s => s.stage_number === c.stage) || ws.check_runs[c.key]).map(c => {
            const oc = ws.open_issues[c.key]
            const run = ws.check_runs[c.key]
            return (
              <button key={c.key} type="button" onClick={() => setModuleFilter(moduleFilter === c.key ? 'all' : c.key)}
                      className={cn('w-full text-left rounded-md border px-3 py-2 text-xs', moduleFilter === c.key ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text text-sm">{c.name}</span>
                  <span className="flex gap-1">
                    {oc?.error ? <Badge variant="error" size="sm">{oc.error}</Badge> : null}
                    {oc?.warning ? <Badge variant="warning" size="sm">{oc.warning}</Badge> : null}
                    {!oc?.error && !oc?.warning && run?.status === 'Completed' ? <Badge variant="success" size="sm">✓</Badge> : null}
                  </span>
                </div>
                <div className="text-muted mt-0.5">
                  {c.stage === STAGE.PRE_EDITING ? 'Pre-Editing' : `Stage ${c.stage}`} · {run ? (run.status === 'Failed' ? 'Last run failed' : `${run.rules_passed} of ${run.rules_total} rules passed`) : 'Not run yet'}
                </div>
              </button>
            )
          })}
          <div className="text-xs text-muted space-y-1 border-t border-border pt-3">
            <p>Style sheet: {journal ? <Link className="text-primary hover:underline" to={`/journal-production/journals/${journal.id}/settings#style`}>{ws.stylesheet ?? 'None set'}</Link> : ws.stylesheet ?? 'None set'}</p>
            <p>Grammar sheet: {journal ? <Link className="text-primary hover:underline" to={`/journal-production/journals/${journal.id}/settings#grammar`}>{ws.grammarsheet ?? 'None set'}</Link> : ws.grammarsheet ?? 'None set'}</p>
            <p>Edits are saved into an edited copy of the manuscript{trackChanges ? ' as tracked changes' : ''}. The original upload is kept.</p>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col h-screen bg-background text-text overflow-hidden">
      <style>{`.journal-issue-flash{outline:2px solid rgb(245 158 11);outline-offset:4px;border-radius:2px;transition:outline-color .6s}`}</style>

      {/* Header */}
      <header className="bg-card border-b border-border px-4 py-2.5 flex flex-wrap items-center gap-3">
        <Link to={`/journal-production/articles/${id}`}
              className="size-8 rounded-full border border-border flex items-center justify-center text-muted hover:text-text"
              aria-label="Back to the article files" title="Back to the article files">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 mr-auto">
          <p className="text-[11px] text-muted">{journal?.journal_code} / Article #{article.id}</p>
          <h1 className="text-sm font-semibold truncate max-w-[640px]">{article.article_title}</h1>
        </div>
        {ws.xhtml && (
          <div className="flex items-center gap-1 rounded-md border border-border px-1 py-0.5" role="group" aria-label="Open in book review pages">
            <span className="text-[11px] text-muted px-1">Book review:</span>
            {(['structuring', 'technical', 'language'] as const).map(kind => (
              <Button key={kind} variant="ghost" size="sm" className="capitalize" onClick={() => openBookReview(kind)}>{kind}</Button>
            ))}
          </div>
        )}
        {stageNo === STAGE.PRE_EDITING && !done && ws.xhtml && ws.pre_editing.steps[1]?.status !== 'locked' && (
          <>
            <Button variant="secondary" size="sm" onClick={() => stageAction('references')} isLoading={stageBusy}>Process references</Button>
            <Button variant="ghost" size="sm" onClick={() => stageAction('references-status')}>Reference status</Button>
            {refReport !== null && (
              <a href={journalsApi.fileUrl(id, refReport, true)} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">
                Reference report
              </a>
            )}
          </>
        )}
        {stageNo === STAGE.XML && !done && (
          <Button variant="secondary" size="sm" onClick={() => stageAction('jats')} isLoading={stageBusy}>Convert to JATS XML</Button>
        )}
        {stageNo === STAGE.INDESIGN && !done && (
          <>
            <Button variant="secondary" size="sm" onClick={() => stageAction('indesign')} isLoading={stageBusy}>Generate InDesign</Button>
            <Button variant="ghost" size="sm" onClick={() => stageAction('indesign-status')}>Check InDesign status</Button>
          </>
        )}
        {stageNo >= STAGE.INDESIGN_QC && (
          <a href={journalsApi.proofUrl(id)} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">
            Download proof PDF
          </a>
        )}
        {!done && (
          <Button size="sm" onClick={advance} isLoading={advancing}
                  disabled={stageNo === STAGE.PRE_EDITING && ws.pre_editing.applies && !ws.pre_editing.all_finished}
                  title={stageNo === STAGE.PRE_EDITING && !ws.pre_editing.all_finished ? 'Finish all 4 Pre-Editing steps first' : undefined}>
            Complete {shortStage(article.current_stage)}
          </Button>
        )}
      </header>

      {/* Workflow stages */}
      <ol className="bg-card border-b border-border px-4 py-1.5 flex gap-1 overflow-x-auto" aria-label="Workflow stages">
        {ws.stages.map(s => {
          const isDone = s.stage_status === 'Completed'
          const current = !isDone && s.stage_name === article.current_stage
          return (
            <li key={s.stage_number} aria-current={current ? 'step' : undefined}
                className={cn('flex items-center gap-1.5 text-xs px-3 py-1 rounded-md whitespace-nowrap',
                  current ? 'bg-amber-500/10 text-amber-700 font-semibold' : isDone ? 'text-green-600' : 'text-muted')}>
              <span className={cn('size-4 rounded-full flex items-center justify-center text-[10px]',
                isDone ? 'bg-green-600 text-white' : current ? 'bg-amber-500 text-white' : 'bg-border')}>
                {isDone ? <Check className="size-2.5" /> : s.stage_number}
              </span>
              {shortStage(s.stage_name)}
            </li>
          )
        })}
      </ol>

      {ws.working_copy_changed && (
        <div className="mx-4 mt-2 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm flex items-center gap-3" role="status">
          <p className="text-amber-800">The manuscript was changed in a book review page. Refresh to load those changes and re-run the checks.</p>
          <Button size="sm" className="ml-auto" onClick={runPreEditing} isLoading={running}>Refresh</Button>
        </div>
      )}

      {blocked && (
        <div className="mx-4 mt-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm flex items-center gap-3" role="alert">
          <p className="font-medium text-danger">{blocked.message}</p>
          {blocked.issues.length > 0 && (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setSeverityFilter('error'); setModuleFilter('all') }}>
              Show the {blocked.issues.length} blocking error{blocked.issues.length > 1 ? 's' : ''}
            </button>
          )}
          <button type="button" className="ml-auto text-xs text-muted" onClick={() => setBlocked(null)}>Dismiss</button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Findings checklist */}
        <aside className="w-[340px] shrink-0 bg-card border-r border-border flex flex-col min-h-0 overflow-y-auto">
          {stageNo === STAGE.PRE_EDITING && ws.pre_editing.applies && selectedStep && (
            <PreEditingSteps state={ws.pre_editing} selected={selectedStep} busy={stepBusy}
                             onSelect={key => { setSelectedStep(key); setModuleFilter(ws.pre_editing.steps.find(s => s.key === key)?.module ?? 'all') }}
                             onRun={runStep} onFinish={finishStep} onReopen={reopenStep} />
          )}
          <div className="p-3 space-y-2 border-b border-border">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-text">Findings checklist</p>
              <span className="rounded-full bg-surface px-2 text-xs tabular-nums">{issues.length}</span>
            </div>
            <label className="relative block">
              <span className="sr-only">Search findings</span>
              <Search className="size-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search findings or rules…"
                     className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-xs outline-none focus:ring-2 focus:ring-primary/30" />
            </label>
            <div className="flex flex-wrap gap-1">
              <button type="button" onClick={() => setModuleFilter('all')}
                      className={cn('px-2 py-0.5 rounded text-[11px] font-semibold', moduleFilter === 'all' ? 'bg-text text-card' : 'bg-surface text-muted')}>
                ALL ({issues.length})
              </button>
              {modulesWithIssues.map(c => (
                <button key={c.key} type="button" onClick={() => setModuleFilter(c.key)}
                        className={cn('px-2 py-0.5 rounded text-[11px] font-semibold uppercase', moduleFilter === c.key ? 'bg-text text-card' : 'bg-surface text-muted')}>
                  {c.name.split(' ')[0]} ({counts.byModule[c.key]})
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 rounded-md bg-surface p-0.5 text-[11px]">
              {(['all', 'error', 'warning', 'info'] as const).map(s => (
                <button key={s} type="button" onClick={() => setSeverityFilter(s)}
                        className={cn('py-1 rounded capitalize', severityFilter === s ? 'bg-card shadow-sm font-semibold text-text' : 'text-muted')}>
                  {s === 'info' ? 'Hints' : s === 'all' ? 'All' : `${s}s`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {visible.length === 0 ? (
              <p className="text-xs text-muted text-center py-8">
                {issues.length ? 'No findings match these filters.' : ws.xhtml ? 'No open findings. Complete the stage when you are ready.' : 'Run pre-editing to check the manuscript.'}
              </p>
            ) : visible.map(i => {
              const l = locOf(i)
              const selected = selectedId === i.id
              const canApply = i.suggestion?.type === 'replace' && occIndexByIssue.has(i.id)
              return (
                <article key={i.id} id={`finding-${i.id}`}
                         className={cn('rounded-lg border bg-card p-3 space-y-1.5 border-l-4 text-xs cursor-pointer',
                           i.severity === 'error' ? 'border-l-red-500' : i.severity === 'warning' ? 'border-l-amber-500' : 'border-l-blue-500',
                           selected ? 'ring-2 ring-primary/40 border-primary' : 'border-border')}
                         onClick={() => goTo(i)}>
                  <div className="flex items-center gap-2">
                    <span className="font-bold uppercase text-[10px] tracking-wide text-text">{CHECK_NAME[i.module] ?? i.module}</span>
                    <span className="font-mono text-muted">{i.rule_id}</span>
                    <span className="ml-auto text-muted">{l.para_idx !== undefined ? `Para ${l.para_idx}` : (i.location as { xml_line?: number } | undefined)?.xml_line ? `Line ${(i.location as { xml_line?: number }).xml_line}` : ''}</span>
                  </div>
                  <p className="font-semibold text-text text-[13px] leading-snug">{i.title}</p>
                  {i.context_snippet && (
                    <p className="text-muted break-words">
                      {l.surface && i.context_snippet.includes(l.surface) ? (
                        <>
                          {i.context_snippet.split(l.surface)[0]}
                          <mark className="bg-amber-200/70 text-text rounded px-0.5">{l.surface}</mark>
                          {i.context_snippet.split(l.surface).slice(1).join(l.surface)}
                        </>
                      ) : i.context_snippet}
                    </p>
                  )}
                  {i.suggestion?.to && i.suggestion.type !== 'signoff' && (
                    <p className="text-muted">
                      {i.suggestion.type === 'retag' ? 'Retag as ' : 'Suggested: '}
                      <strong className="text-green-700">{i.suggestion.to}</strong>
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5 pt-1" onClick={e => e.stopPropagation()}>
                    {canApply && <Button size="sm" onClick={() => applyFix(i)}>Apply fix</Button>}
                    {i.suggestion?.type === 'retag' ? (
                      <Button size="sm" variant="secondary" onClick={() => { goTo(i); setSideTab('styles') }}>Retag in Styles</Button>
                    ) : null}
                    <Button size="sm" variant="secondary" onClick={() => resolve(i, 'accept')}>
                      {i.suggestion?.type === 'signoff' ? 'Sign off' : 'Mark fixed'}
                    </Button>
                    {l.para_idx !== undefined && (
                      <Button size="sm" variant="ghost" leftIcon={<Crosshair />} onClick={() => goTo(i)}>Go to</Button>
                    )}
                    {i.severity !== 'error' && <Button size="sm" variant="ghost" onClick={() => resolve(i, 'ignore')}>Ignore</Button>}
                  </div>
                </article>
              )
            })}
          </div>
        </aside>

        {/* Editor */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          {ws.jats && (
            <div className="flex items-center gap-1 bg-slate-900 px-3 pt-1.5 shrink-0" role="tablist" aria-label="Article view">
              {([['xhtml', 'WYSIWYG XHTML'], ['xml', 'JATS XML Source']] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={xmlView === (key === 'xml')}
                        onClick={() => setView(key)}
                        className={cn('px-4 py-1.5 text-xs font-semibold rounded-t-md border-b-2',
                          xmlView === (key === 'xml') ? 'bg-white text-slate-900 border-blue-500' : 'text-slate-300 border-transparent hover:text-white')}>
                  {label}{key === 'xml' ? ` · v${ws.jats!.version}` : ''}
                </button>
              ))}
              {(ws.open_issues.xml?.error ?? 0) > 0 && (
                <span className="ml-2 rounded-full bg-red-500/20 text-red-300 px-2 text-[11px]">{ws.open_issues.xml!.error} DTD error{ws.open_issues.xml!.error > 1 ? 's' : ''}</span>
              )}
            </div>
          )}
          {xmlView ? (
            <JatsXmlEditor articleId={id} version={jatsVersion} height={editorHeight} onSaved={load} />
          ) : ws.xhtml ? (
            <WysiwygEditor
              ref={editorRef}
              key={`${id}-${ws.xhtml.file.version}`}
              initialContent={ws.xhtml.content}
              onSave={saveEdits}
              isSaving={saving}
              saveLabel="Save edits to DOCX"
              documentTitle={ws.xhtml.file.filename}
              height={editorHeight}
              styles={styles}
              onAddStyle={s => setCustomStyles(prev => prev.includes(s) ? prev : [...prev, s])}
              trackChangesEnabled={trackChanges}
              onTrackChangesToggle={setTrackChanges}
              currentUser={currentUser}
              occurrences={occurrences}
              selectedOccurrenceIndex={selectedOcc}
              onOccurrenceClick={idx => setSelectedId(issueByOcc[idx] ?? null)}
              sidePanel={sidePanel}
            />
          ) : running || stepBusy === 'structuring' || structuring?.status === 'running' ? (
            <EmptyState
              title="Structuring the manuscript…"
              description="Started automatically. Paragraph styles, front matter and headings are being applied to the working copy; the manuscript and its findings appear here when it finishes."
            />
          ) : (
            <EmptyState
              title="No XHTML yet"
              description={structuring?.status === 'failed' ? `Structuring failed: ${structuring.error ?? 'unknown error'}` : 'Structure the manuscript to convert it to XHTML and see its findings.'}
              action={<Button leftIcon={<Play />} onClick={runPreEditing} isLoading={running}>{structuring?.status === 'failed' ? 'Retry structuring' : 'Run structuring'}</Button>}
            />
          )}
        </main>
      </div>
    </div>
  )
}
