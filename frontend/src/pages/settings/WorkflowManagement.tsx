import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Trash2, Edit2, ChevronRight, Workflow,
  AlertCircle, Search, GripVertical, Copy, X,
} from 'lucide-react'
import { workflowsApi } from '@/api/workflows'
import type { WorkflowStage, StageEntry } from '@/api/workflows'
import { stagesApi } from '@/api/stages'
import type { Stage } from '@/api/stages'
import { projectsApi } from '@/api/projects'
import { toast } from '@/store/useToastStore'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'

// ── Helpers ───────────────────────────────────────────────────────────────────

function orderStages(stages: WorkflowStage[]): WorkflowStage[] {
  if (stages.length === 0) return []
  const first = stages.find(s => !s.previous_stage) ?? stages[0]
  const visited = new Set<number>()
  const result: WorkflowStage[] = []
  let cur: WorkflowStage | undefined = first
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id)
    result.push(cur)
    cur = stages.find(s => s.stage_name === cur!.next_stage)
  }
  stages.forEach(s => { if (!visited.has(s.id)) result.push(s) })
  return result
}

function buildLinkedList(names: string[]): StageEntry[] {
  return names.map((name, i) => ({
    stage_name:     name,
    previous_stage: i > 0 ? names[i - 1] : null,
    next_stage:     i < names.length - 1 ? names[i + 1] : null,
  }))
}

// ── WorkflowModal ─────────────────────────────────────────────────────────────

interface WorkflowModalProps {
  isOpen:        boolean
  onClose:       () => void
  onSaved:       (name: string, stages: WorkflowStage[]) => void
  editName:      string | null   // null = create mode
  editStages:    WorkflowStage[]
  initName?:     string          // pre-fill for clone
  masterStages:  Stage[]
  usageCount:    number
}

