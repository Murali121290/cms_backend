import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookMarked, Plus, Settings } from 'lucide-react'
import { journalsApi, type JournalClient, type JournalOverview } from '@/api/journals'
import { getApiErrorMessage } from '@/api/client'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'

export function JournalClientPage() {
  const { clientId } = useParams()
  const id = Number(clientId)
  const navigate = useNavigate()
  const [client, setClient] = useState<JournalClient | null>(null)
  const [journals, setJournals] = useState<JournalOverview[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([journalsApi.getClient(id), journalsApi.getJournalsOverview(id)])
      .then(([c, j]) => { setClient(c); setJournals(j) })
      .catch(err => toast.error(getApiErrorMessage(err, 'Could not load this client')))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <FullPageSpinner />
  if (!client) return <EmptyState title="Client not found" description="It may have been removed." />

  const newJournal = () => navigate(`/journal-production/clients/${id}/journals/new`)

  return (
    <div className="p-6 space-y-5">
      <Breadcrumb items={[{ label: 'Journal Production', href: '/journal-production' }, { label: client.publisher_name }]} />
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold text-text">{client.publisher_name}</h1>
          <p className="text-sm text-muted">
            <span className="font-mono">{client.client_code}</span> · JATS {client.jats_version}
            {client.contact_email && <> · {client.contact_email}</>}
          </p>
        </div>
        <Button leftIcon={<Plus />} onClick={newJournal}>New journal</Button>
      </div>

      {journals.length === 0 ? (
        <EmptyState
          icon={BookMarked}
          title="No journals yet"
          description="Create a journal, choose its workflow, then upload articles."
          action={<Button leftIcon={<Plus />} onClick={newJournal}>New journal</Button>}
        />
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Journal</th>
                <th className="text-left font-semibold px-4 py-2.5">ISSN</th>
                <th className="text-left font-semibold px-4 py-2.5">Vol / Issue</th>
                <th className="text-left font-semibold px-4 py-2.5">Workflow</th>
                <th className="text-right font-semibold px-4 py-2.5">Articles</th>
                <th className="text-right font-semibold px-4 py-2.5">In progress</th>
                <th className="text-right font-semibold px-4 py-2.5">Completed</th>
                <th className="text-right font-semibold px-4 py-2.5">Delayed</th>
                <th className="px-4 py-2.5"><span className="sr-only">Settings</span></th>
              </tr>
            </thead>
            <tbody>
              {journals.map(j => (
                <tr
                  key={j.id}
                  onClick={() => navigate(`/journal-production/journals/${j.id}`)}
                  className="border-t border-border hover:bg-surface/60 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <a
                      href={`/journal-production/journals/${j.id}`}
                      onClick={e => { e.preventDefault(); navigate(`/journal-production/journals/${j.id}`) }}
                      className="font-medium text-text hover:text-primary"
                    >
                      {j.journal_title}
                    </a>
                    <div className="text-xs text-muted font-mono">{j.journal_code}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted font-mono whitespace-nowrap">
                    {[j.issn_print && `${j.issn_print} (print)`, j.issn_online && `${j.issn_online} (online)`].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{j.volume || j.issue ? `Vol ${j.volume ?? '—'} · Issue ${j.issue ?? '—'}` : '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant="info" size="sm">{j.workflow_name ?? 'Full production'}</Badge>
                    <div className="text-xs text-muted mt-1">{j.stages.length} stages</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{j.articles.total}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{j.articles.in_progress}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-green-600">{j.articles.completed}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${j.articles.delayed ? 'text-red-500 font-semibold' : ''}`}>{j.articles.delayed}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" aria-label={`Settings for ${j.journal_code}`} title="Journal settings"
                            onClick={e => { e.stopPropagation(); navigate(`/journal-production/journals/${j.id}/settings`) }}
                            className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-primary">
                      <Settings className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
