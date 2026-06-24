import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, Plus, Search, Filter, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { rolesApi, type RolesMaster as Role } from '@/api/workflow'
import { toast } from '@/store/useToastStore'
import { Badge } from '@/components/ui/Badge'
import { Toggle } from '@/components/ui/Toggle'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { Card } from '@/components/ui/Card'

// ── Constants ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 8

// ── Create Role Modal ─────────────────────────────────────────────────────────
interface CreateRoleModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (r: Role) => void
  existingTeams: string[]
  existingRoleNames: string[]
}

function CreateRoleModal({ isOpen, onClose, onCreated, existingTeams, existingRoleNames }: CreateRoleModalProps) {
  const [form, setForm]     = useState({ role_name: '', team: '', newTeam: '', description: '', active_status: true })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [isNewTeam, setIsNewTeam]   = useState(false)
  const [isNewRole, setIsNewRole]   = useState(false)

  useEffect(() => {
    if (isOpen) {
      setForm({ role_name: '', team: '', newTeam: '', description: '', active_status: true })
      setErrors({})
      setIsNewTeam(false)
      setIsNewRole(existingRoleNames.length === 0)
    }
  }, [isOpen, existingRoleNames.length])

  function set(key: string, value: string | boolean) {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => { const n = { ...e }; delete n[key]; return n })
  }

  async function handleSubmit() {
    const errs: Record<string, string> = {}
    if (!form.role_name.trim()) errs.role_name = 'Role name is required'
    const team = isNewTeam ? form.newTeam.trim() : form.team
    if (!team) errs.team = isNewTeam ? 'Team name is required' : 'Please select a team'
    if (Object.keys(errs).length) { setErrors(errs); return }
    setLoading(true)
    try {
      const role = await rolesApi.create({
        role_name: form.role_name.trim(),
        team,
        description: form.description.trim() || undefined,
        active_status: form.active_status,
      })
      toast.success(`Role "${role.role_name}" created`)
      onCreated(role)
      onClose()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      if (msg?.toLowerCase().includes('already exists')) {
        setErrors({ role_name: 'This role already exists in the selected team' })
      } else {
        toast.error(msg ?? 'Failed to create role')
      }
    } finally { setLoading(false) }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Role" footer={
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={loading}>
          {loading ? <><Spinner size="sm" />Saving…</> : 'Save Role'}
        </Button>
      </div>
    }>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Role Name — select existing or type new */}
        <div className="flex flex-col gap-1">
          {isNewRole || existingRoleNames.length === 0 ? (
            <Input
              label="Role Name" required
              value={form.role_name} onChange={e => set('role_name', e.target.value)}
              error={errors.role_name} placeholder="e.g. copyeditor"
            />
          ) : (
            <Select
              label="Role Name" required
              value={form.role_name} onChange={e => set('role_name', e.target.value)}
              error={errors.role_name}
              options={existingRoleNames.map(n => ({ value: n, label: n }))}
              placeholder="Select role name"
            />
          )}
          {existingRoleNames.length > 0 && (
            <button
              type="button"
              onClick={() => { setIsNewRole(s => !s); set('role_name', '') }}
              className="text-xs text-primary hover:underline text-left"
            >
              {isNewRole ? '← Select from existing roles' : '+ Create new role name'}
            </button>
          )}
        </div>

        {/* Team — select existing or type new */}
        <div className="flex flex-col gap-1">
          {isNewTeam ? (
            <Input
              label="New Team Name" required
              value={form.newTeam} onChange={e => set('newTeam', e.target.value)}
              error={errors.team} placeholder="e.g. Copyediting Team"
            />
          ) : (
            <Select
              label="Team" required
              value={form.team} onChange={e => set('team', e.target.value)}
              error={errors.team}
              options={existingTeams.map(t => ({ value: t, label: t }))}
              placeholder="Select team"
            />
          )}
          <button
            type="button"
            onClick={() => { setIsNewTeam(s => !s); set('team', ''); set('newTeam', '') }}
            className="text-xs text-primary hover:underline text-left"
          >
            {isNewTeam ? '← Pick existing team' : '+ Create new team'}
          </button>
        </div>

        <div className="sm:col-span-2">
          <Input
            label="Description"
            value={form.description} onChange={e => set('description', e.target.value)}
            placeholder="Brief description of this role's responsibilities"
          />
        </div>

      </div>
    </Modal>
  )
}

