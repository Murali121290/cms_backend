import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ChevronRight,
  Calendar, Clock, Zap, BookOpen, AlertCircle, CheckCircle2,
  RotateCcw, Layers, User, BookMarked, Info, Edit2, Plus, Bookmark
} from 'lucide-react'
import { ViewSwitcher } from '@/components/ui/ViewSwitcher'
import { useViewMode } from '@/hooks/useViewMode'
import { projectsApi } from '@/api/projects'
import type { Project } from '@/api/projects'
import { chaptersApi } from '@/api/chapters'
import type { Chapter } from '@/api/chapters'
import { workflowsApi } from '@/api/workflows'
import type { WorkflowStage } from '@/api/workflows'
import { usersApi } from '@/api/users'
import type { User as AppUser } from '@/api/users'
import { stageDetailsApi } from '@/api/stageDetails'
import { stagesApi } from '@/api/stages'
import type { Stage } from '@/api/stages'
import { toast } from '@/store/useToastStore'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { uiPaths } from '@/utils/appPaths'
import { useStylesheetsQuery } from '@/features/stylesheets/useStylesheetsQuery'
import { ProjectInfoModal } from './ProjectInfoModal'
import { Modal } from '@/components/ui/Modal'
import { UploadZone } from '@/components/ui/UploadZone'
import { getApiErrorMessage } from '@/api/client'
import { uploadChapterFiles } from '@/api/files'
import { useRBAC } from '@/hooks/useRBAC'
import { ROLE_PERMISSIONS } from '@/config/rbacConfig'

// ── Helpers ────────────────────────────────────────────────────────────────────

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

type StageInfo = { due: string; sla: number | null }

function isDelayed(ch: Chapter, plannedDueDates?: Map<string, StageInfo>): boolean {
  if (ch.status === 'complete') return false
  const due = (ch.stage_name && plannedDueDates)
    ? (plannedDueDates.get(`${ch.chapters}||${ch.stage_name}`)?.due ?? ch.due_date)
    : ch.due_date
  return !!due && new Date(due) < new Date()
}