function WorkflowModal({
  isOpen, onClose, onSaved,
  editName, editStages, initName,
  masterStages, usageCount,
}: WorkflowModalProps) {
  const [workflowName,    setWorkflowName]    = useState('')
  const [description,     setDescription]     = useState('')
  const [activeStatus,    setActiveStatus]     = useState(true)
  const [selectedStages,  setSelectedStages]  = useState<string[]>([])
  const [search,          setSearch]          = useState('')
  const [errors,          setErrors]          = useState<Record<string, string>>({})
  const [saving,          setSaving]          = useState(false)

  // DnD state
  const dragRef    = useRef<{ source: 'available' | 'workflow'; stageName: string; fromIndex: number } | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState(-1)

  // ── Initialise on open ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return
    const src = editName ? editStages : (initName ? editStages : [])
    const ordered = orderStages(src)
    setWorkflowName(editName ?? initName ?? '')
    setDescription(src[0]?.description ?? '')
    setActiveStatus(src[0]?.active_status ?? true)
    setSelectedStages(ordered.map(s => s.stage_name))
    setSearch('')
    setErrors({})
  }, [open, editName, editStages, initName])

  // ── Computed ────────────────────────────────────────────────────────────────

  const selectedSet = useMemo(() => new Set(selectedStages), [selectedStages])

  const filteredAvailable = useMemo(() =>
    masterStages
      .filter(s => s.active_status && !selectedSet.has(s.stage_name))
      .filter(s => !search || s.stage_name.toLowerCase().includes(search.toLowerCase()))
  , [masterStages, selectedSet, search])

  const activeCount = useMemo(
    () => masterStages.filter(s => s.active_status).length,
    [masterStages]
  )

  // ── Stage manipulation ──────────────────────────────────────────────────────

  function addStage(name: string, at?: number) {
    setSelectedStages(prev => {
      if (prev.includes(name)) return prev
      const next = [...prev]
      if (at !== undefined) next.splice(at, 0, name)
      else next.push(name)
      return next
    })
    setErrors(e => { const n = { ...e }; delete n.stages; return n })
  }

  function removeStage(idx: number) {
    setSelectedStages(prev => prev.filter((_, i) => i !== idx))
  }

  // ── DnD handlers ───────────────────────────────────────────────────────────

  function onDragStartAvailable(e: React.DragEvent, stageName: string) {
    dragRef.current = { source: 'available', stageName, fromIndex: -1 }
    e.dataTransfer.effectAllowed = 'copy'
  }

  function onDragStartWorkflow(e: React.DragEvent, stageName: string, idx: number) {
    dragRef.current = { source: 'workflow', stageName, fromIndex: idx }
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDragOverItem(e: React.DragEvent, idx: number) {
    e.preventDefault()
    e.stopPropagation()
    setDragOverIdx(idx)
  }

  function onDropItem(e: React.DragEvent, targetIdx: number) {
    e.preventDefault()
    e.stopPropagation()
    const drag = dragRef.current
    if (!drag) return
    if (drag.source === 'available') {
      addStage(drag.stageName, targetIdx)
    } else {
      const from = drag.fromIndex
      if (from === targetIdx) { dragRef.current = null; setDragOverIdx(-1); return }
      setSelectedStages(prev => {
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(from < targetIdx ? targetIdx - 1 : targetIdx, 0, moved)
        return next
      })
    }
    dragRef.current = null
    setDragOverIdx(-1)
  }

  function onDropZone(e: React.DragEvent) {
    e.preventDefault()
    const drag = dragRef.current
    if (drag?.source === 'available') addStage(drag.stageName)
    dragRef.current = null
    setDragOverIdx(-1)
  }

  // ── Validate & save ─────────────────────────────────────────────────────────

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!workflowName.trim()) e.workflowName = 'Workflow name is required'
    if (selectedStages.length === 0) e.stages = 'Add at least one stage'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    const stages = buildLinkedList(selectedStages)
    try {
      let saved: WorkflowStage[]
      if (editName) {
        saved = await workflowsApi.update(editName, {
          workflow_name: workflowName.trim(),
          description:   description || null,
          active_status: activeStatus,
          stages,
        })
      } else {
        saved = await workflowsApi.create({
          workflow_name: workflowName.trim(),
          description:   description || null,
          active_status: activeStatus,
          stages,
        })
      }
      toast.success(`Workflow "${workflowName.trim()}" ${editName ? 'updated' : 'created'}`)
      onSaved(workflowName.trim(), saved)
      onClose()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Failed to save workflow')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const modalTitle = editName
    ? `Edit Workflow — ${editName}`
    : initName
      ? `Clone Workflow — ${initName}`
      : 'Create Workflow'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving
              ? <><Spinner size="sm" /> Saving…</>
              : editName ? 'Update Workflow' : 'Create Workflow'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">

        {/* ── Usage warning ─────────────────────────────────────────────────── */}
        {editName && usageCount > 0 && (
          <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <p className="text-xs leading-relaxed">
              This workflow is used by <strong>{usageCount} project{usageCount !== 1 ? 's' : ''}</strong>.
              Editing stages will affect those projects.
            </p>
          </div>
        )}

        {/* ── Workflow info ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Workflow Name"
            required
            value={workflowName}
            onChange={e => { setWorkflowName(e.target.value); setErrors(v => { const n = { ...v }; delete n.workflowName; return n }) }}
            placeholder="e.g. Standard Book Workflow"
            error={errors.workflowName}
          />
          <Input
            label="Description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>

        {/* Active status toggle */}
        <label className="inline-flex items-center gap-2.5 cursor-pointer w-fit select-none">
          <button
            type="button"
            role="switch"
            aria-checked={activeStatus}
            onClick={() => setActiveStatus(v => !v)}
            className={`relative w-9 h-5 rounded-full transition-colors ${activeStatus ? 'bg-primary' : 'bg-border'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${activeStatus ? 'translate-x-4' : ''}`} />
          </button>
          <span className="text-xs font-medium text-text">{activeStatus ? 'Active' : 'Inactive'}</span>
        </label>

        {/* ── Flow preview ───────────────────────────────────────────────────── */}
        {selectedStages.length > 0 && (
          <div className="flex items-center flex-wrap gap-1 px-4 py-2.5 bg-accent/40 rounded-xl border border-primary/20">
            <span className="text-xs font-semibold text-primary mr-1 flex-shrink-0">Flow:</span>
            {selectedStages.map((name, i) => (
              <span key={name + i} className="flex items-center gap-1">
                <span className="text-xs font-medium text-text bg-card border border-border px-2 py-0.5 rounded-lg whitespace-nowrap">
                  {name}
                </span>
                {i < selectedStages.length - 1 && (
                  <ChevronRight size={12} className="text-muted flex-shrink-0" />
                )}
              </span>
            ))}
          </div>
        )}

        {/* ── Split panels ───────────────────────────────────────────────────── */}
        <div className="flex gap-3 h-[390px]">

          {/* Left: Available stages */}
          <div className="w-56 flex flex-col border border-border rounded-xl overflow-hidden bg-surface flex-shrink-0">
            <div className="px-3 py-2.5 border-b border-border bg-background flex-shrink-0">
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
                Available Stages
              </p>
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search stages…"
                  className="w-full pl-7 pr-2 py-1.5 text-xs bg-card border border-border rounded-lg text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
              {filteredAvailable.length === 0 ? (
                <p className="text-xs text-muted text-center py-8 italic">
                  {search ? 'No stages match' : 'All stages added'}
                </p>
              ) : filteredAvailable.map(stage => (
                <div
                  key={stage.id}
                  draggable
                  onDragStart={e => onDragStartAvailable(e, stage.stage_name)}
                  onClick={() => addStage(stage.stage_name)}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-grab active:cursor-grabbing hover:bg-card border border-transparent hover:border-primary/20 text-xs font-medium text-text transition-colors group"
                >
                  <GripVertical size={11} className="text-muted group-hover:text-primary flex-shrink-0" />
                  <span className="flex-1 truncate">{stage.stage_name}</span>
                  <Plus size={11} className="text-primary flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              ))}
            </div>

            <div className="px-3 py-2 border-t border-border bg-background flex-shrink-0">
              <p className="text-[10px] text-muted">
                {selectedStages.length} of {activeCount} added
              </p>
            </div>
          </div>

          {/* Right: Workflow builder */}
          <div
            className="flex-1 flex flex-col border border-border rounded-xl overflow-hidden bg-surface"
            onDragOver={e => { e.preventDefault(); if (dragRef.current?.source === 'available') setDragOverIdx(selectedStages.length) }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverIdx(-1) }}
            onDrop={onDropZone}
          >
            <div className="px-3 py-2.5 border-b border-border bg-background flex-shrink-0 flex items-center justify-between">
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">
                Workflow Builder
              </p>
              <span className="text-[10px] text-muted">
                {selectedStages.length} stage{selectedStages.length !== 1 ? 's' : ''}
              </span>
            </div>

            {errors.stages && (
              <div className="px-3 py-2 bg-red-50 border-b border-red-100 flex-shrink-0">
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle size={11} />{errors.stages}
                </p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-2">
              {selectedStages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-muted">
                  <Workflow size={28} className="opacity-20" />
                  <p className="text-xs text-center">
                    Drag stages from the left<br />or click a stage to add it
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {selectedStages.map((stageName, i) => (
                    <div key={stageName + i}>
                      {/* Drop indicator before this item */}
                      {dragOverIdx === i && dragRef.current?.source === 'available' && (
                        <div className="h-0.5 bg-primary rounded-full mx-1 mb-1" />
                      )}
                      <div
                        draggable
                        onDragStart={e => onDragStartWorkflow(e, stageName, i)}
                        onDragOver={e => onDragOverItem(e, i)}
                        onDrop={e => onDropItem(e, i)}
                        onDragEnd={() => { dragRef.current = null; setDragOverIdx(-1) }}
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors cursor-grab active:cursor-grabbing ${
                          dragOverIdx === i && dragRef.current?.source === 'workflow'
                            ? 'border-primary bg-accent/50'
                            : 'border-border bg-card hover:border-primary/30'
                        }`}
                      >
                        <GripVertical size={11} className="text-muted flex-shrink-0" />
                        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                          {i + 1}
                        </span>
                        <span className="flex-1 text-text truncate">{stageName}</span>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); removeStage(i) }}
                          className="p-1 rounded hover:bg-red-50 hover:text-red-500 text-muted transition-colors flex-shrink-0"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Drop indicator at end */}
                  {dragOverIdx === selectedStages.length && dragRef.current?.source === 'available' && (
                    <div className="h-0.5 bg-primary rounded-full mx-1 mt-1" />
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </Modal>
  )
}

// ── Flow chip (in table) ──────────────────────────────────────────────────────

function FlowChip({ stages }: { stages: WorkflowStage[] }) {
  const ordered = orderStages(stages)
  if (ordered.length === 0) return <span className="text-xs text-muted italic">No stages</span>
  return (
    <div className="flex items-center flex-wrap gap-1">
      {ordered.map((s, i) => (
        <span key={s.id} className="flex items-center gap-1">
          <span className="text-xs bg-accent text-primary border border-primary/20 rounded-md px-2 py-0.5 font-medium whitespace-nowrap">
            {s.stage_name}
          </span>
          {i < ordered.length - 1 && <ChevronRight size={11} className="text-muted flex-shrink-0" />}
        </span>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function WorkflowManagement() {
  const navigate = useNavigate()

  const [workflowMap,    setWorkflowMap]    = useState<Map<string, WorkflowStage[]>>(new Map())
  const [masterStages,   setMasterStages]   = useState<Stage[]>([])
  const [projectUsage,   setProjectUsage]   = useState<Map<string, number>>(new Map())
  const [loading,        setLoading]        = useState(true)

  // Modal state
  const [modalOpen,      setModalOpen]      = useState(false)
  const [editName,       setEditName]       = useState<string | null>(null)
  const [cloneName,      setCloneName]      = useState<string | undefined>(undefined)

  // Delete confirm
  const [confirmDelete,  setConfirmDelete]  = useState<string | null>(null)
  const [deleteLoading,  setDeleteLoading]  = useState(false)

  useEffect(() => {
    Promise.all([
      workflowsApi.getAllStages().catch(() => [] as WorkflowStage[]),
      stagesApi.list().catch(() => { toast.error('Failed to load stages from stage master'); return [] as Stage[] }),
      projectsApi.list().then(res => res.projects).catch(() => []),
    ]).then(([allStages, stages, projects]) => {
      const map = new Map<string, WorkflowStage[]>()
      for (const s of allStages) {
        const list = map.get(s.workflow_name) ?? []
        list.push(s)
        map.set(s.workflow_name, list)
      }
      setWorkflowMap(map)
      setMasterStages(stages)

      const usage = new Map<string, number>()
      for (const p of projects) {
        const wfType = p.workflow_type || (p as any).workflow_name
        if (wfType) {
          usage.set(wfType, (usage.get(wfType) ?? 0) + 1)
        }
      }
      setProjectUsage(usage)
    })
    .catch(() => toast.error('Failed to load workflows'))
    .finally(() => setLoading(false))
  }, [])

  function openCreate() {
    setEditName(null)
    setCloneName(undefined)
    setModalOpen(true)
  }

  function openEdit(name: string) {
    setEditName(name)
    setCloneName(undefined)
    setModalOpen(true)
  }

  function openClone(name: string) {
    setEditName(null)
    setCloneName(`${name} (copy)`)
    setModalOpen(true)
  }

  function handleSaved(name: string, stages: WorkflowStage[]) {
    setWorkflowMap(prev => {
      const next = new Map(prev)
      if (editName && editName !== name) next.delete(editName)
      next.set(name, stages)
      return next
    })
  }

  async function handleDelete(name: string) {
    setDeleteLoading(true)
    try {
      await workflowsApi.delete(name)
      setWorkflowMap(prev => { const n = new Map(prev); n.delete(name); return n })
      toast.success(`Workflow "${name}" deleted`)
    } catch {
      toast.error('Failed to delete workflow')
    } finally {
      setDeleteLoading(false)
      setConfirmDelete(null)
    }
  }

  const workflows = useMemo(() => Array.from(workflowMap.entries()), [workflowMap])

  const cloneStages = useMemo(() => {
    if (!cloneName) return []
    const original = cloneName.replace(/ \(copy\)$/, '')
    return workflowMap.get(original) ?? []
  }, [cloneName, workflowMap])

  if (loading) return <FullPageSpinner />

  return (
    <div className="flex flex-col gap-6 p-6 min-h-full">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent rounded-lg">
              <Workflow size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-text">Workflow Builder</h1>
              <p className="text-sm text-muted">
                {workflows.length} workflow{workflows.length !== 1 ? 's' : ''} configured
              </p>
            </div>
          </div>
        </div>
        <Button onClick={openCreate}><Plus size={15} /> Create Workflow</Button>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              {['Workflow Name', 'Stages', 'Flow', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {workflows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted">
                    <Workflow size={32} className="opacity-30" />
                    <p className="text-sm">No workflows yet. Create your first workflow.</p>
                    <button
                      onClick={openCreate}
                      className="mt-1 text-xs font-medium text-primary hover:underline"
                    >
                      + Create Workflow
                    </button>
                  </div>
                </td>
              </tr>
            ) : workflows.map(([name, stages]) => {
              const usage = projectUsage.get(name) ?? 0
              const desc  = stages[0]?.description
              const active = stages[0]?.active_status ?? true
              return (
                <tr key={name} className="hover:bg-background/60 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-text">{name}</p>
                        {!active && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-border text-muted rounded font-medium">
                            Inactive
                          </span>
                        )}
                      </div>
                      {desc && <p className="text-xs text-muted truncate max-w-xs">{desc}</p>}
                      {usage > 0 && (
                        <p className="text-[10px] text-amber-600">
                          Used by {usage} project{usage !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-surface border border-border px-2 py-0.5 rounded-full font-medium text-muted">
                      {stages.length} stage{stages.length !== 1 ? 's' : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-sm">
                    <FlowChip stages={stages} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => openEdit(name)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-accent rounded-lg hover:bg-primary hover:text-white transition-colors"
                      >
                        <Edit2 size={12} /> Edit
                      </button>
                      <button
                        onClick={() => openClone(name)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted bg-surface border border-border rounded-lg hover:bg-background transition-colors"
                      >
                        <Copy size={12} /> Clone
                      </button>
                      <button
                        onClick={() => setConfirmDelete(name)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-600 hover:text-white transition-colors"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Workflow modal */}
      <WorkflowModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        editName={editName}
        editStages={editName ? (workflowMap.get(editName) ?? []) : cloneStages}
        initName={cloneName}
        masterStages={masterStages}
        usageCount={editName ? (projectUsage.get(editName) ?? 0) : 0}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title="Delete Workflow"
        message={`Delete "${confirmDelete}" and all its stages? This cannot be undone.${
          (projectUsage.get(confirmDelete ?? '') ?? 0) > 0
            ? ` This workflow is used by ${projectUsage.get(confirmDelete ?? '')} project(s).`
            : ''
        }`}
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        loading={deleteLoading}
      />
    </div>
  )
}
