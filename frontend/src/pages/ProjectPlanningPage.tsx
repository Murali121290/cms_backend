import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Layers, Calendar, Flag, AlertTriangle, Edit3, X, History } from 'lucide-react'
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
import { stageDetailsApi, type StageHistoryEntry } from '@/api/stageDetails'
import { useAuthStore } from '@/store/useAuthStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useUsersStore } from '@/stores/usersStore'
import { formatDateTime } from '@/utils/dateUtils'

function getUserFullName(u?: { first_name?: string | null; last_name?: string | null; username?: string } | null): string | null {
  if (!u) return null
  const fn = (u.first_name || '').trim()
  const ln = (u.last_name || '').trim()
  if (fn && ln) {
    if (fn.endsWith(` ${ln}`) || fn.endsWith(ln)) {
      return fn
    }
    return `${fn} ${ln}`
  }
  return fn || ln || u.username || null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// "Design" and "CE support" are organizational folders created alongside every project
// (see create_project_with_initial_files), not real manuscript chapters — they shouldn't
// take up rows in the per-chapter planning/scheduling grid.
const VIRTUAL_CHAPTER_NAMES = new Set(['Design', 'CE support'])

function orderStages(stages: WorkflowStage[]): WorkflowStage[] {
  const byName = new Map(stages.map(s => [s.stage_name, s]))
  const first = stages.find(s => !s.previous_stage)
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

function fmtDateTime(dateStr: string): string {
  return formatDateTime(dateStr)
}

function sortChapters(a: { chapters: string }, b: { chapters: string }) {
  function getOrderValue(ch: string) {
    if (ch === 'FM') return { type: 1, val: 0, str: '' }
    if (/^\d+$/.test(ch)) return { type: 2, val: parseInt(ch, 10), str: '' }
    if (ch === 'BM') return { type: 3, val: 0, str: '' }
    if (/^[A-Za-z]$/.test(ch)) return { type: 4, val: 0, str: ch }
    return { type: 5, val: 0, str: ch }
  }
  const orderA = getOrderValue(a.chapters)
  const orderB = getOrderValue(b.chapters)
  if (orderA.type !== orderB.type) return orderA.type - orderB.type
  if (orderA.type === 2) return orderA.val - orderB.val
  return orderA.str.localeCompare(orderB.str)
}

function pickSla(stage: Stage, composition: string | null): number | null {
  if (composition === 'Low') return stage.sla_level1
  if (composition === 'High') return stage.sla_level3
  return stage.sla_level2
}

function pickPages(stage: Stage, composition: string | null): number | null {
  if (composition === 'Low') return stage.pages_level1 ?? null
  if (composition === 'High') return stage.pages_level3 ?? null
  return stage.pages_level2 ?? null
}

interface StageSchedule {
  stageName: string
  start: Date
  due: Date
  slaDays: number | null
  pageNorm?: number | null
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
    const master = masterMap.get(ws.stage_name)
    const slaDays = master ? pickSla(master, composition) : null
    const pageNorm = master ? pickPages(master, composition) : null
    const start = new Date(cursor)
    const due = new Date(start)
    if (slaDays) due.setDate(due.getDate() + slaDays)
    result.push({ stageName: ws.stage_name, start, due, slaDays, pageNorm })
    // Next stage starts the day after this one is due, not on the same day.
    cursor.setTime(due.getTime())
    cursor.setDate(cursor.getDate() + 1)
  }
  return result
}

function buildTrackSchedules(
  trackChapters: Chapter[],
  orderedStages: WorkflowStage[],
  baseSlaMap: Map<string, number | null>,
  cellSlas: Record<number, Record<string, number | null>>,
  effectiveAnchor: string,
  pageNormMap?: Map<string, number | null>,
  projectCreatedAt?: string,
  dbDates?: Record<string, { start: Date; due: Date }>,
  checkCompleted?: (chapter: Chapter, stageName: string) => boolean,
  alreadyApproved?: boolean,
  isAdjusting?: boolean,
  plannedChapterNumbers?: Set<string>,
): Map<number, StageSchedule[]> {
  const result = new Map<number, StageSchedule[]>()
  if (trackChapters.length === 0 || orderedStages.length === 0) return result

  // Track the due date of the first stage across chapters so due dates stagger progressively
  let prevFirstStageDue: Date | null = null
  const sorted = [...trackChapters].sort(sortChapters)

  for (const ch of sorted) {
    const isUnplanned = alreadyApproved && plannedChapterNumbers && !plannedChapterNumbers.has(ch.chapters)
    const anchor = isUnplanned
      ? (ch.created_at || effectiveAnchor)
      : (alreadyApproved && !isAdjusting ? (projectCreatedAt || effectiveAnchor) : effectiveAnchor)

    const cursor = validDate(anchor)
    const chOverrides = cellSlas[ch.id] ?? {}
    const chPages = ch.manuscript_pages != null
      ? ch.manuscript_pages
      : (ch.word_count ? Math.ceil(ch.word_count / 250) : null)

    const chSched: StageSchedule[] = []

    for (let stageIdx = 0; stageIdx < orderedStages.length; stageIdx++) {
      const ws = orderedStages[stageIdx]
      const isCompleted = checkCompleted ? checkCompleted(ch, ws.stage_name) : false
      const dbKey = `${ch.chapters}||${ws.stage_name}`
      const pageNorm = pageNormMap ? pageNormMap.get(ws.stage_name) : null

      // Individual chapter SLA based on page norm or master SLA
      const pageBasedSla = (pageNorm && chPages != null && chPages > 0)
        ? Math.max(1, Math.ceil(chPages / pageNorm))
        : null

      const slaDays = ws.stage_name in chOverrides
        ? chOverrides[ws.stage_name]
        : (pageBasedSla ?? baseSlaMap.get(ws.stage_name) ?? null)

      let start: Date
      let due: Date

      if (isCompleted && dbDates && dbDates[dbKey]) {
        start = new Date(dbDates[dbKey].start)
        due = new Date(dbDates[dbKey].due)
      } else {
        if (stageIdx === 0) {
          // Stage 1 (Job Initiation):
          // ALL chapters start on Day 1 (anchor date)
          start = new Date(cursor)
          if (pageNorm != null && pageNorm > 0 && prevFirstStageDue) {
            // Due date staggers progressively after the previous chapter finishes
            due = new Date(prevFirstStageDue)
            if (slaDays) due.setDate(due.getDate() + slaDays)
          } else {
            due = new Date(start)
            if (slaDays) due.setDate(due.getDate() + slaDays)
          }
          prevFirstStageDue = new Date(due)
        } else {
          // Subsequent stages:
          // Starts immediately the day after THIS chapter's preceding stage is due
          start = new Date(cursor)
          due = new Date(start)
          if (slaDays) due.setDate(due.getDate() + slaDays)
        }
      }

      chSched.push({ stageName: ws.stage_name, start, due, slaDays, pageNorm })
      // Next stage for THIS chapter starts the day after this stage is due
      cursor.setTime(due.getTime())
      cursor.setDate(cursor.getDate() + 1)
    }

    result.set(ch.id, chSched)
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
                {(s.slaDays != null || s.pageNorm != null) && (
                  <span className="text-[10px] font-normal normal-case tracking-normal text-muted/70 flex items-center gap-1">
                    {s.slaDays != null && <span>Default: {s.slaDays}d</span>}
                    {s.pageNorm != null && <span>({s.pageNorm} pgs)</span>}
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
                {(s.slaDays != null || s.pageNorm != null) && (
                  <span className="text-[10px] font-normal normal-case tracking-normal text-muted/70 flex items-center gap-1">
                    {s.slaDays != null && <span>Default: {s.slaDays}d</span>}
                    {s.pageNorm != null && <span>({s.pageNorm} pgs)</span>}
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
              {(s.slaDays != null || s.pageNorm != null) && (
                <span className="text-[10px] font-normal normal-case tracking-normal text-muted/70 flex items-center gap-1">
                  {s.slaDays != null && <span>Default: {s.slaDays}d</span>}
                  {s.pageNorm != null && <span>({s.pageNorm} pgs)</span>}
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
  const navigate = useNavigate()
  const viewer = useSessionStore(s => s.viewer)
  const { user } = useAuthStore()
  const currentUserFullName = getUserFullName(viewer) || getUserFullName(user) || null
  const id = Number(projectId)

  const [project, setProject] = useState<Project | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [wfStagesMap, setWfStagesMap] = useState<Record<string, WorkflowStage[]>>({})
  const [stageMasters, setStageMasters] = useState<Stage[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [approvingNew, setApprovingNew] = useState(false)
  const [isAdjusting, setIsAdjusting] = useState(false)
  const [previewComposition, setPreviewComposition] = useState<string | null>(null)
  const [cellSlas, setCellSlas] = useState<Record<number, Record<string, number | null>>>({})
  const [delayMap, setDelayMap] = useState<Map<string, number>>(new Map())
  const [actualFinalDue, setActualFinalDue] = useState<Date | null>(null)
  const [dbDates, setDbDates] = useState<Record<string, { start: Date; due: Date }>>({})
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set())
  const [stageHistoryMap, setStageHistoryMap] = useState<Map<string, StageHistoryEntry[]>>(new Map())
  const [isReasonModalOpen, setIsReasonModalOpen] = useState(false)
  const [adjustmentReason, setAdjustmentReason] = useState('')
  const [viewingHistory, setViewingHistory] = useState<{ chapter: string; stageName: string; history: StageHistoryEntry[] } | null>(null)
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

      if (chsRaw.filter(c => c.chapters !== 'Design').length === 0) {
        navigate(`/projects/${id}/mapping`, { replace: true })
        return
      }

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
      let compStages = new Set<string>()
      let histMap = new Map<string, StageHistoryEntry[]>()
      let maxDue: Date | null = null

      if (stageDetails.length > 0 && chsRaw.length > 0) {
        const sorted = [...stageDetails].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        const slaSeen = new Set<string>()

        for (const d of sorted) {
          const key = `${d.chapters}||${d.stage_name}`
          if (d.stage_status === 'Completed') {
            compStages.add(key)
          }
          if (d.history && Array.isArray(d.history) && d.history.length > 0 && !histMap.has(key)) {
            histMap.set(key, d.history)
          }
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
      setCompletedStages(compStages)
      setStageHistoryMap(histMap)
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

  const isStageCompleted = useCallback((chapter: Chapter, stageName: string) => {
    if (chapter.status === 'Completed') return true
    const key = `${chapter.chapters}||${stageName}`
    if (completedStages.has(key)) return true

    // Progression check: if chapter has moved past this stage in its workflow, it is completed
    if (chapter.stage_name) {
      const wfName = chapter.workflow || project?.workflow_name || ''
      const wfStages = wfStagesMap[wfName] ?? []
      const curIdx = wfStages.findIndex(ws => ws.stage_name === chapter.stage_name)
      const stageIdx = wfStages.findIndex(ws => ws.stage_name === stageName)
      if (curIdx !== -1 && stageIdx !== -1 && stageIdx < curIdx) {
        return true
      }
    }
    return false
  }, [completedStages, wfStagesMap, project?.workflow_name])

  useEffect(() => { loadPlanningData() }, [loadPlanningData])

  const isFirstCompChange = useRef(true)
  useEffect(() => {
    if (isFirstCompChange.current) {
      if (previewComposition !== null) {
        isFirstCompChange.current = false
      }
      return
    }
    setCellSlas({})
  }, [previewComposition])

  const masterMap = useMemo(() => {
    const m = new Map<string, Stage>()
    stageMasters.forEach(s => m.set(s.stage_name, s))
    return m
  }, [stageMasters])

  // Partition chapters into Design, Manuscripts, and Art tracks
  const designChapters = useMemo(() => chapters.filter(c => c.chapters === 'Design'), [chapters])
  const manuscriptChapters = useMemo(() => chapters.filter(c => c.chapters !== 'Design' && !c.chapters.toLowerCase().includes('art')), [chapters])
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

  const pageNormMap = useMemo(() => {
    const m = new Map<string, number | null>()
    baseSchedule.forEach(s => m.set(s.stageName, s.pageNorm ?? null))
    return m
  }, [baseSchedule])

  const alreadyApproved = project?.status === 'Active' || project?.status === 'Completed'
  const isEditable = !alreadyApproved || isAdjusting

  // Project deadline ceiling (cannot be exceeded)
  const projectDueDateStr = project?.due_date ? String(project.due_date).split('T')[0] : null
  const projectDueDate = useMemo(() => {
    if (!projectDueDateStr) return null
    return new Date(projectDueDateStr + 'T00:00:00')
  }, [projectDueDateStr])

  // Chapters with at least one persisted StageDetail row (i.e. already planned/approved).
  // A chapter added after the project was approved has none of these yet and needs its
  // own pass through planning — it must never be silently folded into the locked table.
  const plannedChapterNumbers = useMemo(() => {
    const s = new Set<string>()
    Object.keys(dbDates).forEach(key => s.add(key.split('||')[0]))
    return s
  }, [dbDates])

  // Track-level schedules computed with staggered delivery windows across chapters
  const allTrackSchedules = useMemo(() => {
    if (!project || chapters.length === 0) return new Map<number, StageSchedule[]>()
    const resultMap = new Map<number, StageSchedule[]>()
    const anchor = project.created_at || new Date().toISOString()

    // Manuscript track
    const msStages = wfStagesMap[manuscriptChapters[0]?.workflow || project.workflow_name || ''] ?? []
    const msBase = buildBaseSchedule(msStages, masterMap, previewComposition, anchor)
    const msBaseSla = new Map<string, number | null>()
    const msPageNorm = new Map<string, number | null>()
    msBase.forEach(s => {
      msBaseSla.set(s.stageName, s.slaDays)
      msPageNorm.set(s.stageName, s.pageNorm ?? null)
    })
    const msScheds = buildTrackSchedules(
      manuscriptChapters,
      msStages,
      msBaseSla,
      cellSlas,
      anchor,
      msPageNorm,
      project.created_at,
      dbDates,
      isStageCompleted,
      alreadyApproved,
      isAdjusting,
      plannedChapterNumbers,
    )
    msScheds.forEach((v, k) => resultMap.set(k, v))

    // Art track
    if (artChapters.length > 0) {
      const artStages = wfStagesMap[artChapters[0]?.workflow || ''] ?? []
      const artBase = buildBaseSchedule(artStages, masterMap, previewComposition, anchor)
      const artBaseSla = new Map<string, number | null>()
      const artPageNorm = new Map<string, number | null>()
      artBase.forEach(s => {
        artBaseSla.set(s.stageName, s.slaDays)
        artPageNorm.set(s.stageName, s.pageNorm ?? null)
      })
      const artScheds = buildTrackSchedules(
        artChapters,
        artStages,
        artBaseSla,
        cellSlas,
        anchor,
        artPageNorm,
        project.created_at,
        dbDates,
        isStageCompleted,
        alreadyApproved,
        isAdjusting,
        plannedChapterNumbers,
      )
      artScheds.forEach((v, k) => resultMap.set(k, v))
    }

    // Design track
    if (designChapters.length > 0) {
      const designStages = wfStagesMap[designChapters[0]?.workflow || ''] ?? []
      const designBase = buildBaseSchedule(designStages, masterMap, previewComposition, anchor)
      const designBaseSla = new Map<string, number | null>()
      const designPageNorm = new Map<string, number | null>()
      designBase.forEach(s => {
        designBaseSla.set(s.stageName, s.slaDays)
        designPageNorm.set(s.stageName, s.pageNorm ?? null)
      })
      const designScheds = buildTrackSchedules(
        designChapters,
        designStages,
        designBaseSla,
        cellSlas,
        anchor,
        designPageNorm,
        project.created_at,
        dbDates,
        isStageCompleted,
        alreadyApproved,
        isAdjusting,
        plannedChapterNumbers,
      )
      designScheds.forEach((v, k) => resultMap.set(k, v))
    }

    return resultMap
  }, [project, chapters, manuscriptChapters, artChapters, designChapters, wfStagesMap, masterMap, previewComposition, cellSlas, dbDates, isStageCompleted, alreadyApproved, isAdjusting, plannedChapterNumbers])

  const chapterSchedules = allTrackSchedules

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

  function handleDueDateChange(chId: number, stageName: string, startDate: Date, newDateStr: string) {
    if (!newDateStr) return
    const newDue = new Date(newDateStr + 'T00:00:00')
    const startZero = new Date(startDate)
    startZero.setHours(0, 0, 0, 0)
    const diffTime = newDue.getTime() - startZero.getTime()
    const diffDays = Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)))

    if (projectDueDateStr && newDateStr > projectDueDateStr) {
      toast.error(`Date cannot be above the project due date (${fmt(new Date(projectDueDateStr + 'T00:00:00'))})`)
      return
    }

    setCellSlas(prev => ({
      ...prev,
      [chId]: { ...(prev[chId] ?? {}), [stageName]: diffDays }
    }))
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
    return allTrackSchedules.get(ch.id) ?? []
  }, [allTrackSchedules])

  const manuscriptFinalDue = useMemo(() => {
    let max: Date | null = null
    for (const ch of manuscriptChapters) {
      const sched = allTrackSchedules.get(ch.id)
      const last = sched && sched.length > 0 ? sched[sched.length - 1].due : null
      if (last && (!max || last > max)) max = last
    }
    return max
  }, [manuscriptChapters, allTrackSchedules])

  const artFinalDue = useMemo(() => {
    let max: Date | null = null
    for (const ch of artChapters) {
      const sched = allTrackSchedules.get(ch.id)
      const last = sched && sched.length > 0 ? sched[sched.length - 1].due : null
      if (last && (!max || last > max)) max = last
    }
    return max
  }, [artChapters, allTrackSchedules])

  const designFinalDue = useMemo(() => {
    let max: Date | null = null
    for (const ch of designChapters) {
      const sched = allTrackSchedules.get(ch.id)
      const last = sched && sched.length > 0 ? sched[sched.length - 1].due : null
      if (last && (!max || last > max)) max = last
    }
    return max
  }, [designChapters, allTrackSchedules])

  // Combined final due used for Approve (latest across all tracks)
  const finalDue = useMemo(() => {
    const candidates = [manuscriptFinalDue, artFinalDue, designFinalDue].filter(Boolean) as Date[]
    return candidates.length > 0 ? candidates.reduce((a, b) => (b > a ? b : a)) : null
  }, [manuscriptFinalDue, artFinalDue, designFinalDue])

  // Check if final deliverable date exceeds the project due date
  const isExceedingDueDate = useMemo(() => {
    if (!projectDueDateStr || !finalDue) return false
    const finalDueStr = toLocalDateStr(finalDue)
    return finalDueStr > projectDueDateStr
  }, [projectDueDateStr, finalDue])

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

    // Guard: Final due cannot exceed project due date
    if (projectDueDateStr && toLocalDateStr(finalDue) > projectDueDateStr) {
      toast.error(`Adjusted final deliverable date (${fmt(finalDue)}) cannot be above the project due date (${fmt(projectDueDate!)})`)
      return
    }

    // Prompt for adjustment reason if re-approving an existing plan
    if (alreadyApproved) {
      setAdjustmentReason('')
      setIsReasonModalOpen(true)
      return
    }

    await executeApprove()
  }

  async function executeApprove(reason?: string) {
    if (!project || !finalDue) return

    setApproving(true)
    try {
      await projectsApi.update(project.id, {
        status: 'Active',
        due_date: project.due_date || toLocalDateStr(finalDue),
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
          return chSched
            .filter(s => !isStageCompleted(ch, s.stageName))
            .map(s => ({
              chapters: ch.chapters,
              stage_name: s.stageName,
              planned_start_date: toLocalISOString(s.start),
              planned_end_date: toLocalISOString(s.due),
              sla: s.slaDays,
              workflow: ch.workflow || wfName || '',
            }))
        })
        try {
          await stageDetailsApi.createPlanningRows({
            client: project.division_code ?? '',
            project: prjCode,
            workflow: wfName ?? '',
            complexity_level: previewComposition,
            project_manager_name: project.project_manager ?? null,
            reason: reason || null,
            changed_by: currentUserFullName || project.project_manager || null,
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

    toast.success(alreadyApproved ? 'Planning re-approved successfully' : 'Planning approved — project is now Active')
    setIsAdjusting(false)
    setIsReasonModalOpen(false)
    setAdjustmentReason('')
    if (alreadyApproved) {
      await loadPlanningData({ silent: true })
    } else {
      if (project.client_id) {
        navigate(`/clients/${project.client_id}/projects/${project.id}`)
      } else {
        navigate(`/projects/${project.id}`)
      }
    }
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
            chapters: ch.chapters,
            stage_name: s.stageName,
            planned_start_date: toLocalISOString(s.start),
            planned_end_date: toLocalISOString(s.due),
            sla: s.slaDays,
            workflow: ch.workflow || wfName || '',
          }))
        })
        await stageDetailsApi.createPlanningRows({
          client: project.division_code ?? '',
          project: prjCode,
          workflow: wfName ?? '',
          complexity_level: previewComposition,
          project_manager_name: project.project_manager ?? null,
          changed_by: currentUserFullName || project.project_manager || null,
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
    const chEffectivePages = ch.manuscript_pages != null
      ? ch.manuscript_pages
      : (ch.word_count ? Math.ceil(ch.word_count / 250) : null)
    return (
      <tr
        key={ch.id}
        className="border-b border-border hover:bg-accent transition-colors group bg-card"
      >
        <td className="px-4 py-3 font-semibold text-text sticky left-0 z-10 whitespace-nowrap w-[144px] min-w-[144px] max-w-[144px] shadow-[inset_-1px_0_0_var(--color-border)] bg-card group-hover:bg-accent transition-colors">
          {ch.chapters === 'FM' ? 'Front matter' : ch.chapters === 'BM' ? 'Back matter' : /^[A-Za-z]$/.test(ch.chapters) ? `Appendix ${ch.chapters}` : /^\d+$/.test(ch.chapters) ? `Chapter ${ch.chapters}` : ch.chapters}
        </td>
        <td className={`px-4 py-3 text-xs text-muted sticky left-[144px] z-10 whitespace-nowrap w-[176px] min-w-[176px] max-w-[176px] truncate bg-card group-hover:bg-accent transition-colors ${activeTab === 'design' ? 'shadow-[inset_-2px_0_0_var(--color-border)]' : 'shadow-[inset_-1px_0_0_var(--color-border)]'
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
          const delayDays = delayMap.get(`${ch.chapters}||${s.stageName}`)
            ?? (ch.delayed_stages?.[s.stageName] ?? 0)
          const dbKey = `${ch.chapters}||${s.stageName}`
          const isCompleted = isStageCompleted(ch, s.stageName)
          const isCellEditable = editable && !isCompleted
          const stageHist = stageHistoryMap.get(dbKey)

          const displayStart = dbDates[dbKey] ? dbDates[dbKey].start : s.start
          const displayDue = dbDates[dbKey] && (!editable || isCompleted) ? dbDates[dbKey].due : s.due
          const dueStr = toLocalDateStr(displayDue)
          const cellExceedsDue = projectDueDateStr ? dueStr > projectDueDateStr : false
          return (
            <td
              key={s.stageName}
              className={`px-4 py-3 border-r border-border/50 last:border-r-0 ${isCompleted ? 'bg-surface/40' : ''
                }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-9 text-[10px] font-semibold text-muted uppercase tracking-wide">Start</span>
                  <span className="text-text font-medium">{fmt(displayStart)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-9 text-[10px] font-semibold text-muted uppercase tracking-wide">Due</span>
                  {isCompleted ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-text font-medium">{fmt(displayDue)}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50">
                        <CheckCircle2 size={10} className="text-emerald-600 flex-shrink-0" />
                      </span>
                    </div>
                  ) : !isCellEditable ? (
                    <span className={`font-medium ${cellExceedsDue ? 'text-red-600 font-bold' : isCellEdited ? 'text-primary font-bold' : 'text-text'}`}>
                      {fmt(displayDue)}
                      {cellExceedsDue && (
                        <span className="text-[10px] ml-1 text-red-500 font-bold" title={`Exceeds project due date (${projectDueDateStr})`}>⚠️</span>
                      )}
                    </span>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        value={dueStr}
                        max={projectDueDateStr || undefined}
                        onChange={e => handleDueDateChange(ch.id, s.stageName, s.start, e.target.value)}
                        className={`w-[124px] text-[11px] border rounded px-1.5 py-0.5 text-text focus:outline-none focus:ring-1 focus:ring-primary/40 ${cellExceedsDue
                          ? 'border-red-400 bg-red-50 text-red-700 font-semibold'
                          : isCellEdited
                            ? 'border-amber-400 bg-amber-50/60 text-amber-800'
                            : 'bg-background border-border'
                          }`}
                        title={projectDueDateStr ? `Cannot be above ${projectDueDateStr}` : undefined}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-9 text-[10px] font-semibold text-muted uppercase tracking-wide">SLA</span>
                  {isCompleted ? (
                    <span className="text-[10px] font-medium text-muted">
                      {s.slaDays != null ? `${s.slaDays}d` : '—'}
                    </span>
                  ) : !isCellEditable ? (
                    <>
                      {s.slaDays != null && (
                        <span className="text-[10px] font-bold text-primary">{s.slaDays}d</span>
                      )}
                      {s.pageNorm != null && chEffectivePages != null && chEffectivePages > 0 && (
                        <span
                          className="text-[9px] text-muted/70 ml-1 whitespace-nowrap"
                          title={`${chEffectivePages} pages ÷ ${s.pageNorm} pgs/day norm = ${Math.ceil(chEffectivePages / s.pageNorm)}d`}
                        >
                          ({chEffectivePages}p ÷ {s.pageNorm})
                        </span>
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
                        className={`w-12 text-[11px] border rounded px-1.5 py-0.5 text-text focus:outline-none focus:ring-1 focus:ring-primary/40 ${cellExceedsDue
                          ? 'border-red-400 bg-red-50 text-red-700 font-semibold'
                          : isCellEdited
                            ? 'border-amber-400 bg-amber-50/60 text-amber-800'
                            : 'bg-background border-border'
                          }`}
                      />
                      <span className="text-[10px] text-muted">d</span>
                      {s.pageNorm != null && chEffectivePages != null && chEffectivePages > 0 && (
                        <span
                          className="text-[9px] text-muted/70 ml-0.5 whitespace-nowrap"
                          title={`${chEffectivePages} pages ÷ ${s.pageNorm} pgs/day norm = ${Math.ceil(chEffectivePages / s.pageNorm)}d`}
                        >
                          ({chEffectivePages}p ÷ {s.pageNorm})
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {stageHist && stageHist.length > 0 && (
                  <div className="pt-1 border-t border-border/40 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setViewingHistory({ chapter: ch.chapters, stageName: s.stageName, history: stageHist })}
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary-hover hover:underline transition-colors"
                      title="View adjustment history"
                    >
                      <History size={10} className="flex-shrink-0" />
                      <span>{stageHist.length} adjustment{stageHist.length !== 1 ? 's' : ''}</span>
                    </button>
                  </div>
                )}
              </div>
            </td>
          )
        })}
      </tr>
    )
  }

  async function handleBack() {
    navigate(-1)
  }

  if (loading) return <FullPageSpinner />
  if (!project) return (
    <div className="flex items-center justify-center h-64 text-muted text-sm">Project not found</div>
  )

  return (
    <div className="flex flex-col min-h-full">

      {/* Header */}
      <div className="px-6 py-3.5 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={handleBack}
            className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors flex-shrink-0"
            title="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1
              className="text-base sm:text-lg font-bold text-text truncate max-w-[240px] sm:max-w-xs md:max-w-sm lg:max-w-md xl:max-w-xl"
              title={project.project_title || project.title || project.code || project.project_code || `Project #${project.id}`}
            >
              {project.project_title || project.title || project.code || project.project_code || `Project #${project.id}`}
            </h1>
            <p className="text-xs text-muted flex items-center gap-1.5 mt-0.5 whitespace-nowrap">
              <Layers size={11} className="flex-shrink-0" />
              <span className="truncate">{project.workflow_name || 'No workflow'} · Project Planning</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="flex items-center gap-2 flex-shrink-0">
            <label className="text-xs text-muted font-medium whitespace-nowrap">Composition:</label>
            <select
              value={previewComposition ?? 'Medium'}
              onChange={e => setPreviewComposition(e.target.value)}
              disabled={alreadyApproved && !isAdjusting && unplannedChapters.length === 0}
              className="text-xs bg-surface border border-border rounded-lg px-2.5 h-8 text-text focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <option value="Low">Low (Level 1)</option>
              <option value="Medium">Medium (Level 2)</option>
              <option value="High">High (Level 3)</option>
            </select>
            {previewComposition !== (project.composition ?? 'Medium') && (
              <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded whitespace-nowrap">
                Preview only
              </span>
            )}
          </div>

          {/* Project Due Date Badge */}
          {projectDueDate && (
            <div
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 h-8 rounded-lg border whitespace-nowrap flex-shrink-0 ${isExceedingDueDate
                ? 'text-red-700 bg-red-50 border-red-300 font-semibold'
                : 'text-text bg-surface/80 border-border'
                }`}
              title={`Project Due Date: ${fmt(projectDueDate)}`}
            >
              <Calendar size={13} className={isExceedingDueDate ? 'text-red-600 flex-shrink-0' : 'text-muted flex-shrink-0'} />
              <span>Due: <span className="font-semibold text-text">{fmt(projectDueDate)}</span></span>
            </div>
          )}

          {activeTabFinalDue && (
            <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
              <div
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 h-8 rounded-lg border whitespace-nowrap ${isExceedingDueDate
                  ? 'text-red-700 bg-red-50 border-red-300 font-semibold'
                  : alreadyApproved
                    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    : 'text-primary bg-primary/10 border-primary/20'
                  }`}
                title={`${activeTab === 'art' ? 'Art' : activeTab === 'design' ? 'Design' : 'Manuscript'} Final Deliverable: ${fmt(activeTabFinalDue)}`}
              >
                <Flag size={12} className="flex-shrink-0" />
                <span>
                  {activeTab === 'art' ? 'Art' : activeTab === 'design' ? 'Design' : 'Manuscript'} Target: <span className="font-semibold">{fmt(activeTabFinalDue)}</span>
                </span>
              </div>
              {alreadyApproved && actualFinalDue && finalDue && actualFinalDue > finalDue && (
                <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                  <Flag size={9} className="flex-shrink-0" /> Updated: {fmt(actualFinalDue)} due to delays
                </div>
              )}
            </div>
          )}

          {alreadyApproved && !isAdjusting ? (
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 h-8 px-2.5 rounded-lg whitespace-nowrap flex-shrink-0">
                <CheckCircle2 size={13} className="text-emerald-600 flex-shrink-0" /> Planning Approved
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAdjusting(true)}
                leftIcon={<Edit3 size={13} />}
                className="text-xs whitespace-nowrap flex-shrink-0 h-8 px-3 font-medium"
              >
                Adjust Planning
              </Button>
            </div>
          ) : alreadyApproved && isAdjusting ? (
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsAdjusting(false)
                  loadPlanningData({ silent: true })
                }}
                leftIcon={<X size={13} />}
                className="text-xs whitespace-nowrap flex-shrink-0 h-8 px-3 text-muted hover:text-text font-medium"
              >
                Cancel
              </Button>
              <Button
                onClick={handleApprove}
                disabled={isExceedingDueDate || approving || !finalDue}
                isLoading={approving}
                size="sm"
                leftIcon={<CheckCircle2 size={14} />}
                variant={isExceedingDueDate ? "outline" : "primary"}
                className="text-xs whitespace-nowrap flex-shrink-0 h-8 px-3 font-medium"
                title={isExceedingDueDate ? `Cannot exceed Project Due Date (${projectDueDateStr})` : undefined}
              >
                {approving ? "Re-approving…" : "Re-approve Planning"}
              </Button>
            </div>
          ) : (
            <Button
              onClick={handleApprove}
              disabled={isExceedingDueDate || approving || !finalDue || chapters.length === 0}
              isLoading={approving}
              size="sm"
              leftIcon={<CheckCircle2 size={14} />}
              className="text-xs whitespace-nowrap flex-shrink-0 h-8 px-3 font-medium"
              title={isExceedingDueDate ? `Cannot exceed Project Due Date (${projectDueDateStr})` : undefined}
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
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${activeTab === 'manuscript'
            ? 'text-primary bg-accent border-primary/20 shadow-sm font-bold'
            : 'text-muted border-transparent hover:bg-accent/40'
            }`}
        >
          📚 Manuscripts ({manuscriptChapters.length})
        </button>
        <button
          onClick={() => setActiveTab('art')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${activeTab === 'art'
            ? 'text-primary bg-accent border-primary/20 shadow-sm font-bold'
            : 'text-muted border-transparent hover:bg-accent/40'
            }`}
        >
          📐 Art Tracks ({artChapters.length})
        </button>
        <button
          onClick={() => setActiveTab('design')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${activeTab === 'design'
            ? 'text-primary bg-accent border-primary/20 shadow-sm font-bold'
            : 'text-muted border-transparent hover:bg-accent/40'
            }`}
        >
          🎨 Design ({designChapters.length})
        </button>
      </div>

      {!(activeTab === 'design' && designChapters.length === 0) && (
        <div className="px-6 py-2 bg-surface border-b border-border text-xs text-muted flex items-center justify-between flex-shrink-0 gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span>Active Workflow: <strong>{activeWorkflowName || 'None'}</strong></span>
            {activeTab === 'manuscript' && activeChapters.reduce((sum, ch) => sum + (ch.manuscript_pages || 0), 0) > 0 && (
              <>
                <span className="text-border">|</span>
                <span>Total MS Pages: <strong className="text-text">{activeChapters.reduce((sum, ch) => sum + (ch.manuscript_pages || 0), 0).toLocaleString()} pgs</strong></span>
                {baseSchedule.filter(s => s.pageNorm != null && s.pageNorm > 0).map(s => (
                  <span key={s.stageName} className="flex items-center gap-1.5 text-primary font-medium">
                    <span className="text-border">|</span>
                    <span>
                      {s.stageName}: <strong>{s.pageNorm} pgs/day</strong>
                    </span>
                  </span>
                ))}
              </>
            )}
          </div>
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
            {isExceedingDueDate && (
              <div className="sticky left-0 z-30 w-fit min-w-full px-6 py-2.5 bg-red-50 border-b border-red-200 flex items-center justify-between text-xs text-red-800">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={15} className="text-red-600 flex-shrink-0" />
                  <span>
                    <strong>Due Date Exceeded:</strong> Calculated final deliverable date (<strong>{fmt(finalDue!)}</strong>) is above the project due date (<strong>{fmt(projectDueDate!)}</strong>). You must adjust stage dates or SLA days so the schedule finishes on or before <strong>{fmt(projectDueDate!)}</strong> before approving.
                  </span>
                </div>
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
                    .sort(sortChapters)
                    .map(ch => renderChapterRow(ch, isEditable))
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
                      .sort(sortChapters)
                      .map(ch => renderChapterRow(ch, true))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>

      {/* Adjustment Reason Modal */}
      {isReasonModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <History size={18} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-text">Adjustment Reason</h3>
                  <p className="text-xs text-muted">Provide a reason for re-approving planning changes</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsReasonModalOpen(false)
                  setAdjustmentReason('')
                }}
                className="text-muted hover:text-text p-1 rounded-lg hover:bg-surface transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-text block">
                Reason for Date / SLA Change <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={adjustmentReason}
                onChange={e => setAdjustmentReason(e.target.value)}
                placeholder="e.g., Client requested extension due to late manuscript delivery, author review delay..."
                className="w-full text-xs bg-surface border border-border rounded-lg p-3 text-text placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                autoFocus
              />
              <p className="text-[11px] text-muted">
                This reason will be recorded in the stage audit history alongside the before and after dates.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsReasonModalOpen(false)
                  setAdjustmentReason('')
                }}
                disabled={approving}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  if (!adjustmentReason.trim()) {
                    toast.error('Please enter a reason for the adjustment')
                    return
                  }
                  executeApprove(adjustmentReason.trim())
                }}
                isLoading={approving}
                disabled={!adjustmentReason.trim() || approving}
                leftIcon={<CheckCircle2 size={14} />}
              >
                Confirm & Re-approve
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Viewing Adjustment History Modal */}
      {viewingHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <History size={18} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-text">Adjustment History</h3>
                  <p className="text-xs text-muted">
                    Chapter {viewingHistory.chapter} · {viewingHistory.stageName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewingHistory(null)}
                className="text-muted hover:text-text p-1.5 rounded-lg hover:bg-surface transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
              {viewingHistory.history.map((entry, idx) => (
                <div key={idx} className="bg-surface/60 border border-border/80 rounded-lg p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between text-muted">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-text">Revision #{idx + 1}</span>
                      {entry.changed_by && (
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium text-[10px]">
                          by {useUsersStore.getState().getUserDisplayNameByUsername(entry.changed_by)}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px]">{fmtDateTime(entry.changed_at)}</span>
                  </div>
                  <div className="bg-background/80 rounded p-2 text-text font-medium text-[11px]">
                    <span className="text-muted block text-[10px] uppercase font-semibold">Reason:</span>
                    {entry.reason}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2 rounded bg-amber-50/60 border border-amber-200/60 text-amber-900">
                      <span className="font-bold text-[10px] block uppercase text-amber-700">Before</span>
                      <div>Start: {entry.before?.planned_start_date ? fmt(new Date(entry.before.planned_start_date)) : '—'}</div>
                      <div>Due: {entry.before?.planned_end_date ? fmt(new Date(entry.before.planned_end_date)) : '—'}</div>
                      <div>SLA: {entry.before?.sla != null ? `${entry.before.sla}d` : '—'}</div>
                    </div>
                    <div className="p-2 rounded bg-emerald-50/60 border border-emerald-200/60 text-emerald-900">
                      <span className="font-bold text-[10px] block uppercase text-emerald-700">After</span>
                      <div>Start: {entry.after?.planned_start_date ? fmt(new Date(entry.after.planned_start_date)) : '—'}</div>
                      <div>Due: {entry.after?.planned_end_date ? fmt(new Date(entry.after.planned_end_date)) : '—'}</div>
                      <div>SLA: {entry.after?.sla != null ? `${entry.after.sla}d` : '—'}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-border">
              <Button size="sm" variant="outline" onClick={() => setViewingHistory(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}