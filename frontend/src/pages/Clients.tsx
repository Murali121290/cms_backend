import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Building2, ChevronRight } from 'lucide-react'
import { clientsApi, type Client } from '@/api/clients'
import { projectsApi, type Project } from '@/api/projects'
import { toast } from '@/store/useToastStore'
import { Badge } from '@/components/ui/Badge'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { ViewSwitcher } from '@/components/ui/ViewSwitcher'
import { useViewMode } from '@/hooks/useViewMode'

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
    delayed:   projects.filter(p => p.is_delayed).length,
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
      {/* Top — logo area */}
      <div className={`relative flex items-center justify-center h-32 ${areaBg}`}>
        {client.logo_url ? (
          <img src={client.logo_url} alt={name} className="w-full h-full p-4 object-contain" />
        ) : (
          <div className={`w-16 h-16 rounded-full flex items-center justify-center shadow-sm ${circleBg}`}>
            <span className={`text-xl font-bold tracking-wide select-none ${circleText}`}>
              {clientInitials(name)}
            </span>
          </div>
        )}
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
  const [viewMode, setViewMode] = useViewMode('view:clients', 'large')

  const [clients,  setClients]  = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')

  useEffect(() => {
    Promise.all([clientsApi.list(), projectsApi.list()])
      .then(([c, p]) => {
        setClients(c)
        setProjects((p as any).projects as Project[])
      })
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
    const base = q
      ? clients.filter(c =>
          clientDisplayName(c).toLowerCase().includes(q) ||
          (c.division ?? '').toLowerCase().includes(q) ||
          (c.company  ?? '').toLowerCase().includes(q)
        )
      : [...clients]
    return base.sort((a, b) => clientDisplayName(a).localeCompare(clientDisplayName(b)))
  }, [clients, search])

  if (loading) return <FullPageSpinner />

  const empty = (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted py-20">
      <Building2 size={40} className="opacity-30" />
      <p className="text-sm">{search ? 'No clients match your search.' : 'No clients found.'}</p>
    </div>
  )

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

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clients…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-surface border border-border rounded-lg text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <ViewSwitcher mode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {filtered.length === 0 ? empty : (
        <>
          {/* ── Large grid (default) ── */}
          {viewMode === 'large' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map(client => (
                <ClientCard key={client.id} client={client}
                  projects={projectsByClient.get(client.id) ?? []}
                  onClick={() => navigate(`/clients/${client.id}/projects`)} />
              ))}
            </div>
          )}

          {/* ── Medium grid (5-col compact) ── */}
          {viewMode === 'medium' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filtered.map(client => {
                const name = clientDisplayName(client)
                const stats = computeStats(projectsByClient.get(client.id) ?? [])
                const { circleBg, circleText } = logoStyle(client.id)
                return (
                  <div key={client.id} onClick={() => navigate(`/clients/${client.id}/projects`)}
                    className="bg-card rounded-xl border border-border shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer flex flex-col items-center gap-2 px-3 py-4">
                    {client.logo_url ? (
                      <img src={client.logo_url} alt={name} className="h-10 max-w-[5rem] object-contain" />
                    ) : (
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${circleBg}`}>
                        <span className={`text-sm font-bold ${circleText}`}>{clientInitials(name)}</span>
                      </div>
                    )}
                    <div className="text-center min-w-0 w-full">
                      <p className="text-xs font-semibold text-text truncate">{name}</p>
                      {!client.active_status && <Badge variant="hold" className="mt-0.5 text-[9px]">Inactive</Badge>}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted">
                      <span className="text-green-600 font-semibold">{stats.active}</span>
                      <span>·</span>
                      <span className="text-purple-600 font-semibold">{stats.fastTrack}</span>
                      <span>·</span>
                      <span className="text-red-500 font-semibold">{stats.delayed}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── List view ── */}
          {viewMode === 'list' && (
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
              {filtered.map((client, i) => {
                const name = clientDisplayName(client)
                const stats = computeStats(projectsByClient.get(client.id) ?? [])
                const { circleBg, circleText } = logoStyle(client.id)
                return (
                  <div key={client.id} onClick={() => navigate(`/clients/${client.id}/projects`)}
                    className={`flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-surface transition-colors ${i > 0 ? 'border-t border-border' : ''}`}>
                    {client.logo_url ? (
                      <img src={client.logo_url} alt={name} className="h-8 w-8 object-contain flex-shrink-0" />
                    ) : (
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${circleBg}`}>
                        <span className={`text-xs font-bold ${circleText}`}>{clientInitials(name)}</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-text truncate">{name}</p>
                      {client.division && <p className="text-xs text-muted truncate">{client.division}</p>}
                    </div>
                    {!client.active_status && <Badge variant="hold" className="flex-shrink-0">Inactive</Badge>}
                    <div className="flex items-center gap-4 text-xs flex-shrink-0">
                      <StatChip label="Active"     value={stats.active}    valueClass="text-green-600"  />
                      <StatChip label="Fast Track" value={stats.fastTrack} valueClass="text-purple-600" />
                      <StatChip label="Delay"      value={stats.delayed}   valueClass="text-red-500"    />
                    </div>
                    <ChevronRight size={14} className="text-muted flex-shrink-0" />
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Details table ── */}
          {viewMode === 'details' && (
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border bg-surface">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">Client</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">Division</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider">Active</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider">Fast Track</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider">Delayed</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((client, i) => {
                    const name = clientDisplayName(client)
                    const stats = computeStats(projectsByClient.get(client.id) ?? [])
                    return (
                      <tr key={client.id} onClick={() => navigate(`/clients/${client.id}/projects`)}
                        className={`cursor-pointer hover:bg-surface transition-colors ${i > 0 ? 'border-t border-border' : ''}`}>
                        <td className="px-4 py-3 text-xs text-muted">{i + 1}</td>
                        <td className="px-4 py-3 font-semibold text-text">{name}</td>
                        <td className="px-4 py-3 text-muted text-xs">{client.division ?? '—'}</td>
                        <td className="px-4 py-3 text-center font-bold text-green-600">{stats.active}</td>
                        <td className="px-4 py-3 text-center font-bold text-purple-600">{stats.fastTrack}</td>
                        <td className="px-4 py-3 text-center font-bold text-red-500">{stats.delayed}</td>
                        <td className="px-4 py-3 text-center">
                          {client.active_status
                            ? <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Active</span>
                            : <Badge variant="hold">Inactive</Badge>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
