import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ChevronRight,
  Calendar, Clock, Zap, BookOpen, AlertCircle, CheckCircle2,
  RotateCcw, Layers, User,
} from 'lucide-react'
import { projectsApi } from '@/api/projects'
import type { Project } from '@/api/projects'
import { chaptersApi } from '@/api/chapters'
import type { Chapter } from '@/api/chapters'
import { workflowsApi } from '@/api/workflows'
import type { WorkflowStage } from '@/api/workflows'
import { usersApi } from '@/api/users'
import type { User as AppUser } from '@/api/users'
import { stageDetailsApi } from '@/api/stageDetails'
import { toast } from '@/store/useToastStore'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'

// ── Helpers ────────────────────────────────────────────────────────────────────

function orderStages(stages: WorkflowStage[]): WorkflowStage[] {
  const byName = new Map(stages.map(s => [s.stage_name, s]))
  const first  = stages.find(s => !s.previous_stage)
  if (!first) return stages
  const result: WorkflowStage[] = []
  const visited = new Set<string>()
  let cur: WorkflowStage | undefined = first
  while (cur && !visited.has(cur.stage_name)) {
    visited.add(cur.stage_name)
    result.push(cur)
    cur = cur.next_stage ? byName.get(cur.next_stage) : undefined
  }
  stages.forEach(s => { if (!visited.has(s.stage_name)) result.push(s) })
  return result
}

type StageInfo = { due: string; sla: number | null }

