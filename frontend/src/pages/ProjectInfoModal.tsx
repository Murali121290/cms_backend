import { useState, useEffect } from 'react'
import { BookOpen, Layers, FileText, Download, ExternalLink, FileSpreadsheet, FileCode, FolderArchive, Calendar, History, Clock, ArrowRight } from 'lucide-react'
import { projectsApi, type Project, type ProjectUpdate, type ProjectDocument } from '@/api/projects'
import { chaptersApi } from '@/api/chapters'
import { Select } from '@/components/ui/Select'
import { toast } from '@/store/useToastStore'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge, statusToBadge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { useUsersStore } from '@/stores/usersStore'
import { formatDate, formatDateTime } from '@/utils/dateUtils'

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
  composition: string
  edition: string
  color: string
  trim_size: string
  copyright_year: string
  estimated_pages: string
  actual_pages: string
  due_date: string
  reason: string
  billing_location: string
  billing_type: string
  alt_text: string
  accessibility: string
  isbn_no: string
}

interface ProjectInfoModalProps {
  project: Project | null
  open: boolean
  mode: 'view' | 'edit'
  onClose: () => void
  onUpdated: (project: Project) => void
}

export function ProjectInfoModal({ project, open, mode, onClose, onUpdated }: ProjectInfoModalProps) {
  const [form, setForm] = useState<EditForm>({
    composition: '',
    edition: '',
    color: '',
    trim_size: '',
    copyright_year: '',
    estimated_pages: '',
    actual_pages: '',
    due_date: '',
    reason: '',
    billing_location: '',
    billing_type: '',
    alt_text: '',
    accessibility: '',
    isbn_no: '',
  })
  const [saving, setSaving] = useState(false)
  const [chapterManuscriptPages, setChapterManuscriptPages] = useState<number | null>(null)
  const [chapterWordCount, setChapterWordCount] = useState<number | null>(null)
  const [documents, setDocuments] = useState<ProjectDocument[]>([])
  const [loadingDocs, setLoadingDocs] = useState(false)

  useEffect(() => {
    if (!open || !project?.id) {
      setDocuments([])
      return
    }
    setLoadingDocs(true)
    projectsApi.getDocuments(project.id)
      .then(docs => setDocuments(docs))
      .catch(err => {
        console.error('Failed to load project documents:', err)
        setDocuments([])
      })
      .finally(() => setLoadingDocs(false))
  }, [open, project?.id])

  useEffect(() => {
    if (project) {
      setForm({
        composition: project.composition ?? '',
        edition: project.edition ?? '',
        color: project.color ?? '',
        trim_size: project.trim_size ?? '',
        copyright_year: project.copyright_year != null ? String(project.copyright_year) : '',
        estimated_pages: project.estimated_pages != null ? String(project.estimated_pages) : '',
        actual_pages: String(project.actual_pages ?? 0),
        due_date: project.due_date ? String(project.due_date).split('T')[0] : '',
        reason: '',
        billing_location: project.billing_location ?? '',
        billing_type: project.billing_type ?? '',
        alt_text: project.alt_text ?? '',
        accessibility: project.accessibility ?? '',
        isbn_no: project.isbn_no ?? '',
      })
    }
  }, [project])

  useEffect(() => {
    if (!open || !project) {
      setChapterManuscriptPages(null)
      setChapterWordCount(null)
      return
    }
    const projectCode = project.code || project.project_code || ''
    if (!projectCode) {
      setChapterManuscriptPages(null)
      setChapterWordCount(null)
      return
    }
    let cancelled = false
    chaptersApi.getByProject(projectCode)
      .then(chapters => {
        if (cancelled) return
        setChapterManuscriptPages(chapters.reduce((sum, ch) => sum + (ch.manuscript_pages ?? 0), 0))
        setChapterWordCount(chapters.reduce((sum, ch) => sum + (ch.word_count ?? 0), 0))
      })
      .catch(() => {
        setChapterManuscriptPages(null)
        setChapterWordCount(null)
      })
    return () => { cancelled = true }
  }, [open, project])

  if (!project) return null

  const manuscriptPages = chapterManuscriptPages ?? project.manuscript_pages ?? 0
  const cePages = Math.floor((chapterWordCount ?? 0) / 250)

  function set(key: keyof EditForm, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave() {
    if (!project) return
    setSaving(true)
    try {
      const origDue = project.due_date ? String(project.due_date).split('T')[0] : ''
      const newDue = form.due_date ? form.due_date.trim() : ''
      const isDueDateChanged = origDue !== newDue

      if (isDueDateChanged && origDue && !form.reason.trim()) {
        toast.error('Please provide a reason for the due date change.')
        setSaving(false)
        return
      }

      const data: ProjectUpdate = {
        composition: form.composition || null,
        edition: form.edition || null,
        color: form.color || null,
        trim_size: form.trim_size || null,
        copyright_year: form.copyright_year ? Number(form.copyright_year) : null,
        estimated_pages: form.estimated_pages ? Number(form.estimated_pages) : null,
        actual_pages: form.actual_pages ? Number(form.actual_pages) : 0,
        due_date: form.due_date ? form.due_date : null,
        billing_location: form.billing_location || null,
        billing_type: form.billing_type || null,
        alt_text: form.alt_text || null,
        accessibility: form.accessibility || null,
        isbn_no: form.isbn_no || null,
        reason: isDueDateChanged && form.reason.trim() ? form.reason.trim() : null,
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
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <><Spinner size="sm" /> Saving…</> : 'Save Changes'}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
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

        <InfoField label="Project Code" value={project.project_code} />
        <InfoField label="Customer Name" value={project.client_name} />
        <InfoField label="Division Code" value={project.division_code} />
        <InfoField label="Customer Contact" value={project.customer_contact} />
        <InfoField label="Category" value={project.category} />
        <InfoField label="Composition" value={project.composition} />
        <InfoField label="Workflow" value={project.workflow_name} />
        <InfoField label="Project Manager" value={project.project_manager ? useUsersStore.getState().getUserDisplayNameByUsername(project.project_manager) : '—'} />
        <InfoField label="Sales Person" value={project.sales_person ? useUsersStore.getState().getUserDisplayNameByUsername(project.sales_person) : '—'} />
        {mode === 'view' ? (
          <>
            <InfoField label="Billing Location" value={project.billing_location} />
            <InfoField label="Billing Type" value={project.billing_type ? project.billing_type.charAt(0).toUpperCase() + project.billing_type.slice(1) : '—'} />
            <InfoField label="Alt Text" value={project.alt_text ? project.alt_text.charAt(0).toUpperCase() + project.alt_text.slice(1) : '—'} />
            <InfoField label="Accessibility" value={project.accessibility ? project.accessibility.charAt(0).toUpperCase() + project.accessibility.slice(1) : '—'} />
            <InfoField label="ISBN No" value={project.isbn_no} />
          </>
        ) : (
          <>
            <Select
              label="Billing Location"
              value={form.billing_location}
              onChange={e => set('billing_location', e.target.value)}
              options={[
                { value: 'S4Carlisle Publishing Services-Chennai', label: 'S4Carlisle Publishing Services-Chennai' },
                { value: 'S4Carlisle Publishing Services-Singapore', label: 'S4Carlisle Publishing Services-Singapore' },
                { value: 'S4Carlisle Transmedia Services Inc', label: 'S4Carlisle Transmedia Services Inc' },
                { value: 'S4Carlisle Publishing Services Pte Ltd-Singapore 2', label: 'S4Carlisle Publishing Services Pte Ltd-Singapore 2' },
              ]}
              placeholder="Select billing location"
            />
            <Select
              label="Billing Type"
              value={form.billing_type}
              onChange={e => set('billing_type', e.target.value)}
              options={[
                { value: 'partial', label: 'Partial' },
                { value: 'full', label: 'Full' },
              ]}
              placeholder="Select billing type"
            />
            <Select
              label="Alt Text"
              value={form.alt_text}
              onChange={e => set('alt_text', e.target.value)}
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
              placeholder="Select alt text"
            />
            <Select
              label="Accessibility"
              value={form.accessibility}
              onChange={e => set('accessibility', e.target.value)}
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
              placeholder="Select accessibility"
            />
            <Input
              label="ISBN No"
              value={form.isbn_no}
              onChange={e => set('isbn_no', e.target.value)}
              placeholder="e.g. 978-3-16-148410-0"
            />
          </>
        )}

        {/* ── Publication Details ── */}
        <Section title="Publication Details" icon={Layers} />

        {mode === 'view' ? (
          <>
            <InfoField label="Composition" value={project.composition} />
            <InfoField label="Edition" value={project.edition} />
            <InfoField label="Color" value={project.color} />
            <InfoField label="Trim Size" value={project.trim_size} />
            <InfoField label="Copyright Year" value={project.copyright_year} />
            <InfoField label="Actual Pages" value={project.actual_pages} />
            <InfoField label="Due Date" value={project.due_date ? formatDate(project.due_date) : '—'} />
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
                  { value: 'Low', label: 'Low (Level 1)' },
                  { value: 'Medium', label: 'Medium (Level 2)' },
                  { value: 'High', label: 'High (Level 3)' },
                ]}
                placeholder="Select composition level"
              />
            )}
            <Input label="Edition" value={form.edition} onChange={e => set('edition', e.target.value)} placeholder="e.g. 3rd Edition" />
            <Input label="Color" value={form.color} onChange={e => set('color', e.target.value)} placeholder="e.g. 4-color, B&W" />
            <Input label="Trim Size" value={form.trim_size} onChange={e => set('trim_size', e.target.value)} placeholder="e.g. 8.5 x 11" />
            <Input label="Copyright Year" value={form.copyright_year} onChange={e => set('copyright_year', e.target.value)} type="number" placeholder={String(new Date().getFullYear())} />
            <Input label="Estimated Pages" value={form.estimated_pages} onChange={e => set('estimated_pages', e.target.value)} type="number" placeholder="0" />
            <Input label="Actual Pages" value={form.actual_pages} onChange={e => set('actual_pages', e.target.value)} type="number" placeholder="0" />
            <Input label="Due Date" value={form.due_date} onChange={e => set('due_date', e.target.value)} type="date" />
            {project.due_date && String(project.due_date).split('T')[0] !== form.due_date && form.due_date && (
              <div className="col-span-2">
                <Input
                  label="Reason for Due Date Change"
                  value={form.reason}
                  onChange={e => set('reason', e.target.value)}
                  placeholder="e.g. Customer requested schedule postponement"
                  required
                />
              </div>
            )}
          </>
        )}

        {/* Manuscript Pages — sum of each chapter's manuscript pages, kept in sync as chapters update */}
        <InfoField label="Manuscript Pages" value={manuscriptPages} />
        <InfoField label="CE Pages" value={cePages} />
        <InfoField label="Estimated Pages" value={project.estimated_pages} />
        <InfoField label="Chapter Count" value={project.chapter_count} />

        {/* ── Extracted PO Metadata (if available) ── */}
        {((project.file_details as any)?.author_name || (project.file_details as any)?.author_names?.length || (project.file_details as any)?.ebook_isbn || (project.file_details as any)?.publisher) && (
          <>
            <Section title="Extracted PO Details" icon={BookOpen} />
            {((project.file_details as any)?.author_name || (project.file_details as any)?.author_names?.length) && (
              <InfoField
                label="Author"
                value={(project.file_details as any)?.author_name || (Array.isArray((project.file_details as any)?.author_names) ? (project.file_details as any)?.author_names.join(', ') : (project.file_details as any)?.author_names)}
              />
            )}
            {(project.file_details as any)?.ebook_isbn && (
              <InfoField label="E-Book ISBN" value={(project.file_details as any)?.ebook_isbn} />
            )}
            {(project.file_details as any)?.publisher && (
              <InfoField label="Publisher" value={(project.file_details as any)?.publisher} />
            )}
            {(project.file_details as any)?.job_number && (
              <InfoField label="PO / Job Number" value={(project.file_details as any)?.job_number} />
            )}
          </>
        )}

        {/* ── Uploaded Documents / PO ── */}
        <Section title="Uploaded Documents / PO" icon={FileText} />

        <div className="col-span-2 space-y-2 pt-1">
          {loadingDocs ? (
            <div className="flex items-center justify-center py-6 text-muted text-xs gap-2">
              <Spinner size="sm" /> Loading documents…
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 px-4 rounded-lg bg-surface-subtle/40 border border-border/50 text-center">
              <FileText size={28} className="text-muted/40 mb-1.5" />
              <p className="text-xs text-muted">No documents found in uploads folder for this project.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc, idx) => {
                const ext = doc.filename.split('.').pop()?.toLowerCase() || ''
                const isPdf = ext === 'pdf'
                const isExcel = ['xlsx', 'xls', 'csv'].includes(ext)
                const isWord = ['docx', 'doc'].includes(ext)
                const isZip = ext === 'zip'
                const isJson = ext === 'json'

                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-border bg-surface hover:bg-surface-subtle/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isPdf ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' :
                          isExcel ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                            isWord ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                              isZip ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                                'bg-gray-500/10 text-gray-600 dark:text-gray-400'
                        }`}>
                        {isPdf && <FileText size={16} />}
                        {isExcel && <FileSpreadsheet size={16} />}
                        {isWord && <FileText size={16} />}
                        {isZip && <FolderArchive size={16} />}
                        {isJson && <FileCode size={16} />}
                        {!isPdf && !isExcel && !isWord && !isZip && !isJson && <FileText size={16} />}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium text-text truncate max-w-[260px]" title={doc.filename}>
                            {doc.filename}
                          </p>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${doc.category === 'PO Document'
                              ? 'bg-primary/10 text-primary border-primary/20'
                              : doc.category === 'Extracted PO Data'
                                ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
                                : 'bg-muted/10 text-muted border-border'
                            }`}>
                            {doc.category}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                          <span>{doc.size_formatted}</span>
                          <span>•</span>
                          <span className="truncate">{doc.relative_path}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <a
                        href={projectsApi.getDocumentViewUrl(project.id, doc.relative_path)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-muted hover:text-text rounded border border-border hover:bg-surface-subtle transition-colors"
                        title="View document in new tab"
                      >
                        <ExternalLink size={12} />
                        View
                      </a>
                      <a
                        href={projectsApi.getDocumentDownloadUrl(project.id, doc.relative_path)}
                        download={doc.filename}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary hover:text-primary-hover rounded border border-primary/30 hover:bg-primary/10 transition-colors"
                        title="Download document"
                      >
                        <Download size={12} />
                        Download
                      </a>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Due Date Change History ── */}
        {project.due_date_history && Array.isArray(project.due_date_history) && project.due_date_history.length > 0 && (
          <>
            <Section title="Due Date Change History" icon={History} />
            <div className="col-span-2 space-y-2 pt-1">
              {[...project.due_date_history].reverse().map((entry: any, idx: number) => {
                const fromStr = entry.from_date || entry.old_date
                const toStr = entry.to_date || entry.new_date
                return (
                  <div
                    key={idx}
                    className="flex items-start justify-between bg-surface border border-border rounded-lg p-3 gap-3"
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="p-2 bg-primary/10 text-primary rounded-lg shrink-0 mt-0.5">
                        <Calendar size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {fromStr ? (
                            <>
                              <span className="text-muted line-through">{formatDate(fromStr)}</span>
                              <ArrowRight size={12} className="text-muted" />
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                {formatDate(toStr)}
                              </span>
                            </>
                          ) : (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              Set to {formatDate(toStr)}
                            </span>
                          )}
                        </div>
                        {entry.reason && (
                          <p className="text-xs text-text/80 mt-1.5 mb-0 break-words">
                            <span className="text-muted font-medium">Reason:</span> {entry.reason}
                          </p>
                        )}
                        <p className="text-[11px] text-muted m-0 mt-1">
                          Changed By: <span className="font-medium text-text/90">{entry.changed_by || 'Unknown'}</span>
                        </p>
                      </div>
                    </div>
                    <div className="text-[11px] text-muted font-medium shrink-0 pt-0.5 text-right whitespace-nowrap">
                      {entry.timestamp ? formatDateTime(entry.timestamp) : '—'}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

      </div>
    </Modal>
  )
}
