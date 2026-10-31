import { useState, useEffect, useMemo } from 'react'
import {
  Workflow, Check, Plus, Edit2, Copy, Trash2, ArrowUp, ArrowDown, X,
  Layers, Settings, Sparkles, AlertCircle, Info, ChevronRight, CheckCircle2
} from 'lucide-react'
import {
  journalsApi,
  type JournalWorkflow,
  type MasterJournalStage,
  type JournalOverview,
} from '@/api/journals'
import { getApiErrorMessage } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'
import { cn } from '@/utils/cn'

interface Props {
  journalId: number
  journal: JournalOverview
  onJournalUpdated: () => void
}

export function JournalWorkflowSettingsTab({ journalId, journal, onJournalUpdated }: Props) {
  const [workflows, setWorkflows] = useState<JournalWorkflow[]>([])
  const [availableStages, setAvailableStages] = useState<MasterJournalStage[]>([])
  const [loading, setLoading] = useState(true)
  const [savingAssignment, setSavingAssignment] = useState(false)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number>(journal.workflow_id ?? 0)

  // Modal State
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'clone'>('create')
  const [editingWorkflowId, setEditingWorkflowId] = useState<number | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formIsDefault, setFormIsDefault] = useState(false)
  const [formSelectedStages, setFormSelectedStages] = useState<{ id: number; name: string }[]>([])
  const [modalSaving, setModalSaving] = useState(false)

  // Delete Confirm State
  const [deleteWorkflowId, setDeleteWorkflowId] = useState<number | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const loadData = async () => {
    try {
      const [wfs, stages] = await Promise.all([
        journalsApi.getWorkflows(),
        journalsApi.getAvailableStages(),
      ])
      setWorkflows(wfs)
      setAvailableStages(stages)
      if (journal.workflow_id) {
        setSelectedWorkflowId(journal.workflow_id)
      } else {
        const def = wfs.find(w => w.is_default) ?? wfs[0]
        if (def) setSelectedWorkflowId(def.id)
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to load journal workflows'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [journalId])

  useEffect(() => {
    if (journal.workflow_id) {
      setSelectedWorkflowId(journal.workflow_id)
    }
  }, [journal.workflow_id])

  // Current Journal Active Workflow
  const currentWorkflow = useMemo(() => {
    return workflows.find(w => w.id === journal.workflow_id) ?? workflows.find(w => w.is_default) ?? workflows[0]
  }, [workflows, journal.workflow_id])

  // Assign Workflow to Journal
  const handleAssignWorkflow = async (wfId: number) => {
    setSavingAssignment(true)
    try {
      await journalsApi.updateJournalWorkflow(journalId, wfId)
      toast.success('Journal workflow updated successfully')
      setSelectedWorkflowId(wfId)
      onJournalUpdated()
      await loadData()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update journal workflow'))
    } finally {
      setSavingAssignment(false)
    }
  }

  // Open Create Modal
  const openCreateModal = () => {
    setModalMode('create')
    setEditingWorkflowId(null)
    setFormName('')
    setFormDescription('')
    setFormIsDefault(false)
    // Default to the 4-stage editorial pipeline for convenience
    setFormSelectedStages([
      { id: 1, name: '1. MS review & elog' },
      { id: 2, name: '2. Pre-editing' },
      { id: 3, name: '3. Language editing' },
      { id: 8, name: '4. final delivery' },
    ])
    setModalOpen(true)
  }

  // Open Edit Modal
  const openEditModal = (wf: JournalWorkflow) => {
    setModalMode('edit')
    setEditingWorkflowId(wf.id)
    setFormName(wf.name)
    setFormDescription(wf.description ?? '')
    setFormIsDefault(wf.is_default)
    const stagesList = (wf.custom_stages && wf.custom_stages.length > 0)
      ? wf.custom_stages.map((name, i) => ({ id: wf.stage_numbers[i] ?? i + 1, name }))
      : (wf.stages && wf.stages.length > 0)
      ? wf.stages.map((name, i) => ({ id: wf.stage_numbers[i] ?? i + 1, name }))
      : wf.stage_numbers.map((n) => ({ id: n, name: `Stage ${n}` }))
    setFormSelectedStages(stagesList)
    setModalOpen(true)
  }

  // Open Clone Modal
  const openCloneModal = (wf: JournalWorkflow) => {
    setModalMode('clone')
    setEditingWorkflowId(null)
    setFormName(`${wf.name} (Copy)`)
    setFormDescription(wf.description ?? '')
    setFormIsDefault(false)
    const stagesList = (wf.custom_stages && wf.custom_stages.length > 0)
      ? wf.custom_stages.map((name, i) => ({ id: wf.stage_numbers[i] ?? i + 1, name }))
      : (wf.stages && wf.stages.length > 0)
      ? wf.stages.map((name, i) => ({ id: wf.stage_numbers[i] ?? i + 1, name }))
      : wf.stage_numbers.map((n) => ({ id: n, name: `Stage ${n}` }))
    setFormSelectedStages(stagesList)
    setModalOpen(true)
  }

  // Stage list manipulation in modal
  const addStageToWorkflow = (masterStage: MasterJournalStage) => {
    const nextNum = formSelectedStages.length + 1
    const cleanShort = masterStage.short_name.toLowerCase() === 'final delivery' ? 'final delivery' : masterStage.short_name
    const stageLabel = `${nextNum}. ${cleanShort}`
    setFormSelectedStages(prev => [...prev, { id: masterStage.id, name: stageLabel }])
  }

  const removeStageFromWorkflow = (index: number) => {
    setFormSelectedStages(prev => {
      const next = prev.filter((_, i) => i !== index)
      // re-index stage numbers
      return next.map((st, i) => ({
        id: st.id,
        name: st.name.replace(/^\d+\.\s*/, `${i + 1}. `)
      }))
    })
  }

  const moveStage = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= formSelectedStages.length) return
    setFormSelectedStages(prev => {
      const copy = [...prev]
      const [item] = copy.splice(index, 1)
      copy.splice(targetIndex, 0, item)
      return copy.map((st, i) => ({
        id: st.id,
        name: st.name.replace(/^\d+\.\s*/, `${i + 1}. `)
      }))
    })
  }

  const handleUpdateStageLabel = (index: number, newLabel: string) => {
    setFormSelectedStages(prev => {
      const copy = [...prev]
      copy[index] = { ...copy[index], name: newLabel }
      return copy
    })
  }

  // Save Modal
  const handleSaveWorkflowModal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) {
      toast.error('Workflow name is required')
      return
    }
    if (formSelectedStages.length === 0) {
      toast.error('Please add at least one stage to the workflow')
      return
    }

    setModalSaving(true)
    try {
      const stageNumbers = formSelectedStages.map((st, i) => st.id ?? i + 1)
      const customStages = formSelectedStages.map(st => st.name)

      if (modalMode === 'edit' && editingWorkflowId) {
        await journalsApi.updateWorkflow(editingWorkflowId, {
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          stage_numbers: stageNumbers,
          custom_stages: customStages,
          is_default: formIsDefault,
        })
        toast.success(`Workflow "${formName}" updated successfully`)
      } else {
        await journalsApi.createWorkflow({
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          stage_numbers: stageNumbers,
          custom_stages: customStages,
          is_default: formIsDefault,
        })
        toast.success(`Workflow "${formName}" created successfully`)
      }

      setModalOpen(false)
      await loadData()
      onJournalUpdated()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to save workflow'))
    } finally {
      setModalSaving(false)
    }
  }

  // Delete Workflow
  const handleDeleteWorkflow = async () => {
    if (!deleteWorkflowId) return
    setDeleteBusy(true)
    try {
      const res = await journalsApi.deleteWorkflow(deleteWorkflowId)
      toast.success(res.message || 'Workflow deleted')
      setDeleteWorkflowId(null)
      await loadData()
      onJournalUpdated()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to delete workflow'))
    } finally {
      setDeleteBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="p-12 flex justify-center items-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* ── Active Workflow Section ────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/80 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-primary/10 text-primary">
                <Workflow className="size-5" />
              </span>
              <div>
                <h2 className="text-base font-bold text-text flex items-center gap-2">
                  <span>Current Journal Workflow</span>
                  <Badge variant="in-progress" size="sm">Active</Badge>
                </h2>
                <p className="text-xs text-muted">
                  Articles created or uploaded to <span className="font-semibold text-text">{journal.journal_title}</span> follow this sequence of production stages.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedWorkflowId}
              onChange={e => setSelectedWorkflowId(Number(e.target.value))}
              className="bg-surface border border-border rounded-lg text-xs font-medium px-3 py-2 text-text focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {workflows.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name} {w.is_default ? '(Default)' : ''} ({w.stages?.length ?? w.stage_numbers?.length} stages)
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              size="sm"
              disabled={selectedWorkflowId === journal.workflow_id}
              onClick={() => handleAssignWorkflow(selectedWorkflowId)}
              isLoading={savingAssignment}
            >
              Apply to Journal
            </Button>
          </div>
        </div>

        {/* Current Pipeline Visualization */}
        {currentWorkflow && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-text">{currentWorkflow.name}</h3>
                <p className="text-xs text-muted">{currentWorkflow.description || 'Custom sequential production workflow.'}</p>
              </div>
              <Badge variant="outline" size="sm">
                {currentWorkflow.stages?.length || currentWorkflow.stage_numbers?.length} Stages
              </Badge>
            </div>

            {/* Stepper Rail */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              {(currentWorkflow.stages || []).map((stageName, idx) => {
                const isFirst = idx === 0
                const isLast = idx === (currentWorkflow.stages?.length ?? 1) - 1
                return (
                  <div
                    key={stageName + idx}
                    className="relative p-4 rounded-xl border border-border bg-surface/50 hover:border-primary/40 hover:bg-surface transition-all flex flex-col justify-between space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="size-6 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center">
                        {idx + 1}
                      </span>
                      {isFirst && <Badge variant="info" size="sm">Entry Gate</Badge>}
                      {isLast && <Badge variant="success" size="sm">Delivery</Badge>}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-text line-clamp-1">{stageName}</h4>
                      <p className="text-[11px] text-muted line-clamp-2 mt-0.5">
                        {stageName.toLowerCase().includes('ms review') || stageName.toLowerCase().includes('ms analysis')
                          ? 'Manuscript extraction, metadata inspection & ELOG.'
                          : stageName.toLowerCase().includes('pre-edit')
                          ? 'Structuring, references, 121 rules & citation checks.'
                          : stageName.toLowerCase().includes('language')
                          ? 'Grammar house style rules, language quality & tracked changes.'
                          : stageName.toLowerCase().includes('delivery')
                          ? 'Final publication package and ZIP generation.'
                          : 'Standard journal production gate.'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── Workflow Management Section (Configurable Like Book) ───────────── */}
      <section className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-5">
          <div>
            <h2 className="text-base font-bold text-text flex items-center gap-2">
              <Layers className="size-5 text-primary" />
              <span>Configure Journal Workflows & Stages</span>
            </h2>
            <p className="text-xs text-muted mt-0.5">
              Manage reusable workflow templates just like book workflows. Create custom stages, pick required gates, and assign to publications.
            </p>
          </div>
          <Button variant="primary" leftIcon={<Plus className="size-4" />} onClick={openCreateModal}>
            + New Journal Workflow
          </Button>
        </div>

        {/* Workflows List Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workflows.map(wf => {
            const isAssigned = wf.id === journal.workflow_id
            const stageCount = wf.stages?.length || wf.stage_numbers?.length || 0
            const isFourStage = stageCount === 4
            return (
              <div
                key={wf.id}
                className={cn(
                  'p-5 rounded-xl border transition-all flex flex-col justify-between space-y-4',
                  isAssigned
                    ? 'border-primary/50 bg-primary/5 shadow-sm ring-1 ring-primary/20'
                    : 'border-border bg-card hover:border-primary/30 hover:shadow-sm'
                )}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-text">{wf.name}</h3>
                        {wf.is_default && (
                          <Badge variant="default" size="sm">Default</Badge>
                        )}
                        {isFourStage && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                            4-Stage Pipeline
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted line-clamp-2 mt-1">
                        {wf.description || 'No description provided.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditModal(wf)}
                        className="p-1.5 rounded-md hover:bg-surface text-muted hover:text-text transition-colors"
                        title="Edit workflow"
                      >
                        <Edit2 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openCloneModal(wf)}
                        className="p-1.5 rounded-md hover:bg-surface text-muted hover:text-text transition-colors"
                        title="Clone workflow"
                      >
                        <Copy className="size-3.5" />
                      </button>
                      {!wf.is_default && (
                        <button
                          type="button"
                          onClick={() => setDeleteWorkflowId(wf.id)}
                          className="p-1.5 rounded-md hover:bg-rose-500/10 text-muted hover:text-rose-600 transition-colors"
                          title="Delete workflow"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Stage Sequence Pills */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-2">
                    {(wf.stages || []).map((s, idx) => (
                      <span
                        key={s + idx}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-surface border border-border/80 text-text"
                      >
                        <span className="size-3.5 rounded-full bg-primary/20 text-primary font-bold text-[9px] flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <span>{s.replace(/^\d+\.\s*/, '')}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border/70 pt-3 text-xs text-muted">
                  <span>
                    Used by <strong className="text-text font-semibold">{wf.journals_count ?? 0}</strong> journal{wf.journals_count === 1 ? '' : 's'}
                  </span>
                  {isAssigned ? (
                    <span className="inline-flex items-center gap-1 text-primary font-bold">
                      <CheckCircle2 className="size-4" /> Active on this Journal
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleAssignWorkflow(wf.id)}
                      disabled={savingAssignment}
                      className="text-primary hover:text-primary-dark"
                    >
                      Assign to this Journal ➔
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Workflow Create / Edit Modal ────────────────────────────────────── */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          modalMode === 'edit'
            ? `Edit Workflow: ${formName}`
            : modalMode === 'clone'
            ? 'Clone Journal Workflow'
            : 'Create New Journal Workflow'
        }
        size="lg"
      >
        <form onSubmit={handleSaveWorkflowModal} className="space-y-6">
          <div className="space-y-4">
            <Input
              label="Workflow Name"
              placeholder="e.g. PA Editorial (4 stages) or Fast Track"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              required
            />
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text">Description</label>
              <textarea
                rows={2}
                placeholder="Brief description of the stages and production workflow..."
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                className="w-full text-xs rounded-lg border border-border bg-surface px-3 py-2 text-text focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-text">
              <input
                type="checkbox"
                checked={formIsDefault}
                onChange={e => setFormIsDefault(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary/40 size-4"
              />
              <span>Set as default workflow for newly created journals</span>
            </label>
          </div>

          {/* Two-Column Stage Builder */}
          <div className="border border-border rounded-xl p-4 bg-surface/30 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-text flex items-center gap-1.5">
                <Layers className="size-4 text-primary" />
                <span>Configure Workflow Stages ({formSelectedStages.length} selected)</span>
              </h3>
              <span className="text-[11px] text-muted">Use arrows to reorder sequential stages</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Available Master Stages */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wide">Available Master Stages</h4>
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                  {availableStages.map(st => (
                    <div
                      key={st.id}
                      className="p-2.5 rounded-lg border border-border bg-card flex items-center justify-between hover:border-primary/40 transition-colors"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-bold text-text truncate">{st.short_name}</p>
                        <p className="text-[10px] text-muted line-clamp-1">{st.description}</p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="shrink-0 h-7 text-xs px-2"
                        onClick={() => addStageToWorkflow(st)}
                      >
                        + Add
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Selected Workflow Stages */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wide">Pipeline Order (Stages 1..N)</h4>
                {formSelectedStages.length === 0 ? (
                  <div className="h-44 border border-dashed border-border rounded-lg flex flex-col items-center justify-center p-4 text-center">
                    <p className="text-xs text-muted">No stages added yet.</p>
                    <p className="text-[11px] text-muted/70">Click + Add on any master stage to build this workflow.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                    {formSelectedStages.map((st, i) => (
                      <div
                        key={i}
                        className="p-2 rounded-lg border border-primary/30 bg-primary/5 flex items-center justify-between gap-2"
                      >
                        <span className="size-5 rounded-full bg-primary text-white font-bold text-[10px] flex items-center justify-center shrink-0">
                          {i + 1}
                        </span>

                        <input
                          type="text"
                          value={st.name}
                          onChange={e => handleUpdateStageLabel(i, e.target.value)}
                          className="flex-1 min-w-0 text-xs font-semibold bg-white border border-border rounded px-2 py-1 text-slate-900 focus:outline-none focus:ring-1 focus:ring-primary"
                        />

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={i === 0}
                            onClick={() => moveStage(i, 'up')}
                            className="p-1 rounded hover:bg-surface text-muted hover:text-text disabled:opacity-30"
                            title="Move Up"
                          >
                            <ArrowUp className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={i === formSelectedStages.length - 1}
                            onClick={() => moveStage(i, 'down')}
                            className="p-1 rounded hover:bg-surface text-muted hover:text-text disabled:opacity-30"
                            title="Move Down"
                          >
                            <ArrowDown className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeStageFromWorkflow(i)}
                            className="p-1 rounded hover:bg-rose-500/10 text-muted hover:text-rose-600"
                            title="Remove stage"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={modalSaving}>
              {modalMode === 'edit' ? 'Save Workflow Changes' : 'Create Workflow'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Confirmation Dialog ──────────────────────────────────────── */}
      <Modal
        isOpen={deleteWorkflowId !== null}
        onClose={() => setDeleteWorkflowId(null)}
        title="Delete Journal Workflow"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Are you sure you want to delete this workflow template? If any journals are currently assigned to it, the workflow will be deactivated instead of removed.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setDeleteWorkflowId(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleDeleteWorkflow} isLoading={deleteBusy}>
              Delete Workflow
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