// Effective due = planned_end_date for the chapter's current stage (dynamic), falling back to chapter.due_date
function getEffectiveDue(ch: Chapter, plannedDueDates: Map<string, StageInfo>): { due: string | null; delayed: boolean } {
  const info = ch.stage_name ? plannedDueDates.get(`${ch.chapters}||${ch.stage_name}`) : undefined
  const due = info?.due ?? ch.due_date
  const delayed = !!due && ch.status !== 'complete' && new Date(due) < new Date()
  return { due, delayed }
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function statusMeta(status: string): { cls: string; label: string } {
  switch (status) {
    case 'complete': return { cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200', label: 'Complete' }
    case 'In-progress': return { cls: 'bg-amber-50  text-amber-700  border border-amber-200', label: 'In Progress' }
    case 'Hold': return { cls: 'bg-slate-50  text-slate-600  border border-slate-200', label: 'Hold' }
    case 'In-query': return { cls: 'bg-blue-50   text-blue-700   border border-blue-200', label: 'In-query' }
    default: return { cls: 'bg-gray-50   text-gray-600   border border-gray-200', label: status }
  }
}

function cardBorderCls(ch: Chapter): string {
  if (ch.status === 'complete') return 'border-l-4 border-l-emerald-500'
  if (isDelayed(ch)) return 'border-l-4 border-l-red-500'
  if (ch.priority === 'Fast Track') return 'border-l-4 border-l-purple-500'
  if (ch.status === 'In-progress') return 'border-l-4 border-l-amber-400'
  if (ch.status === 'Hold') return 'border-l-4 border-l-slate-400'
  if (ch.status === 'In-query') return 'border-l-4 border-l-blue-400'
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
      className={`bg-card rounded-xl border px-4 py-3 flex items-center gap-3 shadow-sm transition-all flex-1 min-w-0 ${onClick ? 'cursor-pointer hover:shadow-md' : ''
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

// ── Role config ────────────────────────────────────────────────────────────────

// Roles that work across every stage rather than owning a specific one — edit this
// list to change which roles are exempt from workflow-rail highlighting and always
// selectable in assignee dropdowns regardless of stage role mapping.
const PRIVILEGED_ROLES = ['project manager', 'admin', 'team lead']

function isPrivilegedRole(role: string): boolean {
  const norm = role.toLowerCase()
  return PRIVILEGED_ROLES.some(p => norm.includes(p))
}

function normalizeRole(role: string): string {
  return role.toLowerCase().replace(/\s+/g, '')
}

// True if `userRole` should be assignable/highlighted for `stageName`, given the
// stage → role-name mapping fetched from stagesApi. Stages with no roles mapped
// impose no restriction (fail open) so untouched stages keep working as before.
function isRoleAllowedForStage(userRole: string, stageName: string | null | undefined, stageRolesMap: Map<string, string[]>): boolean {
  if (!userRole) return false
  if (isPrivilegedRole(userRole)) return true
  if (!stageName) return true
  const stageRoles = stageRolesMap.get(stageName)
  if (!stageRoles || stageRoles.length === 0) return true
  const norm = normalizeRole(userRole)
  return stageRoles.some(r => normalizeRole(r) === norm)
}

// ── Workflow Rail ──────────────────────────────────────────────────────────────

function WorkflowRail({ stages, chapters, filterStage, onStageClick, stageRolesMap }: {
  stages: WorkflowStage[]
  chapters: Chapter[]
  filterStage: string
  onStageClick: (s: string) => void
  stageRolesMap: Map<string, string[]>
}) {
  const { roles, canAccess } = useRBAC()

  const countByStage = useMemo(() => {
    const m = new Map<string, number>()
    chapters.forEach(c => { if (c.stage_name) m.set(c.stage_name, (m.get(c.stage_name) ?? 0) + 1) })
    return m
  }, [chapters])

  // PM/Admin/Team Lead roles work across all stages, so they get no per-stage highlight.
  const isHighlightExempt = roles.some(isPrivilegedRole)

  if (stages.length === 0) return null

  return (
    <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-6 py-3">
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
        <Layers size={13} className="text-muted flex-shrink-0 mr-1" />
        {stages.map((stage, i) => {
          const cnt = countByStage.get(stage.stage_name) ?? 0
          const active = filterStage === stage.stage_name
          const isMyStage = !isHighlightExempt
            && canAccess(stageRolesMap.get(stage.stage_name) ?? [])
          return (
            <span key={stage.stage_name} className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => onStageClick(stage.stage_name)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${active
                  ? 'bg-primary text-white'
                  : isMyStage
                    ? 'bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100'
                    : 'bg-card border border-border text-text hover:bg-accent'
                  }`}
              >
                {/* <span className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center flex-shrink-0 ${
                  active ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
                }`}>{i + 1}</span> */}
                {stage.stage_name}
                {cnt > 0 && (
                  <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${active ? 'bg-white/20 text-white' : isMyStage ? 'bg-amber-500/20 text-amber-800' : 'bg-primary/10 text-primary'
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

// ── Assignee Select ────────────────────────────────────────────────────────────

function getUserDisplayName(user_name: string | null | undefined, users: AppUser[]): string {
  if (!user_name) return 'Unassigned'
  const u = users.find(x => x.user_name === user_name)
  if (u) {
    const fn = (u.first_name || '').trim()
    const ln = (u.last_name || '').trim()
    const full = `${fn} ${ln}`.trim()
    if (full) return full
  }
  return user_name
}

function AssigneeSelect({ value, users, onChange, disabled, widthCls = 'w-28', className, onClick, updating, stageName, stageRolesMap }: {
  value: string | null
  users: AppUser[]
  onChange: (val: string) => void
  disabled?: boolean
  widthCls?: string
  className?: string
  onClick?: (e: React.MouseEvent) => void
  updating?: boolean
  // When provided, the dropdown is restricted to users whose role is mapped to
  // this stage (plus PRIVILEGED_ROLES) — the currently-assigned user is always
  // kept as an option even if their role no longer matches the stage mapping.
  stageName?: string | null
  stageRolesMap?: Map<string, string[]>
}) {
  const { canAccess } = useRBAC()
  const canEdit = canAccess(ROLE_PERMISSIONS.edit_assignee)

  const currentDisplay = getUserDisplayName(value, users)

  if (!canEdit) {
    return (
      <span className={`text-[11px] text-text font-medium px-2 py-0.5 border border-transparent truncate block ${widthCls} ${className ?? ''}`} title={currentDisplay}>
        {currentDisplay}
      </span>
    )
  }

  const active = users.filter(u => u.active_status)
  const assignable = stageRolesMap
    ? active.filter(u => isRoleAllowedForStage(u.role || '', stageName, stageRolesMap) || u.user_name === value)
    : active

  return (
    <div className={`relative flex items-center ${widthCls} ${className ?? ''}`} onClick={onClick}>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        disabled={disabled || updating}
        className="text-[11px] bg-background border border-border rounded-md pl-2 pr-6 py-0.5 text-text focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60 appearance-none cursor-pointer w-full truncate"
        title={currentDisplay}
      >
        <option value="">— Unassigned —</option>
        {assignable.map(u => {
          const fn = (u.first_name || '').trim()
          const ln = (u.last_name || '').trim()
          const fullName = `${fn} ${ln}`.trim()
          const label = fullName ? `${fullName} (${u.user_name})` : u.user_name
          return (
            <option key={u.id} value={u.user_name}>{label}</option>
          )
        })}
      </select>
      {updating ? (
        <span className="absolute right-1.5 flex items-center justify-center pointer-events-none">
          <Spinner size="sm" className="w-3 h-3 border-primary/30 border-t-primary" />
        </span>
      ) : (
        <span className="pointer-events-none absolute right-1.5 text-muted text-[9px]">▾</span>
      )}
    </div>
  )
}

// ── Chapter Card ───────────────────────────────────────────────────────────────

interface ChapterCardProps {
  chapter: Chapter
  users: AppUser[]
  plannedDueDates: Map<string, StageInfo>
  stageRolesMap: Map<string, string[]>
  onAssigneeChange: (chapter: Chapter, val: string) => Promise<boolean>
  onViewDetails: (chapter: Chapter) => void
}

function ChapterCard({ chapter, users, plannedDueDates, stageRolesMap, onAssigneeChange, onViewDetails }: ChapterCardProps) {
  const [updating, setUpdating] = useState(false)

  const status = statusMeta(chapter.status)
  const { due: effectiveDue, delayed } = getEffectiveDue(chapter, plannedDueDates)

  async function handleAssignee(val: string) {
    setUpdating(true)
    await onAssigneeChange(chapter, val)
    setUpdating(false)
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

      {/* File Pipeline Status Badges */}
      {!chapter.chapters?.toLowerCase().includes('art') && chapter.workflow !== 'WF-11 Art Process' && (
        <div className="px-4 py-2 border-t border-border flex flex-wrap gap-1.5">
          {!chapter.style_status && !chapter.xml_status && !chapter.indesign_status && !chapter.final_delivery_status && !chapter.structuring_status ? (
            <span className="text-[10px] italic text-muted">No pipeline assets generated yet.</span>
          ) : (
            <>
              {/* Style Validation Status */}
              {chapter.style_status === 'valid' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={10} className="text-emerald-500" /> Style: Valid
                </span>
              )}
              {chapter.style_status === 'invalid' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                  <AlertCircle size={10} className="text-red-500" /> Style: Invalid
                </span>
              )}
              {chapter.style_status === 'pending' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                  <Clock size={10} className="text-amber-500 animate-spin" /> Style: Pending
                </span>
              )}

              {/* Structuring Status */}
              {chapter.structuring_status === 'completed' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                  <CheckCircle2 size={10} className="text-sky-500" /> Structuring: Complete
                </span>
              )}
              {chapter.structuring_status === 'pending' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                  <Clock size={10} className="text-amber-500 animate-spin" /> Structuring: Pending
                </span>
              )}
              {chapter.structuring_status === 'failed' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                  <AlertCircle size={10} className="text-red-500" /> Structuring: Failed
                </span>
              )}

              {/* XML Validation Status */}
              {chapter.xml_status === 'valid' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={10} className="text-emerald-500" /> XML: Valid
                </span>
              )}
              {chapter.xml_status === 'invalid' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                  <AlertCircle size={10} className="text-red-500" /> XML: Invalid
                </span>
              )}
              {chapter.xml_status === 'pending' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                  <Clock size={10} className="text-amber-500 animate-spin" /> XML: Pending
                </span>
              )}
              {/* InDesign File Status */}
              {chapter.indesign_status === 'generated' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                  <Layers size={10} className="text-purple-500" /> InDesign
                </span>
              )}
              {/* Final Delivery Status */}
              {chapter.final_delivery_status === 'generated' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
                  <Bookmark size={10} className="text-teal-500" /> Final Delivery
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Fields */}
      <div className="px-4 pb-3 space-y-1.5 text-xs flex-1">

        {/* Assignee + Due date row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <User size={11} className="text-muted flex-shrink-0" />
            <AssigneeSelect value={chapter.current_assignee_name} users={users} onChange={handleAssignee} disabled={updating} updating={updating} stageName={chapter.stage_name} stageRolesMap={stageRolesMap} />
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Calendar size={11} className={delayed ? 'text-red-500' : 'text-muted'} />
            <span className={`text-[11px] ${delayed ? 'text-red-600 font-semibold' : 'text-text'}`}>
              {formatDate(effectiveDue)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────


export function ProjectWorkflow() {
  const { projectId, clientId } = useParams<{ projectId: string; clientId?: string }>()
  const navigate = useNavigate()
  const id = Number(projectId)

  const { roles } = useRBAC()
  const showBatchButtons = roles.some(role => {
    const r = role.toLowerCase()
    return r === 'admin' || r === 'xml operator' || r === 'xml manager'
  })

  const [project, setProject] = useState<Project | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [wfStagesMap, setWfStagesMap] = useState<Record<string, WorkflowStage[]>>({})
  const [stageRolesMap, setStageRolesMap] = useState<Map<string, string[]>>(new Map())
  const [combineConfirmOpen, setCombineConfirmOpen] = useState(false)
  const [combining, setCombining] = useState(false)
  const [users, setUsers] = useState<AppUser[]>([])
  const [plannedDueDates, setPlannedDueDates] = useState<Map<string, StageInfo>>(new Map())
  // Maps WMS chapter number (e.g. "01") → CMS chapter DB id for correct navigation
  const [cmsChapterIdMap, setCmsChapterIdMap] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'manuscript' | 'art' | 'design'>('manuscript')

  const [isInfoOpen, setIsInfoOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)


  const stylesheetsQuery = useStylesheetsQuery(id || null)
  const activeStylesheet = stylesheetsQuery.data?.active_stylesheet
  const stylesheetCount = stylesheetsQuery.data?.stylesheets?.length ?? 0

  const [viewMode, setViewMode] = useViewMode('view:chapters', 'large')

  // Fetch InDesign templates for this project
  const templatesQuery = useQuery<{
    id: number
    filename: string
    category: string
    file_size: string
    uploaded_by: string
    uploaded_on: string
  }[]>({
    queryKey: ["indesign-templates", project?.id],
    queryFn: async () => {
      if (!project?.id) return []
      const response = await fetch(`/api/v2/projects/${project.id}/indesign-templates`)
      if (!response.ok) {
        throw new Error("Failed to fetch templates")
      }
      return response.json()
    },
    enabled: !!project?.id,
  })

  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterStage, setFilterStage] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const [bulkStage, setBulkStage] = useState('')
  const [bulkAssignee, setBulkAssignee] = useState('')
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [bulkAssignModalOpen, setBulkAssignModalOpen] = useState(false)
  const [selectedBulkChapterIds, setSelectedBulkChapterIds] = useState<Set<number>>(new Set())
  const [batchModalType, setBatchModalType] = useState<'word_to_xml' | 'style_validation' | 'structuring' | 'xml_to_indesign' | 'indesign_to_xml' | null>(null)
  const [batchSelectedChapterIds, setBatchSelectedChapterIds] = useState<Set<number>>(new Set())
  const [batchTemplateId, setBatchTemplateId] = useState<number | ''>('')

  useEffect(() => {
    if (batchModalType === 'xml_to_indesign' && !batchTemplateId) {
      const templates = templatesQuery.data ?? []
      if (templates.length > 0) {
        setBatchTemplateId(templates[0].id)
      }
    }
  }, [batchModalType, templatesQuery.data, batchTemplateId])

  const [isAddChapterOpen, setIsAddChapterOpen] = useState(false)
  const [newChapterNumber, setNewChapterNumber] = useState('')
  const [newChapterFile, setNewChapterFile] = useState<File | null>(null)
  const [addingChapter, setAddingChapter] = useState(false)
  const [addChapterError, setAddChapterError] = useState<string | null>(null)

  const [newChapterCategory, setNewChapterCategory] = useState('indesign')

  const DESIGN_UPLOAD_CATEGORIES = [
    { key: 'indesign', label: 'InDesign' },
    { key: 'common_art', label: 'Common Art' },
    { key: 'pdf', label: 'Pdf' },
    { key: 'font', label: 'Font' },
    { key: 'library', label: 'Library' },
    { key: 'template', label: 'template' },
    { key: 'print_preset', label: 'Print Preset' },
    { key: 'misc', label: 'Final delivery' },
  ]

  useEffect(() => {
    if (!id) return
    setLoading(true)

    // Load users in background — don't block the main page render
    usersApi.list().then(setUsers).catch(() => { })

    projectsApi.getById(id)
      .then(async response => {
        const p = response.project as unknown as Project
        setProject(p)
        const projectCode = p.code || p.project_code || ''

        const [chs, details, cmsChapters, allStages] = await Promise.all([
          chaptersApi.getByProject(projectCode).catch(() => [] as Chapter[]),
          projectCode
            ? stageDetailsApi.listByProject(projectCode).catch(() => [])
            : Promise.resolve([]),
          projectsApi.getProjectChapters(id).catch(() => ({ project: null, chapters: [] })),
          stagesApi.list().catch(() => [] as Stage[]),
        ])

        setChapters(chs)
        setStageRolesMap(new Map(allStages.map(s => [s.stage_name, s.roles])))

        // Find unique workflows across all chapters, including default project workflow
        const uniqueWfs = Array.from(new Set(chs.map(c => c.workflow).filter(Boolean))) as string[]
        if (p.workflow_name && !uniqueWfs.includes(p.workflow_name)) {
          uniqueWfs.push(p.workflow_name)
        }

        // Fetch all workflows stages
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

        // Build number → CMS chapter id map with multiple normalizations for robust matching
        const idMap = new Map<string, number>()
        for (const c of cmsChapters.chapters ?? []) {
          if (!c.number) continue
          idMap.set(c.number, c.id)
          idMap.set(parseInt(c.number, 10).toString(), c.id)
          idMap.set(c.number.padStart(2, '0'), c.id)
        }
        setCmsChapterIdMap(idMap)

        const sorted = [...details].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        const dueDateMap = new Map<string, StageInfo>()
        for (const d of sorted) {
          if (!d.planned_end_date) continue
          const key = `${d.chapters}||${d.stage_name}`
          if (dueDateMap.has(key)) continue
          const due = d.planned_end_date.split('T')[0]
          dueDateMap.set(key, { due, sla: d.sla })
        }
        setPlannedDueDates(dueDateMap)
      })
      .catch(() => toast.error('Failed to load project'))
      .finally(() => setLoading(false))
  }, [id])

  // Partition chapters into Design, Manuscripts, and Art tracks
  const designChapters = useMemo(() => chapters
    .filter(c => c.chapters === 'Design')
    .sort(sortChapters), [chapters])
  const manuscriptChapters = useMemo(() => chapters
    .filter(c => c.chapters !== 'Design' && !c.chapters.toLowerCase().includes('art'))
    .sort(sortChapters), [chapters])
  const artChapters = useMemo(() => chapters
    .filter(c => c.chapters.toLowerCase().includes('art'))
    .sort(sortChapters), [chapters])

  const batchTargets = useMemo(() => {
    if (filterStage) {
      return manuscriptChapters.filter(c => c.stage_name === filterStage)
    }
    return manuscriptChapters
  }, [manuscriptChapters, filterStage])

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

  const orderedStages = useMemo(() => {
    return wfStagesMap[activeWorkflowName] ?? []
  }, [activeWorkflowName, wfStagesMap])

  const summary = useMemo(() => {
    const actual = activeChapters.filter(c => c.chapters !== 'CE support')
    const total = actual.length
    const complete = actual.filter(c => c.status === 'complete').length
    const inProg = actual.filter(c => c.status === 'In-progress').length
    const hold = actual.filter(c => c.status === 'Hold').length
    const inQuery = actual.filter(c => c.status === 'In-query').length
    const yts = actual.filter(c => c.status === 'Received').length
    const delayed = actual.filter(c => isDelayed(c, plannedDueDates)).length
    return { total, complete, inProg, hold, inQuery, yts, delayed }
  }, [activeChapters, plannedDueDates])

  const assigneeOptions = useMemo(() => {
    const actual = activeChapters.filter(c => c.chapters !== 'CE support')
    const set = new Set(actual.map(c => c.current_assignee_name).filter(Boolean) as string[])
    return Array.from(set).sort()
  }, [activeChapters])

  const filtered = useMemo(() => activeChapters
    .filter(ch => {
      if (filterAssignee && ch.current_assignee_name !== filterAssignee) return false
      if (filterStage && ch.stage_name !== filterStage) return false
      if (filterStatus === '__delayed__' && !isDelayed(ch, plannedDueDates)) return false
      if (filterStatus && filterStatus !== '__delayed__' && ch.status !== filterStatus) return false
      return true
    })
    .sort(sortChapters)
    , [activeChapters, filterAssignee, filterStage, filterStatus, plannedDueDates])

  // Chapters currently sitting in the stage picked for bulk assignment, ascending by chapter number
  const bulkTargets = useMemo(
    () => bulkStage
      ? activeChapters
        .filter(c => c.stage_name === bulkStage)
        .sort(sortChapters)
      : [],
    [activeChapters, bulkStage]
  )

  // Ids of chapters in the picked stage that have no assignee yet
  const unassignedBulkIds = useMemo(
    () => new Set(bulkTargets.filter(c => !c.current_assignee_name).map(c => c.id)),
    [bulkTargets]
  )

  const isOnlyUnassignedSelected = unassignedBulkIds.size > 0
    && selectedBulkChapterIds.size === unassignedBulkIds.size
    && [...selectedBulkChapterIds].every(id => unassignedBulkIds.has(id))

  // Subset of bulkTargets the user has checked off in the Group Assign modal
  const selectedBulkChapters = useMemo(
    () => bulkTargets.filter(c => selectedBulkChapterIds.has(c.id)),
    [bulkTargets, selectedBulkChapterIds]
  )

  // Next sequential chapter number, zero-padded (e.g. "06") — chapters must be added in order, no gaps
  const nextChapterNumber = useMemo(() => {
    const nums = chapters.map(c => parseInt(c.chapters, 10)).filter(n => !isNaN(n))
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
    return String(next).padStart(2, '0')
  }, [chapters])

  const nextArtChapterNumber = useMemo(() => {
    const regex = /^Ch\s+(\d+)\s+-\s+Art$/
    const nums = chapters
      .map(c => {
        const match = c.chapters.match(regex)
        return match ? parseInt(match[1], 10) : NaN
      })
      .filter(n => !isNaN(n))
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
    return String(next).padStart(2, '0')
  }, [chapters])

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

  async function handleAssigneeChange(chapter: Chapter, val: string, opts?: { silent?: boolean }): Promise<boolean> {
    const assignee = val || null
    const projectCode = project?.code || project?.project_code || ''
    try {
      if (projectCode && chapter.stage_name) {
        await stageDetailsApi.assignToStage(projectCode, chapter.chapters, chapter.stage_name, assignee)
      }
      const info = chapter.stage_name ? plannedDueDates.get(`${chapter.chapters}||${chapter.stage_name}`) : undefined
      let newDue: string | null = chapter.due_date
      if (assignee && info?.sla) {
        const d = new Date()
        d.setDate(d.getDate() + info.sla)
        newDue = d.toISOString().split('T')[0]
      }
      const updated = await chaptersApi.update(chapter.id, {
        current_assignee_name: assignee,
        due_date: newDue,
      })
      handleChapterUpdate(chapter.id, updated)
      if (!opts?.silent) {
        if (assignee) {
          toast.success(`Assigned to ${assignee}`)
        } else {
          toast.success('Chapter unassigned successfully')
        }
      }
      return true
    } catch {
      if (!opts?.silent) toast.error('Failed to update assignee')
      return false
    }
  }

  async function handleBulkAssign() {
    if (!bulkStage || selectedBulkChapters.length === 0) return
    setBulkAssigning(true)
    const results = await Promise.all(
      selectedBulkChapters.map(c => handleAssigneeChange(c, bulkAssignee, { silent: true }))
    )
    setBulkAssigning(false)
    setBulkAssignModalOpen(false)
    const succeeded = results.filter(Boolean).length
    const failed = results.length - succeeded
    if (failed === 0) {
      toast.success(`Assigned ${succeeded} chapter${succeeded !== 1 ? 's' : ''} in ${bulkStage} to ${bulkAssignee || 'Unassigned'}`)
    } else {
      toast.error(`Assigned ${succeeded}/${results.length} chapters — ${failed} failed`)
    }
    setBulkStage('')
    setBulkAssignee('')
    setSelectedBulkChapterIds(new Set())
  }

  async function handleBatchProcess(processType: string) {
    if (selectedBulkChapters.length === 0 || !project) return
    setBatchProcessing(true)
    try {
      const response = await fetch(`/api/v2/projects/${project.id}/batch-jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          process_type: processType,
          chapter_ids: selectedBulkChapters.map(c => c.id),
          mode: 'style',
          options: processType === 'structuring' ? { structuring_method: 'manual' } : undefined
        })
      })
      const result = await response.json()
      if (response.ok && result.success) {
        let label = 'Word to XML'
        if (processType === 'style_validation') label = 'Style Validation'
        else if (processType === 'structuring') label = 'Word Structuring'
        else if (processType === 'xml_to_indesign') label = 'XML to InDesign'
        else if (processType === 'indesign_to_xml') label = 'InDesign to Final'
        toast.success(`Triggered ${label} for ${result.triggered_count} chapters.`)
        setBulkAssignModalOpen(false)

        // Refresh chapters list
        const chsRes = await chaptersApi.getByProject(project?.code || project?.project_code || '')
        setChapters(chsRes)
      } else {
        toast.error(result.message || 'Failed to trigger batch processing')
      }
    } catch (err: any) {
      toast.error(err.message || 'An error occurred during batch processing')
    } finally {
      setBatchProcessing(false)
      setBulkStage('')
      setBulkAssignee('')
      setSelectedBulkChapterIds(new Set())
    }
  }

  async function handleDedicatedBatchProcess() {
    if (!batchModalType || batchSelectedChapterIds.size === 0 || !project) return
    setBatchProcessing(true)
    const selectedIds = Array.from(batchSelectedChapterIds)

    let templateFileId: number | undefined = undefined
    if (batchModalType === 'xml_to_indesign' && batchTemplateId) {
      const stylesheets = stylesheetsQuery.data?.stylesheets ?? []
      const selectedSs = stylesheets.find(s => s.id === batchTemplateId)
      if (selectedSs && selectedSs.analyzed_file_ids && selectedSs.analyzed_file_ids.length > 0) {
        templateFileId = selectedSs.analyzed_file_ids[0]
      }
    }

    try {
      let batchOptions: Record<string, any> | undefined = undefined
      if (templateFileId) {
        batchOptions = { template_file_id: templateFileId }
      } else if (batchModalType === 'structuring') {
        batchOptions = { structuring_method: 'manual' }
      }

      const response = await fetch(`/api/v2/projects/${project.id}/batch-jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          process_type: batchModalType,
          chapter_ids: selectedIds,
          mode: 'style',
          options: batchOptions
        })
      })
      const result = await response.json()
      if (response.ok && result.success) {
        let processLabel = 'Word to XML'
        if (batchModalType === 'xml_to_indesign') processLabel = 'XML to InDesign'
        if (batchModalType === 'indesign_to_xml') processLabel = 'InDesign to Final'
        if (batchModalType === 'style_validation') processLabel = 'Style Validation'
        if (batchModalType === 'structuring') processLabel = 'Word Structuring'

        toast.success(`Triggered ${processLabel} for ${result.triggered_count} chapters.`)
        setBatchModalType(null)
        setBatchSelectedChapterIds(new Set())

        // Refresh chapters list
        const chsRes = await chaptersApi.getByProject(project?.code || project?.project_code || '')
        setChapters(chsRes)
      } else {
        toast.error(result.message || 'Failed to trigger batch processing')
      }
    } catch (err: any) {
      toast.error(err.message || 'An error occurred during batch processing')
    } finally {
      setBatchProcessing(false)
    }
  }

  function openAddChapter() {
    setNewChapterNumber(activeTab === 'art' ? nextArtChapterNumber : nextChapterNumber)
    setNewChapterFile(null)
    setAddChapterError(null)
    setNewChapterCategory('indesign')
    setIsAddChapterOpen(true)
  }

  async function handleCreateChapter() {
    if (!newChapterFile) return
    setAddingChapter(true)
    setAddChapterError(null)
    try {
      if (activeTab === 'design') {
        const designChapter = designChapters[0]
        if (!designChapter) {
          setAddChapterError('Design track is not enabled for this project.')
          return
        }
        await uploadChapterFiles({
          projectId: id,
          chapterId: designChapter.id,
          category: newChapterCategory,
          files: [newChapterFile],
        })
        const refreshed = await chaptersApi.getByProject(project?.code || project?.project_code || '')
        setChapters(refreshed)
        setIsAddChapterOpen(false)
        toast.success(`File uploaded to Design / ${newChapterCategory}`)
        if (project?.status === 'Active' || project?.status === 'Completed') {
          navigate(`/projects/${id}/planning`)
        }
        return
      }

      if (activeTab === 'art') {
        const result = await chaptersApi.createArtChaptersFromZip(id, newChapterFile)
        setChapters(prev => [...prev, ...result.created])
        setIsAddChapterOpen(false)
        const skippedNote = result.skipped.length > 0 ? `, ${result.skipped.length} skipped` : ''
        toast.success(`${result.created.length} Art chapter(s) created${skippedNote}`)
        if (result.created.length > 0 && (project?.status === 'Active' || project?.status === 'Completed')) {
          navigate(`/projects/${id}/planning`)
        }
        return
      }

      const result = await chaptersApi.createManuscriptChaptersFromZip(id, newChapterFile)
      setChapters(prev => [...prev, ...result.created])
      setIsAddChapterOpen(false)
      const skippedNote = result.skipped.length > 0 ? `, ${result.skipped.length} skipped` : ''
      toast.success(`${result.created.length} chapter(s) created${skippedNote}`)
      if (result.created.length > 0 && (project?.status === 'Active' || project?.status === 'Completed')) {
        navigate(`/projects/${id}/planning`)
      }
      return
    } catch (err) {
      setAddChapterError(getApiErrorMessage(err, 'Failed to create chapter'))
    } finally {
      setAddingChapter(false)
    }
  }

  const hasFilters = filterAssignee || filterStage || filterStatus

  if (loading) return <FullPageSpinner />
  if (!project) return (
    <div className="flex flex-col items-center justify-center h-64 text-muted">
      <AlertCircle size={32} className="mb-2 opacity-40" />
      <p>Project not found</p>
    </div>
  )

  function openChapter(ch: Chapter) {
    if (ch.status === 'Received') {
      toast.error(`Chapter ${ch.chapters} needs planning approval before it can be opened — approve it in Planning first.`)
      return
    }
    const num = ch.chapters
    const cmsId = cmsChapterIdMap.get(num) ?? cmsChapterIdMap.get(parseInt(num, 10).toString()) ?? cmsChapterIdMap.get(num.padStart(2, '0')) ?? null
    if (!cmsId) { toast.error(`Chapter "${num}" has no files yet.`); return }
    navigate(`${clientId ? `/clients/${clientId}/projects/${projectId}` : `/projects/${projectId}`}/chapters/${cmsId}`)
  }

  async function handleCombineBook() {
    setCombining(true)
    try {
      const response = await fetch(`/api/v2/projects/${id}/combine-book`, {
        method: 'POST',
      })
      if (!response.ok) {
        const errorText = await response.text()
        let errorMsg = 'Failed to combine book files.'
        try {
          const errJson = JSON.parse(errorText)
          if (errJson.detail) errorMsg = errJson.detail
        } catch { }
        throw new Error(errorMsg)
      }

      toast.success('Book files combined and saved to Final files successfully!')
      setCombineConfirmOpen(false)
      window.location.reload()

    } catch (err: any) {
      toast.error(err.message || 'Failed to combine book files.')
    } finally {
      setCombining(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full relative">

      {/* ── Page Header ── */}
      <div className="px-6 py-4 border-b border-border bg-background flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            onClick={() => {
              if (clientId) {
                navigate(`/clients/${clientId}/projects`)
              } else {
                navigate('/clients')
              }
            }}
            className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors mt-0.5 flex-shrink-0"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-text">
                {project.project_title || project.title || project.code || project.project_code || `Project #${project.id}`}
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
              <button
                onClick={() => setIsInfoOpen(true)}
                title="View project info"
                className="text-muted hover:text-primary transition-colors flex-shrink-0 ml-2"
              >
                <Info size={14} />
              </button>
              <button
                onClick={() => setIsEditOpen(true)}
                title="Edit project"
                className="text-muted hover:text-primary transition-colors flex-shrink-0 ml-1.5"
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={() => {
                  if (project.project_manager !== viewer?.username && !canAccess(['admin'])) {
                    toast.error('Only the assigned Project Manager can open planning.')
                    return
                  }
                  const contentChapters = chapters.filter(c => c.chapters !== 'Design' && c.chapters !== 'CE support')
                  if (contentChapters.length === 0) {
                    navigate(`/projects/${id}/mapping`)
                  } else {
                    navigate(`/projects/${id}/planning`)
                  }
                }}
                title="Project planning"
                className="text-muted hover:text-primary transition-colors flex-shrink-0 ml-1.5"
              >
                <Calendar size={14} />
              </button>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-muted">
              {(project.code || project.project_code) && <span>{project.code || project.project_code}</span>}
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

        {/* Chapter counts + Stylesheets button */}
        <div className="flex items-center gap-3 flex-shrink-0 text-xs text-muted">
          <span className="flex items-center gap-1">
            <BookOpen size={12} /> {summary.total} chapters
          </span>
          {summary.complete > 0 && (
            <span className="flex items-center gap-1 text-emerald-600">
              <CheckCircle2 size={12} /> {summary.complete} done
            </span>
          )}
          <button
            onClick={openAddChapter}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={12} />
            New Chapter
          </button>
          <button
            onClick={() => navigate(uiPaths.projectStylesheets(id))}
            title={activeStylesheet ? `Active: ${activeStylesheet.name}` : 'No active stylesheet'}
            className="relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-surface text-text font-medium transition-colors"
          >
            <BookMarked size={12} />
            Stylesheets
            {stylesheetCount > 0 && (
              <span className="text-[10px] bg-primary/10 text-primary px-1 rounded font-bold">{stylesheetCount}</span>
            )}
            {activeStylesheet && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 absolute -top-0.5 -right-0.5 ring-1 ring-white" />
            )}
          </button>
        </div>
      </div>

      {/* Track Selection Tabs */}
      <div className="flex border-b border-border bg-card px-6 py-2 gap-4 flex-shrink-0">
        <button
          onClick={() => {
            setActiveTab('manuscript')
            setFilterStage('')
            setFilterStatus('')
          }}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${activeTab === 'manuscript'
              ? 'text-primary bg-accent border-primary/20 shadow-sm font-bold'
              : 'text-muted border-transparent hover:bg-accent/40'
            }`}
        >
          📚 Manuscripts ({manuscriptChapters.length})
        </button>
        <button
          onClick={() => {
            setActiveTab('art')
            setFilterStage('')
            setFilterStatus('')
          }}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${activeTab === 'art'
              ? 'text-primary bg-accent border-primary/20 shadow-sm font-bold'
              : 'text-muted border-transparent hover:bg-accent/40'
            }`}
        >
          📐 Art Tracks ({artChapters.length})
        </button>
        <button
          onClick={() => {
            setActiveTab('design')
            setFilterStage('')
            setFilterStatus('')
          }}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${activeTab === 'design'
              ? 'text-primary bg-accent border-primary/20 shadow-sm font-bold'
              : 'text-muted border-transparent hover:bg-accent/40'
            }`}
        >
          🎨 Design ({designChapters.length})
        </button>
      </div>

      {/* ── Sticky Workflow Rail ── */}
      <WorkflowRail
        stages={orderedStages}
        chapters={activeChapters}
        filterStage={filterStage}
        onStageClick={s => setFilterStage(prev => prev === s ? '' : s)}
        stageRolesMap={stageRolesMap}
      />

      <div className="flex-1 px-6 py-5 space-y-5">

        {/* ── Summary Widgets ── */}
        <div className="flex flex-wrap gap-3">
          <SummaryWidget label="Total" value={summary.total} icon={BookOpen} iconCls="bg-blue-50    text-blue-600" onClick={() => setFilterStatus('')} active={filterStatus === ''} />
          {summary.yts > 0 && <SummaryWidget label="YTS" value={summary.yts} icon={Clock} iconCls="bg-indigo-50 text-indigo-600" onClick={() => setFilterStatus(prev => prev === 'Received' ? '' : 'Received')} active={filterStatus === 'Received'} />}
          {summary.delayed > 0 && <SummaryWidget label="Delayed" value={summary.delayed} icon={AlertCircle} iconCls="bg-red-50   text-red-600" onClick={() => setFilterStatus(prev => prev === '__delayed__' ? '' : '__delayed__')} active={filterStatus === '__delayed__'} />}
          <SummaryWidget label="In Progress" value={summary.inProg} icon={RotateCcw} iconCls="bg-amber-50   text-amber-600" onClick={() => setFilterStatus(prev => prev === 'In-progress' ? '' : 'In-progress')} active={filterStatus === 'In-progress'} />
          {summary.hold > 0 && <SummaryWidget label="Hold" value={summary.hold} icon={AlertCircle} iconCls="bg-slate-50 text-slate-600" onClick={() => setFilterStatus(prev => prev === 'Hold' ? '' : 'Hold')} active={filterStatus === 'Hold'} />}
          {summary.inQuery > 0 && <SummaryWidget label="In-query" value={summary.inQuery} icon={BookOpen} iconCls="bg-blue-50  text-blue-700" onClick={() => setFilterStatus(prev => prev === 'In-query' ? '' : 'In-query')} active={filterStatus === 'In-query'} />}
          <SummaryWidget label="Completed" value={summary.complete} icon={CheckCircle2} iconCls="bg-emerald-50 text-emerald-600" onClick={() => setFilterStatus(prev => prev === 'complete' ? '' : 'complete')} active={filterStatus === 'complete'} />
        </div>

        {/* ── Filters + Group Assign ── */}
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
            {assigneeOptions.map(a => <option key={a} value={a}>{getUserDisplayName(a, users)} ({a})</option>)}
          </select>

          {hasFilters && (
            <button
              onClick={() => { setFilterAssignee(''); setFilterStage(''); setFilterStatus('') }}
              className="flex items-center gap-1 text-xs text-danger hover:underline"
            >
              <RotateCcw size={11} /> Clear
            </button>
          )}

          <span className="w-px h-5 bg-border mx-1" />

          {/* Group Assign */}
          <span className="text-xs text-muted flex items-center gap-1 mr-1">
            <Layers size={11} /> Group Assign
          </span>

          <select
            value={bulkStage}
            onChange={e => { setBulkStage(e.target.value); setBulkAssignee(''); setSelectedBulkChapterIds(new Set()) }}
            className="text-xs bg-card border border-border rounded-lg px-2.5 py-1.5 text-text focus:outline-none focus:ring-1 focus:ring-primary/40 appearance-none cursor-pointer"
          >
            <option value="">Select stage…</option>
            {orderedStages.map(s => <option key={s.stage_name} value={s.stage_name}>{s.stage_name}</option>)}
          </select>

          <button
            onClick={() => {
              setSelectedBulkChapterIds(new Set(bulkTargets.map(c => c.id)))
              setBulkAssignModalOpen(true)
            }}
            disabled={!bulkStage || bulkTargets.length === 0}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            {bulkStage ? `Select chapters (${bulkTargets.length})` : 'Assign'}
          </button>

          {showBatchButtons && activeTab === 'manuscript' && (
            <>
              <span className="w-px h-5 bg-border mx-1" />
              {filterStage?.toLowerCase() === 'manuscript analysis' && (
                <button
                  onClick={() => {
                    setBatchSelectedChapterIds(new Set(batchTargets.map(c => c.id)))
                    setBatchModalType('style_validation')
                  }}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                >
                  Batch Style Validation
                </button>
              )}
              {filterStage?.toLowerCase() === 'pre-editing' && (
                <button
                  onClick={() => {
                    setBatchSelectedChapterIds(new Set(batchTargets.map(c => c.id)))
                    setBatchModalType('structuring')
                  }}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white transition-colors"
                >
                  Batch Structuring
                </button>
              )}
              {filterStage?.toLowerCase() === 'xml conversion' && (
                <>
                  <button
                    onClick={() => {
                      setBatchSelectedChapterIds(new Set(batchTargets.map(c => c.id)))
                      setBatchModalType('word_to_xml')
                    }}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors"
                  >
                    Batch Word to XML
                  </button>
                  <button
                    onClick={() => {
                      setBatchSelectedChapterIds(new Set(batchTargets.map(c => c.id)))
                      const templates = templatesQuery.data ?? []
                      if (templates.length > 0) {
                        setBatchTemplateId(templates[0].id)
                      } else {
                        setBatchTemplateId('')
                      }
                      setBatchModalType('xml_to_indesign')
                    }}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors"
                  >
                    Batch XML to InDesign
                  </button>
                  <button
                    onClick={() => {
                      setBatchSelectedChapterIds(new Set(batchTargets.map(c => c.id)))
                      setBatchModalType('indesign_to_xml')
                    }}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition-colors"
                  >
                    Batch InDesign to Final
                  </button>
                </>
              )}
              <button
                onClick={() => {
                  setCombineConfirmOpen(true)
                }}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition-colors"
              >
                Combine Book
              </button>
            </>
          )}

          <span className="ml-auto text-xs text-muted">
            {filtered.length} of {summary.total} chapter{summary.total !== 1 ? 's' : ''}
          </span>
          <ViewSwitcher mode={viewMode} onChange={setViewMode} />
        </div>

        {/* ── Chapter views ── */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted">
            <BookOpen size={36} className="mb-3 opacity-25" />
            <p className="text-sm font-medium">
              {hasFilters ? 'No chapters match your filters' : 'No chapters found for this project'}
            </p>
            {hasFilters && (
              <button onClick={() => { setFilterAssignee(''); setFilterStage(''); setFilterStatus('') }}
                className="mt-3 text-xs text-primary hover:underline flex items-center gap-1">
                <RotateCcw size={11} /> Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Large — full chapter cards (default) */}
            {viewMode === 'large' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map(ch => (
                  <ChapterCard key={ch.id} chapter={ch} users={users}
                    plannedDueDates={plannedDueDates}
                    stageRolesMap={stageRolesMap}
                    onAssigneeChange={handleAssigneeChange}
                    onViewDetails={openChapter} />
                ))}
              </div>
            )}

            {/* Medium — compact 4-col cards */}
            {viewMode === 'medium' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filtered.map(ch => {
                  const sm = statusMeta(ch.status)
                  const { due, delayed } = getEffectiveDue(ch, plannedDueDates)
                  return (
                    <div key={ch.id} onClick={() => openChapter(ch)} className={`bg-card rounded-xl border border-border shadow-sm hover:shadow-md transition-all flex flex-col gap-1.5 p-3 cursor-pointer ${cardBorderCls(ch)}`}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-primary uppercase">{ch.chapters}</span>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${sm.cls}`}>{sm.label}</span>
                      </div>
                      <p className="text-xs font-medium text-text line-clamp-2 leading-snug">{ch.chapter_title || ch.chapters}</p>
                      {ch.stage_name && <span className="text-[9px] bg-primary/10 text-primary rounded px-1.5 py-0.5 w-fit font-semibold">{ch.stage_name}</span>}
                      <div className="flex items-center justify-between gap-1 text-[10px] text-muted mt-auto pt-1 border-t border-border">
                        <div className="min-w-0 flex-1">
                          <AssigneeSelect
                            widthCls="w-full"
                            value={ch.current_assignee_name}
                            users={users}
                            onChange={val => handleAssigneeChange(ch, val)}
                            onClick={e => e.stopPropagation()}
                            stageName={ch.stage_name}
                            stageRolesMap={stageRolesMap}
                          />
                        </div>
                        <span className={`flex-shrink-0 ${delayed ? 'text-red-500 font-semibold' : ''}`}>{formatDate(due)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* List — single-column rows */}
            {viewMode === 'list' && (
              <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                {filtered.map((ch, i) => {
                  const sm = statusMeta(ch.status)
                  const { due, delayed } = getEffectiveDue(ch, plannedDueDates)
                  return (
                    <div key={ch.id} onClick={() => openChapter(ch)}
                      className={`flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-surface transition-colors ${i > 0 ? 'border-t border-border' : ''} ${cardBorderCls(ch).replace('border-l-4', 'border-l-[3px]')}`}>
                      <span className="text-xs font-bold text-primary uppercase w-8 flex-shrink-0">{ch.chapters}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-text truncate">{ch.chapter_title || ch.chapters}</p>
                      </div>
                      {ch.stage_name && <span className="text-[10px] bg-primary/10 text-primary rounded px-2 py-0.5 font-semibold whitespace-nowrap flex-shrink-0">{ch.stage_name}</span>}
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${sm.cls}`}>{sm.label}</span>
                      <AssigneeSelect
                        className="flex-shrink-0"
                        value={ch.current_assignee_name}
                        users={users}
                        onChange={val => handleAssigneeChange(ch, val)}
                        onClick={e => e.stopPropagation()}
                        stageName={ch.stage_name}
                        stageRolesMap={stageRolesMap}
                      />
                      <span className={`text-xs flex-shrink-0 ${delayed ? 'text-red-600 font-semibold' : 'text-muted'}`}>{formatDate(due)}</span>
                      <ChevronRight size={14} className="text-muted flex-shrink-0" />
                    </div>
                  )
                })}
              </div>
            )}

            {/* Details — full table */}
            {viewMode === 'details' && (
              <div className="bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
                <table className="w-full text-sm border-collapse min-w-max">
                  <thead>
                    <tr className="border-b border-border bg-surface">
                      {['#', 'Title', 'Stage', 'Status', 'Assignee', 'Due Date', 'MS Pages', 'Delayed'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((ch, i) => {
                      const sm = statusMeta(ch.status)
                      const { due, delayed } = getEffectiveDue(ch, plannedDueDates)
                      return (
                        <tr key={ch.id} onClick={() => openChapter(ch)} className={`cursor-pointer hover:bg-surface transition-colors ${i > 0 ? 'border-t border-border' : ''}`}>
                          <td className="px-4 py-3 font-bold text-primary text-xs uppercase">{ch.chapters}</td>
                          <td className="px-4 py-3 font-semibold text-text max-w-xs truncate">{ch.chapter_title || ch.chapters}</td>
                          <td className="px-4 py-3 text-xs">
                            {ch.stage_name
                              ? <span className="bg-primary/10 text-primary rounded px-2 py-0.5 font-semibold">{ch.stage_name}</span>
                              : <span className="text-muted">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sm.cls}`}>{sm.label}</span>
                          </td>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <AssigneeSelect value={ch.current_assignee_name} users={users} onChange={val => handleAssigneeChange(ch, val)} stageName={ch.stage_name} stageRolesMap={stageRolesMap} />
                          </td>
                          <td className={`px-4 py-3 text-xs whitespace-nowrap ${delayed ? 'text-red-600 font-semibold' : 'text-muted'}`}>{formatDate(due)}</td>
                          <td className="px-4 py-3 text-xs text-center text-muted">{ch.manuscript_pages ?? '—'}</td>
                          <td className="px-4 py-3 text-center">
                            {delayed
                              ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">Delayed</span>
                              : <span className="text-[10px] text-muted">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* View Info Modal */}
      <ProjectInfoModal
        project={project}
        open={isInfoOpen}
        mode="view"
        onClose={() => setIsInfoOpen(false)}
        onUpdated={() => { }}
      />

      {/* Edit Info Modal */}
      <ProjectInfoModal
        project={project}
        open={isEditOpen}
        mode="edit"
        onClose={() => setIsEditOpen(false)}
        onUpdated={updated => {
          setProject(updated)
          setIsEditOpen(false)
        }}
      />

      {/* Group Assign — pick chapters + assignee */}
      <Modal
        isOpen={bulkAssignModalOpen}
        onClose={() => { if (!bulkAssigning) setBulkAssignModalOpen(false) }}
        title="Group Assign Chapters"
        description={`Choose which chapters in "${bulkStage}" to assign. Each chapter's due date updates based on the stage SLA.`}
        footer={
          <div className="flex gap-3 justify-end items-center">
            {bulkStage && bulkStage.toLowerCase().includes('manuscript') && (
              <>
                <button
                  onClick={() => handleBatchProcess('style_validation')}
                  disabled={batchProcessing || selectedBulkChapters.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {batchProcessing && <Spinner size="sm" />}
                  Batch Style Validation
                </button>
                <button
                  onClick={() => handleBatchProcess('word_to_xml')}
                  disabled={batchProcessing || selectedBulkChapters.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {batchProcessing && <Spinner size="sm" />}
                  Batch Word to XML
                </button>
              </>
            )}
            {bulkStage && bulkStage.toLowerCase() === 'pre-editing' && (
              <button
                onClick={() => handleBatchProcess('structuring')}
                disabled={batchProcessing || selectedBulkChapters.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
              >
                {batchProcessing && <Spinner size="sm" />}
                Batch Structuring
              </button>
            )}
            {bulkStage && bulkStage.toLowerCase().includes('xml') && (
              <button
                onClick={() => handleBatchProcess('xml_to_indesign')}
                disabled={batchProcessing || selectedBulkChapters.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
              >
                {batchProcessing && <Spinner size="sm" />}
                Batch XML to InDesign
              </button>
            )}
            {bulkStage && bulkStage.toLowerCase().includes('design') && (
              <button
                onClick={() => handleBatchProcess('indesign_to_xml')}
                disabled={batchProcessing || selectedBulkChapters.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
              >
                {batchProcessing && <Spinner size="sm" />}
                Batch InDesign to Word
              </button>
            )}
            <button
              onClick={() => setBulkAssignModalOpen(false)}
              disabled={bulkAssigning || batchProcessing}
              className="px-4 py-2 text-sm font-medium text-text bg-background border border-border rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleBulkAssign}
              disabled={bulkAssigning || selectedBulkChapters.length === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {bulkAssigning && <Spinner size="sm" />}
              {bulkAssigning ? 'Assigning…' : `Assign ${selectedBulkChapters.length} chapter${selectedBulkChapters.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Assign to</label>
            <AssigneeSelect widthCls="w-full" value={bulkAssignee || null} users={users} onChange={setBulkAssignee} stageName={bulkStage} stageRolesMap={stageRolesMap} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-muted">
                Chapters ({selectedBulkChapters.length}/{bulkTargets.length} selected)
              </label>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setSelectedBulkChapterIds(
                    isOnlyUnassignedSelected ? new Set() : new Set(unassignedBulkIds)
                  )}
                  disabled={unassignedBulkIds.size === 0}
                  className="text-xs text-primary hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                >
                  {isOnlyUnassignedSelected ? 'Deselect unassigned' : 'Select unassigned'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedBulkChapterIds(
                    selectedBulkChapterIds.size === bulkTargets.length
                      ? new Set()
                      : new Set(bulkTargets.map(c => c.id))
                  )}
                  className="text-xs text-primary hover:underline"
                >
                  {selectedBulkChapterIds.size === bulkTargets.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
              {bulkTargets.map(c => (
                <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-surface">
                  <input
                    type="checkbox"
                    checked={selectedBulkChapterIds.has(c.id)}
                    onChange={() => {
                      setSelectedBulkChapterIds(prev => {
                        const next = new Set(prev)
                        if (next.has(c.id)) next.delete(c.id)
                        else next.add(c.id)
                        return next
                      })
                    }}
                    className="rounded border-border"
                  />
                  <span className="font-semibold text-primary text-xs uppercase w-8 flex-shrink-0">{c.chapters}</span>
                  <span className="truncate text-text flex-1 min-w-0">{c.chapter_title || c.chapters}</span>
                  <span className={`text-xs flex-shrink-0 ${c.current_assignee_name ? 'text-muted' : 'text-muted/60 italic'}`}>
                    {c.current_assignee_name || 'Unassigned'}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Dedicated Batch Modal */}
      <Modal
        isOpen={batchModalType !== null}
        onClose={() => { if (!batchProcessing) setBatchModalType(null) }}
        title={
          batchModalType === 'word_to_xml'
            ? 'Batch Word to XML'
            : batchModalType === 'style_validation'
              ? 'Batch Style Validation'
              : batchModalType === 'structuring'
                ? 'Batch Word Structuring'
                : batchModalType === 'xml_to_indesign'
                  ? 'Batch XML to InDesign'
                  : 'Batch InDesign to Final'
        }
        description={
          batchModalType === 'word_to_xml'
            ? 'Select the chapters you want to run Word-to-XML conversion for in bulk. This will convert the docx manuscripts into JATS XML files.'
            : batchModalType === 'style_validation'
              ? 'Select the chapters you want to run Style Validation for in bulk. This will validate the docx manuscripts against project style guidelines.'
              : batchModalType === 'structuring'
                ? 'Select the chapters you want to run Word Structuring for in bulk. This will apply standard styles to the docx manuscripts using the rules-based structuring library.'
                : batchModalType === 'xml_to_indesign'
                  ? 'Select the chapters you want to generate InDesign layouts for in bulk. This will dispatch layout generation tasks to the Windows InDesign Server.'
                  : 'Select the chapters you want to convert from InDesign to final XML outputs. This will extract final packages (XML + Logs) from the InDesign layouts.'
        }
        footer={
          <div className="flex gap-3 justify-end items-center">
            <button
              onClick={() => setBatchModalType(null)}
              disabled={batchProcessing}
              className="px-4 py-2 text-sm font-medium text-text bg-background border border-border rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDedicatedBatchProcess}
              disabled={batchProcessing || batchSelectedChapterIds.size === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {batchProcessing && <Spinner size="sm" />}
              {batchProcessing ? 'Running…' : `Start Batch Job`}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {batchModalType === 'xml_to_indesign' && (
            <div className="bg-surface/50 border border-border/80 rounded-xl p-3.5 space-y-2">
              <label className="block text-xs font-semibold text-text uppercase tracking-wider">
                Select InDesign Template
              </label>
              <select
                value={batchTemplateId}
                onChange={e => setBatchTemplateId(e.target.value ? Number(e.target.value) : '')}
                className="text-xs bg-card border border-border rounded-lg px-2.5 py-2 text-text focus:outline-none focus:ring-1 focus:ring-primary/40 appearance-none cursor-pointer w-full"
              >
                <option value="">-- Choose template --</option>
                {(templatesQuery.data ?? []).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.filename} ({t.uploaded_on})
                  </option>
                ))}
              </select>
              {(!templatesQuery.data || templatesQuery.data.length === 0) && (
                <p className="text-[10px] text-amber-500 font-medium mt-1">
                  ⚠️ No templates found in this project. Please upload one in the Design folder.
                </p>
              )}
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-muted">
                Chapters ({batchSelectedChapterIds.size}/{batchTargets.length} selected)
              </label>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setBatchSelectedChapterIds(new Set())}
                  className="text-[11px] text-primary hover:underline font-medium transition-colors"
                >
                  Deselect all
                </button>
                <span className="text-border">|</span>
                <button
                  type="button"
                  onClick={() => setBatchSelectedChapterIds(new Set(batchTargets.map(c => c.id)))}
                  className="text-[11px] text-primary hover:underline font-medium transition-colors"
                >
                  Select all
                </button>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
              {batchTargets.map(ch => {
                const isSelected = batchSelectedChapterIds.has(ch.id)
                return (
                  <label
                    key={ch.id}
                    className={`flex items-center gap-3 px-3 py-2 text-sm hover:bg-surface transition-colors cursor-pointer select-none ${isSelected ? 'bg-amber-50/20' : ''
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        setBatchSelectedChapterIds(prev => {
                          const next = new Set(prev)
                          if (next.has(ch.id)) {
                            next.delete(ch.id)
                          } else {
                            next.add(ch.id)
                          }
                          return next
                        })
                      }}
                      className="rounded border-border text-primary focus:ring-primary/40 cursor-pointer"
                    />
                    <span className="font-semibold text-primary text-xs uppercase w-8 flex-shrink-0">
                      {ch.chapters.padStart(2, '0')}
                    </span>
                    <span className="truncate text-text flex-1 min-w-0">
                      {ch.chapter_title || `Chapter ${ch.chapters}`}
                    </span>
                    {(() => {
                      const sm = statusMeta(ch.status)
                      return (
                        <span className={`ml-auto text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${sm.cls}`}>
                          {sm.label}
                        </span>
                      )
                    })()}
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      </Modal>

      {/* Add Chapter Modal */}
      <Modal
        isOpen={isAddChapterOpen}
        onClose={() => { if (!addingChapter) setIsAddChapterOpen(false) }}
        title={activeTab === 'art' ? 'New Art Chapters' : activeTab === 'design' ? 'New Design File' : 'New Chapters'}
        description={
          activeTab === 'art'
            ? 'Add multiple Art chapters from a zip file.'
            : activeTab === 'design'
              ? 'Upload a file into the Design track.'
              : 'Add multiple chapters at once from a zip file.'
        }
        footer={
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setIsAddChapterOpen(false)}
              disabled={addingChapter}
              className="px-4 py-2 text-sm font-medium text-text bg-background border border-border rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateChapter}
              disabled={addingChapter || !newChapterFile || (activeTab === 'design' && !designChapters[0])}
              className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {addingChapter && <Spinner size="sm" />}
              {addingChapter ? 'Creating…' : activeTab === 'design' ? 'Upload File' : 'Create Chapters'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">

          {activeTab === 'design' && (
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Category</label>
              <select
                value={newChapterCategory}
                onChange={e => setNewChapterCategory(e.target.value)}
                disabled={addingChapter}
                className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 text-text focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
              >
                {DESIGN_UPLOAD_CATEGORIES.map(cat => (
                  <option key={cat.key} value={cat.key}>{cat.label}</option>
                ))}
              </select>
              {!designChapters[0] && (
                <p className="text-[11px] text-danger mt-1">
                  Design track is not enabled for this project.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              {activeTab === 'art' ? 'Art files (.zip)' : activeTab === 'design' ? 'Design file (single or .zip)' : 'Chapters (.zip)'}
            </label>
            <UploadZone
              accept={
                (activeTab === 'art' || activeTab === 'manuscript')
                  ? '.zip'
                  : activeTab === 'design'
                    ? '.zip,.png,.jpg,.jpeg,.gif,.tiff,.webp,.bmp,.pdf,.docx,.doc,.xlsx,.xls,.txt,.indb,.indd'
                    : '.docx'
              }
              onFiles={files => setNewChapterFile(files[0] ?? null)}
              isUploading={addingChapter}
              label={newChapterFile ? newChapterFile.name : undefined}
            />
          </div>

          {addChapterError && (
            <p className="text-xs text-danger flex items-center gap-1.5">
              <AlertCircle size={12} /> {addChapterError}
            </p>
          )}
        </div>
      </Modal>

      {/* Combine Book Modal */}
      <Modal
        isOpen={combineConfirmOpen}
        onClose={() => { if (!combining) setCombineConfirmOpen(false) }}
        title="Combine Project Book"
        description="This will gather all XML and ePUB files from the Final delivery folders of all chapters and merge them into a single book XML and ePUB. The combined files will be uploaded to a new 'Final files' chapter folder."
        footer={
          <div className="flex gap-3 justify-end items-center">
            <button
              onClick={() => setCombineConfirmOpen(false)}
              disabled={combining}
              className="text-xs font-semibold px-4 py-2.5 rounded-lg border border-border hover:bg-hover text-text transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCombineBook}
              disabled={combining}
              className="text-xs font-semibold px-4 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {combining && <Spinner size="sm" />}
              {combining ? 'Combining Book...' : 'Start Combine Process'}
            </button>
          </div>
        }
      >
        <div className="py-4 text-xs text-muted flex flex-col gap-2">
          <p>The merge scripts will be executed on the Windows Conversion Server:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>XML Merge: <code className="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-1.5 py-0.5 rounded font-mono border border-gray-200 dark:border-gray-700">book_xml.pl</code></li>
            <li>ePUB Merge: <code className="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-1.5 py-0.5 rounded font-mono border border-gray-200 dark:border-gray-700">book_epub.pl</code></li>
          </ul>
          <p className="mt-2 text-amber-600 font-medium">⚠️ Note: Make sure chapters have XML and ePUB files uploaded in their Final delivery folder before running the combine process.</p>
        </div>
      </Modal>

    </div>
  )
}
