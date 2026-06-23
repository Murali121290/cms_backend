import { useState, useEffect } from 'react'
import { BookOpen, Layers } from 'lucide-react'
import { projectsApi, type Project, type ProjectUpdate } from '@/api/projects'
import { Select } from '@/components/ui/Select'
import { toast } from '@/store/useToastStore'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge, statusToBadge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'

// ── Helpers ───────────────────────────────────────────────────────────────────

function Section({ title, icon: Icon }: { title: string; icon?: React.ElementType }) {
  return (
    <div className="col-span-2 flex items-center gap-2 pt-2 pb-1">
      {Icon && <Icon size={14} className="text-primary flex-shrink-0" />}
      <h3 className="text-xs font-semibold text-primary uppercase tracking-wider whitespace-nowrap">{title}</h3>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

function InfoField({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] text-muted font-medium uppercase tracking-wide">{label}</p>
      <p className="text-sm text-text">{value != null && value !== '' ? value : '—'}</p>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface EditForm {
  composition:    string
  edition:        string
  color:          string
  trim_size:      string
  copyright_year: string
  actual_pages:   string
}

interface ProjectInfoModalProps {
  project:   Project | null
  open:      boolean
  mode:      'view' | 'edit'
  onClose:   () => void
  onUpdated: (project: Project) => void
}

export function ProjectInfoModal({ project, open, mode, onClose, onUpdated }: ProjectInfoModalProps) {
  const [form, setForm]     = useState<EditForm>({ composition: '', edition: '', color: '', trim_size: '', copyright_year: '', actual_pages: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (project) {
      setForm({
        composition:    project.composition    ?? '',
        edition:        project.edition        ?? '',
        color:          project.color          ?? '',
        trim_size:      project.trim_size       ?? '',
        copyright_year: project.copyright_year != null ? String(project.copyright_year) : '',
        actual_pages:   String(project.actual_pages ?? 0),
      })
    }
  }, [project])

  if (!project) return null

  function set(key: keyof EditForm, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave() {
    if (!project) return
    setSaving(true)
    try {
      const data: ProjectUpdate = {
        composition:    form.composition    || null,
        edition:        form.edition        || null,
        color:          form.color          || null,
        trim_size:      form.trim_size       || null,
        copyright_year: form.copyright_year ? Number(form.copyright_year) : null,
        actual_pages:   form.actual_pages   ? Number(form.actual_pages)   : 0,
      }
      const updated = await projectsApi.update(project.id, data)
      toast.success('Project updated')
      onUpdated(updated)
      onClose()
    } catch {
      toast.error('Failed to update project')
    } finally {
      setSaving(false)
    }
  }

  const statusV = project.status ? statusToBadge(project.status.toLowerCase()) : 'default'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? 'Edit Project Details' : 'Project Details'}
      size="xl"
      footer={
        mode === 'edit' ? (
          <>
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <><Spinner size="sm" /> Saving…</> : 'Save Changes'}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>Close</Button>
        )
      }
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-border mb-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text truncate">
            {project.project_title || project.project_code || `Project #${project.id}`}
          </h2>
          {project.project_title && project.project_code && (
            <p className="text-xs text-muted mt-0.5">{project.project_code}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {project.priority === 'Fast Track' && <Badge variant="in-progress">Fast Track</Badge>}
          {project.status && <Badge variant={statusV}>{project.status}</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">

        {/* ── Project Information ── */}
        <Section title="Project Information" icon={BookOpen} />

        <InfoField label="Project Code"     value={project.project_code} />
        <InfoField label="Customer Name"    value={project.client_name} />
        <InfoField label="Division Code"    value={project.division_code} />
        <InfoField label="Customer Contact" value={project.customer_contact} />
        <InfoField label="Category"         value={project.category} />
        <InfoField label="Composition"      value={project.composition} />
        <InfoField label="Workflow"         value={project.workflow_name} />
        <InfoField label="Project Manager"  value={project.project_manager} />
        <InfoField label="Sales Person"     value={project.sales_person} />
        <InfoField label="Billing Location" value={project.billing_location} />
        <InfoField label="ISBN No"          value={project.isbn_no} />

        {/* ── Publication Details ── */}
        <Section title="Publication Details" icon={Layers} />

        {mode === 'view' ? (
          <>
            <InfoField label="Composition"     value={project.composition} />
            <InfoField label="Edition"         value={project.edition} />
            <InfoField label="Color"           value={project.color} />
            <InfoField label="Trim Size"       value={project.trim_size} />
            <InfoField label="Copyright Year"  value={project.copyright_year} />
            <InfoField label="Actual Pages"    value={project.actual_pages} />
          </>
        ) : (
          <>
            {(project.status === 'Active' || project.status === 'Completed') ? (
              <div className="flex flex-col gap-0.5">
                <p className="text-[11px] text-muted font-medium uppercase tracking-wide">Composition</p>
                <p className="text-sm text-text">{project.composition || '—'}</p>
                <p className="text-[10px] text-muted italic mt-0.5">Locked — project is {project.status}</p>
              </div>
            ) : (
              <Select
                label="Composition"
                value={form.composition}
                onChange={e => set('composition', e.target.value)}
                options={[
                  { value: 'Low',    label: 'Low (Level 1)'    },
                  { value: 'Medium', label: 'Medium (Level 2)' },
                  { value: 'High',   label: 'High (Level 3)'   },
                ]}
                placeholder="Select composition level"
              />
            )}
            <Input label="Edition"        value={form.edition}        onChange={e => set('edition',        e.target.value)} placeholder="e.g. 3rd Edition" />
            <Input label="Color"          value={form.color}          onChange={e => set('color',          e.target.value)} placeholder="e.g. 4-color, B&W" />
            <Input label="Trim Size"      value={form.trim_size}      onChange={e => set('trim_size',      e.target.value)} placeholder="e.g. 8.5 x 11" />
            <Input label="Copyright Year" value={form.copyright_year} onChange={e => set('copyright_year', e.target.value)} type="number" placeholder={String(new Date().getFullYear())} />
            <Input label="Actual Pages"   value={form.actual_pages}   onChange={e => set('actual_pages',   e.target.value)} type="number" placeholder="0" />
          </>
        )}

        {/* Read-only page / chapter info */}
        <InfoField label="Manuscript Pages" value={project.manuscript_pages} />
        <InfoField label="CE Pages"         value={Math.floor((project.manuscript_pages ?? 0) / 250)} />
        <InfoField label="Estimated Pages"  value={project.estimated_pages} />
        <InfoField label="Chapter Count"    value={project.chapter_count} />

      </div>
    </Modal>
  )
}
