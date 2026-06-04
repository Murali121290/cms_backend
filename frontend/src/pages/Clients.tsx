import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Building2 } from 'lucide-react'
import { clientsApi, type Client } from '@/api/clients'
import { projectsApi, type Project } from '@/api/projects'
import { toast } from '@/store/useToastStore'
import { Badge } from '@/components/ui/Badge'
import { FullPageSpinner } from '@/components/ui/Spinner'

// ── Helpers ───────────────────────────────────────────────────────────────────

function clientDisplayName(c: Client): string {
  if (c.name_company) return c.name_company
  if (c.company) return c.company
  if (c.first_name || c.surname) return [c.first_name, c.surname].filter(Boolean).join(' ')
  if (c.division) return c.division
  return `Client #${c.id}`
}

const LOGO_STYLES = [
  { areaBg: 'bg-blue-50',    circleBg: 'bg-blue-100',    circleText: 'text-blue-700'    },
  { areaBg: 'bg-purple-50',  circleBg: 'bg-purple-100',  circleText: 'text-purple-700'  },
  { areaBg: 'bg-emerald-50', circleBg: 'bg-emerald-100', circleText: 'text-emerald-700' },
  { areaBg: 'bg-orange-50',  circleBg: 'bg-orange-100',  circleText: 'text-orange-700'  },
  { areaBg: 'bg-rose-50',    circleBg: 'bg-rose-100',    circleText: 'text-rose-700'    },
  { areaBg: 'bg-cyan-50',    circleBg: 'bg-cyan-100',    circleText: 'text-cyan-700'    },
]

function logoStyle(id: number) {
  return LOGO_STYLES[id % LOGO_STYLES.length]
}

function clientInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

interface ClientStats {
  active: number
  delayed: number
  fastTrack: number
}

function computeStats(projects: Project[]): ClientStats {
  return {
    active:    projects.filter(p => p.status === 'Active').length,
    delayed:   projects.filter(p => p.status === 'Planning').length,
    fastTrack: projects.filter(p => p.priority === 'Fast Track').length,
  }
}

// ── Client Card ───────────────────────────────────────────────────────────────

interface ClientCardProps {
  client: Client
  projects: Project[]
  onClick: () => void
}

function ClientCard({ client, projects, onClick }: ClientCardProps) {
  const name  = clientDisplayName(client)
  const stats = computeStats(projects)
  const { areaBg, circleBg, circleText } = logoStyle(client.id)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      className="bg-card rounded-xl border border-border shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/40 overflow-hidden"
    >
      {/* Top — logo area with circular initials avatar */}
      <div className={`relative flex items-center justify-center py-8 ${areaBg}`}>
        {/* Circular avatar with initials */}
        <div className={`w-16 h-16 rounded-full flex items-center justify-center shadow-sm ${circleBg}`}>
          <span className={`text-xl font-bold tracking-wide select-none ${circleText}`}>
            {clientInitials(name)}
          </span>
        </div>
        {!client.active_status && (
          <span className="absolute top-2.5 right-2.5">
            <Badge variant="hold">Inactive</Badge>
          </span>
        )}
      </div>

      {/* Middle — client name */}
      <div className="px-4 py-3 text-center border-b border-border">
        <p className="font-semibold text-text truncate">{name}</p>
        {client.division && (
          <p className="text-xs text-muted truncate mt-0.5">{client.division}</p>
        )}
      </div>

      {/* Bottom — single-line stats */}
      <div className="px-4 py-3 flex items-center justify-center gap-4 flex-wrap">
        <StatChip label="Active"      value={stats.active}    valueClass="text-green-600"  />
        <StatChip label="Fast Track"  value={stats.fastTrack} valueClass="text-purple-600" />
        <StatChip label="Delay"       value={stats.delayed}   valueClass="text-red-500"    />
      </div>
    </div>
  )
}

function StatChip({ label, value, valueClass }: { label: string; value: number; valueClass: string }) {
  return (
    <span className="text-xs text-muted whitespace-nowrap">
      {label} : <strong className={`font-semibold tabular-nums ${valueClass}`}>{value}</strong>
    </span>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function Clients() {
  const navigate = useNavigate()

  const [clients,  setClients]  = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')

  useEffect(() => {
    setLoading(true)
    Promise.all([clientsApi.list(), projectsApi.list()])
      .then(([c, p]) => { setClients(c); setProjects(p) })
      .catch(() => toast.error('Failed to load data'))
      .finally(() => setLoading(false))
  }, [])

  const projectsByClient = useMemo(() => {
    const map = new Map<number, Project[]>()
    for (const p of projects) {
      if (p.client_id == null) continue
      if (!map.has(p.client_id)) map.set(p.client_id, [])
      map.get(p.client_id)!.push(p)
    }
    return map
  }, [projects])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return clients
    return clients.filter(c =>
      clientDisplayName(c).toLowerCase().includes(q) ||
      (c.division ?? '').toLowerCase().includes(q) ||
      (c.company  ?? '').toLowerCase().includes(q)
    )
  }, [clients, search])

  if (loading) return <FullPageSpinner />

  return (
    <div className="flex flex-col gap-6 p-6 min-h-full">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-accent rounded-lg">
            <Building2 size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text">Clients</h1>
            <p className="text-sm text-muted">{clients.length} client{clients.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-surface border border-border rounded-lg text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted py-20">
          <Building2 size={40} className="opacity-30" />
          <p className="text-sm">{search ? 'No clients match your search.' : 'No clients found.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(client => (
            <ClientCard
              key={client.id}
              client={client}
              projects={projectsByClient.get(client.id) ?? []}
              onClick={() => navigate(`/clients/${client.id}/projects`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
