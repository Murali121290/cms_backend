import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Plus, Search } from 'lucide-react'
import { journalsApi, type JournalClientOverview } from '@/api/journals'
import { getApiErrorMessage } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'
import { cn } from '@/utils/cn'
import { NewClientModal, clientCodeInitials, getClientTheme } from './journalUi'

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
        <div className="grid gap-6 grid-cols-[repeat(auto-fill,minmax(310px,1fr))]">
          {visible.map(c => {
            const theme = getClientTheme(c.client_code)
            const codeInit = clientCodeInitials(c.client_code, c.publisher_name)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/journal-production/clients/${c.id}`)}
                className={cn(
                  'text-left bg-card rounded-2xl border border-border shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-primary/40 flex flex-col',
                  theme.borderColor,
                  theme.shadowColor
                )}
              >
                <div className={cn('flex items-center justify-center h-32 relative', theme.bannerBg)}>
                  <div className={cn('size-16 rounded-2xl flex items-center justify-center text-xl font-black tracking-wide shadow-lg border border-white/20', theme.avatarBg, theme.avatarText)}>
                    {codeInit}
                  </div>
                </div>
                <div className="p-4 border-b border-border text-center flex-1 flex flex-col justify-center">
                  <p className="font-bold text-base text-text leading-snug line-clamp-2" title={c.publisher_name}>{c.publisher_name}</p>
                  <div className="mt-1.5 flex items-center justify-center gap-2 text-xs">
                    <span className="font-mono font-semibold px-2 py-0.5 rounded bg-surface border border-border text-text">{c.client_code}</span>
                    <span className="text-muted">· JATS {c.jats_version}</span>
                  </div>
                </div>
                <div className="px-5 py-3.5 flex justify-around text-xs bg-card/60">
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] text-muted font-bold uppercase tracking-wider">Journals</span>
                    <strong className="text-text tabular-nums text-sm font-semibold">{c.journal_count}</strong>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] text-muted font-bold uppercase tracking-wider">Active</span>
                    <strong className="text-green-500 tabular-nums text-sm font-semibold">{c.articles.in_progress}</strong>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] text-muted font-bold uppercase tracking-wider">Delay</span>
                    <strong className="text-red-400 tabular-nums text-sm font-semibold">{c.articles.delayed}</strong>
                  </div>
                </div>
              </button>
            )
          })}
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
