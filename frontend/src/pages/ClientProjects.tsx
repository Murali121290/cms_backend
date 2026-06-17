import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Search, FolderOpen, BookOpen,
  Layers, Zap, CheckCircle2, Clock, Plus, Info, Edit2, CalendarDays, ChevronRight
} from 'lucide-react'
import { ViewSwitcher } from '@/components/ui/ViewSwitcher'
import { useViewMode } from '@/hooks/useViewMode'
import { clientsApi, type Client } from '@/api/clients'
import { projectsApi, type Project } from '@/api/projects'
import { chaptersApi, type Chapter } from '@/api/chapters'
import { usersApi, type User } from '@/api/users'
import { toast } from '@/store/useToastStore'
import { useRBAC } from '@/hooks/useRBAC'
import { Badge, statusToBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { CreateProjectModal } from './CreateProjectModal'
import { ProjectInfoModal } from './ProjectInfoModal'
import { ProjectPlanningModal } from './ProjectPlanningModal'

// ── Helpers ───────────────────────────────────────────────────────────────────

function clientDisplayName(c: Client): string {
  if (c.name_company) return c.name_company
  if (c.company) return c.company
  if (c.first_name || c.surname) return [c.first_name, c.surname].filter(Boolean).join(' ')
  if (c.division) return c.division
  return `Client #${c.id}`
}

function projectLabel(p: Project): string {
  return p.project_title || p.project_code || `Project #${p.id}`
}

// ── Summary Widget ────────────────────────────────────────────────────────────

function SummaryWidget({ icon: Icon, label, value, iconCls, onClick, active }: {
  icon: React.ElementType
  label: string
  value: number | string
  iconCls: string
  onClick?: () => void
  active?: boolean
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-card rounded-xl border px-5 py-4 flex items-center gap-4 shadow-sm transition-all flex-1 min-w-0 ${
        onClick ? 'cursor-pointer hover:shadow-md' : ''
      } ${active ? 'border-primary ring-1 ring-primary/30' : 'border-border'}`}
    >
      <div className={`p-2.5 rounded-xl bg-surface ${iconCls}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-2xl font-bold text-text">{value}</p>
        <p className="text-xs text-muted mt-0.5">{label}</p>
      </div>
    </div>
  )
}

// ── Chapter Stage Breakdown ───────────────────────────────────────────────────

function StageBreakdown({ chapters }: { chapters: Chapter[] }) {
  const byStage = useMemo(() => {
    const map = new Map<string, Chapter[]>()
    for (const ch of chapters) {
      const stage = ch.stage_name || 'No Stage'
      if (!map.has(stage)) map.set(stage, [])
      map.get(stage)!.push(ch)
    }
    return map
  }, [chapters])

  if (byStage.size === 0) return (
    <p className="text-xs text-muted italic">No chapters assigned</p>
  )

  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {Array.from(byStage.entries()).map(([stage, chs]) => {
        const done = chs.filter(c => c.status === 'complete').length
        return (
          <span
            key={stage}
            className="inline-flex items-center gap-1 text-xs bg-surface border border-border rounded-md px-2 py-0.5 text-muted"
            title={`${done}/${chs.length} complete`}
          >
            <span className="font-medium text-text">{stage}</span>
            <span className="text-muted">({chs.length})</span>
          </span>
        )
      })}
    </div>
  )
}

// ── Project Card ──────────────────────────────────────────────────────────────

interface ProjectCardProps {
  project: Project
  pmUsers: User[]
  onProjectUpdate: (updated: Project) => void
  onViewInfo: () => void
  onEditInfo: () => void
  onOpenWorkflow: () => void
  onOpenPlanning: () => void
}

