import { useState, useEffect, useMemo } from 'react'
import { CheckCircle2, Layers, Calendar, Flag } from 'lucide-react'
import { projectsApi } from '@/api/projects'
import type { Project } from '@/api/projects'
import { chaptersApi } from '@/api/chapters'
import type { Chapter } from '@/api/chapters'
import { workflowsApi } from '@/api/workflows'
import type { WorkflowStage } from '@/api/workflows'
import { stagesApi } from '@/api/stages'
import type { Stage } from '@/api/stages'
import { toast } from '@/store/useToastStore'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
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

/** Base schedule — same SLA for all chapters, derived from composition. */
function buildBaseSchedule(
  orderedStages: WorkflowStage[],
  masterMap: Map<string, Stage>,
  composition: string | null,
  projectCreatedAt: string,
): StageSchedule[] {
  const result: StageSchedule[] = []
  const cursor = new Date(projectCreatedAt)
  cursor.setHours(0, 0, 0, 0)
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

/**
 * Per-chapter schedule — applies per-cell SLA overrides and cascades dates.
 * Changing stage N's SLA shifts all subsequent stage start/due dates for this chapter.
 */
function buildChapterSchedule(
  chId: number,
  orderedStages: WorkflowStage[],
  baseSlaMap: Map<string, number | null>,
  cellSlas: Record<number, Record<string, number | null>>,
  projectCreatedAt: string,
): StageSchedule[] {
  const result: StageSchedule[] = []
  const cursor = new Date(projectCreatedAt)
  cursor.setHours(0, 0, 0, 0)
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

// ── Modal ──────────────────────────────────────────────────────────────────────

interface ProjectPlanningModalProps {
  projectId:   number | null
  open:        boolean
  onClose:     () => void
  onApproved?: () => void
}

export function ProjectPlanningModal({ projectId, open, onClose, onApproved }: ProjectPlanningModalProps) {
  const [project,      setProject]      = useState<Project | null>(null)
  const [chapters,     setChapters]     = useState<Chapter[]>([])
  const [wfStages,     setWfStages]     = useState<WorkflowStage[]>([])
  const [stageMasters, setStageMasters] = useState<Stage[]>([])
  const [loading,      setLoading]      = useState(false)
  const [approving,    setApproving]    = useState(false)
  const [previewComposition, setPreviewComposition] = useState<string | null>(null)
  // Per-chapter, per-stage SLA overrides: chapterId → stageName → days
  const [cellSlas, setCellSlas] = useState<Record<number, Record<string, number | null>>>({})
  // Delay info per chapter×stage: "chapters||stageName" → delay_days (only when delayed)
  const [delayMap,  setDelayMap]  = useState<Map<string, number>>(new Map())
  // Actual final deliverable after cascade shifts (max planned_end_date across all stage_detail rows)
  const [actualFinalDue, setActualFinalDue] = useState<Date | null>(null)

  useEffect(() => {
    if (!open || !projectId) return
    setLoading(true)
    setProject(null)
    setChapters([])
    setWfStages([])
    setStageMasters([])
    setCellSlas({})
    projectsApi.getById(projectId)
      .then(async proj => {
        setProject(proj)
        setPreviewComposition(proj.composition ?? 'Medium')
        const [chs, wf, masters, stageDetails] = await Promise.all([
          chaptersApi.getByProject(proj.project_code ?? '').catch(() => [] as Chapter[]),
          proj.workflow_name
            ? workflowsApi.getWorkflow(proj.workflow_name).catch(() => [] as WorkflowStage[])
            : Promise.resolve([] as WorkflowStage[]),
          stagesApi.list().catch(() => [] as Stage[]),
          proj.project_code
            ? stageDetailsApi.listByProject(proj.project_code).catch(() => [])
            : Promise.resolve([]),
        ])
        setChapters(chs)
        setWfStages(wf)
        setStageMasters(masters)

        if (stageDetails.length > 0 && chs.length > 0) {
          const sorted = [...stageDetails].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )

          // SLA overrides: newest row with non-null sla wins
          // NOTE: key is only added to slaSeen AFTER a valid sla is stored,
          // so if the newest row has sla=null we keep looking at older rows.
          const slaSeen = new Set<string>()
          const loaded: Record<number, Record<string, number | null>> = {}

          // Delay map: "chapters||stage_name" → max delay_days (delayed rows only)
          const dMap = new Map<string, number>()

          // Actual final due = max planned_end_date across all rows (reflects cascade shifts)
          let maxDue: Date | null = null

          for (const d of sorted) {
            const key = `${d.chapters}||${d.stage_name}`

            // SLA — take the first (newest) row that actually has a sla value
            if (!slaSeen.has(key) && d.sla != null) {
              slaSeen.add(key)
              const ch = chs.find(c => c.chapters === d.chapters)
              if (ch) {
                if (!loaded[ch.id]) loaded[ch.id] = {}
                loaded[ch.id][d.stage_name] = d.sla
              }
            }

            // Delay — accumulate max delay_days per chapter×stage
            if (d.delayed && d.delay_days != null && d.delay_days > 0) {
              const existing = dMap.get(key) ?? 0
              if (d.delay_days > existing) dMap.set(key, d.delay_days)
            }

            // Actual final due — max planned_end_date
            if (d.planned_end_date) {
              const due = new Date(d.planned_end_date)
              if (!maxDue || due > maxDue) maxDue = due
            }
          }

          setCellSlas(loaded)
          setDelayMap(dMap)
          if (maxDue) setActualFinalDue(maxDue)
        }
      })
      .catch(() => toast.error('Failed to load project'))
      .finally(() => setLoading(false))
  }, [open, projectId])

  // Changing composition resets manual SLA edits (only applies before approval when composition is editable)
  useEffect(() => { setCellSlas({}) }, [previewComposition])

  const orderedStages = useMemo(() => orderStages(wfStages), [wfStages])

  const masterMap = useMemo(() => {
    const m = new Map<string, Stage>()
    stageMasters.forEach(s => m.set(s.stage_name, s))
    return m
  }, [stageMasters])

  // Base schedule — composition-level SLA, same for all chapters
  const baseSchedule = useMemo((): StageSchedule[] => {
    if (!project || orderedStages.length === 0) return []
    return buildBaseSchedule(orderedStages, masterMap, previewComposition, project.created_at)
  }, [project, orderedStages, masterMap, previewComposition])

  // Quick lookup: stageName → default SLA days (from base schedule)
  const baseSlaMap = useMemo(() => {
    const m = new Map<string, number | null>()
    baseSchedule.forEach(s => m.set(s.stageName, s.slaDays))
    return m
  }, [baseSchedule])

  // Per-chapter schedules — apply cell-level SLA overrides with cascade
  const chapterSchedules = useMemo(() => {
    if (!project || chapters.length === 0 || orderedStages.length === 0) return new Map<number, StageSchedule[]>()
    const result = new Map<number, StageSchedule[]>()
    for (const ch of chapters) {
      result.set(ch.id, buildChapterSchedule(ch.id, orderedStages, baseSlaMap, cellSlas, project.created_at))
    }
    return result
  }, [project, chapters, orderedStages, baseSlaMap, cellSlas])

  function handleCellSlaChange(chId: number, stageName: string, raw: string) {
    if (raw === '') {
      // Remove override → revert to composition default
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

  // Max due date across all chapters' last stage — the Final Deliverable
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

  // Converts a Date to YYYY-MM-DD using local timezone (avoids UTC-shift in UTC+ zones)
  function toLocalDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  async function handleApprove() {
    if (!project || !finalDue) return
    setApproving(true)

    // Step 1 — critical: update project status/due_date/composition
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

    // Steps 2-5 run independently — a failure in one does not block the rest
    if (project.project_code) {
      // Step 2 — chapters → In-progress
      chaptersApi.bulkUpdateStatus(project.project_code, 'In-progress')
        .catch(e => console.error('[Planning step 2]', e))

      if (chapters.length > 0) {
        // Step 3 — chapters complexity_level (non-blocking)
        if (previewComposition) {
          Promise.all(chapters.map(ch =>
            chaptersApi.update(ch.id, { complexity_level: previewComposition })
          )).catch(e => console.error('[Planning step 3]', e))
        }

        // Step 4 — insert stage_detail rows (one per chapter × stage)
        const items = chapters.flatMap(ch => {
          const chSched = chapterSchedules.get(ch.id) ?? baseSchedule
          return chSched.map(s => ({
            chapters:           ch.chapters,
            stage_name:         s.stageName,
            planned_start_date: s.start.toISOString(),
            planned_end_date:   s.due.toISOString(),
            sla:                s.slaDays,
          }))
        })
        try {
          await stageDetailsApi.createPlanningRows({
            client:               project.division_code ?? '',
            project:              project.project_code,
            workflow:             project.workflow_name ?? '',
            complexity_level:     previewComposition,
            project_manager_name: project.project_manager,
            items,
          })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[Planning step 4] stage_detail insert failed:', msg)
          toast.error(`Stage details not saved: ${msg}`)
        }

        // Step 5 — set each chapter's due_date to their current stage's planned end date
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
    onApproved?.()
    onClose()
    setApproving(false)
  }

  // On close: keep project.due_date in sync with Final Deliverable for approved projects
  async function handleClose() {
    if (project && finalDue && alreadyApproved) {
      const s = toLocalDateStr(finalDue)
      if (project.due_date !== s) {
        try {
          await projectsApi.update(project.id, { due_date: s })
          onApproved?.()
        } catch { /* non-critical */ }
      }
    }
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Project Planning" size="2xl"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={approving}>Close</Button>
          {alreadyApproved ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
              <CheckCircle2 size={13} /> Planning Approved
            </span>
          ) : (
            <Button onClick={handleApprove} disabled={approving || !finalDue || chapters.length === 0}>
              {approving ? <><Spinner size="sm" /> Approving…</> : <><CheckCircle2 size={14} /> Approve Planning</>}
            </Button>
          )}
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-24"><Spinner size="lg" /></div>
      ) : !project ? (
        <div className="flex items-center justify-center py-16 text-muted text-sm">Project not found</div>
      ) : (
        <div className="flex flex-col gap-0">

          {/* ── Info bar ─────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border">
            <div>
              <p className="font-semibold text-text text-sm">
                {project.project_title || project.project_code || `Project #${project.id}`}
              </p>
              <div className="flex items-center gap-2 mt-1">
                {project.workflow_name && (
                  <span className="inline-flex items-center gap-1 text-xs bg-accent text-primary border border-primary/20 rounded-md px-2 py-0.5 font-medium">
                    <Layers size={10} /> {project.workflow_name}
                  </span>
                )}
                <span className="text-xs text-muted">{chapters.length} chapter{chapters.length !== 1 ? 's' : ''}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted font-medium whitespace-nowrap">Composition</label>
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
                {!alreadyApproved && previewComposition !== (project.composition ?? 'Medium') && (
                  <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">
                    Preview only
                  </span>
                )}
              </div>
              {finalDue && (
                <div className="flex flex-col items-end gap-0.5">
                  <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border ${
                    alreadyApproved ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-primary bg-accent border-primary/20'
                  }`}>
                    <Flag size={11} /> Final Deliverable: {fmt(finalDue)}
                  </div>
                  {/* Show updated due if cascade delays shifted it past the original */}
                  {alreadyApproved && actualFinalDue && actualFinalDue > finalDue && (
                    <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-md">
                      <Flag size={9} /> Updated: {fmt(actualFinalDue)} due to delays
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Table ─────────────────────────────────────────────── */}
          {baseSchedule.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted">
              <Calendar size={36} className="mb-3 opacity-30" />
              <p className="text-sm">No workflow stages found. Assign a workflow to this project first.</p>
            </div>
          ) : (
            <div className="-mx-6 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-border">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider sticky left-0 z-20 bg-card whitespace-nowrap min-w-[9rem] border-r border-border">
                      Chapter
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider sticky left-[9rem] z-20 bg-card whitespace-nowrap min-w-[10rem] border-r border-border">
                      File Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider sticky left-[19rem] z-20 bg-card whitespace-nowrap min-w-[7rem] border-r-2 border-border shadow-[4px_0_8px_-4px_rgba(0,0,0,0.15)]">
                      MS Pages
                    </th>
                    {baseSchedule.map(s => (
                      <th key={s.stageName} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap min-w-[13rem] border-r border-border last:border-r-0">
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
                      <td colSpan={3 + baseSchedule.length} className="px-4 py-14 text-center text-sm text-muted">
                        No chapters found. Upload a zip file to add chapters first.
                      </td>
                    </tr>
                  ) : (
                    [...chapters].sort((a, b) => a.id - b.id).map((ch, idx) => {
                      const chSched = chapterSchedules.get(ch.id) ?? baseSchedule
                      return (
                        <tr
                          key={ch.id}
                          className={`border-b border-border transition-colors ${idx % 2 === 0 ? 'bg-background' : 'bg-surface'} hover:brightness-95`}
                        >
                          <td className="px-4 py-2.5 font-semibold text-text sticky left-0 z-10 bg-card whitespace-nowrap border-r border-border text-sm">
                            {ch.chapters}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted sticky left-[9rem] z-10 bg-card whitespace-nowrap border-r border-border max-w-[10rem] truncate">
                            {ch.chapter_title || '—'}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-center sticky left-[19rem] z-10 bg-card whitespace-nowrap border-r-2 border-border shadow-[4px_0_8px_-4px_rgba(0,0,0,0.15)]">
                            {ch.manuscript_pages != null
                              ? <span className="font-medium text-text">{ch.manuscript_pages}</span>
                              : <span className="text-muted">—</span>
                            }
                          </td>
                          {chSched.map(s => {
                            const isCellEdited = s.slaDays !== (baseSlaMap.get(s.stageName) ?? null)
                            // stage_details.delay_days is authoritative — computed by backend at exact sign-off time
                            // Fall back to chapter.delayed_stages (client-side, may be slightly inaccurate)
                            const delayDays    = delayMap.get(`${ch.chapters}||${s.stageName}`)
                                              ?? (ch.delayed_stages?.[s.stageName] ?? 0)
                            return (
                              <td key={s.stageName} className="px-3 py-2.5 border-r border-border/50 last:border-r-0">
                                <div className="flex flex-col gap-1">
                                  {/* Start date */}
                                  <div className="flex items-center gap-1.5 text-xs">
                                    <span className="text-[10px] font-semibold text-muted uppercase w-8 shrink-0">Start</span>
                                    <span className="text-text">{fmt(s.start)}</span>
                                  </div>
                                  {/* Due date */}
                                  <div className="flex items-center gap-1.5 text-xs">
                                    <span className="text-[10px] font-semibold text-muted uppercase w-8 shrink-0">Due</span>
                                    <span className={`font-medium ${isCellEdited ? 'text-primary' : 'text-text'}`}>
                                      {fmt(s.due)}
                                    </span>
                                  </div>
                                  {/* SLA + delay badge */}
                                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                    <span className="text-[10px] font-semibold text-muted uppercase w-8 shrink-0">SLA</span>
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
                                      <>
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
                                      </>
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
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
