import { useState, useEffect, useMemo, useCallback } from 'react'
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

// "Design" and "CE support" are organizational folders created alongside every project
// (see create_project_with_initial_files), not real manuscript chapters — they shouldn't
// take up rows in the per-chapter planning/scheduling grid.
const VIRTUAL_CHAPTER_NAMES = new Set(['Design', 'CE support'])

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
    // Next stage starts the day after this one is due, not on the same day.
    cursor.setTime(due.getTime())
    cursor.setDate(cursor.getDate() + 1)
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
    // Next stage starts the day after this one is due, not on the same day.
    cursor.setTime(due.getTime())
    cursor.setDate(cursor.getDate() + 1)
  }
  return result
}

// ── Planning Table Header ────────────────────────────────────────────────────────

function PlanningTableHeader({ stages, activeTab = 'manuscript' }: { stages: StageSchedule[], activeTab?: 'manuscript' | 'art' | 'design' }) {
  if (activeTab === 'art') {
    return (
      <thead>
        <tr className="bg-background border-b-2 border-border">
          <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider sticky left-0 z-20 bg-background whitespace-nowrap w-[144px] min-w-[144px] max-w-[144px] shadow-[inset_-1px_0_0_var(--color-border)]">
            Chapter
          </th>
          <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider sticky left-[144px] z-20 bg-background whitespace-nowrap w-[176px] min-w-[176px] max-w-[176px] shadow-[inset_-1px_0_0_var(--color-border)]">
            File Name
          </th>
          <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider sticky left-[320px] z-20 bg-background whitespace-nowrap w-[112px] min-w-[112px] max-w-[112px] shadow-[inset_-2px_0_0_var(--color-border)]">
            Art Count
          </th>
          {stages.map(s => (
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
    )
  }

  if (activeTab === 'design') {
    return (
      <thead>
        <tr className="bg-background border-b-2 border-border">
          <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider sticky left-0 z-20 bg-background whitespace-nowrap w-[144px] min-w-[144px] max-w-[144px] shadow-[inset_-1px_0_0_var(--color-border)]">
            Chapter
          </th>
          <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider sticky left-[144px] z-20 bg-background whitespace-nowrap w-[176px] min-w-[176px] max-w-[176px] shadow-[inset_-2px_0_0_var(--color-border)]">
            File Name
          </th>
          {stages.map(s => (
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
    )
  }

  return (
    <thead>
      <tr className="bg-background border-b-2 border-border">
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider sticky left-0 z-20 bg-background whitespace-nowrap w-[144px] min-w-[144px] max-w-[144px] shadow-[inset_-1px_0_0_var(--color-border)]">
          Chapter
        </th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider sticky left-[144px] z-20 bg-background whitespace-nowrap w-[176px] min-w-[176px] max-w-[176px] shadow-[inset_-1px_0_0_var(--color-border)]">
          File Name
        </th>
        <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider sticky left-[320px] z-20 bg-background whitespace-nowrap w-[112px] min-w-[112px] max-w-[112px] shadow-[inset_-1px_0_0_var(--color-border)]">
          MS Pages
        </th>
        <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider sticky left-[432px] z-20 bg-background whitespace-nowrap w-[96px] min-w-[96px] max-w-[96px] shadow-[inset_-2px_0_0_var(--color-border)]">
          CE Pages
        </th>
        {stages.map(s => (
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
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function ProjectPlanningPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate      = useNavigate()
  const id            = Number(projectId)

  const [project,      setProject]      = useState<Project | null>(null)
  const [chapters,     setChapters]     = useState<Chapter[]>([])
  const [wfStagesMap,  setWfStagesMap]  = useState<Record<string, WorkflowStage[]>>({})
  const [stageMasters, setStageMasters] = useState<Stage[]>([])
  const [loading,      setLoading]      = useState(true)
  const [approving,    setApproving]    = useState(false)
  const [approvingNew, setApprovingNew] = useState(false)
  const [previewComposition, setPreviewComposition] = useState<string | null>(null)
  const [cellSlas, setCellSlas] = useState<Record<number, Record<string, number | null>>>({})
  const [delayMap,  setDelayMap]  = useState<Map<string, number>>(new Map())
  const [actualFinalDue, setActualFinalDue] = useState<Date | null>(null)
  const [dbDates, setDbDates] = useState<Record<string, { start: Date; due: Date }>>({})
  const [activeTab, setActiveTab] = useState<'manuscript' | 'art' | 'design'>('manuscript')

  const loadPlanningData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!id) return
    if (!opts?.silent) setLoading(true)
    try {
      const response = await projectsApi.getById(id)
      const proj = response.project as unknown as Project
      setProject(proj)
      setPreviewComposition(proj.composition ?? 'Medium')
      const projectCode = proj.code || proj.project_code || ''

      // Ensure WMS chapter_details are in sync with CMS chapters
      await import('@/api/client').then(m => m.default.post(`/projects/${id}/sync-chapters`)).catch(() => undefined)

      const [chsRaw, masters, stageDetails] = await Promise.all([
        chaptersApi.getByProject(projectCode)
          .then(list => list.filter(c => c.chapters !== 'CE support'))
          .catch(() => [] as Chapter[]),
        stagesApi.list().catch(() => [] as Stage[]),
        projectCode
          ? stageDetailsApi.listByProject(projectCode).catch(() => [])
          : Promise.resolve([]),
      ])
      setChapters(chsRaw)
      setStageMasters(masters)

      // Find unique workflows across all chapters, including default project workflow
      const uniqueWfs = Array.from(new Set(chsRaw.map(c => c.workflow).filter(Boolean))) as string[]
      if (proj.workflow_name && !uniqueWfs.includes(proj.workflow_name)) {
        uniqueWfs.push(proj.workflow_name)
      }

      // Fetch all unique workflows stages
      const wfPromises = uniqueWfs.map(wf =>
        workflowsApi.getWorkflow(wf)
          .then(stages => ({ workflowName: wf, stages }))
          .catch(() => ({ workflowName: wf, stages: [] as WorkflowStage[] }))
      )
      const wfsList = await Promise.all(wfPromises)
      
      const wfMapObj: Record<string, WorkflowStage[]> = {}
      wfsList.forEach(({ workflowName, stages }) => {
        wfMapObj[workflowName] = orderStages(stages)
      })
      setWfStagesMap(wfMapObj)

      let loaded: Record<number, Record<string, number | null>> = {}
      let dMap = new Map<string, number>()
      let datesMap: Record<string, { start: Date; due: Date }> = {}
      let maxDue: Date | null = null

      if (stageDetails.length > 0 && chsRaw.length > 0) {
        const sorted = [...stageDetails].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        const slaSeen = new Set<string>()

        for (const d of sorted) {
          const key = `${d.chapters}||${d.stage_name}`
          if (!slaSeen.has(key) && d.sla != null) {
            slaSeen.add(key)
            const ch = chsRaw.find(c => c.chapters === d.chapters)
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
      }
      setCellSlas(loaded)
      setDelayMap(dMap)
      setDbDates(datesMap)
      setActualFinalDue(maxDue)
    } catch {
      toast.error('Failed to load project')
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [id])

  useEffect(() => { loadPlanningData() }, [loadPlanningData])

  useEffect(() => { setCellSlas({}) }, [previewComposition])

  const masterMap = useMemo(() => {
    const m = new Map<string, Stage>()
    stageMasters.forEach(s => m.set(s.stage_name, s))
    return m
  }, [stageMasters])

  // Partition chapters into Design, Manuscripts, and Art tracks
  const designChapters = useMemo(() => chapters.filter(c => c.chapters === 'Design'), [chapters])
  const manuscriptChapters = useMemo(() => chapters.filter(c => /^\d+$/.test(c.chapters)), [chapters])
  const artChapters = useMemo(() => chapters.filter(c => c.chapters.toLowerCase().includes('art')), [chapters])

  // Select active track chapters
  const activeChapters = useMemo(() => {
    if (activeTab === 'design') return designChapters
    if (activeTab === 'art') return artChapters
    return manuscriptChapters
  }, [activeTab, designChapters, artChapters, manuscriptChapters])

  // Get active workflow and stages based on the selected tab
  const activeWorkflowName = useMemo(() => {
    if (activeTab === 'design') return designChapters[0]?.workflow || project?.workflow_name || ''
    if (activeTab === 'art') return artChapters[0]?.workflow || project?.workflow_name || ''
    return manuscriptChapters[0]?.workflow || project?.workflow_name || ''
  }, [activeTab, designChapters, artChapters, manuscriptChapters, project])

  const currentOrderedStages = useMemo(() => {
    return wfStagesMap[activeWorkflowName] ?? []
  }, [activeWorkflowName, wfStagesMap])

  const baseSchedule = useMemo((): StageSchedule[] => {
    if (!project || currentOrderedStages.length === 0) return []
    return buildBaseSchedule(currentOrderedStages, masterMap, previewComposition, project.created_at || '')
  }, [project, currentOrderedStages, masterMap, previewComposition])

  const baseSlaMap = useMemo(() => {
    const m = new Map<string, number | null>()
    baseSchedule.forEach(s => m.set(s.stageName, s.slaDays))
    return m
  }, [baseSchedule])

  const alreadyApproved = project?.status === 'Active' || project?.status === 'Completed'

  // Chapters with at least one persisted StageDetail row (i.e. already planned/approved).
  // A chapter added after the project was approved has none of these yet and needs its
  // own pass through planning — it must never be silently folded into the locked table.
  const plannedChapterNumbers = useMemo(() => {
    const s = new Set<string>()
    Object.keys(dbDates).forEach(key => s.add(key.split('||')[0]))
    return s
  }, [dbDates])

  const chapterSchedules = useMemo(() => {
    if (!project || chapters.length === 0 || currentOrderedStages.length === 0) return new Map<number, StageSchedule[]>()
    const result = new Map<number, StageSchedule[]>()
    const activeChapters = activeTab === 'design' ? designChapters : activeTab === 'art' ? artChapters : manuscriptChapters
    for (const ch of activeChapters) {
      const isUnplanned = alreadyApproved && !plannedChapterNumbers.has(ch.chapters)
      const anchor = isUnplanned ? (ch.created_at || project.created_at || '') : (project.created_at || '')
      result.set(ch.id, buildChapterSchedule(ch.id, currentOrderedStages, baseSlaMap, cellSlas, anchor))
    }
    return result
  }, [project, chapters, currentOrderedStages, baseSlaMap, cellSlas, activeTab, designChapters, artChapters, manuscriptChapters, alreadyApproved, plannedChapterNumbers])

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

  const unplannedChapters = useMemo(
    () => alreadyApproved ? chapters.filter(ch => !plannedChapterNumbers.has(ch.chapters)) : [],
    [alreadyApproved, chapters, plannedChapterNumbers]
  )

  const plannedChapters = useMemo(
    () => alreadyApproved ? chapters.filter(ch => plannedChapterNumbers.has(ch.chapters)) : chapters,
    [alreadyApproved, chapters, plannedChapterNumbers]
  )

  const getScheduleForChapter = useCallback((ch: Chapter) => {
    let trackWf = project?.workflow_name || ''
    let ordered: WorkflowStage[] = []
    if (ch.chapters === 'Design') {
      trackWf = designChapters[0]?.workflow || project?.workflow_name || ''
      ordered = wfStagesMap[trackWf] ?? []
    } else if (ch.chapters.toLowerCase().includes('art')) {
      trackWf = artChapters[0]?.workflow || project?.workflow_name || ''
      ordered = wfStagesMap[trackWf] ?? []
    } else {
      trackWf = manuscriptChapters[0]?.workflow || project?.workflow_name || ''
      ordered = wfStagesMap[trackWf] ?? []
    }

    const baseSched = buildBaseSchedule(ordered, masterMap, previewComposition, project?.created_at || '')
    const baseSlas = new Map<string, number | null>()
    baseSched.forEach(s => baseSlas.set(s.stageName, s.slaDays))

    const isUnplanned = alreadyApproved && !plannedChapterNumbers.has(ch.chapters)
    const anchor = isUnplanned ? (ch.created_at || project?.created_at || '') : (project?.created_at || '')
    
    return buildChapterSchedule(ch.id, ordered, baseSlas, cellSlas, anchor)
  }, [project, designChapters, artChapters, manuscriptChapters, wfStagesMap, masterMap, previewComposition, cellSlas, alreadyApproved, plannedChapterNumbers])

  // Helper: compute the latest stage-end date across a set of chapters and their workflow
  const getTrackFinalDue = useCallback((
    trackChapters: Chapter[],
    ordered: WorkflowStage[],
  ): Date | null => {
    if (trackChapters.length === 0 || ordered.length === 0) return null
    const baseSchedule = buildBaseSchedule(ordered, masterMap, previewComposition, project?.created_at || '')
    const baseSlas = new Map<string, number | null>()
    baseSchedule.forEach(s => baseSlas.set(s.stageName, s.slaDays))
    let max: Date | null = null
    for (const ch of trackChapters) {
      const isUnplanned = alreadyApproved && !plannedChapterNumbers.has(ch.chapters)
      const anchor = isUnplanned ? (ch.created_at || project?.created_at || '') : (project?.created_at || '')
      const sched = buildChapterSchedule(ch.id, ordered, baseSlas, cellSlas, anchor)
      const last = sched.length > 0 ? sched[sched.length - 1].due : null
      if (last && (!max || last > max)) max = last
    }
    return max
  }, [project, masterMap, previewComposition, cellSlas, alreadyApproved, plannedChapterNumbers])

  const manuscriptFinalDue = useMemo(() => {
    const stages = wfStagesMap[manuscriptChapters[0]?.workflow || project?.workflow_name || ''] ?? []
    return getTrackFinalDue(manuscriptChapters, stages)
  }, [manuscriptChapters, wfStagesMap, project, getTrackFinalDue])

  const artFinalDue = useMemo(() => {
    const stages = wfStagesMap[artChapters[0]?.workflow || ''] ?? []
    return getTrackFinalDue(artChapters, stages)
  }, [artChapters, wfStagesMap, getTrackFinalDue])

  const designFinalDue = useMemo(() => {
    const stages = wfStagesMap[designChapters[0]?.workflow || ''] ?? []
    return getTrackFinalDue(designChapters, stages)
  }, [designChapters, wfStagesMap, getTrackFinalDue])

  // Combined final due used for Approve (latest across all tracks)
  const finalDue = useMemo(() => {
    const candidates = [manuscriptFinalDue, artFinalDue, designFinalDue].filter(Boolean) as Date[]
    return candidates.length > 0 ? candidates.reduce((a, b) => (b > a ? b : a)) : null
  }, [manuscriptFinalDue, artFinalDue, designFinalDue])

  // Final due for the currently visible tab
  const activeTabFinalDue = useMemo(() => {
    if (activeTab === 'art') return artFinalDue
    if (activeTab === 'design') return designFinalDue
    return manuscriptFinalDue
  }, [activeTab, manuscriptFinalDue, artFinalDue, designFinalDue])

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
          const chSched = getScheduleForChapter(ch)
          return chSched.map(s => ({
            chapters:           ch.chapters,
            stage_name:         s.stageName,
            planned_start_date: toLocalISOString(s.start),
            planned_end_date:   toLocalISOString(s.due),
            sla:                s.slaDays,
            workflow:           ch.workflow || wfName || '',
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
          const chSched = getScheduleForChapter(ch)
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

  async function handleApproveNewChapters() {
    if (!project || unplannedChapters.length === 0) return
    setApprovingNew(true)
    const prjCode = project.code || project.project_code
    const wfName = project.workflow_name
    try {
      if (prjCode) {
        if (previewComposition) {
          await Promise.all(unplannedChapters.map(ch =>
            chaptersApi.update(ch.id, { complexity_level: previewComposition })
          )).catch(e => console.error('[New chapter planning] complexity update failed', e))
        }

        const items = unplannedChapters.flatMap(ch => {
          const chSched = getScheduleForChapter(ch)
          return chSched.map(s => ({
            chapters:           ch.chapters,
            stage_name:         s.stageName,
            planned_start_date: toLocalISOString(s.start),
            planned_end_date:   toLocalISOString(s.due),
            sla:                s.slaDays,
            workflow:           ch.workflow || wfName || '',
          }))
        })
        await stageDetailsApi.createPlanningRows({
          client:               project.division_code ?? '',
          project:              prjCode,
          workflow:             wfName ?? '',
          complexity_level:     previewComposition,
          project_manager_name: project.project_manager ?? null,
          items,
        })

        await Promise.all(unplannedChapters.map(ch => {
          const chSched = getScheduleForChapter(ch)
          const stageSched = ch.stage_name
            ? (chSched.find(s => s.stageName === ch.stage_name) ?? chSched[0])
            : chSched[0]
          if (!stageSched) return Promise.resolve()
          return chaptersApi.update(ch.id, { due_date: toLocalDateStr(stageSched.due), status: 'In-progress' })
        })).catch(e => console.error('[New chapter planning] due date update failed', e))
      }
      toast.success(`Planning approved for ${unplannedChapters.length} new chapter${unplannedChapters.length !== 1 ? 's' : ''}`)
      await loadPlanningData({ silent: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Failed to approve new chapter planning: ${msg}`)
    } finally {
      setApprovingNew(false)
    }
  }

  // `editable` is per-row, not the global `alreadyApproved` flag — a chapter added after
  // approval must show editable SLA inputs even while the rest of the project is locked.
  function renderChapterRow(ch: Chapter, editable: boolean) {
    const chSched = chapterSchedules.get(ch.id) ?? baseSchedule
    return (
      <tr
        key={ch.id}
        className="border-b border-border hover:bg-accent transition-colors group bg-card"
      >
        <td className="px-4 py-3 font-semibold text-text sticky left-0 z-10 whitespace-nowrap w-[144px] min-w-[144px] max-w-[144px] shadow-[inset_-1px_0_0_var(--color-border)] bg-card group-hover:bg-accent transition-colors">
          {ch.chapters}
        </td>
        <td className={`px-4 py-3 text-xs text-muted sticky left-[144px] z-10 whitespace-nowrap w-[176px] min-w-[176px] max-w-[176px] truncate bg-card group-hover:bg-accent transition-colors ${
          activeTab === 'design' ? 'shadow-[inset_-2px_0_0_var(--color-border)]' : 'shadow-[inset_-1px_0_0_var(--color-border)]'
        }`}>
          {ch.chapter_title || '—'}
        </td>
        {activeTab === 'manuscript' && (
          <>
            <td className="px-4 py-3 text-xs text-center sticky left-[320px] z-10 whitespace-nowrap w-[112px] min-w-[112px] max-w-[112px] shadow-[inset_-1px_0_0_var(--color-border)] font-medium text-text bg-card group-hover:bg-accent transition-colors">
              {ch.manuscript_pages != null ? ch.manuscript_pages : '—'}
            </td>
            <td className="px-4 py-3 text-xs text-center sticky left-[432px] z-10 whitespace-nowrap w-[96px] min-w-[96px] max-w-[96px] shadow-[inset_-2px_0_0_var(--color-border)] font-medium text-text bg-card group-hover:bg-accent transition-colors">
              {ch.word_count != null ? Math.floor(ch.word_count / 250) : '—'}
            </td>
          </>
        )}
        {activeTab === 'art' && (
          <td className="px-4 py-3 text-xs text-center sticky left-[320px] z-10 whitespace-nowrap w-[112px] min-w-[112px] max-w-[112px] shadow-[inset_-2px_0_0_var(--color-border)] font-medium text-text bg-card group-hover:bg-accent transition-colors">
            {ch.art_count != null && ch.art_count > 0 ? ch.art_count : 'no arts'}
          </td>
        )}
        {chSched.map(s => {
          const isCellEdited = s.slaDays !== (baseSlaMap.get(s.stageName) ?? null)
          const delayDays    = delayMap.get(`${ch.chapters}||${s.stageName}`)
                            ?? (ch.delayed_stages?.[s.stageName] ?? 0)
          const dbKey = `${ch.chapters}||${s.stageName}`
          const displayStart = !editable && dbDates[dbKey] ? dbDates[dbKey].start : s.start
          const displayDue = !editable && dbDates[dbKey] ? dbDates[dbKey].due : s.due
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
                  {!editable ? (
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
              disabled={alreadyApproved && unplannedChapters.length === 0}
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

          {activeTabFinalDue && (
            <div className="flex flex-col items-end gap-0.5">
              <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border ${
                alreadyApproved
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  : 'text-primary bg-accent border-primary/20'
              }`}>
                <Flag size={12} />
                {activeTab === 'art' ? 'Art' : activeTab === 'design' ? 'Design' : 'Manuscript'} Final Deliverable: {fmt(activeTabFinalDue)}
              </div>
              {alreadyApproved && actualFinalDue && finalDue && actualFinalDue > finalDue && (
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
              isLoading={approving}
              leftIcon={<CheckCircle2 size={14} />}
            >
              {approving ? "Approving…" : "Approve Planning"}
            </Button>
          )}
        </div>
      </div>

      {/* Track Selection Tabs */}
      <div className="flex border-b border-border bg-card px-6 py-2 gap-4 flex-shrink-0">
        <button
          onClick={() => setActiveTab('manuscript')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
            activeTab === 'manuscript'
              ? 'text-primary bg-accent border-primary/20 shadow-sm font-bold'
              : 'text-muted border-transparent hover:bg-accent/40'
          }`}
        >
          📚 Manuscripts ({manuscriptChapters.length})
        </button>
        <button
          onClick={() => setActiveTab('art')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
            activeTab === 'art'
              ? 'text-primary bg-accent border-primary/20 shadow-sm font-bold'
              : 'text-muted border-transparent hover:bg-accent/40'
          }`}
        >
          📐 Art Tracks ({artChapters.length})
        </button>
        <button
          onClick={() => setActiveTab('design')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
            activeTab === 'design'
              ? 'text-primary bg-accent border-primary/20 shadow-sm font-bold'
              : 'text-muted border-transparent hover:bg-accent/40'
          }`}
        >
          🎨 Design ({designChapters.length})
        </button>
      </div>

      {!(activeTab === 'design' && designChapters.length === 0) && (
        <div className="px-6 py-2 bg-surface border-b border-border text-xs text-muted flex items-center justify-between flex-shrink-0">
          <span>Active Workflow: <strong>{activeWorkflowName || 'None'}</strong></span>
          <span>Chapters count: <strong>{activeChapters.length}</strong></span>
        </div>
      )}

      {/* Planning Table */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'design' && designChapters.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted">
            <Layers size={40} className="mb-3 opacity-30" />
            <p className="text-sm">Design track is not enabled for this project.</p>
          </div>
        ) : baseSchedule.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted">
            <Calendar size={40} className="mb-3 opacity-30" />
            <p className="text-sm">No workflow stages found for active workflow '{activeWorkflowName}'.</p>
          </div>
        ) : (
          <>
          {alreadyApproved && unplannedChapters.length > 0 && (
            <div className="sticky left-0 z-30 w-fit min-w-full px-4 pt-4 pb-2 flex items-center justify-between gap-3 bg-amber-50 border-b border-amber-200">
              <p className="text-xs text-amber-800 flex items-center gap-1.5">
                <Calendar size={13} />
                {unplannedChapters.length} new chapter{unplannedChapters.length !== 1 ? 's' : ''} added after approval — plan and approve below to give them due dates.
              </p>
              <Button
                onClick={handleApproveNewChapters}
                disabled={approvingNew}
                isLoading={approvingNew}
                leftIcon={<CheckCircle2 size={14} />}
              >
                {approvingNew ? "Approving…" : `Approve ${unplannedChapters.length} New Chapter${unplannedChapters.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          )}
          <table className="w-full border-collapse text-sm min-w-max">
            <PlanningTableHeader stages={baseSchedule} activeTab={activeTab} />
            <tbody>
              {activeChapters.filter(ch => !alreadyApproved || plannedChapterNumbers.has(ch.chapters)).length === 0 ? (
                <tr>
                  <td colSpan={(activeTab === 'manuscript' ? 4 : activeTab === 'art' ? 3 : 2) + baseSchedule.length} className="px-4 py-16 text-center text-sm text-muted">
                    No active chapters found for this track.
                  </td>
                </tr>
              ) : (
                [...activeChapters]
                  .filter(ch => !alreadyApproved || plannedChapterNumbers.has(ch.chapters))
                  .sort((a, b) => a.chapters.localeCompare(b.chapters, undefined, { numeric: true }))
                  .map(ch => renderChapterRow(ch, !alreadyApproved))
              )}
            </tbody>
          </table>

          {alreadyApproved && activeChapters.filter(ch => !plannedChapterNumbers.has(ch.chapters)).length > 0 && (
            <>
              <div className="sticky left-0 z-30 w-fit min-w-full mt-6 px-4 py-2 text-left text-xs font-semibold text-amber-800 bg-amber-50 border-y border-amber-200">
                New Chapters in {activeTab === 'manuscript' ? 'Manuscript' : activeTab === 'art' ? 'Art' : 'Design'} Track — Pending Planning
              </div>
              <table className="w-full border-collapse text-sm min-w-max">
                <PlanningTableHeader stages={baseSchedule} activeTab={activeTab} />
                <tbody>
                  {[...activeChapters]
                    .filter(ch => !plannedChapterNumbers.has(ch.chapters))
                    .sort((a, b) => a.chapters.localeCompare(b.chapters, undefined, { numeric: true }))
                    .map(ch => renderChapterRow(ch, true))}
                </tbody>
              </table>
            </>
          )}
          </>
        )}
      </div>
    </div>
  )
}
