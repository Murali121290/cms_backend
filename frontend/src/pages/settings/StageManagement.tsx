import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, Plus, Pencil, RefreshCw,
  ChevronDown, ChevronRight, Search,
  Layers, Clock, X, AlertCircle,
} from 'lucide-react'
import { stagesApi } from '@/api/stages'
import type { Stage, StagePayload } from '@/api/stages'
import { rolesApi } from '@/api/workflow'
import type { RolesMaster } from '@/api/workflow'
import { Toggle } from '@/components/ui/Toggle'
import { Spinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'

// ── Tiny helpers ───────────────────────────────────────────────────────────────

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold
      ${active ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-slate-500 bg-slate-50 border border-slate-200'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function SectionHeader({ title, count, icon: Icon }: { title: string; count: number; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border bg-background rounded-t-xl">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, white)', color: 'var(--color-primary)' }}>
        <Icon size={14} />
      </div>
      <span className="text-sm font-semibold text-text">{title}</span>
      <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full bg-card border border-border text-muted">{count}</span>
    </div>
  )
}

// ── Stage Modal ────────────────────────────────────────────────────────────────

interface StageModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  initial?: Stage | null
  allRoles: RolesMaster[]
}

interface StageForm {
  stage_name: string
  sla_level1: string
  sla_level2: string
  sla_level3: string
  description: string
  active_status: boolean
  role_names: string[]
}

const EMPTY_FORM: StageForm = {
  stage_name: '', sla_level1: '', sla_level2: '', sla_level3: '',
  description: '', active_status: true, role_names: [],
}

