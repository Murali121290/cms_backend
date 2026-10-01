import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Plus, Search } from 'lucide-react'
import { journalsApi, type JournalClientOverview } from '@/api/journals'
import { getApiErrorMessage } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'
import { NewClientModal, initials } from './journalUi'

export function JournalClientsPage() {
  const navigate = useNavigate()
  const [clients, setClients] = useState<JournalClientOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [showNew, setShowNew] = useState(false)

  const load = async () => {
    try {
      setClients(await journalsApi.getClientsOverview())
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not load journal clients'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? clients.filter(c => `${c.publisher_name} ${c.client_code}`.toLowerCase().includes(q)) : clients
  }, [clients, query])

  if (loading) return <FullPageSpinner />

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3 mr-auto">
          <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <BookOpen className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text">Journal Production</h1>
            <p className="text-sm text-muted">Choose a publisher to see its journals.</p>
          </div>
        </div>
        <label className="relative">
          <span className="sr-only">Search clients</span>
          <Search className="size-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search clients"
            className="h-9 w-64 rounded-md border border-border bg-card pl-9 pr-3 text-sm text-text outline-none focus:ring-2 focus:ring-primary/30"
          />
        </label>
        <Button leftIcon={<Plus />} onClick={() => setShowNew(true)}>New client</Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={clients.length ? 'No clients match your search' : 'No journal clients yet'}
          description={clients.length ? 'Try a different name or code.' : 'Add the first publisher to start producing its journals.'}
          action={!clients.length && <Button leftIcon={<Plus />} onClick={() => setShowNew(true)}>New client</Button>}
        />
      ) : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
          {visible.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate(`/journal-production/clients/${c.id}`)}
              className="text-left bg-card rounded-xl border border-border shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <div className="flex items-center justify-center h-28 bg-primary/5">
                <div className="size-14 rounded-full bg-primary/15 text-primary flex items-center justify-center text-lg font-bold">
                  {initials(c.publisher_name)}
                </div>
              </div>
              <div className="px-4 py-3 border-b border-border text-center">
                <p className="font-semibold text-text truncate">{c.publisher_name}</p>
                <p className="text-xs text-muted font-mono mt-0.5">{c.client_code} · JATS {c.jats_version}</p>
              </div>
              <div className="px-4 py-3 flex justify-center gap-4 text-xs text-muted flex-wrap">
                <span>Journals : <strong className="text-text tabular-nums">{c.journal_count}</strong></span>
                <span>Active : <strong className="text-green-600 tabular-nums">{c.articles.in_progress}</strong></span>
                <span>Delay : <strong className="text-red-500 tabular-nums">{c.articles.delayed}</strong></span>
              </div>
            </button>
          ))}
        </div>
      )}

      <NewClientModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={() => { setShowNew(false); load() }}
      />
    </div>
  )
}
