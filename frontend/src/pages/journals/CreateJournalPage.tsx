import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { journalsApi, type JournalClient, type JournalWorkflow } from '@/api/journals'
import { usersApi, type User } from '@/api/users'
import { getApiErrorMessage } from '@/api/client'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'
import { cn } from '@/utils/cn'
import { STAGE_NAMES, shortStage } from './journalUi'

const ALL_STAGES = STAGE_NAMES
const ISSN = /^\d{4}-\d{3}[\dX]$/

type Form = {
  journal_code: string; journal_title: string; issn_print: string; issn_online: string
  volume: string; issue: string; journal_manager: string; workflow_id: string
}

export function CreateJournalPage() {
  const { clientId } = useParams()
  const id = Number(clientId)
  const navigate = useNavigate()
  const [client, setClient] = useState<JournalClient | null>(null)
  const [workflows, setWorkflows] = useState<JournalWorkflow[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof Form | 'form', string>>>({})
  const [form, setForm] = useState<Form>({
    journal_code: '', journal_title: '', issn_print: '', issn_online: '', volume: '', issue: '', journal_manager: '', workflow_id: '',
  })

  useEffect(() => {
    Promise.all([journalsApi.getClient(id), journalsApi.getWorkflows(), usersApi.list().catch(() => [] as User[])])
      .then(([c, wfs, us]) => {
        setClient(c)
        setWorkflows(wfs)
        setUsers(us.filter(u => u.active_status))
        const def = wfs.find(w => w.is_default) ?? wfs[0]
        if (def) setForm(f => ({ ...f, workflow_id: String(def.id) }))
      })
      .catch(err => toast.error(getApiErrorMessage(err, 'Could not load the form')))
      .finally(() => setLoading(false))
  }, [id])

  const workflow = useMemo(() => workflows.find(w => String(w.id) === form.workflow_id), [workflows, form.workflow_id])
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const validate = () => {
    const e: typeof errors = {}
    if (!form.journal_code.trim()) e.journal_code = 'Enter the journal code'
    if (!form.journal_title.trim()) e.journal_title = 'Enter the journal title'
    if (form.issn_print && !ISSN.test(form.issn_print.trim())) e.issn_print = 'Use the form 1234-567X'
    if (form.issn_online && !ISSN.test(form.issn_online.trim())) e.issn_online = 'Use the form 1234-567X'
    if (!form.issn_print.trim() && !form.issn_online.trim()) e.issn_print = 'JATS needs at least one ISSN'
    if (!form.workflow_id) e.workflow_id = 'Choose a workflow'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      const j = await journalsApi.createJournal({
        client_id: id,
        journal_code: form.journal_code.trim(),
        journal_title: form.journal_title.trim(),
        issn_print: form.issn_print.trim() || undefined,
        issn_online: form.issn_online.trim() || undefined,
        volume: form.volume.trim() || undefined,
        issue: form.issue.trim() || undefined,
        journal_manager: form.journal_manager || undefined,
        workflow_id: Number(form.workflow_id),
      })
      toast.success(`Journal ${j.journal_code} created`)
      navigate(`/journal-production/journals/${j.id}`)
    } catch (err) {
      setErrors({ form: getApiErrorMessage(err, 'Could not create the journal') })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <FullPageSpinner />

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <Breadcrumb items={[
        { label: 'Journal Production', href: '/journal-production' },
        { label: client?.publisher_name ?? 'Client', href: `/journal-production/clients/${id}` },
        { label: 'New journal' },
      ]} />
      <div>
        <h1 className="text-xl font-semibold text-text">New journal</h1>
        <p className="text-sm text-muted">For {client?.publisher_name}. Articles uploaded to this journal follow the workflow you choose.</p>
      </div>

      <form onSubmit={submit} className="space-y-6" noValidate>
        <section className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text">Journal details</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Journal code" placeholder="JAIS" value={form.journal_code} onChange={set('journal_code')} error={errors.journal_code} />
            <div className="sm:col-span-2">
              <Input label="Journal title" placeholder="Journal of AI & Neural Systems" value={form.journal_title}
                     onChange={set('journal_title')} error={errors.journal_title} />
            </div>
            <Input label="ISSN (print)" placeholder="1532-4435" value={form.issn_print} onChange={set('issn_print')} error={errors.issn_print} />
            <Input label="ISSN (online)" placeholder="1533-7928" value={form.issn_online} onChange={set('issn_online')} error={errors.issn_online} />
            <Select
              label="Journal manager"
              value={form.journal_manager}
              onChange={set('journal_manager')}
              placeholder="Not assigned"
              options={users.map(u => ({ value: u.user_name, label: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.user_name }))}
            />
            <Input label="Volume" placeholder="42" value={form.volume} onChange={set('volume')} />
            <Input label="Issue" placeholder="3" value={form.issue} onChange={set('issue')} />
          </div>
        </section>

        <section className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-text">Workflow</h2>
            <p className="text-xs text-muted">Each article moves through these stages in order. Stages not in the workflow are skipped.</p>
          </div>
          <Select
            label="Workflow"
            value={form.workflow_id}
            onChange={set('workflow_id')}
            error={errors.workflow_id}
            options={workflows.map(w => ({ value: String(w.id), label: w.is_default ? `${w.name} (default)` : w.name }))}
          />
          {workflow && (
            <>
              {workflow.description && <p className="text-sm text-muted">{workflow.description}</p>}
              <ol className="flex flex-wrap gap-2" aria-label="Workflow stages">
                {ALL_STAGES.map((s, i) => {
                  const included = workflow.stage_numbers.includes(i + 1)
                  return (
                    <li
                      key={s}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs',
                        included ? 'border-primary/40 bg-primary/10 text-primary font-medium' : 'border-border text-muted line-through',
                      )}
                    >
                      {included && <Check className="size-3" />}
                      <span className="font-mono">{i + 1}</span> {shortStage(s)}
                    </li>
                  )
                })}
              </ol>
            </>
          )}
        </section>

        {errors.form && <p className="text-sm text-danger" role="alert">{errors.form}</p>}
        <div className="flex gap-3">
          <Button type="submit" isLoading={saving}>Create journal</Button>
          <Button type="button" variant="secondary" onClick={() => navigate(`/journal-production/clients/${id}`)}>Cancel</Button>
        </div>
      </form>
    </div>
  )
}