function isDelayed(ch: Chapter, plannedDueDates?: Map<string, StageInfo>): boolean {
  if (ch.status === 'complete') return false
  const due = (ch.stage_name && plannedDueDates)
    ? (plannedDueDates.get(`${ch.chapters}||${ch.stage_name}`)?.due ?? ch.due_date)
    : ch.due_date
  return !!due && new Date(due) < new Date()
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function statusMeta(status: string): { cls: string; label: string } {
  switch (status) {
    case 'complete':    return { cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200', label: 'Complete'    }
    case 'In-progress': return { cls: 'bg-amber-50  text-amber-700  border border-amber-200',    label: 'In Progress' }
    case 'Hold':        return { cls: 'bg-slate-50  text-slate-600  border border-slate-200',    label: 'Hold'        }
    case 'In-query':    return { cls: 'bg-blue-50   text-blue-700   border border-blue-200',     label: 'In-query'    }
    default:            return { cls: 'bg-gray-50   text-gray-600   border border-gray-200',     label: status        }
  }
}

function cardBorderCls(ch: Chapter): string {
  if (ch.status === 'complete')   return 'border-l-4 border-l-emerald-500'
  if (isDelayed(ch))              return 'border-l-4 border-l-red-500'
  if (ch.priority === 'Fast Track') return 'border-l-4 border-l-purple-500'
  if (ch.status === 'In-progress')  return 'border-l-4 border-l-amber-400'
  if (ch.status === 'Hold')         return 'border-l-4 border-l-slate-400'
  if (ch.status === 'In-query')     return 'border-l-4 border-l-blue-400'
  return 'border-l-4 border-l-border'
}

// ── Summary Widget ─────────────────────────────────────────────────────────────

function SummaryWidget({ label, value, icon: Icon, iconCls, onClick, active }: {
  label: string; value: number; icon: React.ElementType; iconCls: string
  onClick?: () => void; active?: boolean
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-card rounded-xl border px-4 py-3 flex items-center gap-3 shadow-sm transition-all flex-1 min-w-0 ${
        onClick ? 'cursor-pointer hover:shadow-md' : ''
      } ${active ? 'border-primary ring-1 ring-primary/30' : 'border-border'}`}
    >
      <div className={`p-2 rounded-xl ${iconCls}`}><Icon size={15} /></div>
      <div>
        <p className="text-xl font-bold text-text">{value}</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </div>
  )
}

// ── Workflow Rail ──────────────────────────────────────────────────────────────

function WorkflowRail({ stages, chapters, filterStage, onStageClick }: {
  stages: WorkflowStage[]
  chapters: Chapter[]
  filterStage: string
  onStageClick: (s: string) => void
}) {
  const countByStage = useMemo(() => {
    const m = new Map<string, number>()
    chapters.forEach(c => { if (c.stage_name) m.set(c.stage_name, (m.get(c.stage_name) ?? 0) + 1) })
    return m
  }, [chapters])

  if (stages.length === 0) return null

  return (
    <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-6 py-3">
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
        <Layers size={13} className="text-muted flex-shrink-0 mr-1" />
        {stages.map((stage, i) => {
          const cnt   = countByStage.get(stage.stage_name) ?? 0
          const active = filterStage === stage.stage_name
          return (
            <span key={stage.stage_name} className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => onStageClick(stage.stage_name)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-primary text-white'
                    : 'bg-card border border-border text-text hover:bg-accent'
                }`}
              >
                {/* <span className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center flex-shrink-0 ${
                  active ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
                }`}>{i + 1}</span> */}
                {stage.stage_name}
                {cnt > 0 && (
                  <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${
                    active ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
                  }`}>{cnt}</span>
                )}
              </button>
              {i < stages.length - 1 && <ChevronRight size={10} className="text-muted" />}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ── Chapter Card ───────────────────────────────────────────────────────────────

interface ChapterCardProps {
  chapter: Chapter
  users: AppUser[]
  projectCode: string | null
  plannedDueDates: Map<string, StageInfo>
  onUpdate: (id: number, patch: Partial<Chapter>) => void
  onViewDetails: (chapter: Chapter) => void
}

function ChapterCard({ chapter, users, projectCode, plannedDueDates, onUpdate, onViewDetails }: ChapterCardProps) {
  const [updating, setUpdating] = useState(false)

  const status = statusMeta(chapter.status)

  // Effective due = actual_start + sla (dynamic) or planned_end_date, falling back to chapter.due_date
  const currentInfo = chapter.stage_name ? plannedDueDates.get(`${chapter.chapters}||${chapter.stage_name}`) : undefined
  const effectiveDue: string | null = currentInfo?.due ?? chapter.due_date
  const delayed = !!effectiveDue && chapter.status !== 'complete' && new Date(effectiveDue) < new Date()

  async function handleAssignee(val: string) {
    const assignee = val || null
    setUpdating(true)
    try {
      if (projectCode && chapter.stage_name) {
        await stageDetailsApi.assignToStage(projectCode, chapter.chapters, chapter.stage_name, assignee)
      }
      // When assigning someone, due = now + sla so their window is tracked from today
      let newDue: string | null = chapter.due_date
      if (assignee && currentInfo?.sla) {
        const d = new Date()
        d.setDate(d.getDate() + currentInfo.sla)
        newDue = d.toISOString().split('T')[0]
      }
      const updated = await chaptersApi.update(chapter.id, {
        current_assignee_name: assignee,
        due_date: newDue,
      })
      onUpdate(chapter.id, updated)
    } catch {
      toast.error('Failed to update assignee')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className={`bg-card rounded-xl border border-border shadow-sm flex flex-col overflow-hidden transition-shadow hover:shadow-md ${cardBorderCls(chapter)}`}>

      {/* Header */}
      <div className="px-4 pt-3.5 pb-2.5">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0 cursor-pointer" onClick={() => onViewDetails(chapter)}>
            <p className="text-xs font-bold text-primary uppercase tracking-wide hover:underline">{chapter.chapters}</p>
            <p className="text-sm font-medium text-text mt-0.5 line-clamp-2 leading-snug hover:text-primary transition-colors">
              {chapter.chapter_title || chapter.chapters}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              {chapter.stage_name && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-primary/10 text-primary">
                  {chapter.stage_name}
                </span>
              )}
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
            </div>
            {delayed && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                <AlertCircle size={8} /> Delayed
              </span>
            )}
            {!delayed && Object.keys(chapter.delayed_stages ?? {}).length > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
                <AlertCircle size={8} /> {Object.keys(chapter.delayed_stages!).length} stage{Object.keys(chapter.delayed_stages!).length > 1 ? 's' : ''} delayed
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Fields */}
      <div className="px-4 pb-3 space-y-1.5 text-xs flex-1">

        {/* Assignee + Due date row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <User size={11} className="text-muted flex-shrink-0" />
            <div className="relative flex items-center w-28">
              <select
                value={chapter.current_assignee_name ?? ''}
                onChange={e => handleAssignee(e.target.value)}
                disabled={updating}
                className="text-[11px] bg-background border border-border rounded-md pl-2 pr-5 py-0.5 text-text focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60 appearance-none cursor-pointer w-full truncate"
              >
                <option value="">— Unassigned —</option>
                {users.filter(u => u.active_status).map(u => (
                  <option key={u.id} value={u.user_name}>{u.user_name}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-1.5 text-muted text-[9px]">▾</span>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Calendar size={11} className={delayed ? 'text-red-500' : 'text-muted'} />
            <span className={`text-[11px] ${delayed ? 'text-red-600 font-semibold' : 'text-text'}`}>
              {formatDate(effectiveDue)}
            </span>
          </div>
        </div>
      </div>

      {updating && (
        <div className="px-3 py-2 border-t border-border flex justify-end">
          <Spinner size="sm" />
        </div>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────


export function ProjectWorkflow() {
  const { projectId, clientId } = useParams<{ projectId: string; clientId?: string }>()
  const navigate = useNavigate()
  const id       = Number(projectId)

  const [project,         setProject]         = useState<Project | null>(null)
  const [chapters,        setChapters]        = useState<Chapter[]>([])
  const [workflowStages,  setWorkflowStages]  = useState<WorkflowStage[]>([])
  const [users,           setUsers]           = useState<AppUser[]>([])
  const [plannedDueDates, setPlannedDueDates] = useState<Map<string, StageInfo>>(new Map())
  const [loading,         setLoading]         = useState(true)


  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterStage,    setFilterStage]    = useState('')
  const [filterStatus,   setFilterStatus]   = useState('')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    projectsApi.getById(id)
      .then(async proj => {
        setProject(proj)
        const [chs, stages, usrs, details] = await Promise.all([
          chaptersApi.getByProject(proj.project_code ?? '').catch(() => [] as Chapter[]),
          proj.workflow_name
            ? workflowsApi.getWorkflow(proj.workflow_name).catch(() => [] as WorkflowStage[])
            : Promise.resolve([] as WorkflowStage[]),
          usersApi.list().catch(() => [] as AppUser[]),
          proj.project_code
            ? stageDetailsApi.listByProject(proj.project_code).catch(() => [])
            : Promise.resolve([]),
        ])
        setChapters(chs)
        setWorkflowStages(stages)
        setUsers(usrs)
        // Build lookup: "chapterLabel||stageName" → planned_end_date from stage_details
        // Use planned_end_date as the authoritative due date for each stage.
        // Take the first row that has a planned_end_date (oldest creation wins so planning
        // approval rows are preferred over transition rows that may have null planned_end).
        const sorted = [...details].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        const dueDateMap = new Map<string, StageInfo>()
        for (const d of sorted) {
          if (!d.planned_end_date) continue           // skip rows without a planned date
          const key = `${d.chapters}||${d.stage_name}`
          if (dueDateMap.has(key)) continue           // keep the earliest (planning) row
          const due = d.planned_end_date.split('T')[0]
          dueDateMap.set(key, { due, sla: d.sla })
        }
        setPlannedDueDates(dueDateMap)
      })
      .catch(() => toast.error('Failed to load project'))
      .finally(() => setLoading(false))
  }, [id])

  const orderedStages = useMemo(() => orderStages(workflowStages), [workflowStages])

  const summary = useMemo(() => {
    const total    = chapters.length
    const complete = chapters.filter(c => c.status === 'complete').length
    const inProg   = chapters.filter(c => c.status === 'In-progress').length
    const hold     = chapters.filter(c => c.status === 'Hold').length
    const inQuery  = chapters.filter(c => c.status === 'In-query').length
    const delayed  = chapters.filter(c => isDelayed(c, plannedDueDates)).length
    return { total, complete, inProg, hold, inQuery, delayed }
  }, [chapters, plannedDueDates])

  const assigneeOptions = useMemo(() => {
    const set = new Set(chapters.map(c => c.current_assignee_name).filter(Boolean) as string[])
    return Array.from(set).sort()
  }, [chapters])

  const filtered = useMemo(() => chapters
    .filter(ch => {
      if (filterAssignee && ch.current_assignee_name !== filterAssignee) return false
      if (filterStage    && ch.stage_name             !== filterStage)    return false
      if (filterStatus === '__delayed__' && !isDelayed(ch, plannedDueDates)) return false
      if (filterStatus && filterStatus !== '__delayed__' && ch.status !== filterStatus) return false
      return true
    })
    .sort((a, b) => a.id - b.id)
  , [chapters, filterAssignee, filterStage, filterStatus, plannedDueDates])

  function handleChapterUpdate(id: number, patch: Partial<Chapter>) {
    setChapters(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, ...patch } : c)
      const allDone = updated.length > 0 && updated.every(c => c.status === 'complete')
      if (allDone && project && project.status !== 'Completed') {
        projectsApi.update(project.id, { status: 'Completed' })
          .then(p => setProject(p))
          .catch(() => toast.error('Failed to mark project as Completed'))
      }
      return updated
    })
  }

  const hasFilters = filterAssignee || filterStage || filterStatus

  if (loading) return <FullPageSpinner />
  if (!project) return (
    <div className="flex flex-col items-center justify-center h-64 text-muted">
      <AlertCircle size={32} className="mb-2 opacity-40" />
      <p>Project not found</p>
    </div>
  )

  return (
    <div className="flex flex-col min-h-full relative">

      {/* ── Page Header ── */}
      <div className="px-6 py-4 border-b border-border bg-background flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors mt-0.5 flex-shrink-0"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-text">
                {project.project_title || project.project_code || `Project #${project.id}`}
              </h1>
              {project.status && (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusMeta(project.status).cls}`}>
                  {project.status}
                </span>
              )}
              {project.priority === 'Fast Track' && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                  <Zap size={10} /> Fast Track
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-muted">
              {project.project_code && <span>{project.project_code}</span>}
              {project.workflow_name && (
                <span className="inline-flex items-center gap-1">
                  <Layers size={11} /> {project.workflow_name}
                </span>
              )}
              {project.project_manager && (
                <span className="inline-flex items-center gap-1">
                  <User size={11} /> PM: {project.project_manager}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Chapter counts */}
        <div className="flex items-center gap-3 flex-shrink-0 text-xs text-muted">
          <span className="flex items-center gap-1">
            <BookOpen size={12} /> {summary.total} chapters
          </span>
          {summary.complete > 0 && (
            <span className="flex items-center gap-1 text-emerald-600">
              <CheckCircle2 size={12} /> {summary.complete} done
            </span>
          )}
        </div>
      </div>

      {/* ── Sticky Workflow Rail ── */}
      <WorkflowRail
        stages={orderedStages}
        chapters={chapters}
        filterStage={filterStage}
        onStageClick={s => setFilterStage(prev => prev === s ? '' : s)}
      />

      <div className="flex-1 px-6 py-5 space-y-5">

        {/* ── Summary Widgets ── */}
        <div className="flex flex-wrap gap-3">
          <SummaryWidget label="Total"       value={summary.total}    icon={BookOpen}     iconCls="bg-blue-50    text-blue-600"    onClick={() => setFilterStatus('')}              active={filterStatus === ''}           />
          <SummaryWidget label="Completed"   value={summary.complete} icon={CheckCircle2} iconCls="bg-emerald-50 text-emerald-600" onClick={() => setFilterStatus(prev => prev === 'complete'    ? '' : 'complete')}    active={filterStatus === 'complete'}    />
          <SummaryWidget label="In Progress" value={summary.inProg}   icon={RotateCcw}    iconCls="bg-amber-50   text-amber-600"   onClick={() => setFilterStatus(prev => prev === 'In-progress' ? '' : 'In-progress')} active={filterStatus === 'In-progress'} />
          {summary.hold    > 0 && <SummaryWidget label="Hold"     value={summary.hold}    icon={AlertCircle} iconCls="bg-slate-50 text-slate-600" onClick={() => setFilterStatus(prev => prev === 'Hold'        ? '' : 'Hold')}        active={filterStatus === 'Hold'}        />}
          {summary.inQuery > 0 && <SummaryWidget label="In-query" value={summary.inQuery} icon={BookOpen}    iconCls="bg-blue-50  text-blue-700"  onClick={() => setFilterStatus(prev => prev === 'In-query'    ? '' : 'In-query')}   active={filterStatus === 'In-query'}    />}
          {summary.delayed > 0 && <SummaryWidget label="Delayed"  value={summary.delayed} icon={AlertCircle} iconCls="bg-red-50   text-red-600"   onClick={() => setFilterStatus(prev => prev === '__delayed__' ? '' : '__delayed__')} active={filterStatus === '__delayed__'} />}
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted flex items-center gap-1 mr-1">
            <Clock size={11} /> Filters
          </span>

          {/* Assignee filter */}
          <select
            value={filterAssignee}
            onChange={e => setFilterAssignee(e.target.value)}
            className="text-xs bg-card border border-border rounded-lg px-2.5 py-1.5 text-text focus:outline-none focus:ring-1 focus:ring-primary/40 appearance-none cursor-pointer"
          >
            <option value="">All Assignees</option>
            {assigneeOptions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>

{hasFilters && (
            <button
              onClick={() => { setFilterAssignee(''); setFilterStage(''); setFilterStatus('') }}
              className="flex items-center gap-1 text-xs text-danger hover:underline"
            >
              <RotateCcw size={11} /> Clear
            </button>
          )}

          <span className="ml-auto text-xs text-muted">
            {filtered.length} of {summary.total} chapter{summary.total !== 1 ? 's' : ''}
          </span>
        </div>

        {/* ── Chapter Cards ── */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted">
            <BookOpen size={36} className="mb-3 opacity-25" />
            <p className="text-sm font-medium">
              {hasFilters ? 'No chapters match your filters' : 'No chapters found for this project'}
            </p>
            {hasFilters && (
              <button
                onClick={() => { setFilterAssignee(''); setFilterStage(''); setFilterStatus('') }}
                className="mt-3 text-xs text-primary hover:underline flex items-center gap-1"
              >
                <RotateCcw size={11} /> Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(ch => (
              <ChapterCard
                key={ch.id}
                chapter={ch}
                users={users}
                projectCode={project.project_code}
                plannedDueDates={plannedDueDates}
                onUpdate={handleChapterUpdate}
                onViewDetails={ch => {
                  const base = clientId
                    ? `/clients/${clientId}/projects/${projectId}`
                    : `/projects/${projectId}`
                  navigate(`${base}/chapters/${ch.id}`)
                }}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