function ProjectCard({ project, pmUsers, onProjectUpdate, onViewInfo, onEditInfo, onOpenWorkflow, onOpenPlanning }: ProjectCardProps) {
  const { canAccess } = useRBAC()
  const canEdit = canAccess(['admin', 'manager'])
  const isFastTrack = project.priority === 'Fast Track'

  const [chapters, setChapters] = useState<Chapter[]>([])
  const [chLoading, setChLoading] = useState(true)
  const [ftLoading, setFtLoading]   = useState(false)
  const [pmLoading, setPmLoading]   = useState(false)

  useEffect(() => {
    if (!project.project_code) { setChLoading(false); return }
    chaptersApi.getByProject(project.project_code)
      .then(setChapters)
      .catch(() => {})
      .finally(() => setChLoading(false))
  }, [project.project_code])

  const completed = chapters.filter(c => c.status === 'complete').length
  const total     = chapters.length
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0

  const statusV = project.status
    ? statusToBadge(project.status.toLowerCase())
    : 'default'

  async function toggleFastTrack() {
    setFtLoading(true)
    const newPriority = isFastTrack ? 'Normal' : 'Fast Track'
    try {
      const updated = await projectsApi.update(project.id, { priority: newPriority })
      onProjectUpdate(updated)
    } catch {
      toast.error('Failed to update Fast Track')
      setFtLoading(false)
      return
    }
    if (project.project_code) {
      try {
        await chaptersApi.bulkUpdatePriority(project.project_code, newPriority)
      } catch {
        toast.error('Project updated but failed to sync chapter priorities')
      }
    }
    setFtLoading(false)
  }

  async function handlePmChange(userName: string) {
    setPmLoading(true)
    try {
      const updated = await projectsApi.update(project.id, {
        project_manager: userName || null,
      })
      onProjectUpdate(updated)
    } catch {
      toast.error('Failed to update project manager')
    } finally {
      setPmLoading(false)
    }
  }

  return (
    <div
      onClick={onOpenWorkflow}
      className="bg-card rounded-xl border border-border shadow-sm hover:shadow-md hover:border-primary/30 transition-all duration-200 flex flex-col cursor-pointer"
    >
      {/* Top */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-text truncate">{projectLabel(project)}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {project.project_code && project.project_title && (
                <span className="text-xs text-muted">{project.project_code}</span>
              )}
              <button
                onClick={e => { e.stopPropagation(); onViewInfo() }}
                title="View project info"
                className="text-muted hover:text-primary transition-colors flex-shrink-0"
              >
                <Info size={12} />
              </button>
              {canEdit && (
                <button
                  onClick={e => { e.stopPropagation(); onEditInfo() }}
                  title="Edit project"
                  className="text-muted hover:text-primary transition-colors flex-shrink-0"
                >
                  <Edit2 size={12} />
                </button>
              )}
              <button
                onClick={e => { e.stopPropagation(); onOpenPlanning() }}
                title="Project planning"
                className="text-muted hover:text-primary transition-colors flex-shrink-0"
              >
                <CalendarDays size={12} />
              </button>
            </div>
          </div>
          {project.status && (
            <Badge variant={statusV} className="flex-shrink-0">{project.status}</Badge>
          )}
        </div>

        {/* Fast Track toggle + workflow */}
        <div className="flex flex-wrap items-center gap-2">
          {project.workflow_name && (
            <span className="text-xs bg-accent text-primary border border-primary/20 rounded-md px-2 py-0.5 font-medium">
              {project.workflow_name}
            </span>
          )}

          {/* Fast Track Yes / No button */}
          <button
            onClick={e => { e.stopPropagation(); toggleFastTrack() }}
            disabled={ftLoading}
            className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full border transition-colors disabled:opacity-60 ${
              isFastTrack
                ? 'bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200'
                : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200 dark:bg-surface dark:text-muted dark:border-border'
            }`}
          >
            {ftLoading
              ? <Spinner size="sm" />
              : <Zap size={10} className={isFastTrack ? 'text-orange-500' : 'text-muted'} />
            }
            Fast Track: <strong>{isFastTrack ? 'Yes' : 'No'}</strong>
          </button>
        </div>

        {/* PM + Due date row */}
        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-muted font-medium flex-shrink-0">PM:</span>
            <div className="relative flex items-center">
              <select
                value={project.project_manager ?? ''}
                onClick={e => e.stopPropagation()}
                onChange={e => handlePmChange(e.target.value)}
                disabled={pmLoading}
                className="text-xs bg-surface border border-border rounded-md pl-2 pr-6 py-0.5 text-text focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60 appearance-none cursor-pointer"
              >
                <option value="">— Unassigned —</option>
                {pmUsers.map(u => (
                  <option key={u.id} value={u.user_name}>{u.user_name}</option>
                ))}
              </select>
              {pmLoading
                ? <Spinner size="sm" />
                : <span className="pointer-events-none absolute right-1.5 text-muted text-[9px]">▾</span>
              }
            </div>
          </div>
          {project.due_date && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <CalendarDays size={11} className="text-muted" />
              <span className="text-xs text-muted font-medium">Due:</span>
              <span className="text-xs text-text font-semibold">
                {new Date(project.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Chapters */}
      <div className="px-5 py-3 flex-1">
        <div className="flex items-center justify-between mb-2.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <BookOpen size={12} className="flex-shrink-0" />
            Chapters
          </span>
          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full border ${
            total === 0
              ? 'bg-surface text-muted border-border'
              : pct === 100
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : pct > 0
              ? 'bg-primary/8 text-primary border-primary/20'
              : 'bg-surface text-muted border-border'
          }`}>
            {completed}
            <span className="font-normal opacity-60">/</span>
            {total}
          </span>
        </div>

        {total > 0 && (
          <div className="h-1 rounded-full bg-border overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-emerald-500' : 'bg-primary'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {chLoading ? (
          <div className="mt-2 h-3 bg-surface animate-pulse rounded w-32" />
        ) : (
          <StageBreakdown chapters={chapters} />
        )}
      </div>

      {/* Footer: pages */}
      {(project.estimated_pages != null || (project.actual_pages ?? 0) > 0) && (
        <div className="px-5 py-2.5 border-t border-border flex gap-3">
          {project.estimated_pages != null && (
            <span className="text-xs text-muted">Est. {project.estimated_pages}pp</span>
          )}
          {(project.actual_pages ?? 0) > 0 && (
            <span className="text-xs text-muted">Actual {project.actual_pages}pp</span>
          )}
        </div>
      )}

    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ClientProjects() {
  const { clientId } = useParams<{ clientId: string }>()
  const navigate = useNavigate()
  const id = Number(clientId)

  const [client,   setClient]   = useState<Client | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [pmUsers,  setPmUsers]  = useState<User[]>([])
  const [loading,    setLoading]    = useState(true)
  const [createOpen,      setCreateOpen]      = useState(false)
  const [infoProject,     setInfoProject]     = useState<Project | null>(null)
  const [editProject,     setEditProject]     = useState<Project | null>(null)
  const [planningProjectId, setPlanningProjectId] = useState<number | null>(null)

  const [viewMode, setViewMode] = useViewMode('view:client-projects', 'large')

  const [search,           setSearch]           = useState('')
  const [filterWorkflow,   setFilterWorkflow]   = useState('')
  const [filterStatus,     setFilterStatus]     = useState('')
  const [filterPriority,   setFilterPriority]   = useState('')

  useEffect(() => {
    if (!id) return
    setLoading(true)

    Promise.all([
      clientsApi.getById(id),
      projectsApi.getByClient(id),
      usersApi.list().catch(() => []),
    ])
      .then(([c, ps, users]) => {
        setClient(c)
        setProjects(ps)
        setPmUsers((users || []).filter(u =>
          u.active_status && u.role.toLowerCase().replace(" ","").includes('projectmanager')
        ))
      })
      .catch(() => toast.error('Failed to load projects'))
      .finally(() => setLoading(false))
  }, [id])

  // Derive filter options
  const workflowOptions = useMemo(() => {
    const set = new Set(projects.map(p => p.workflow_name).filter(Boolean) as string[])
    return Array.from(set).sort().map(w => ({ value: w, label: w }))
  }, [projects])

  // Summary stats (chapter stats loaded lazily per card)
  const stats = useMemo(() => {
    const total     = projects.length
    const active    = projects.filter(p => p.status === 'Active').length
    const delayed   = projects.filter(p => p.status === 'Planning').length
    const completed = projects.filter(p => p.status === 'Completed').length
    const fastTrack = projects.filter(p => p.priority === 'Fast Track').length
    return { total, active, delayed, completed, fastTrack }
  }, [projects])

  const STATUS_ORDER: Record<string, number> = { Planning: 0, Active: 1, Completed: 2 }

  // Filter + search + sort
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return projects
      .filter(p => {
        if (q && !projectLabel(p).toLowerCase().includes(q) &&
                 !(p.project_code ?? '').toLowerCase().includes(q)) return false
        if (filterWorkflow && p.workflow_name !== filterWorkflow) return false
        if (filterStatus   && p.status        !== filterStatus)   return false
        if (filterPriority && p.priority      !== filterPriority) return false
        return true
      })
      .sort((a, b) =>
        (STATUS_ORDER[a.status ?? ''] ?? 99) - (STATUS_ORDER[b.status ?? ''] ?? 99)
      )
  }, [projects, search, filterWorkflow, filterStatus, filterPriority])

  if (loading) return <FullPageSpinner />

  const clientName = client ? clientDisplayName(client) : `Client #${id}`

  return (
    <div className="flex flex-col gap-6 p-6 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/clients')}
            className="p-2 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent rounded-lg">
              <FolderOpen size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-text">{clientName}</h1>
              <p className="text-sm text-muted">
                {client?.division && `${client.division} · `}
                {stats.total} project{stats.total !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={15} /> Create Project
        </Button>
      </div>

      {/* Summary widgets */}
      <div className="flex gap-3">
        <SummaryWidget icon={Layers}       label="Total"      value={stats.total}     iconCls="text-blue-600"    onClick={() => setFilterStatus('')}                                          active={filterStatus === '' && filterPriority === ''}  />
        <SummaryWidget icon={Clock}        label="Active"     value={stats.active}    iconCls="text-green-600"   onClick={() => { setFilterStatus(s => s === 'Active'    ? '' : 'Active');    setFilterPriority('') }} active={filterStatus === 'Active'}    />
        <SummaryWidget icon={Layers}       label="Planning"   value={stats.delayed}   iconCls="text-purple-600"  onClick={() => { setFilterStatus(s => s === 'Planning'  ? '' : 'Planning');  setFilterPriority('') }} active={filterStatus === 'Planning'}  />
        <SummaryWidget icon={CheckCircle2} label="Completed"  value={stats.completed} iconCls="text-emerald-600" onClick={() => { setFilterStatus(s => s === 'Completed' ? '' : 'Completed'); setFilterPriority('') }} active={filterStatus === 'Completed'} />
        <SummaryWidget icon={Zap}          label="Fast Track" value={stats.fastTrack} iconCls="text-orange-600"  onClick={() => { setFilterPriority(p => p === 'Fast Track' ? '' : 'Fast Track'); setFilterStatus('') }} active={filterPriority === 'Fast Track'} />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-surface border border-border rounded-lg text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {workflowOptions.length > 0 && (
          <select
            value={filterWorkflow}
            onChange={e => setFilterWorkflow(e.target.value)}
            className="px-3 py-2 text-sm bg-surface border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">All Workflows</option>
            {workflowOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}

        {(search || filterWorkflow || filterStatus || filterPriority) && (
          <button
            onClick={() => { setSearch(''); setFilterWorkflow(''); setFilterStatus(''); setFilterPriority('') }}
            className="text-xs text-muted hover:text-text transition-colors"
          >
            Clear filters
          </button>
        )}

        <div className="ml-auto flex-shrink-0">
          <ViewSwitcher mode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {/* View Info Modal */}
      <ProjectInfoModal
        project={infoProject}
        open={infoProject !== null}
        mode="view"
        onClose={() => setInfoProject(null)}
        onUpdated={() => {}}
      />

      {/* Edit Info Modal */}
      <ProjectInfoModal
        project={editProject}
        open={editProject !== null}
        mode="edit"
        onClose={() => setEditProject(null)}
        onUpdated={updated => {
          setProjects(ps => ps.map(p => p.id === updated.id ? updated : p))
          setEditProject(null)
        }}
      />

      {/* Planning Modal */}
      <ProjectPlanningModal
        projectId={planningProjectId}
        open={planningProjectId !== null}
        onClose={() => setPlanningProjectId(null)}
        onApproved={() => {
          setProjects(ps => ps.map(p =>
            p.id === planningProjectId ? { ...p, status: 'Active' } : p
          ))
          setPlanningProjectId(null)
        }}
      />

      {/* Create Project Modal */}
      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultClientId={id}
        onCreated={project => {
          setProjects(ps => [project, ...ps])
          setCreateOpen(false)
        }}
      />

      {/* Projects — 4 view modes */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted py-20">
          <FolderOpen size={40} className="opacity-30" />
          <p className="text-sm">{search || filterWorkflow || filterStatus || filterPriority
            ? 'No projects match your filters.'
            : 'No projects found for this client.'}</p>
        </div>
      ) : (
        <>
          {/* Large — full cards (default) */}
          {viewMode === 'large' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map(project => (
                <ProjectCard key={project.id} project={project} pmUsers={pmUsers}
                  onProjectUpdate={u => setProjects(ps => ps.map(p => p.id === u.id ? u : p))}
                  onViewInfo={() => setInfoProject(project)}
                  onEditInfo={() => setEditProject(project)}
                  onOpenWorkflow={() => {
                    if (project.status === 'Planning') { toast.error('Planning not approved yet.'); return }
                    navigate(`/clients/${clientId}/projects/${project.id}`)
                  }}
                  onOpenPlanning={() => setPlanningProjectId(project.id)} />
              ))}
            </div>
          )}

          {/* Medium — compact cards 4-col */}
          {viewMode === 'medium' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filtered.map(project => {
                const statusV = project.status ? statusToBadge(project.status.toLowerCase()) : 'default'
                return (
                  <div key={project.id}
                    onClick={() => { if (project.status === 'Planning') { toast.error('Planning not approved yet.'); return } navigate(`/clients/${clientId}/projects/${project.id}`) }}
                    className="bg-card rounded-xl border border-border shadow-sm hover:shadow-md hover:border-primary/30 transition-all cursor-pointer flex flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-mono text-muted truncate">{project.project_code}</p>
                        <p className="text-sm font-semibold text-text truncate leading-snug">{projectLabel(project)}</p>
                      </div>
                      {project.status && <Badge variant={statusV} className="flex-shrink-0 text-[10px]">{project.status}</Badge>}
                    </div>
                    {project.workflow_name && (
                      <span className="text-[10px] bg-accent text-primary border border-primary/20 rounded-md px-2 py-0.5 font-medium w-fit">{project.workflow_name}</span>
                    )}
                    <div className="flex items-center justify-between text-xs text-muted mt-auto pt-1 border-t border-border">
                      {project.project_manager
                        ? <span className="truncate">PM: {project.project_manager}</span>
                        : <span className="italic">No PM</span>}
                      {project.due_date && <span className="flex-shrink-0 flex items-center gap-0.5"><CalendarDays size={10}/> {new Date(project.due_date).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* List — single-column rows */}
          {viewMode === 'list' && (
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
              {filtered.map((project, i) => {
                const statusV = project.status ? statusToBadge(project.status.toLowerCase()) : 'default'
                return (
                  <div key={project.id}
                    onClick={() => { if (project.status === 'Planning') { toast.error('Planning not approved yet.'); return } navigate(`/clients/${clientId}/projects/${project.id}`) }}
                    className={`flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-surface transition-colors ${i > 0 ? 'border-t border-border' : ''}`}>
                    <div className="min-w-0 flex-1 flex items-center gap-3">
                      <span className="text-[10px] font-mono text-muted w-24 flex-shrink-0 truncate">{project.project_code}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-text truncate">{projectLabel(project)}</p>
                        {project.workflow_name && <p className="text-xs text-muted">{project.workflow_name}</p>}
                      </div>
                    </div>
                    {project.status && <Badge variant={statusV} className="flex-shrink-0">{project.status}</Badge>}
                    <div className="flex items-center gap-4 text-xs text-muted flex-shrink-0">
                      {project.project_manager && <span>PM: {project.project_manager}</span>}
                      {project.due_date && <span className="flex items-center gap-1"><CalendarDays size={11}/> {new Date(project.due_date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</span>}
                    </div>
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
                    {['Code','Title','Status','Workflow','PM','Due Date','Chapters','Pages'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((project, i) => {
                    const statusV = project.status ? statusToBadge(project.status.toLowerCase()) : 'default'
                    return (
                      <tr key={project.id}
                        onClick={() => { if (project.status === 'Planning') { toast.error('Planning not approved yet.'); return } navigate(`/clients/${clientId}/projects/${project.id}`) }}
                        className={`cursor-pointer hover:bg-surface transition-colors ${i > 0 ? 'border-t border-border' : ''}`}>
                        <td className="px-4 py-3 font-mono text-xs text-muted whitespace-nowrap">{project.project_code ?? '—'}</td>
                        <td className="px-4 py-3 font-semibold text-text max-w-xs truncate">{projectLabel(project)}</td>
                        <td className="px-4 py-3"><Badge variant={statusV}>{project.status ?? '—'}</Badge></td>
                        <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">{project.workflow_name ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">{project.project_manager ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                          {project.due_date ? new Date(project.due_date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-center text-text font-medium">{(project as any).chapter_count ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                          {project.estimated_pages != null ? `Est. ${project.estimated_pages}` : '—'}
                          {(project.actual_pages ?? 0) > 0 ? ` / ${project.actual_pages} act.` : ''}
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
  )
}
