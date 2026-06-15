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

function buildSchedule(
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

  useEffect(() => {
    if (!id) return
    setLoading(true)
    projectsApi.getById(id)
      .then(async response => {
        const proj = response.project as unknown as Project
        setProject(proj)
        const projectCode = proj.code || proj.project_code || ''
        const workflowName = proj.workflow_name || ''

        // Ensure WMS chapter_details exist for this project
        await import('@/api/client').then(m => m.default.post(`/projects/${id}/sync-chapters`)).catch(() => undefined)

        const [chs, wf, masters] = await Promise.all([
          chaptersApi.getByProject(projectCode).catch(() => [] as Chapter[]),
          workflowName
            ? workflowsApi.getWorkflow(workflowName).catch(() => [] as WorkflowStage[])
            : Promise.resolve([] as WorkflowStage[]),
          stagesApi.list().catch(() => [] as Stage[]),
        ])
        setChapters(chs)
        setWfStages(wf)
        setStageMasters(masters)
        setPreviewComposition(proj.composition ?? 'Medium')
      })
      .catch(() => toast.error('Failed to load project'))
      .finally(() => setLoading(false))
  }, [id])

  const orderedStages = useMemo(() => orderStages(wfStages), [wfStages])

  const masterMap = useMemo(() => {
    const m = new Map<string, Stage>()
    stageMasters.forEach(s => m.set(s.stage_name, s))
    return m
  }, [stageMasters])

  const schedule = useMemo((): StageSchedule[] => {
    if (!project || orderedStages.length === 0) return []
    return buildSchedule(orderedStages, masterMap, previewComposition, project.created_at || '')
  }, [project, orderedStages, masterMap, previewComposition])

  async function handleApprove() {
    if (!project || schedule.length === 0) return
    setApproving(true)
    try {
      const lastDue    = schedule[schedule.length - 1].due
      const dueDateStr = lastDue.toISOString().split('T')[0]
      await projectsApi.update(project.id, { status: 'Active', due_date: dueDateStr })
      const prjCode = project.code || project.project_code
      if (prjCode) {
        await chaptersApi.bulkUpdateStatus(prjCode, 'In-progress')
      }
      toast.success('Planning approved — project is now Active')
      navigate(-1)
    } catch {
      toast.error('Failed to approve planning')
    } finally {
      setApproving(false)
    }
  }

  if (loading) return <FullPageSpinner />
  if (!project) return (
    <div className="flex items-center justify-center h-64 text-muted text-sm">Project not found</div>
  )

  const alreadyApproved = project.status === 'Active' || project.status === 'Completed'

  return (
    <div className="flex flex-col min-h-full">

      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-background flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
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

          {schedule.length > 0 && (
            <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border ${
              alreadyApproved
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : 'text-primary bg-accent border-primary/20'
            }`}>
              <Flag size={12} />
              Final Due Date: {fmt(schedule[schedule.length - 1].due)}
            </div>
          )}

          {alreadyApproved ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
            <CheckCircle2 size={13} /> Planning Approved
          </span>
        ) : (
          <Button
            onClick={handleApprove}
            disabled={approving || schedule.length === 0 || chapters.length === 0}
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
        {schedule.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted">
            <Calendar size={40} className="mb-3 opacity-30" />
            <p className="text-sm">No workflow stages found. Assign a workflow to this project first.</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface border-b-2 border-border">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider sticky left-0 z-10 bg-surface whitespace-nowrap min-w-32 border-r border-border">
                  Chapter
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap min-w-40 border-r border-border">
                  File Name
                </th>
                {schedule.map(s => (
                  <th key={s.stageName} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap min-w-52 border-r border-border last:border-r-0">
                    {s.stageName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chapters.length === 0 ? (
                <tr>
                  <td colSpan={2 + schedule.length} className="px-4 py-16 text-center text-sm text-muted">
                    No chapters found. Upload a zip file to add chapters first.
                  </td>
                </tr>
              ) : (
                chapters.map((ch, idx) => (
                  <tr
                    key={ch.id}
                    className={`border-b border-border hover:bg-accent/20 transition-colors ${
                      idx % 2 === 0 ? 'bg-background' : 'bg-surface/20'
                    }`}
                  >
                    <td className="px-4 py-3 font-semibold text-text sticky left-0 z-10 bg-inherit whitespace-nowrap border-r border-border">
                      {ch.chapters}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted whitespace-nowrap border-r border-border">
                      {ch.chapter_title || '—'}
                    </td>
                    {schedule.map(s => (
                      <td key={s.stageName} className="px-4 py-3 border-r border-border/50 last:border-r-0">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="w-9 text-[10px] font-semibold text-muted uppercase tracking-wide">Start</span>
                            <span className="text-text font-medium">{fmt(s.start)}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="w-9 text-[10px] font-semibold text-muted uppercase tracking-wide">Due</span>
                            <span className="text-text font-medium">{fmt(s.due)}</span>
                          </div>
                          {s.slaDays != null && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="w-9 text-[10px] font-semibold text-muted uppercase tracking-wide">SLA</span>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                                {s.slaDays} Day{s.slaDays !== 1 ? 's' : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
