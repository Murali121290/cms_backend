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

export function clientCodeInitials(code?: string, name?: string): string {
  if (code) {
    const cleaned = code.replace(/[-_\d]+$/, '').trim()
    if (cleaned.length >= 2 && cleaned.length <= 5) {
      return cleaned.toUpperCase()
    }
  }
  if (name) {
    return initials(name)
  }
  return (code || 'CL').slice(0, 4).toUpperCase()
}

export interface ClientTheme {
  bannerBg: string
  avatarBg: string
  avatarText: string
  borderColor: string
  shadowColor: string
}

const CLIENT_THEMES: ClientTheme[] = [
  {
    bannerBg: 'bg-gradient-to-br from-teal-500/20 via-teal-500/10 to-teal-500/5 border-b border-teal-500/20',
    avatarBg: 'bg-gradient-to-br from-teal-500 to-teal-700',
    avatarText: 'text-white font-extrabold',
    borderColor: 'hover:border-teal-500/40',
    shadowColor: 'hover:shadow-teal-500/10',
  },
  {
    bannerBg: 'bg-gradient-to-br from-indigo-500/20 via-indigo-500/10 to-indigo-500/5 border-b border-indigo-500/20',
    avatarBg: 'bg-gradient-to-br from-indigo-500 to-indigo-700',
    avatarText: 'text-white font-extrabold',
    borderColor: 'hover:border-indigo-500/40',
    shadowColor: 'hover:shadow-indigo-500/10',
  },
  {
    bannerBg: 'bg-gradient-to-br from-rose-500/20 via-rose-500/10 to-rose-500/5 border-b border-rose-500/20',
    avatarBg: 'bg-gradient-to-br from-rose-500 to-rose-700',
    avatarText: 'text-white font-extrabold',
    borderColor: 'hover:border-rose-500/40',
    shadowColor: 'hover:shadow-rose-500/10',
  },
  {
    bannerBg: 'bg-gradient-to-br from-amber-500/20 via-amber-500/10 to-amber-500/5 border-b border-amber-500/20',
    avatarBg: 'bg-gradient-to-br from-amber-500 to-amber-600',
    avatarText: 'text-slate-950 font-extrabold',
    borderColor: 'hover:border-amber-500/40',
    shadowColor: 'hover:shadow-amber-500/10',
  },
  {
    bannerBg: 'bg-gradient-to-br from-purple-500/20 via-purple-500/10 to-purple-500/5 border-b border-purple-500/20',
    avatarBg: 'bg-gradient-to-br from-purple-500 to-purple-700',
    avatarText: 'text-white font-extrabold',
    borderColor: 'hover:border-purple-500/40',
    shadowColor: 'hover:shadow-purple-500/10',
  },
  {
    bannerBg: 'bg-gradient-to-br from-cyan-500/20 via-cyan-500/10 to-cyan-500/5 border-b border-cyan-500/20',
    avatarBg: 'bg-gradient-to-br from-cyan-500 to-cyan-700',
    avatarText: 'text-white font-extrabold',
    borderColor: 'hover:border-cyan-500/40',
    shadowColor: 'hover:shadow-cyan-500/10',
  },
  {
    bannerBg: 'bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-emerald-500/5 border-b border-emerald-500/20',
    avatarBg: 'bg-gradient-to-br from-emerald-500 to-emerald-700',
    avatarText: 'text-white font-extrabold',
    borderColor: 'hover:border-emerald-500/40',
    shadowColor: 'hover:shadow-emerald-500/10',
  },
]

