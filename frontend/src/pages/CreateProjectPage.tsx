import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Upload, X, FileArchive, CheckCircle2, ExternalLink, Layers, BookOpen, ChevronRight, ArrowLeft } from 'lucide-react'
import { clientsApi, type Client } from '@/api/clients'
import { projectsApi, type ProjectCreate } from '@/api/projects'
import { uploadsApi } from '@/api/uploads'
import { usersApi, type User } from '@/api/users'
import { workflowsApi } from '@/api/workflows'
import type { WorkflowStage } from '@/api/workflows'
import { toast } from '@/store/useToastStore'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'

// ── Helpers ───────────────────────────────────────────────────────────────────

function clientLabel(c: Client): string {
  if (c.name_company) return c.name_company
  if (c.company) return c.company
  if (c.first_name || c.surname) return [c.first_name, c.surname].filter(Boolean).join(' ')
  return `Client #${c.id}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Validation ────────────────────────────────────────────────────────────────

function validate(f: Partial<ProjectCreate>): Record<string, string> {
  const e: Record<string, string> = {}
  if (!f.client_id)              e.client_id     = 'Client is required'
  if (!f.project_code?.trim())   e.project_code  = 'Project Code is required'
  if (!f.project_title?.trim())  e.project_title = 'Project Title is required'
  if (!f.workflow_name?.trim())  e.workflow_name = 'Workflow is required'
  if (!f.xml_standard?.trim())   e.xml_standard  = 'XML Standard is required'
  if (!f.copyright_year)         e.copyright_year = 'Copyright Year is required'
  if (!f.isbn_no?.trim()) {
    e.isbn_no = 'ISBN is required'
  } else if (!/^[0-9]{9}[0-9X]$|^[0-9]{13}$/i.test(f.isbn_no.trim())) {
    e.isbn_no = 'ISBN must be 10 or 13 characters'
  }
  return e
}

// ── Section Divider ───────────────────────────────────────────────────────────

function Section({ title, icon: Icon, required }: { title: string; icon?: React.ElementType; required?: boolean }) {
  return (
    <div className="col-span-2 flex items-center gap-2 pt-3 pb-1">
      {Icon && <Icon size={14} className="text-primary flex-shrink-0" />}
      <h3 className="text-xs font-semibold text-primary uppercase tracking-wider whitespace-nowrap">
        {title}
        {required && <span className="text-danger ml-0.5 font-bold">*</span>}
      </h3>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

// ── ZIP Upload ────────────────────────────────────────────────────────────────

type ZipState = 'idle' | 'processing' | 'done'

interface ZipUploadProps {
  onFileReady: (file: File | null) => void
}

function ZipUpload({ onFileReady }: ZipUploadProps) {
  const [zipFile, setZipFile]     = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [zipState, setZipState]   = useState<ZipState>('idle')
  const [progress, setProgress]   = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('Only .zip files are allowed')
      return
    }
    setZipFile(file)
    setZipState('processing')
    setProgress(0)
    onFileReady(file)

    intervalRef.current = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          setZipState('done')
          return 100
        }
        return p + 25
      })
    }, 200)
  }

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
  }, [])

  function removeFile() {
    setZipFile(null)
    setZipState('idle')
    setProgress(0)
    onFileReady(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [])

  if (zipFile) {
    return (
      <div className="col-span-2 rounded-xl border border-border bg-surface p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent rounded-lg">
              <FileArchive size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-text">{zipFile.name}</p>
              <p className="text-xs text-muted">{formatBytes(zipFile.size)}</p>
            </div>
          </div>
          <button onClick={removeFile} className="p-1.5 rounded-lg hover:bg-border text-muted hover:text-text transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Progress bar */}
        {zipState === 'processing' && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted">Validating ZIP…</span>
              <span className="text-xs text-muted">{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-border overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Done */}
        {zipState === 'done' && (
          <div className="flex items-center gap-2 text-xs text-success">
            <CheckCircle2 size={13} />
            <span>ZIP validated — chapters will be extracted after the project is saved.</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={`col-span-2 rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
        isDragging ? 'border-primary bg-accent/40' : 'border-border hover:border-primary/50 bg-surface'
      }`}
      onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }}
      />
      <div className="flex flex-col items-center gap-2 py-8 px-4 text-center select-none">
        <div className={`p-3 rounded-full transition-colors ${isDragging ? 'bg-primary/20' : 'bg-surface'}`}>
          <Upload size={22} className={isDragging ? 'text-primary' : 'text-muted'} />
        </div>
        <p className="text-sm font-medium text-text">Drag & drop ZIP file here</p>
        <p className="text-xs text-muted">or click to browse — <strong>.zip only</strong></p>
        <p className="text-[11px] text-muted mt-1">May contain chapters, XML files, images, manuscript files</p>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function CreateProjectPage() {
  const navigate = useNavigate()
  const { clientId } = useParams<{ clientId: string }>()
  const parsedClientId = clientId ? Number(clientId) : undefined

  const INIT: Partial<ProjectCreate> = {
    status:   'Planning',
    priority: 'Normal',
    actual_pages: 0,
    client_id: parsedClientId ?? undefined,
    xml_standard: 'NLM',
  }

  const [form,    setForm]    = useState<Partial<ProjectCreate>>(INIT)
  const [errors,  setErrors]  = useState<Record<string, string>>({})
  const [saving,  setSaving]  = useState(false)
  const [zipFile, setZipFile] = useState<File | null>(null)

  // Reference data
  const [clients,           setClients]          = useState<Client[]>([])
  const [users,             setUsers]             = useState<User[]>([])
  const [allWorkflowStages, setAllWorkflowStages] = useState<WorkflowStage[]>([])
  const [initLoad,          setInitLoad]          = useState(true)

  useEffect(() => {
    const clientsPromise = clientsApi.list().catch((err) => {
      console.error('Failed to load clients:', err)
      return []
    })
    const usersPromise = usersApi.list().catch((err) => {
      console.error('Failed to load users:', err)
      return []
    })
    const workflowsPromise = workflowsApi.getAllStages().catch((err) => {
      console.error('Failed to load workflows:', err)
      return []
    })

    Promise.all([clientsPromise, usersPromise, workflowsPromise])
      .then(([c, u, ws]) => {
        setClients(c)
        setUsers(u)
        setAllWorkflowStages(ws)
        // Auto-fill client fields once clients are loaded
        if (parsedClientId) {
          const client = c.find(x => x.id === parsedClientId)
          if (client) {
            setForm(f => ({
              ...f,
              client_name:    client.name_company ?? client.company ?? [client.first_name, client.surname].filter(Boolean).join(' ') ?? '',
              division_code:    client.division ?? '',
              customer_contact: client.email ?? client.phone_main ?? '',
            }))
          }
        }
      })
      .catch(() => toast.error('Failed to load form data'))
      .finally(() => setInitLoad(false))
  }, [parsedClientId])

  function set<K extends keyof ProjectCreate>(key: K, value: ProjectCreate[K]) {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => { const n = { ...e }; delete n[key as string]; return n })
  }

  // Auto-fill from selected client
  function handleClientChange(clientIdStr: string) {
    const id = Number(clientIdStr)
    set('client_id', id || null)
    const c = clients.find(x => x.id === id)
    if (c) {
      set('client_name',    c.name_company ?? c.company ?? [c.first_name, c.surname].filter(Boolean).join(' ') ?? '')
      set('division_code',    c.division ?? '',)
      set('customer_contact', c.email ?? c.phone_main ?? '')
    }
  }

  const pmUsers    = useMemo(() => users.filter(u => u.active_status && u.role.toLowerCase().replace(" ","").includes('projectmanager')), [users])
  const salesUsers = useMemo(() => users.filter(u => u.active_status && u.role.toLowerCase().replace(" ","").includes('sales')), [users])

  // Build workflow map + ordered stage lists
  const workflowMap = useMemo(() => {
    const map = new Map<string, WorkflowStage[]>()
    for (const s of allWorkflowStages) {
      const list = map.get(s.workflow_name) ?? []
      list.push(s)
      map.set(s.workflow_name, list)
    }
    return map
  }, [allWorkflowStages])

  const workflowNames = useMemo(() => Array.from(workflowMap.keys()), [workflowMap])

  function orderStages(stages: WorkflowStage[]): WorkflowStage[] {
    const hasLinks = stages.some(s => s.previous_stage || s.next_stage)
    if (!hasLinks) return stages

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
    if (result.length < stages.length) {
      return stages
    }
    return result
  }

  const selectedFlow = useMemo(() => {
    if (!form.workflow_name) return []
    return orderStages(workflowMap.get(form.workflow_name) ?? [])
  }, [form.workflow_name, workflowMap])

  const clientOptions = useMemo(() =>
    clients.filter(c => c.active_status).map(c => ({ value: String(c.id), label: clientLabel(c) }))
  , [clients])

  const handleCancel = () => {
    if (parsedClientId) {
      navigate(`/clients/${parsedClientId}/projects`)
    } else {
      navigate('/clients')
    }
  }

  async function handleSubmit() {
    const errs = validate(form)
    if (!zipFile) {
      errs.zip_file = 'ZIP file is required'
    }
    if (Object.keys(errs).length) {
      setErrors(errs)
      toast.error('Please fill in all required fields.')
      const firstErrorKey = Object.keys(errs)[0]
      setTimeout(() => {
        const element = document.getElementById(firstErrorKey)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
          element.focus()
        }
      }, 50)
      return
    }
    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('code',          form.project_code ?? '')
      formData.append('title',         form.project_title ?? '')
      formData.append('xml_standard',  form.xml_standard ?? 'NLM')
      if (form.client_id)          formData.append('client_id',        String(form.client_id))
      if (form.client_name)        formData.append('client_name',      form.client_name)
      if (form.workflow_name)      formData.append('workflow_name',    form.workflow_name)
      if (form.division_code)      formData.append('division_code',    form.division_code)
      if (form.customer_contact)   formData.append('customer_contact', form.customer_contact)
      if (form.category)           formData.append('category',         form.category)
      if (form.composition)        formData.append('composition',      form.composition)
      if (form.project_manager)    formData.append('project_manager',  form.project_manager)
      if (form.sales_person)       formData.append('sales_person',     form.sales_person)
      if (form.priority)           formData.append('priority',         form.priority)
      if (form.status)             formData.append('status',           form.status)
      if (form.edition)            formData.append('edition',          form.edition)
      if (form.color)              formData.append('color',            form.color)
      if (form.trim_size)          formData.append('trim_size',        form.trim_size)
      if (form.copyright_year != null) formData.append('copyright_year',   String(form.copyright_year))
      if (form.manuscript_pages != null) formData.append('manuscript_pages', String(form.manuscript_pages))
      if (form.estimated_pages != null)  formData.append('estimated_pages',  String(form.estimated_pages))
      if (form.actual_pages != null)     formData.append('actual_pages',     String(form.actual_pages))
      if (form.isbn_no)            formData.append('isbn_no',          form.isbn_no)
      if (form.billing_location)   formData.append('billing_location', form.billing_location)
      if (form.due_date)           formData.append('due_date',         form.due_date)

      const response = await projectsApi.create(formData)

      if (zipFile && response.project.code) {
        const customerCode = form.division_code || form.client_name || 'unknown'
        try {
          const result = await uploadsApi.uploadZip(customerCode, response.project.code, response.project.id, zipFile)
          toast.success(`ZIP processed — ${result.total_chapters} chapter(s) detected`)
        } catch {
          toast.error('Project created but ZIP upload failed')
        }
      }

      toast.success(`Project "${response.project.title ?? response.project.code}" created`)
      
      if (form.client_id) {
        navigate(`/clients/${form.client_id}/projects`)
      } else {
        navigate('/clients')
      }
    } catch (err: unknown) {
      let msg = 'Failed to create project'
      try {
        const errData = (err as any)?.response?.data
        if (typeof errData?.detail === 'string') {
          msg = errData.detail
        } else if (typeof errData?.message === 'string') {
          msg = errData.message
        } else if (Array.isArray(errData?.detail)) {
          const details = errData.detail
            .filter((e: any) => e && typeof e === 'object')
            .map((e: any) => {
              const field = Array.isArray(e.loc) ? e.loc.join('.') : String(e.loc || 'unknown')
              const error = typeof e.msg === 'string' ? e.msg : 'validation error'
              return `${field}: ${error}`
            })
          if (details.length > 0) {
            msg = details.join('; ')
          }
        }
      } catch {
        // use default
      }
      toast.error(String(msg))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 min-h-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleCancel}
          className="p-2 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-text">Create New Project</h1>
          <p className="text-sm text-muted">Fill out the details below to initialize a new project workspace.</p>
        </div>
      </div>

      {initLoad ? (
        <div className="flex items-center justify-center py-20 bg-card rounded-2xl border border-border shadow-sm">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {/* ── Project Information ─────────────────── */}
            <Section title="Project Information" icon={BookOpen} />

            <Select
              id="client_id"
              label="Client"
              required
              value={form.client_id ? String(form.client_id) : ''}
              onChange={e => handleClientChange(e.target.value)}
              options={clientOptions}
              placeholder="Select client"
              error={errors.client_id}
            />
            <Input
              id="project_code"
              label="Project Code"
              required
              value={form.project_code ?? ''}
              onChange={e => set('project_code', e.target.value)}
              placeholder="e.g. PRJ-2024-001"
              error={errors.project_code}
            />

            <Input
              label="Customer Name"
              value={form.client_name ?? ''}
              readOnly
              onChange={() => {}}
              placeholder="Auto-filled from client"
              className="bg-surface cursor-default text-muted"
            />
            <Input
              label="Division Code"
              value={form.division_code ?? ''}
              readOnly
              onChange={() => {}}
              placeholder="Auto-filled from client"
              className="bg-surface cursor-default text-muted"
            />

            <Input
              label="Customer Contact"
              value={form.customer_contact ?? ''}
              readOnly
              onChange={() => {}}
              placeholder="Auto-filled from client"
              className="bg-surface cursor-default text-muted"
            />
            <Input
              label="Category"
              value={form.category ?? ''}
              onChange={e => set('category', e.target.value)}
              placeholder="e.g. Book, Journal, Report"
            />
            <Select
              label="Composition"
              value={form.composition ?? ''}
              onChange={e => set('composition', e.target.value || null)}
              options={[
                { value: 'Low',      label: 'Low (Level 1)'      },
                { value: 'Medium', label: 'Medium (Level 2)' },
                { value: 'High',     label: 'High (Level 3)'     },
              ]}
              placeholder="Select composition level"
            />

            <Select
              label="Priority"
              value={form.priority ?? 'Normal'}
              onChange={e => set('priority', e.target.value)}
              options={[
                { value: 'Normal',     label: 'Normal'     },
                { value: 'Fast Track', label: 'Fast Track' },
              ]}
              placeholder="Select priority"
            />

            <Select
              label="Project Manager"
              value={form.project_manager ?? ''}
              onChange={e => set('project_manager', e.target.value || null)}
              options={pmUsers.map(u => ({ value: u.user_name, label: u.user_name }))}
              placeholder="Select project manager"
            />
            <Select
              label="Sales Person"
              value={form.sales_person ?? ''}
              onChange={e => set('sales_person', e.target.value || null)}
              options={salesUsers.map(u => ({ value: u.user_name, label: u.user_name }))}
              placeholder="Select sales person"
            />

            {/* Project Title — full width */}
            <div className="col-span-2">
              <Input
                id="project_title"
                label="Project Title"
                required
                value={form.project_title ?? ''}
                onChange={e => set('project_title', e.target.value)}
                placeholder="Full project title"
                error={errors.project_title}
              />
            </div>

            {/* ── Publication Details ─────────────────── */}
            <Section title="Publication Details" icon={Layers} />

            <Input label="Edition"    value={form.edition    ?? ''} onChange={e => set('edition',    e.target.value)} placeholder="e.g. 3rd Edition" />
            <Input label="Color"      value={form.color      ?? ''} onChange={e => set('color',      e.target.value)} placeholder="e.g. 4-color, B&W" />
            <Input label="Trim Size"  value={form.trim_size  ?? ''} onChange={e => set('trim_size',  e.target.value)} placeholder="e.g. 8.5 x 11" />
            <Select
              id="xml_standard"
              label="XML Standard"
              required
              value={form.xml_standard ?? 'NLM'}
              onChange={e => set('xml_standard', e.target.value)}
              options={[
                { value: 'NLM',     label: 'NLM / JATS' },
                { value: 'BITS',    label: 'BITS (Book)' },
                { value: 'DocBook', label: 'DocBook' },
                { value: 'TEI',     label: 'TEI' },
              ]}
              placeholder="Select XML standard"
              error={errors.xml_standard}
            />
            <Input
              id="copyright_year"
              label="Copyright Year"
              required
              type="number"
              value={form.copyright_year != null ? String(form.copyright_year) : ''}
              onChange={e => set('copyright_year', e.target.value ? Number(e.target.value) : null)}
              placeholder={String(new Date().getFullYear())}
              error={errors.copyright_year}
            />
            <Input
              label="Manuscript Pages"
              type="number"
              value={form.manuscript_pages != null ? String(form.manuscript_pages) : ''}
              onChange={e => set('manuscript_pages', e.target.value ? Number(e.target.value) : null)}
              placeholder="0"
            />
            <Input
              label="Estimated Pages"
              type="number"
              value={form.estimated_pages != null ? String(form.estimated_pages) : ''}
              onChange={e => set('estimated_pages', e.target.value ? Number(e.target.value) : null)}
              placeholder="0"
            />
            <Input
              label="Actual Pages"
              type="number"
              value={form.actual_pages != null ? String(form.actual_pages) : ''}
              onChange={e => set('actual_pages', e.target.value ? Number(e.target.value) : 0)}
              placeholder="0"
            />
            <Input
              id="isbn_no"
              label="ISBN No"
              required
              value={form.isbn_no ?? ''}
              onChange={e => set('isbn_no', e.target.value)}
              error={errors.isbn_no}
            />
            <Input
              label="Billing Location"
              value={form.billing_location ?? ''}
              onChange={e => set('billing_location', e.target.value)}
              placeholder="e.g. New York, US"
            />

            {/* ── Workflow ────────────────────────────── */}
            <Section title="Workflow" icon={Layers} />

            <div className="col-span-2 flex flex-col gap-2">
              <Select
                id="workflow_name"
                label="Workflow"
                required
                value={form.workflow_name ?? ''}
                onChange={e => set('workflow_name', e.target.value || null)}
                options={workflowNames.map(n => ({ value: n, label: n }))}
                placeholder={workflowNames.length ? 'Select a workflow' : 'No workflows configured'}
                error={errors.workflow_name}
              />

              {/* Flow preview */}
              {form.workflow_name && selectedFlow.length > 0 && (
                <div className="rounded-xl border border-border bg-surface p-4">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
                    Flow — {form.workflow_name}
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    {selectedFlow.map((s, i) => (
                      <span key={s.id} className="inline-flex items-center gap-1">
                        <span className="inline-flex items-center gap-1.5 text-xs bg-card border border-border rounded-lg px-2.5 py-1">
                          <span className="w-4 h-4 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                            {i + 1}
                          </span>
                          <span className="font-medium text-text">{s.stage_name}</span>
                        </span>
                        {i < selectedFlow.length - 1 && (
                          <ChevronRight size={12} className="text-muted flex-shrink-0" />
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!form.workflow_name && workflowNames.length === 0 && (
                <div className="flex items-center justify-between rounded-lg border border-dashed border-border bg-surface px-4 py-3">
                  <p className="text-xs text-muted">No workflows configured yet.</p>
                  <button
                    type="button"
                    onClick={() => navigate('/settings/workflow')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <ExternalLink size={11} /> Create Workflow
                  </button>
                </div>
              )}
            </div>

            {/* ── ZIP Upload ──────────────────────────── */}
            <Section title="ZIP File Upload" icon={Upload} required />

            <div id="zip_file" className="col-span-2 flex flex-col gap-1 outline-none" tabIndex={-1}>
              <ZipUpload onFileReady={setZipFile} />
              {errors.zip_file && <p className="text-xs text-danger mt-1">{errors.zip_file}</p>}
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button variant="outline" onClick={handleCancel} disabled={saving}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? <><Spinner size="sm" /> Saving…</> : 'Save Project'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