// ── Edit Role Modal ───────────────────────────────────────────────────────────
interface EditRoleModalProps {
  isOpen: boolean
  onClose: () => void
  onUpdated: (r: Role) => void
  role: Role | null
}

function EditRoleModal({ isOpen, onClose, onUpdated, role }: EditRoleModalProps) {
  const [form, setForm] = useState({ description: '', active_status: true })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (role) setForm({ description: role.description ?? '', active_status: role.active_status })
  }, [role])

  async function handleSubmit() {
    if (!role) return
    setLoading(true)
    try {
      const updated = await rolesApi.update(role.id, {
        description: form.description.trim() || undefined,
        active_status: form.active_status,
      })
      toast.success(`Role "${updated.role_name}" updated`)
      onUpdated(updated)
      onClose()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Failed to update role')
    } finally { setLoading(false) }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Edit Role — ${role?.role_name ?? ''}`} footer={
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={loading}>
          {loading ? <><Spinner size="sm" />Saving…</> : 'Save Changes'}
        </Button>
      </div>
    }>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="Role Name" value={role?.role_name ?? ''} disabled className="opacity-60" />
        <Input label="Team" value={role?.team ?? ''} disabled className="opacity-60" />
        <div className="sm:col-span-2">
          <Input
            label="Description"
            value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Brief description of this role's responsibilities"
          />
        </div>
      </div>
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function RolesManagement() {
  const navigate = useNavigate()
  const [roles, setRoles]     = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [filterTeam, setFilterTeam]     = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [page, setPage]       = useState(1)
  const [createOpen, setCreateOpen]     = useState(false)
  const [editRole, setEditRole]         = useState<Role | null>(null)
  const [confirmRole, setConfirmRole]   = useState<Role | null>(null)
  const [statusLoading, setStatusLoading] = useState<number | null>(null)

  useEffect(() => {
    rolesApi.list()
      .then(setRoles)
      .catch(() => toast.error('Failed to load roles'))
      .finally(() => setLoading(false))
  }, [])

  const allTeams      = [...new Set(roles.map(r => r.team))].sort()
  const allRoleNames  = [...new Set(roles.map(r => r.role_name))].sort()

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return roles.filter(r =>
      (!q || r.role_name.toLowerCase().includes(q) || r.team.toLowerCase().includes(q)) &&
      (!filterTeam   || r.team === filterTeam) &&
      (!filterStatus || (filterStatus === 'active' ? r.active_status : !r.active_status))
    )
  }, [roles, search, filterTeam, filterStatus])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageData   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [search, filterTeam, filterStatus])

  async function handleToggleStatus(role: Role) {
    if (!role.active_status) {
      await doStatusChange(role, true)
    } else {
      setConfirmRole(role)
    }
  }

  async function doStatusChange(role: Role, status: boolean) {
    setStatusLoading(role.id)
    try {
      const updated = await rolesApi.setStatus(role.id, status)
      setRoles(rs => rs.map(r => r.id === updated.id ? updated : r))
      toast.success(`"${updated.role_name}" is now ${status ? 'active' : 'inactive'}`)
    } catch {
      toast.error('Failed to update status')
    } finally { setStatusLoading(null) }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/settings')}
          className="p-2 rounded-lg hover:bg-card border border-transparent hover:border-border text-muted hover:text-text transition-all"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-text">Roles &amp; Teams</h2>
          <p className="text-xs text-muted mt-0.5">{roles.length} total roles</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} leftIcon={<Plus size={15} />}>
          Create New Role
        </Button>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by role name or team..."
                className="w-full pl-9 pr-4 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-text placeholder:text-muted"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Filter size={14} className="text-muted" />
            <span className="text-xs text-muted font-medium">Filters:</span>
          </div>

          <select
            value={filterTeam} onChange={e => setFilterTeam(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30 w-[160px]"
          >
            <option value="">All Teams</option>
            {allTeams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <select
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30 w-[130px]"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          <button
            onClick={() => { setSearch(''); setFilterTeam(''); setFilterStatus('') }}
            className={`flex items-center gap-1 text-xs text-danger hover:underline transition-opacity ${
              search || filterTeam || filterStatus ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
              }`}
          >
            <RefreshCw size={12} /> Clear
          </button>
        </div>
      </Card>

      {/* Table */}
      <Card>
        {loading ? <FullPageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background">
                  {['Role', 'Team', 'Description', 'Status'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageData.length === 0 ? (
                  <>
                    <tr>
                      <td colSpan={4} className="px-4 py-12 text-center text-muted text-sm">No roles found</td>
                    </tr>
                    {Array.from({ length: PAGE_SIZE - 1 }).map((_, i) => (
                      <tr key={`pad-${i}`}><td colSpan={4} className="py-[22px]" /></tr>
                    ))}
                  </>
                ) : (
                  <>
                    {pageData.map(role => (
                      <tr key={role.id} className="hover:bg-background/60 transition-colors">
                        {/* Role */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                              style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, white)', color: 'var(--color-primary)' }}
                            >
                              {role.role_name[0].toUpperCase()}
                            </div>
                            <span className="font-medium text-text">{role.role_name}</span>
                          </div>
                        </td>
                        {/* Team */}
                        <td className="px-4 py-3">
                          <Badge variant="planning">{role.team}</Badge>
                        </td>
                        {/* Description */}
                        <td className="px-4 py-3 text-muted max-w-[260px] truncate">
                          {role.description ?? <span className="italic">—</span>}
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {statusLoading === role.id ? (
                              <Spinner size="sm" />
                            ) : (
                              <Toggle checked={role.active_status} onChange={() => handleToggleStatus(role)} />
                            )}
                            <span className={`text-xs font-medium ${role.active_status ? 'text-success' : 'text-muted'}`}>
                              {role.active_status ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {Array.from({ length: PAGE_SIZE - pageData.length }).map((_, i) => (
                      <tr key={`pad-${i}`}><td colSpan={4} className="py-[22px]" /></tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <p className="text-xs text-muted">
                Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} roles
              </p>
              <div className={`flex items-center gap-1 ${totalPages <= 1 ? 'invisible' : ''}`}>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed text-text transition-colors"
                >
                  Previous
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setPage(p)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${p === page ? 'bg-primary text-white border-primary' : 'border-border hover:bg-background text-text'}`}>
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed text-text transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Modals */}
      <CreateRoleModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={r => setRoles(rs => [...rs, r])}
        existingTeams={allTeams}
        existingRoleNames={allRoleNames}
      />
      <EditRoleModal
        isOpen={!!editRole}
        onClose={() => setEditRole(null)}
        onUpdated={r => setRoles(rs => rs.map(x => x.id === r.id ? r : x))}
        role={editRole}
      />
      <ConfirmDialog
        isOpen={!!confirmRole}
        onClose={() => setConfirmRole(null)}
        onConfirm={async () => {
          if (confirmRole) {
            await doStatusChange(confirmRole, false)
            setConfirmRole(null)
          }
        }}
        title="Deactivate Role"
        message={`Are you sure you want to deactivate "${confirmRole?.role_name}" in ${confirmRole?.team}? Users assigned this role may be affected.`}
        confirmLabel="Deactivate"
      />
    </div>
  )
}
