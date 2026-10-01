import { useState } from 'react'
import axios from 'axios'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { journalsApi, type JournalClient, type JournalIssue, type ArticleStageStatus } from '@/api/journals'
import { getApiErrorMessage } from '@/api/client'
import { toast } from '@/store/useToastStore'
import { cn } from '@/utils/cn'

/** "4. XML Conversion" -> "XML Conversion" */
export const shortStage = (name: string) => name.replace(/^\d+\.\s*/, '')
export const stageNumber = (name: string) => Number.parseInt(name, 10) || 0

/** Stage numbers of the 7-stage pipeline (Pre-Editing includes the technical checks). */
export const STAGE = { PRE_EDITING: 1, LANGUAGE: 2, XML: 3, INDESIGN: 4, INDESIGN_QC: 5, PROOF: 6, DELIVERY: 7 } as const
export const STAGE_NAMES = [
  '1. Pre-Editing', '2. Language Editing', '3. XML Conversion', '4. Generate InDesign',
  '5. InDesign Final QC', '6. View Proof', '7. Final Delivery',
]

export function initials(name: string) {
  return name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
}

/** A stage advance refused by the API: 409 {detail: {message, blocking_issues}} */
export function advanceError(err: unknown): { message: string; issues: JournalIssue[] } {
  if (axios.isAxiosError(err) && err.response?.status === 409) {
    const detail = (err.response.data as { detail?: { message?: string; blocking_issues?: JournalIssue[] } })?.detail
    if (detail && typeof detail === 'object') {
      return { message: detail.message ?? 'This stage cannot be completed yet', issues: detail.blocking_issues ?? [] }
    }
  }
  return { message: getApiErrorMessage(err, 'Could not move the article to the next stage'), issues: [] }
}

/** One segment per workflow stage: done, current, pending. */
export function StageProgress({ stages, current }: { stages: ArticleStageStatus[]; current: string }) {
  return (
    <div className="flex items-center gap-1" aria-label={`Stage ${stages.findIndex(s => s.stage_name === current) + 1} of ${stages.length}`}>
      {stages.map(s => {
        const done = s.stage_status === 'Completed'
        const isCurrent = !done && s.stage_name === current
        return (
          <span
            key={s.stage_number}
            title={`${s.stage_name} — ${s.stage_status}`}
            className={cn(
              'h-1.5 w-4 rounded-full',
              done ? 'bg-primary' : isCurrent ? 'bg-amber-500' : 'bg-border',
            )}
          />
        )
      })}
    </div>
  )
}

export function NewClientModal({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (client: JournalClient) => void
}) {
  const [form, setForm] = useState({ client_code: '', publisher_name: '', jats_version: '1.3', contact_email: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    if (!form.client_code.trim() || !form.publisher_name.trim()) {
      setError('Enter a client code and the publisher name.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const created = await journalsApi.createClient({
        client_code: form.client_code.trim(),
        publisher_name: form.publisher_name.trim(),
        jats_version: form.jats_version,
        contact_email: form.contact_email.trim() || undefined,
      })
      toast.success(`Client ${created.client_code} created`)
      setForm({ client_code: '', publisher_name: '', jats_version: '1.3', contact_email: '' })
      onCreated(created)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not create the client'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="New journal client"
      description="A publisher whose journals you produce."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} isLoading={saving}>Create client</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Client code" placeholder="ELSA-01" value={form.client_code} onChange={set('client_code')} />
        <Select
          label="JATS version"
          value={form.jats_version}
          onChange={set('jats_version')}
          options={[{ value: '1.3', label: 'JATS 1.3' }, { value: '1.2', label: 'JATS 1.2' }]}
        />
        <div className="sm:col-span-2">
          <Input label="Publisher name" placeholder="Elsevier" value={form.publisher_name} onChange={set('publisher_name')} />
        </div>
        <div className="sm:col-span-2">
          <Input label="Production contact email" type="email" placeholder="production@publisher.com"
                 value={form.contact_email} onChange={set('contact_email')} />
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
    </Modal>
  )
}
