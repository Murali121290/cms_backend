import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Layers, Calendar, Flag } from 'lucide-react'
import { projectsApi } from '@/api/projects'
import type { Project } from '@/api/projects'
import { chaptersApi } from '@/api/chapters'
import type { Chapter } from '@/api/chapters'
import { workflowsApi } from '@/api/workflows'
import type { WorkflowStage } from '@/api/workflows'
import { stagesApi } from '@/api/stages'
import type { Stage } from '@/api/stages'
import { toast } from '@/store/useToastStore'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { stageDetailsApi } from '@/api/stageDetails'

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

function fmt(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function pickSla(stage: Stage, composition: string | null): number | null {
  if (composition === 'Low')  return stage.sla_level1
  if (composition === 'High') return stage.sla_level3
  return stage.sla_level2
}

interface StageSchedule {
  stageName: string
  start: Date
  due: Date
  slaDays: number | null
}

function validDate(s: string | null | undefined): Date {
  if (!s) return new Date()
  const d = new Date(s)
  return isNaN(d.getTime()) ? new Date() : d
}

function toLocalISOString(date: Date): string {
  const tzoffset = date.getTimezoneOffset() * 60000; // offset in milliseconds
  const localISOTime = (new Date(date.getTime() - tzoffset)).toISOString().slice(0, -1);
  const offset = date.getTimezoneOffset();
  const absOffset = Math.abs(offset);
  const hours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const minutes = String(absOffset % 60).padStart(2, '0');
  const sign = offset <= 0 ? '+' : '-';
  return `${localISOTime}${sign}${hours}:${minutes}`;
}

function buildBaseSchedule(
  orderedStages: WorkflowStage[],
  masterMap: Map<string, Stage>,
  composition: string | null,
  projectCreatedAt: string,
): StageSchedule[] {
  const result: StageSchedule[] = []
  const cursor = validDate(projectCreatedAt)
  for (const ws of orderedStages) {
    const master  = masterMap.get(ws.stage_name)
    const slaDays = master ? pickSla(master, composition) : null
    const start   = new Date(cursor)
    const due     = new Date(start)
    if (slaDays) due.setDate(due.getDate() + slaDays)
    result.push({ stageName: ws.stage_name, start, due, slaDays })
    cursor.setTime(due.getTime())
  }
  return result
}

function buildChapterSchedule(
  chId: number,
  orderedStages: WorkflowStage[],
  baseSlaMap: Map<string, number | null>,
  cellSlas: Record<number, Record<string, number | null>>,
  projectCreatedAt: string,
): StageSchedule[] {
  const result: StageSchedule[] = []
  const cursor = validDate(projectCreatedAt)
  const chOverrides = cellSlas[chId] ?? {}
  for (const ws of orderedStages) {
    const slaDays = ws.stage_name in chOverrides
      ? chOverrides[ws.stage_name]
      : (baseSlaMap.get(ws.stage_name) ?? null)
    const start = new Date(cursor)
    const due   = new Date(start)
    if (slaDays) due.setDate(due.getDate() + slaDays)
    result.push({ stageName: ws.stage_name, start, due, slaDays })
    cursor.setTime(due.getTime())
  }
  return result
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function ProjectPlanningPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate      = useNavigate()
  const id            = Number(projectId)

  const [project,      setProject]      = useState<Project | null>(null)
  const [chapters,     setChapters]     = useState<Chapter[]>([])
  const [wfStages,     setWfStages]     = useState<WorkflowStage[]>([])
  const [stageMasters, setStageMasters] = useState<Stage[]>([])
  const [loading,      setLoading]      = useState(true)
  const [approving,    setApproving]    = useState(false)
  const [previewComposition, setPreviewComposition] = useState<string | null>(null)
  const [cellSlas, setCellSlas] = useState<Record<number, Record<string, number | null>>>({})
  const [delayMap,  setDelayMap]  = useState<Map<string, number>>(new Map())
  const [actualFinalDue, setActualFinalDue] = useState<Date | null>(null)
  const [dbDates, setDbDates] = useState<Record<string, { start: Date; due: Date }>>({})

  useEffect(() => {
    if (!id) return
    setLoading(true)
    projectsApi.getById(id)
      .then(async response => {
        const proj = response.project as unknown as Project
        setProject(proj)
        setPreviewComposition(proj.composition ?? 'Medium')
        const projectCode = proj.code || proj.project_code || ''
        const workflowName = proj.workflow_name || ''

        // Ensure WMS chapter_details are in sync with CMS chapters
        await import('@/api/client').then(m => m.default.post(`/projects/${id}/sync-chapters`)).catch(() => undefined)

        const [chs, wf, masters, stageDetails] = await Promise.all([
          chaptersApi.getByProject(projectCode).catch(() => [] as Chapter[]),
          workflowName
            ? workflowsApi.getWorkflow(workflowName).catch(() => [] as WorkflowStage[])
            : Promise.resolve([] as WorkflowStage[]),
          stagesApi.list().catch(() => [] as Stage[]),
          projectCode
            ? stageDetailsApi.listByProject(projectCode).catch(() => [])
            : Promise.resolve([]),
        ])
        setChapters(chs)
        setWfStages(wf)
        setStageMasters(masters)

        if (stageDetails.length > 0 && chs.length > 0) {
          const sorted = [...stageDetails].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
          const slaSeen = new Set<string>()
          const loaded: Record<number, Record<string, number | null>> = {}
          const dMap = new Map<string, number>()
          const datesMap: Record<string, { start: Date; due: Date }> = {}
          let maxDue: Date | null = null

          for (const d of sorted) {
            const key = `${d.chapters}||${d.stage_name}`
            if (!slaSeen.has(key) && d.sla != null) {
              slaSeen.add(key)
              const ch = chs.find(c => c.chapters === d.chapters)
              if (ch) {
                if (!loaded[ch.id]) loaded[ch.id] = {}
                loaded[ch.id][d.stage_name] = d.sla
              }
            }
            if (d.planned_start_date && d.planned_end_date) {
              if (!datesMap[key]) {
                datesMap[key] = {
                  start: new Date(d.planned_start_date),
                  due: new Date(d.planned_end_date)
                }
              }
            }
            if (d.delayed && d.delay_days != null && d.delay_days > 0) {
              const existing = dMap.get(key) ?? 0
              if (d.delay_days > existing) dMap.set(key, d.delay_days)
            }
            if (d.planned_end_date) {
              const due = new Date(d.planned_end_date)
              if (!maxDue || due > maxDue) maxDue = due
            }
          }
          setCellSlas(loaded)
          setDelayMap(dMap)
          setDbDates(datesMap)
          if (maxDue) setActualFinalDue(maxDue)
        }
      })
      .catch(() => toast.error('Failed to load project'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { setCellSlas({}) }, [previewComposition])

  const orderedStages = useMemo(() => orderStages(wfStages), [wfStages])

  const masterMap = useMemo(() => {
    const m = new Map<string, Stage>()
    stageMasters.forEach(s => m.set(s.stage_name, s))
    return m
  }, [stageMasters])

  const baseSchedule = useMemo((): StageSchedule[] => {
    if (!project || orderedStages.length === 0) return []
    return buildBaseSchedule(orderedStages, masterMap, previewComposition, project.created_at || '')
  }, [project, orderedStages, masterMap, previewComposition])

  const baseSlaMap = useMemo(() => {
    const m = new Map<string, number | null>()
    baseSchedule.forEach(s => m.set(s.stageName, s.slaDays))
    return m
  }, [baseSchedule])

  const chapterSchedules = useMemo(() => {
    if (!project || chapters.length === 0 || orderedStages.length === 0) return new Map<number, StageSchedule[]>()
    const result = new Map<number, StageSchedule[]>()
    for (const ch of chapters) {
      result.set(ch.id, buildChapterSchedule(ch.id, orderedStages, baseSlaMap, cellSlas, project.created_at || ''))
    }
    return result
  }, [project, chapters, orderedStages, baseSlaMap, cellSlas])

  function handleCellSlaChange(chId: number, stageName: string, raw: string) {
    if (raw === '') {
      setCellSlas(prev => {
        const next = { ...prev, [chId]: { ...(prev[chId] ?? {}) } }
        delete next[chId][stageName]
        return next
      })
    } else {
      const val = parseInt(raw, 10)
      if (!isNaN(val) && val >= 0) {
        setCellSlas(prev => ({ ...prev, [chId]: { ...(prev[chId] ?? {}), [stageName]: val } }))
      }
    }
  }

  const alreadyApproved = project?.status === 'Active' || project?.status === 'Completed'

  const finalDue = useMemo(() => {
    if (baseSchedule.length === 0) return null
    let max = baseSchedule[baseSchedule.length - 1].due
    for (const ch of chapters) {
      const chSched = chapterSchedules.get(ch.id)
      if (chSched) {
        const last = chSched[chSched.length - 1]
        if (last && last.due > max) max = last.due
      }
    }
    return max
  }, [baseSchedule, chapters, chapterSchedules])

  function toLocalDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  async function handleApprove() {
    if (!project || !finalDue) return
    setApproving(true)
    try {
      await projectsApi.update(project.id, {
        status:      'Active',
        due_date:    toLocalDateStr(finalDue),
        composition: previewComposition ?? undefined,
      })
    } catch {
      toast.error('Failed to approve planning')
      setApproving(false)
      return
    }

    const prjCode = project.code || project.project_code
    const wfName = project.workflow_name
    if (prjCode) {
      chaptersApi.bulkUpdateStatus(prjCode, 'In-progress')
        .catch(e => console.error('[Planning step 2]', e))

      if (chapters.length > 0) {
        if (previewComposition) {
          Promise.all(chapters.map(ch =>
            chaptersApi.update(ch.id, { complexity_level: previewComposition })
          )).catch(e => console.error('[Planning step 3]', e))
        }

        const items = chapters.flatMap(ch => {
          const chSched = chapterSchedules.get(ch.id) ?? baseSchedule
          return chSched.map(s => ({
            chapters:           ch.chapters,
            stage_name:         s.stageName,
            planned_start_date: toLocalISOString(s.start),
            planned_end_date:   toLocalISOString(s.due),
            sla:                s.slaDays,
          }))
        })
        try {
          await stageDetailsApi.createPlanningRows({
            client:               project.division_code ?? '',
            project:              prjCode,
            workflow:             wfName ?? '',
            complexity_level:     previewComposition,
            project_manager_name: project.project_manager ?? null,
            items,
          })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[Planning step 4] stage_detail insert failed:', msg)
          toast.error(`Stage details not saved: ${msg}`)
        }

        Promise.all(chapters.map(ch => {
          const chSched = chapterSchedules.get(ch.id) ?? baseSchedule
          const stageSched = ch.stage_name
            ? (chSched.find(s => s.stageName === ch.stage_name) ?? chSched[0])
            : chSched[0]
          if (!stageSched) return Promise.resolve()
          return chaptersApi.update(ch.id, { due_date: toLocalDateStr(stageSched.due) })
        })).catch(e => console.error('[Planning step 5]', e))
      }
    }

    toast.success('Planning approved — project is now Active')
    navigate(-1)
    setApproving(false)
  }

  async function handleBack() {
    if (project && finalDue && alreadyApproved) {
      const s = toLocalDateStr(finalDue)
      if (project.due_date !== s) {
        try {
          await projectsApi.update(project.id, { due_date: s })
        } catch { /* non-critical */ }
      }
    }
    navigate(-1)
  }

  if (loading) return <FullPageSpinner />
  if (!project) return (
    <div className="flex items-center justify-center h-64 text-muted text-sm">Project not found</div>
  )

  return (
    <div className="flex flex-col min-h-full">

      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-background flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-text">
              {project.project_title || project.title || project.code || project.project_code || `Project #${project.id}`}
            </h1>
            <p className="text-xs text-muted flex items-center gap-1.5 mt-0.5">
              <Layers size={11} />
              {project.workflow_name || 'No workflow'} · Project Planning
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted font-medium whitespace-nowrap">Composition:</label>
            <select
              value={previewComposition ?? 'Medium'}
              onChange={e => setPreviewComposition(e.target.value)}
              disabled={alreadyApproved}
              className="text-xs bg-surface border border-border rounded-lg px-2.5 py-1.5 text-text focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="Low">Low (Level 1)</option>
              <option value="Medium">Medium (Level 2)</option>
              <option value="High">High (Level 3)</option>
            </select>
            {previewComposition !== (project.composition ?? 'Medium') && (
              <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                Preview only
              </span>
            )}
          </div>

          {finalDue && (
            <div className="flex flex-col items-end gap-0.5">
              <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border ${
                alreadyApproved
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  : 'text-primary bg-accent border-primary/20'
              }`}>
                <Flag size={12} />
                Final Deliverable: {fmt(finalDue)}
              </div>
              {alreadyApproved && actualFinalDue && actualFinalDue > finalDue && (
                <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-md">
                  <Flag size={9} /> Updated: {fmt(actualFinalDue)} due to delays
                </div>
              )}
            </div>
          )}

          {alreadyApproved ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
              <CheckCircle2 size={13} /> Planning Approved
            </span>
          ) : (
            <Button
              onClick={handleApprove}
              disabled={approving || !finalDue || chapters.length === 0}
            >
              {approving
                ? <><Spinner size="sm" /> Approving…</>
                : <><CheckCircle2 size={14} /> Approve Planning</>
              }
            </Button>
          )}
        </div>
      </div>

      {/* Planning Table */}
      <div className="flex-1 overflow-auto">
        {baseSchedule.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted">
            <Calendar size={40} className="mb-3 opacity-30" />
            <p className="text-sm">No workflow stages found. Assign a workflow to this project first.</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-sm min-w-max">
            <thead>
              <tr className="bg-background border-b-2 border-border">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider sticky left-0 z-20 bg-background whitespace-nowrap w-[144px] min-w-[144px] max-w-[144px] shadow-[inset_-1px_0_0_var(--color-border)]">
                  Chapter
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider sticky left-[144px] z-20 bg-background whitespace-nowrap w-[176px] min-w-[176px] max-w-[176px] shadow-[inset_-1px_0_0_var(--color-border)]">
                  File Name
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider sticky left-[320px] z-20 bg-background whitespace-nowrap w-[112px] min-w-[112px] max-w-[112px] shadow-[inset_-2px_0_0_var(--color-border)]">
                  MS Pages
                </th>
                {baseSchedule.map(s => (
                  <th key={s.stageName} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap min-w-56 border-r border-border last:border-r-0">
                    <div className="flex flex-col gap-0.5">
                      <span>{s.stageName}</span>
                      {s.slaDays != null && (
                        <span className="text-[10px] font-normal normal-case tracking-normal text-muted/70">
                          Default: {s.slaDays}d
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chapters.length === 0 ? (
                <tr>
                  <td colSpan={3 + baseSchedule.length} className="px-4 py-16 text-center text-sm text-muted">
                    No chapters found. Upload a zip file to add chapters first.
                  </td>
                </tr>
              ) : (
                [...chapters].sort((a, b) => a.id - b.id).map((ch, idx) => {
                  const chSched = chapterSchedules.get(ch.id) ?? baseSchedule
                  return (
                    <tr
                      key={ch.id}
                      className="border-b border-border hover:bg-accent transition-colors group bg-card"
                    >
                      <td className="px-4 py-3 font-semibold text-text sticky left-0 z-10 whitespace-nowrap w-[144px] min-w-[144px] max-w-[144px] shadow-[inset_-1px_0_0_var(--color-border)] bg-card group-hover:bg-accent transition-colors">
                        {ch.chapters}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted sticky left-[144px] z-10 whitespace-nowrap w-[176px] min-w-[176px] max-w-[176px] shadow-[inset_-1px_0_0_var(--color-border)] max-w-[176px] truncate bg-card group-hover:bg-accent transition-colors">
                        {ch.chapter_title || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-center sticky left-[320px] z-10 whitespace-nowrap w-[112px] min-w-[112px] max-w-[112px] shadow-[inset_-2px_0_0_var(--color-border)] font-medium text-text bg-card group-hover:bg-accent transition-colors">
                        {ch.manuscript_pages != null ? ch.manuscript_pages : '—'}
                      </td>
                      {chSched.map(s => {
                        const isCellEdited = s.slaDays !== (baseSlaMap.get(s.stageName) ?? null)
                        const delayDays    = delayMap.get(`${ch.chapters}||${s.stageName}`)
                                          ?? (ch.delayed_stages?.[s.stageName] ?? 0)
                        const dbKey = `${ch.chapters}||${s.stageName}`
                        const displayStart = alreadyApproved && dbDates[dbKey] ? dbDates[dbKey].start : s.start
                        const displayDue = alreadyApproved && dbDates[dbKey] ? dbDates[dbKey].due : s.due
                        return (
                          <td key={s.stageName} className="px-4 py-3 border-r border-border/50 last:border-r-0">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-xs">
                                <span className="w-9 text-[10px] font-semibold text-muted uppercase tracking-wide">Start</span>
                                <span className="text-text font-medium">{fmt(displayStart)}</span>
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <span className="w-9 text-[10px] font-semibold text-muted uppercase tracking-wide">Due</span>
                                <span className={`font-medium ${isCellEdited ? 'text-primary font-bold' : 'text-text'}`}>
                                  {fmt(displayDue)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <span className="w-9 text-[10px] font-semibold text-muted uppercase tracking-wide">SLA</span>
                                {alreadyApproved ? (
                                  <>
                                    {s.slaDays != null && (
                                      <span className="text-[10px] font-bold text-primary">{s.slaDays}d</span>
                                    )}
                                    {delayDays > 0 && (
                                      <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 ml-1">
                                        +{delayDays}d
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      min={0}
                                      value={s.slaDays ?? ''}
                                      onChange={e => handleCellSlaChange(ch.id, s.stageName, e.target.value)}
                                      placeholder="—"
                                      className={`w-12 text-[11px] border rounded px-1.5 py-0.5 text-text focus:outline-none focus:ring-1 focus:ring-primary/40 ${
                                        isCellEdited
                                          ? 'border-amber-400 bg-amber-50/60 text-amber-800'
                                          : 'bg-background border-border'
                                      }`}
                                    />
                                    <span className="text-[10px] text-muted">d</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