function StageModal({ isOpen, onClose, onSaved, initial, allRoles }: StageModalProps) {
  const [form, setForm] = useState<StageForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof StageForm | 'general', string>>>({})
  const [saving, setSaving] = useState(false)
  const [roleSearch, setRoleSearch] = useState('')
  const [roleDropOpen, setRoleDropOpen] = useState(false)
  const roleDropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    if (initial) {
      setForm({
        stage_name:  initial.stage_name,
        sla_level1:  initial.sla_level1 != null ? String(initial.sla_level1) : '',
        sla_level2:  initial.sla_level2 != null ? String(initial.sla_level2) : '',
        sla_level3:  initial.sla_level3 != null ? String(initial.sla_level3) : '',
        description: initial.description ?? '',
        active_status: initial.active_status,
        role_names: initial.roles ?? [],
      })
    } else {
      setForm(EMPTY_FORM)
    }
    setErrors({})
    setRoleSearch('')
    setRoleDropOpen(false)
  }, [isOpen, initial])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (roleDropRef.current && !roleDropRef.current.contains(e.target as Node)) setRoleDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const validate = () => {
    const e: typeof errors = {}
    if (!form.stage_name.trim()) e.stage_name = 'Stage name is required'
    if (form.sla_level1 && Number(form.sla_level1) < 0) e.sla_level1 = 'Cannot be negative'
    if (form.sla_level2 && Number(form.sla_level2) < 0) e.sla_level2 = 'Cannot be negative'
    if (form.sla_level3 && Number(form.sla_level3) < 0) e.sla_level3 = 'Cannot be negative'
    return e
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true)
    try {
      const payload: StagePayload = {
        stage_name:  form.stage_name.trim(),
        sla_level1:  form.sla_level1 ? Number(form.sla_level1) : undefined,
        sla_level2:  form.sla_level2 ? Number(form.sla_level2) : undefined,
        sla_level3:  form.sla_level3 ? Number(form.sla_level3) : undefined,
        description: form.description.trim() || undefined,
        active_status: form.active_status,
        roles: form.role_names,
      }
      if (initial) {
        await stagesApi.update(initial.stage_name, payload)
        toast.success('Stage updated')
      } else {
        await stagesApi.create(payload)
        toast.success('Stage created')
      }
      onSaved()
      onClose()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      if (msg?.includes('already exists')) setErrors({ stage_name: 'Stage name already exists' })
      else toast.error(msg ?? 'Failed to save stage')
    } finally {
      setSaving(false)
    }
  }

  const toggleRole = (roleName: string) => {
    setForm(f => ({
      ...f,
      role_names: f.role_names.includes(roleName)
        ? f.role_names.filter(x => x !== roleName)
        : [...f.role_names, roleName],
    }))
  }

  const removeRole = (roleName: string) => {
    setForm(f => ({ ...f, role_names: f.role_names.filter(x => x !== roleName) }))
  }

  const filteredRoles = allRoles.filter(r =>
    r.active_status && (
      r.role_name.toLowerCase().includes(roleSearch.toLowerCase()) ||
      r.team.toLowerCase().includes(roleSearch.toLowerCase())
    )
  )

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-2xl shadow-2xl border border-border flex w-full max-w-4xl max-h-[90vh] overflow-hidden">

        {/* ── Left: Form ── */}
        <div className="flex flex-col flex-1 min-w-0 overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
            <h2 className="text-base font-semibold text-text">
              {initial ? 'Edit Stage' : 'Create New Stage'}
            </h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-background text-muted hover:text-text transition-colors">
              <X size={16} />
            </button>
          </div>

          <form id="stage-form" onSubmit={handleSubmit} className="px-6 py-5 space-y-5 flex-1">
            {/* Stage Information */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Stage Information</p>
              <div className="space-y-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-text">Stage Name <span className="text-red-500">*</span></label>
                  <input value={form.stage_name}
                    onChange={e => setForm(f => ({ ...f, stage_name: e.target.value }))}
                    disabled={!!initial}
                    className="w-full px-3 py-2 text-sm bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-60 border-border"
                    placeholder="e.g. Copy Editing" />
                  {errors.stage_name && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{errors.stage_name}</p>}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">SLA (days per level)</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-text">Level 1</label>
                      <input type="number" min={0} value={form.sla_level1}
                        onChange={e => setForm(f => ({ ...f, sla_level1: e.target.value }))}
                        className="w-full px-3 py-2 text-sm bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary border-border"
                        placeholder="e.g. 3" />
                      {errors.sla_level1 && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{errors.sla_level1}</p>}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-text">Level 2</label>
                      <input type="number" min={0} value={form.sla_level2}
                        onChange={e => setForm(f => ({ ...f, sla_level2: e.target.value }))}
                        className="w-full px-3 py-2 text-sm bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary border-border"
                        placeholder="e.g. 5" />
                      {errors.sla_level2 && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{errors.sla_level2}</p>}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-text">Level 3</label>
                      <input type="number" min={0} value={form.sla_level3}
                        onChange={e => setForm(f => ({ ...f, sla_level3: e.target.value }))}
                        className="w-full px-3 py-2 text-sm bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary border-border"
                        placeholder="e.g. 7" />
                      {errors.sla_level3 && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{errors.sla_level3}</p>}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-text">Description</label>
                  <textarea value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={2}
                    className="w-full px-3 py-2 text-sm bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary border-border resize-none"
                    placeholder="Brief description of this stage" />
                </div>

              </div>
            </div>

            {/* Role Mapping */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Role Mapping</p>

              <div className="relative" ref={roleDropRef}>
                <button type="button"
                  onClick={() => setRoleDropOpen(o => !o)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm bg-background border border-border rounded-lg hover:border-primary transition-colors">
                  <span className="text-muted">Select roles…</span>
                  <ChevronDown size={14} className={`text-muted transition-transform ${roleDropOpen ? 'rotate-180' : ''}`} />
                </button>

                {roleDropOpen && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg">
                    <div className="p-2 border-b border-border">
                      <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-2 text-muted" />
                        <input value={roleSearch} onChange={e => setRoleSearch(e.target.value)}
                          className="w-full pl-7 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                          placeholder="Search roles…" />
                      </div>
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                      {filteredRoles.length === 0
                        ? <p className="px-3 py-3 text-xs text-muted text-center">No roles found</p>
                        : filteredRoles.map(r => (
                          <button key={r.id} type="button"
                            onClick={() => toggleRole(r.role_name)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text hover:bg-background transition-colors">
                            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${form.role_names.includes(r.role_name) ? 'bg-primary border-primary' : 'border-border'}`}>
                              {form.role_names.includes(r.role_name) && <span className="text-white text-[8px] font-bold leading-none">✓</span>}
                            </span>
                            <span className="flex-1 text-left">{r.role_name}</span>
                            <span className="text-[10px] text-muted">{r.team}</span>
                          </button>
                        ))
                      }
                    </div>
                  </div>
                )}
              </div>

              {form.role_names.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {form.role_names.map(roleName => (
                    <span key={roleName}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-background text-xs text-text">
                      {roleName}
                      <button type="button" onClick={() => removeRole(roleName)}
                        className="text-muted hover:text-red-500 transition-colors">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </form>

          <div className="px-6 py-4 border-t border-border flex justify-end gap-2 flex-shrink-0">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border text-text hover:bg-background transition-colors">
              Cancel
            </button>
            <button type="submit" form="stage-form" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : initial ? 'Update Stage' : 'Create Stage'}
            </button>
          </div>
        </div>

        {/* ── Right: Live Preview ── */}
        <div className="w-64 flex-shrink-0 border-l border-border bg-background flex flex-col">
          <div className="px-4 py-3.5 border-b border-border">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Live Preview</p>
          </div>
          <div className="p-4 flex-1 overflow-y-auto">
            <div className="bg-card rounded-xl border border-border p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, white)', color: 'var(--color-primary)' }}>
                  <Layers size={13} />
                </div>
                <p className="text-xs font-semibold text-text truncate">
                  {form.stage_name || <span className="text-muted italic">Stage Name</span>}
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {form.sla_level1 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium flex items-center gap-0.5">
                    <Clock size={8} /> L1: {form.sla_level1}d
                  </span>
                )}
                {form.sla_level2 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium flex items-center gap-0.5">
                    <Clock size={8} /> L2: {form.sla_level2}d
                  </span>
                )}
                {form.sla_level3 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-medium flex items-center gap-0.5">
                    <Clock size={8} /> L3: {form.sla_level3}d
                  </span>
                )}
                <StatusPill active={form.active_status} />
              </div>

              {form.role_names.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">Mapped Roles</p>
                  <div className="flex flex-wrap gap-1">
                    {form.role_names.map(roleName => (
                      <span key={roleName} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-medium">
                        {roleName}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {form.role_names.length === 0 && (
                <p className="text-[11px] text-muted italic">No roles selected</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Expanded Stage Row ─────────────────────────────────────────────────────────

function ExpandedStageRow({ stage }: { stage: Stage }) {
  const hasLevels = stage.sla_level1 != null || stage.sla_level2 != null || stage.sla_level3 != null
  return (
    <tr>
      <td colSpan={6} className="bg-background/40 border-b border-border/50">
        <div className="px-12 py-3 space-y-3">
          {hasLevels && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5 flex items-center gap-1">
                <Clock size={10} /> SLA by Level
              </p>
              <div className="flex flex-wrap gap-1.5">
                {stage.sla_level1 != null && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">Level 1: {stage.sla_level1} days</span>
                )}
                {stage.sla_level2 != null && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">Level 2: {stage.sla_level2} days</span>
                )}
                {stage.sla_level3 != null && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-medium">Level 3: {stage.sla_level3} days</span>
                )}
              </div>
            </div>
          )}

          {stage.roles.length === 0 ? (
            <p className="text-xs text-muted italic">No roles mapped to this stage</p>
          ) : (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2 flex items-center gap-1">
                <Layers size={10} /> Mapped Roles
              </p>
              <div className="flex flex-wrap gap-2">
                {stage.roles.map(roleName => (
                  <span key={roleName} className="px-2.5 py-1 rounded-lg border border-border bg-card text-xs text-text font-medium">
                    {roleName}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function StageManagement() {
  const navigate = useNavigate()

  const [stages, setStages] = useState<Stage[]>([])
  const [roles, setRoles] = useState<RolesMaster[]>([])
  const [loading, setLoading] = useState(true)

  // Stages table state
  const [stageSearch, setStageSearch] = useState('')
  const [stageStatusFilter, setStageStatusFilter] = useState('')
  const [expandedStage, setExpandedStage] = useState<number | null>(null)

  // Modals
  const [stageModalOpen, setStageModalOpen] = useState(false)
  const [editingStage, setEditingStage] = useState<Stage | null>(null)
  const [stageStatusLoading, setStageStatusLoading] = useState<number | null>(null)

  const loadAll = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([stagesApi.list(), rolesApi.listActive()])
      setStages(s)
      setRoles(r)
    } catch {
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // Filtered stages
  const filteredStages = stages.filter(s =>
    s.stage_name.toLowerCase().includes(stageSearch.toLowerCase()) &&
    (!stageStatusFilter || (stageStatusFilter === 'active' ? s.active_status : !s.active_status))
  )

  const handleToggleStageStatus = async (stage: Stage) => {
    setStageStatusLoading(stage.id)
    try {
      await stagesApi.setStatus(stage.stage_name, !stage.active_status)
      toast.success(`Stage ${stage.active_status ? 'deactivated' : 'activated'}`)
      loadAll()
    } catch { toast.error('Failed to update status') }
    finally { setStageStatusLoading(null) }
  }

  return (
    <div className="space-y-5 max-w-full">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/settings')}
            className="p-1.5 rounded-lg text-muted hover:bg-card hover:text-text transition-colors">
            <ChevronLeft size={18} />
          </button>
          <div>
            <h2 className="text-xl font-bold text-text">Stage Management</h2>
            <p className="text-sm text-muted mt-0.5">Define workflow stages and their role mapping</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setEditingStage(null); setStageModalOpen(true) }}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors">
            <Plus size={15} /> Create New Stage
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-muted text-sm">Loading…</div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <SectionHeader title="Stages" count={filteredStages.length} icon={Layers} />

          {/* Search + Filter bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-background/30">
            <div className="relative flex-1 max-w-xs">
              <Search size={13} className="absolute left-3 top-2.5 text-muted" />
              <input value={stageSearch} onChange={e => setStageSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                placeholder="Search stages…" />
            </div>

            <select value={stageStatusFilter} onChange={e => setStageStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30 w-[130px]">
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>

            <button
              onClick={() => { setStageSearch(''); setStageStatusFilter('') }}
              className={`flex items-center gap-1 text-xs text-danger hover:underline transition-opacity ${
                stageSearch || stageStatusFilter ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
              }`}
            >
              <RefreshCw size={12} /> Clear
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-8"></th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Stage Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">SLA Levels</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Roles</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStages.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-sm text-muted">
                      <Layers size={28} className="mx-auto mb-2 opacity-30" />
                      {stageSearch || stageStatusFilter ? 'No stages match your filters' : 'No stages yet — create your first stage'}
                    </td>
                  </tr>
                ) : (
                  filteredStages.map(stage => (
                    <>
                      <tr key={stage.id}
                        className={`border-b border-border/50 hover:bg-background/50 transition-colors ${expandedStage === stage.id ? 'bg-background/50' : ''}`}>
                        <td className="pl-3 pr-0 py-3">
                          <button onClick={() => setExpandedStage(expandedStage === stage.id ? null : stage.id)}
                            className="p-1 rounded text-muted hover:text-text transition-colors">
                            {expandedStage === stage.id
                              ? <ChevronDown size={14} />
                              : <ChevronRight size={14} />}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
                              style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, white)', color: 'var(--color-primary)' }}>
                              {stage.stage_name[0].toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-text">{stage.stage_name}</p>
                              {stage.description && <p className="text-xs text-muted truncate max-w-[160px]">{stage.description}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {(stage.sla_level1 != null || stage.sla_level2 != null || stage.sla_level3 != null) ? (
                            <div className="flex flex-wrap gap-1">
                              {stage.sla_level1 != null && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">L1: {stage.sla_level1}d</span>
                              )}
                              {stage.sla_level2 != null && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">L2: {stage.sla_level2}d</span>
                              )}
                              {stage.sla_level3 != null && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-medium">L3: {stage.sla_level3}d</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 max-w-[220px]">
                          {stage.roles.length === 0 ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {stage.roles.map(roleName => (
                                <span key={roleName} className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-medium">
                                  {roleName}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {stageStatusLoading === stage.id
                              ? <Spinner />
                              : <Toggle checked={stage.active_status} onChange={() => handleToggleStageStatus(stage)} />}
                            <span className={`text-xs font-medium ${stage.active_status ? 'text-success' : 'text-muted'}`}>
                              {stage.active_status ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => { setEditingStage(stage); setStageModalOpen(true) }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-accent rounded-lg hover:bg-primary hover:text-white transition-colors">
                            <Pencil size={12} /> Edit
                          </button>
                        </td>
                      </tr>
                      {expandedStage === stage.id && (
                        <ExpandedStageRow key={`exp-${stage.id}`} stage={stage} />
                      )}
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      <StageModal
        isOpen={stageModalOpen}
        onClose={() => setStageModalOpen(false)}
        onSaved={loadAll}
        initial={editingStage}
        allRoles={roles}
      />
    </div>
  )
}