export function getClientTheme(code: string): ClientTheme {
  let hash = 0
  for (let i = 0; i < (code || '').length; i++) {
    hash = code.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % CLIENT_THEMES.length
  return CLIENT_THEMES[index]
}

export interface JournalTheme {
  badgeBg: string
  badgeText: string
  accentColor: string
}

const JOURNAL_THEMES: JournalTheme[] = [
  { badgeBg: 'bg-emerald-500/15 border border-emerald-500/30', badgeText: 'text-emerald-400 font-bold', accentColor: 'border-l-4 border-l-emerald-500' },
  { badgeBg: 'bg-indigo-500/15 border border-indigo-500/30', badgeText: 'text-indigo-400 font-bold', accentColor: 'border-l-4 border-l-indigo-500' },
  { badgeBg: 'bg-rose-500/15 border border-rose-500/30', badgeText: 'text-rose-400 font-bold', accentColor: 'border-l-4 border-l-rose-500' },
  { badgeBg: 'bg-amber-500/15 border border-amber-500/30', badgeText: 'text-amber-400 font-bold', accentColor: 'border-l-4 border-l-amber-500' },
  { badgeBg: 'bg-purple-500/15 border border-purple-500/30', badgeText: 'text-purple-400 font-bold', accentColor: 'border-l-4 border-l-purple-500' },
  { badgeBg: 'bg-cyan-500/15 border border-cyan-500/30', badgeText: 'text-cyan-400 font-bold', accentColor: 'border-l-4 border-l-cyan-500' },
  { badgeBg: 'bg-violet-500/15 border border-violet-500/30', badgeText: 'text-violet-400 font-bold', accentColor: 'border-l-4 border-l-violet-500' },
  { badgeBg: 'bg-blue-500/15 border border-blue-500/30', badgeText: 'text-blue-400 font-bold', accentColor: 'border-l-4 border-l-blue-500' },
]

export function getJournalTheme(key: string | number): JournalTheme {
  let hash = 0
  const str = String(key || '')
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return JOURNAL_THEMES[Math.abs(hash) % JOURNAL_THEMES.length]
}

export interface ArticleTheme {
  avatarBg: string
  avatarText: string
  badgeBg: string
  badgeText: string
}

const ARTICLE_THEMES: ArticleTheme[] = [
  { avatarBg: 'bg-emerald-500/20 border border-emerald-500/40', avatarText: 'text-emerald-400 font-bold', badgeBg: 'bg-emerald-500/10 border border-emerald-500/20', badgeText: 'text-emerald-400' },
  { avatarBg: 'bg-blue-500/20 border border-blue-500/40', avatarText: 'text-blue-400 font-bold', badgeBg: 'bg-blue-500/10 border border-blue-500/20', badgeText: 'text-blue-400' },
  { avatarBg: 'bg-purple-500/20 border border-purple-500/40', avatarText: 'text-purple-400 font-bold', badgeBg: 'bg-purple-500/10 border border-purple-500/20', badgeText: 'text-purple-400' },
  { avatarBg: 'bg-rose-500/20 border border-rose-500/40', avatarText: 'text-rose-400 font-bold', badgeBg: 'bg-rose-500/10 border border-rose-500/20', badgeText: 'text-rose-400' },
  { avatarBg: 'bg-amber-500/20 border border-amber-500/40', avatarText: 'text-amber-400 font-bold', badgeBg: 'bg-amber-500/10 border border-amber-500/20', badgeText: 'text-amber-400' },
  { avatarBg: 'bg-cyan-500/20 border border-cyan-500/40', avatarText: 'text-cyan-400 font-bold', badgeBg: 'bg-cyan-500/10 border border-cyan-500/20', badgeText: 'text-cyan-400' },
  { avatarBg: 'bg-indigo-500/20 border border-indigo-500/40', avatarText: 'text-indigo-400 font-bold', badgeBg: 'bg-indigo-500/10 border border-indigo-500/20', badgeText: 'text-indigo-400' },
  { avatarBg: 'bg-teal-500/20 border border-teal-500/40', avatarText: 'text-teal-400 font-bold', badgeBg: 'bg-teal-500/10 border border-teal-500/20', badgeText: 'text-teal-400' },
]

export function getArticleTheme(key: string | number): ArticleTheme {
  let hash = 0
  const str = String(key || '')
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return ARTICLE_THEMES[Math.abs(hash) % ARTICLE_THEMES.length]
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
