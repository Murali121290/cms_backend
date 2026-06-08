import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, Plus, Pencil, RefreshCw,
  ChevronDown, ChevronRight, Search, GripVertical,
  Layers, Activity, Clock, X, AlertCircle,
} from 'lucide-react'
import { stagesApi, activitiesApi } from '@/api/stages'
import type { Stage, StageActivity, StagePayload, StageActivityPayload } from '@/api/stages'
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

// ── Inline Create Activity Mini-Modal ──────────────────────────────────────────

interface MiniActivityModalProps {
  onCreated: (activity: StageActivity) => void
  onClose: () => void
}

function MiniActivityModal({ onCreated, onClose }: MiniActivityModalProps) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) { setErr('Activity name is required'); return }
    setSaving(true)
    try {
      const created = await activitiesApi.create({ stage_activity_name: name.trim(), description: desc || undefined })
      toast.success('Activity created')
      onCreated(created)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setErr(msg ?? 'Failed to create activity')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl border border-border w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-text">Quick Create Activity</p>
          <button onClick={onClose} className="p-1 rounded text-muted hover:text-text"><X size={14} /></button>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text">Activity Name <span className="text-red-500">*</span></label>
          <input value={name} onChange={e => { setName(e.target.value); setErr('') }}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            placeholder="e.g. Grammar Review" autoFocus />
          {err && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{err}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text">Description</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
            placeholder="Optional description" />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-border text-text hover:bg-background transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : 'Save Activity'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Stage Modal ────────────────────────────────────────────────────────────────

interface StageModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  initial?: Stage | null
  allActivities: StageActivity[]
  onActivitiesRefresh: () => Promise<StageActivity[]>
}

interface StageForm {
  stage_name: string
  sla_level1: string
  sla_level2: string
  sla_level3: string
  description: string
  active_status: boolean
  activity_ids: number[]
}

const EMPTY_FORM: StageForm = {
  stage_name: '', sla_level1: '', sla_level2: '', sla_level3: '',
  description: '', active_status: true, activity_ids: [],
}

function StageModal({ isOpen, onClose, onSaved, initial, allActivities, onActivitiesRefresh }: StageModalProps) {
  const [form, setForm] = useState<StageForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof StageForm | 'general', string>>>({})
  const [saving, setSaving] = useState(false)
  const [activities, setActivities] = useState<StageActivity[]>(allActivities)
  const [actSearch, setActSearch] = useState('')
  const [actDropOpen, setActDropOpen] = useState(false)
  const [miniModal, setMiniModal] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setActivities(allActivities) }, [allActivities])

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
        activity_ids: initial.stage_activities.map(a => a.id),
      })
    } else {
      setForm(EMPTY_FORM)
    }
    setErrors({})
    setActSearch('')
    setActDropOpen(false)
  }, [isOpen, initial])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setActDropOpen(false)
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
    if (form.activity_ids.length === 0) e.general = 'At least one stage activity is required'
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
        stage_activities: form.activity_ids,
        roles: [],
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

  const toggleActivity = (id: number) => {
    setForm(f => ({
      ...f,
      activity_ids: f.activity_ids.includes(id)
        ? f.activity_ids.filter(x => x !== id)
        : [...f.activity_ids, id],
    }))
    if (errors.general) setErrors(p => ({ ...p, general: undefined }))
  }

  const removeActivity = (id: number) => {
    setForm(f => ({ ...f, activity_ids: f.activity_ids.filter(x => x !== id) }))
  }

  const handleMiniCreated = async (created: StageActivity) => {
    const refreshed = await onActivitiesRefresh()
    setActivities(refreshed)
    setForm(f => ({ ...f, activity_ids: [...f.activity_ids, created.id] }))
    setMiniModal(false)
  }

  // Drag-and-drop reorder
  const onDragStart = (idx: number) => setDragIdx(idx)
  const onDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx) }
  const onDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return }
    const ids = [...form.activity_ids]
    const [moved] = ids.splice(dragIdx, 1)
    ids.splice(idx, 0, moved)
    setForm(f => ({ ...f, activity_ids: ids }))
    setDragIdx(null)
    setDragOverIdx(null)
  }
  const onDragEnd = () => { setDragIdx(null); setDragOverIdx(null) }

  const selectedActivities = form.activity_ids
    .map(id => activities.find(a => a.id === id))
    .filter(Boolean) as StageActivity[]

  const filteredActivities = activities.filter(a =>
    a.stage_activity_name.toLowerCase().includes(actSearch.toLowerCase()) && a.active_status
  )

  if (!isOpen) return null

  return (
    <>
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

              {/* Activities Mapping */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Stage Activities Mapping</p>

                {errors.general && (
                  <p className="text-xs text-red-500 flex items-center gap-1 mb-2"><AlertCircle size={11} />{errors.general}</p>
                )}

                {/* Multi-select dropdown */}
                <div className="relative" ref={dropRef}>
                  <button type="button"
                    onClick={() => setActDropOpen(o => !o)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm bg-background border border-border rounded-lg hover:border-primary transition-colors">
                    <span className="text-muted">Select activities…</span>
                    <ChevronDown size={14} className={`text-muted transition-transform ${actDropOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {actDropOpen && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg">
                      <div className="p-2 border-b border-border">
                        <div className="relative">
                          <Search size={13} className="absolute left-2.5 top-2 text-muted" />
                          <input value={actSearch} onChange={e => setActSearch(e.target.value)}
                            className="w-full pl-7 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                            placeholder="Search activities…" />
                        </div>
                      </div>
                      <div className="max-h-40 overflow-y-auto">
                        {filteredActivities.length === 0
                          ? <p className="px-3 py-3 text-xs text-muted text-center">No activities found</p>
                          : filteredActivities.map(a => (
                            <button key={a.id} type="button"
                              onClick={() => toggleActivity(a.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text hover:bg-background transition-colors">
                              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${form.activity_ids.includes(a.id) ? 'bg-primary border-primary' : 'border-border'}`}>
                                {form.activity_ids.includes(a.id) && <span className="text-white text-[8px] font-bold leading-none">✓</span>}
                              </span>
                              {a.stage_activity_name}
                            </button>
                          ))
                        }
                      </div>
                      <div className="p-2 border-t border-border">
                        <button type="button" onClick={() => { setActDropOpen(false); setMiniModal(true) }}
                          className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary hover:bg-primary/5 rounded-lg transition-colors">
                          <Plus size={12} /> Create New Activity
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Selected + drag-and-drop reorder */}
                {selectedActivities.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {selectedActivities.map((a, idx) => (
                      <div key={a.id}
                        draggable
                        onDragStart={() => onDragStart(idx)}
                        onDragOver={e => onDragOver(e, idx)}
                        onDrop={() => onDrop(idx)}
                        onDragEnd={onDragEnd}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-all cursor-grab
                          ${dragOverIdx === idx ? 'border-primary bg-primary/5' : 'border-border bg-background'}`}>
                        <GripVertical size={12} className="text-muted flex-shrink-0" />
                        <span className="w-4 h-4 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                          {idx + 1}
                        </span>
                        <span className="flex-1 text-text">{a.stage_activity_name}</span>
                        <button type="button" onClick={() => removeActivity(a.id)}
                          className="text-muted hover:text-red-500 transition-colors">
                          <X size={11} />
                        </button>
                      </div>
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

                {selectedActivities.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">Mapped Activities</p>
                    <ol className="space-y-1">
                      {selectedActivities.map((a, i) => (
                        <li key={a.id} className="flex items-center gap-1.5 text-[11px] text-text">
                          <span className="w-4 h-4 rounded-full bg-primary/10 text-primary text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                            {i + 1}
                          </span>
                          {a.stage_activity_name}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {selectedActivities.length === 0 && (
                  <p className="text-[11px] text-muted italic">No activities selected</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {miniModal && (
        <MiniActivityModal
          onCreated={handleMiniCreated}
          onClose={() => setMiniModal(false)}
        />
      )}
    </>
  )
}

// ── Activity Modal ─────────────────────────────────────────────────────────────

interface ActivityModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  initial?: StageActivity | null
}

function ActivityModal({ isOpen, onClose, onSaved, initial }: ActivityModalProps) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [active, setActive] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setName(initial?.stage_activity_name ?? '')
      setDesc(initial?.description ?? '')
      setActive(initial?.active_status ?? true)
      setErr('')
    }
  }, [isOpen, initial])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setErr('Activity name is required'); return }
    setSaving(true)
    try {
      const payload: StageActivityPayload = { stage_activity_name: name.trim(), description: desc || undefined, active_status: active }
      if (initial) {
        await activitiesApi.update(initial.stage_activity_name, payload)
        toast.success('Activity updated')
      } else {
        await activitiesApi.create(payload)
        toast.success('Activity created')
      }
      onSaved()
      onClose()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      if (msg?.includes('already exists')) setErr('Activity name already exists')
      else toast.error(msg ?? 'Failed to save activity')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-2xl shadow-2xl border border-border w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text">{initial ? 'Edit Activity' : 'Create Stage Activity'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-background text-muted hover:text-text transition-colors"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-text">Activity Name <span className="text-red-500">*</span></label>
            <input value={name} onChange={e => { setName(e.target.value); setErr('') }} disabled={!!initial}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-60"
              placeholder="e.g. Grammar Review" />
            {err && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{err}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-text">Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              placeholder="Brief description of this activity" />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-text">Status</label>
            <Toggle checked={active} onChange={setActive} />
            <span className={`text-xs font-medium ${active ? 'text-success' : 'text-muted'}`}>{active ? 'Active' : 'Inactive'}</span>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-text hover:bg-background transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : initial ? 'Update Activity' : 'Save Activity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Activity Deactivate Warning Modal ─────────────────────────────────────────

interface ActivityDeactivateWarningProps {
  activity: StageActivity
  affectedStages: Stage[]
  onContinue: () => void
  onCancel: () => void
  onViewStages: () => void
}

function ActivityDeactivateWarningModal({
  activity, affectedStages, onContinue, onCancel, onViewStages,
}: ActivityDeactivateWarningProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-card rounded-2xl shadow-2xl border border-border w-full max-w-lg">

        {/* Header */}
        <div className="flex items-start gap-3 px-6 pt-6 pb-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-amber-100">
            <AlertCircle size={20} className="text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-text">Deactivate Stage Activity?</h2>
            <p className="text-sm text-muted mt-1 leading-relaxed">
              This stage activity is currently mapped to existing stages.<br />
              Deactivating it may affect workflows and active projects.
            </p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-background text-muted hover:text-text transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Activity chip */}
        <div className="mx-6 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
          <Activity size={13} className="text-amber-600 flex-shrink-0" />
          <span className="text-xs font-semibold text-amber-800 truncate">{activity.stage_activity_name}</span>
        </div>

        {/* Affected stages table */}
        <div className="mx-6 mb-5 rounded-xl border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 6%, white)' }}>
            <p className="text-xs font-semibold text-muted">
              {affectedStages.length} affected stage{affectedStages.length !== 1 ? 's' : ''}
            </p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-background/50">
                <th className="text-left px-3 py-2 font-semibold text-muted uppercase tracking-wider">Stage Name</th>
                <th className="text-left px-3 py-2 font-semibold text-muted uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {affectedStages.map((s, i) => (
                <tr key={s.id}
                  className={`hover:bg-background/50 transition-colors ${i < affectedStages.length - 1 ? 'border-b border-border/50' : ''}`}>
                  <td className="px-3 py-2.5 font-medium text-text">{s.stage_name}</td>
                  <td className="px-3 py-2.5"><StatusPill active={s.active_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-2 px-6 pb-6">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2 text-sm rounded-lg border border-border text-text hover:bg-background transition-colors">
            Cancel
          </button>
          <button onClick={onViewStages}
            className="flex-1 px-4 py-2 text-sm rounded-lg border border-primary text-primary hover:bg-primary/5 transition-colors">
            View Affected Stages
          </button>
          <button onClick={onContinue}
            className="flex-1 px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors font-medium">
            Continue Inactivation
          </button>
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

          {stage.stage_activities.length === 0 ? (
            <p className="text-xs text-muted italic">No activities mapped to this stage</p>
          ) : (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2 flex items-center gap-1">
                <Activity size={10} /> Mapped Stage Activities
              </p>
              <div className="flex flex-wrap gap-2">
                {stage.stage_activities.map((a, i) => (
                  <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-card text-xs">
                    <span className="w-4 h-4 rounded-full bg-primary/10 text-primary text-[9px] font-bold flex items-center justify-center">{i + 1}</span>
                    <span className="text-text font-medium">{a.stage_activity_name}</span>
                    <StatusPill active={a.active_status} />
                  </div>
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

const ACT_PAGE_SIZE = 8

export function StageManagement() {
  const navigate = useNavigate()

  const [stages, setStages] = useState<Stage[]>([])
  const [activities, setActivities] = useState<StageActivity[]>([])
  const [loading, setLoading] = useState(true)

  // Stages table state
  const [stageSearch, setStageSearch] = useState('')
  const [stageStatusFilter, setStageStatusFilter] = useState('')
  const [expandedStage, setExpandedStage] = useState<number | null>(null)

  // Activities table state
  const [actSearch, setActSearch] = useState('')
  const [actStatusFilter, setActStatusFilter] = useState('')
  const [actPage, setActPage] = useState(1)

  // Modals
  const [stageModalOpen, setStageModalOpen] = useState(false)
  const [editingStage, setEditingStage] = useState<Stage | null>(null)
  const [actModalOpen, setActModalOpen] = useState(false)
  const [editingActivity, setEditingActivity] = useState<StageActivity | null>(null)
  const [stageStatusLoading, setStageStatusLoading] = useState<number | null>(null)
  const [actStatusLoading, setActStatusLoading] = useState<number | null>(null)
  const [actDeactivateWarning, setActDeactivateWarning] = useState<{
    activity: StageActivity
    affectedStages: Stage[]
  } | null>(null)
  const stagesSectionRef = useRef<HTMLDivElement>(null)

  const loadActivities = useCallback(async (): Promise<StageActivity[]> => {
    const data = await activitiesApi.list()
    setActivities(data)
    return data
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([stagesApi.list(), activitiesApi.list()])
      setStages(s)
      setActivities(a)
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

  // Filtered activities + pagination
  const filteredActivities = activities.filter(a =>
    a.stage_activity_name.toLowerCase().includes(actSearch.toLowerCase()) &&
    (!actStatusFilter || (actStatusFilter === 'active' ? a.active_status : !a.active_status))
  )
  const actTotalPages = Math.max(1, Math.ceil(filteredActivities.length / ACT_PAGE_SIZE))
  const actStart = (actPage - 1) * ACT_PAGE_SIZE
  const actPageRows = filteredActivities.slice(actStart, actStart + ACT_PAGE_SIZE)
  const actPadding = Math.max(0, ACT_PAGE_SIZE - actPageRows.length)

  const handleToggleStageStatus = async (stage: Stage) => {
    setStageStatusLoading(stage.id)
    try {
      await stagesApi.setStatus(stage.stage_name, !stage.active_status)
      toast.success(`Stage ${stage.active_status ? 'deactivated' : 'activated'}`)
      loadAll()
    } catch { toast.error('Failed to update status') }
    finally { setStageStatusLoading(null) }
  }

  const doToggleActivityStatus = async (a: StageActivity) => {
    setActStatusLoading(a.id)
    try {
      await activitiesApi.setStatus(a.stage_activity_name, !a.active_status)
      toast.success(`Activity ${a.active_status ? 'deactivated' : 'activated'}`)
      loadAll()
    } catch { toast.error('Failed to update status') }
    finally { setActStatusLoading(null) }
  }

  const handleToggleActivityStatus = (a: StageActivity) => {
    if (a.active_status) {
      const affectedStages = stages.filter(s =>
        s.stage_activities.some(sa => sa.id === a.id)
      )
      if (affectedStages.length > 0) {
        setActDeactivateWarning({ activity: a, affectedStages })
        return
      }
    }
    doToggleActivityStatus(a)
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
            <p className="text-sm text-muted mt-0.5">Define workflow stages and their activities</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setEditingActivity(null); setActModalOpen(true) }}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg border border-border text-text hover:bg-card transition-colors">
            <Plus size={15} /> Create Stage Activity
          </button>
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
        <>
          {/* ══════════════════════════════════════════ TOP SECTION: Stages ══ */}
          <div ref={stagesSectionRef} className="bg-card border border-border rounded-xl overflow-hidden">
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
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Activities</th>
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
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 text-xs font-semibold">
                              {stage.stage_activities.length}
                            </span>
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

          {/* ══════════════════════════════════ BOTTOM SECTION: Activities ══ */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <SectionHeader title="Stage Activities" count={filteredActivities.length} icon={Activity} />

            {/* Search bar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-background/30">
              <div className="relative flex-1 max-w-xs">
                <Search size={13} className="absolute left-3 top-2.5 text-muted" />
                <input value={actSearch}
                  onChange={e => { setActSearch(e.target.value); setActPage(1) }}
                  className="w-full pl-8 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  placeholder="Search activities…" />
              </div>
              <select value={actStatusFilter} onChange={e => { setActStatusFilter(e.target.value); setActPage(1) }}
                className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30 w-[130px]">
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>

              <button
                onClick={() => { setActSearch(''); setActStatusFilter(''); setActPage(1) }}
                className={`flex items-center gap-1 text-xs text-danger hover:underline transition-opacity ${
                  actSearch || actStatusFilter ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
                }`}
              >
                <RefreshCw size={12} /> Clear
              </button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider w-8">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Activity Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Description</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {actPageRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-sm text-muted">
                      <Activity size={28} className="mx-auto mb-2 opacity-30" />
                      {actSearch || actStatusFilter ? 'No activities match your filters' : 'No activities yet'}
                    </td>
                  </tr>
                ) : (
                  actPageRows.map((a, idx) => (
                    <tr key={a.id} className="border-b border-border/50 hover:bg-background/50 transition-colors">
                      <td className="px-4 py-3 text-xs text-muted">{actStart + idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, white)', color: 'var(--color-primary)' }}>
                            {a.stage_activity_name[0].toUpperCase()}
                          </div>
                          <span className="font-medium text-text">{a.stage_activity_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted max-w-[220px] truncate">{a.description ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {actStatusLoading === a.id
                            ? <Spinner />
                            : <Toggle checked={a.active_status} onChange={() => handleToggleActivityStatus(a)} />}
                          <span className={`text-xs font-medium ${a.active_status ? 'text-success' : 'text-muted'}`}>
                            {a.active_status ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => { setEditingActivity(a); setActModalOpen(true) }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-accent rounded-lg hover:bg-primary hover:text-white transition-colors">
                          <Pencil size={12} /> Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
                {Array.from({ length: actPadding }).map((_, i) => (
                  <tr key={`pad-${i}`} className="border-b border-border/30">
                    <td colSpan={6} className="px-4 py-3">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className={`flex items-center justify-between px-4 py-3 border-t border-border/50 ${actTotalPages <= 1 ? 'invisible' : ''}`}>
              <p className="text-xs text-muted">
                Showing {actStart + 1}–{Math.min(actStart + ACT_PAGE_SIZE, filteredActivities.length)} of {filteredActivities.length}
              </p>
              <div className="flex items-center gap-1">
                <button onClick={() => setActPage(p => Math.max(1, p - 1))} disabled={actPage === 1}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-border text-muted hover:bg-background disabled:opacity-40 transition-colors">
                  Prev
                </button>
                {Array.from({ length: actTotalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setActPage(p)}
                    className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${p === actPage ? 'bg-primary text-white border-primary' : 'border-border text-muted hover:bg-background'}`}>
                    {p}
                  </button>
                ))}
                <button onClick={() => setActPage(p => Math.min(actTotalPages, p + 1))} disabled={actPage === actTotalPages}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-border text-muted hover:bg-background disabled:opacity-40 transition-colors">
                  Next
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Modals ── */}
      <StageModal
        isOpen={stageModalOpen}
        onClose={() => setStageModalOpen(false)}
        onSaved={loadAll}
        initial={editingStage}
        allActivities={activities}
        onActivitiesRefresh={loadActivities}
      />
      <ActivityModal
        isOpen={actModalOpen}
        onClose={() => setActModalOpen(false)}
        onSaved={loadAll}
        initial={editingActivity}
      />

      {actDeactivateWarning && (
        <ActivityDeactivateWarningModal
          activity={actDeactivateWarning.activity}
          affectedStages={actDeactivateWarning.affectedStages}
          onCancel={() => setActDeactivateWarning(null)}
          onContinue={() => {
            const a = actDeactivateWarning.activity
            setActDeactivateWarning(null)
            doToggleActivityStatus(a)
          }}
          onViewStages={() => {
            setActDeactivateWarning(null)
            stagesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        />
      )}
    </div>
  )
}
