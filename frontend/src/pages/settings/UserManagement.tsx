import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, Plus, Search, Filter, Edit2, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usersApi, type User, type CreateUserPayload, type UpdateUserPayload } from '@/api/users'
import { rolesApi, type RolesMaster as Role } from '@/api/workflow'
import { clientsApi } from '@/api/clients'
import { toast } from '@/store/useToastStore'
import { Badge, statusToBadge } from '@/components/ui/Badge'
import { Toggle } from '@/components/ui/Toggle'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { Button } from '@/components/ui/Button'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { Card } from '@/components/ui/Card'

// ── Constants ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 8

// ── Validation ────────────────────────────────────────────────────────────────
function validateCreate(f: Partial<CreateUserPayload>, users: User[]) {
  const e: Record<string, string> = {}
  if (!f.user_name?.trim())    e.user_name = 'User name is required'
  if (!f.email?.trim())        e.email     = 'Email is required'
  else if (!/\S+@\S+\.\S+/.test(f.email)) e.email = 'Invalid email address'
  else if (users.some(u => u.email === f.email)) e.email = 'Email already exists'
  if (!f.password?.trim())     e.password  = 'Password is required'
  if (!f.role)                 e.role      = 'Role is required'
  if (!f.team)                 e.team      = 'Team is required'
  return e
}

function validateEdit(f: Partial<UpdateUserPayload>) {
  const e: Record<string, string> = {}
  if (!f.role)  e.role = 'Role is required'
  if (!f.team)  e.team = 'Team is required'
  return e
}

// ── Create User Modal ─────────────────────────────────────────────────────────
interface CreateModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (u: User) => void
  roles: Role[]
  users: User[]
  teams: string[]
  customerOptions: { value: string; label: string }[]
}

function CreateUserModal({ isOpen, onClose, onCreated, roles, users, teams, customerOptions }: CreateModalProps) {
  const [form, setForm] = useState<Partial<CreateUserPayload>>({ customer_access: [], active_status: true })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  function set<K extends keyof CreateUserPayload>(key: K, value: CreateUserPayload[K]) {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => { const n = { ...e }; delete n[key]; return n })
  }

  // Unique role names for dropdown
  const roleOptions = useMemo(() =>
    [...new Set(roles.map(r => r.role_name))].sort().map(n => ({ value: n, label: n }))
    , [roles])

  function handleRoleChange(roleName: string) {
    set('role', roleName)
    const matched = roles.filter(r => r.role_name === roleName)
    if (matched.length >= 1) set('team', matched[0].team)
    else set('team', '')
  }

  async function handleSubmit() {
    const errs = validateCreate(form, users)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setLoading(true)
    try {
      const user = await usersApi.create(form as CreateUserPayload)
      toast.success(`User "${user.user_name}" created successfully`)
      onCreated(user)
      onClose()
      setForm({ customer_access: [], active_status: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New User" size="lg" footer={
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={loading}>
          {loading ? <><Spinner size="sm" />Creating...</> : 'Save User'}
        </Button>
      </div>
    }>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="User Name" required value={form.user_name ?? ''} onChange={e => set('user_name', e.target.value)} error={errors.user_name} placeholder="e.g. john_doe" />
        <Input label="Email" type="email" required value={form.email ?? ''} onChange={e => set('email', e.target.value)} error={errors.email} placeholder="john@example.com" />
        <Input label="Password" type="password" required value={form.password ?? ''} onChange={e => set('password', e.target.value)} error={errors.password} placeholder="Min 8 characters" />
        <Select label="Role" required value={form.role ?? ''} onChange={e => handleRoleChange(e.target.value)} error={errors.role}
          options={roleOptions} placeholder="Select role" />
        <Input label="Team" value={form.team ?? ''} disabled className="opacity-70 cursor-not-allowed"
          placeholder="Auto-filled from role" hint="Set automatically when a role is selected" />
        <div className="sm:col-span-2">
          <MultiSelect label="Customer Access" options={customerOptions} value={form.customer_access ?? []}
            onChange={v => set('customer_access', v)} placeholder="Select customers..." />
        </div>
      </div>
    </Modal>
  )
}

// ── Edit User Modal ───────────────────────────────────────────────────────────
interface EditModalProps {
  isOpen: boolean
  onClose: () => void
  onUpdated: (u: User) => void
  user: User | null
  roles: Role[]
  teams: string[]
  customerOptions: { value: string; label: string }[]
}

function EditUserModal({ isOpen, onClose, onUpdated, user, roles, teams, customerOptions }: EditModalProps) {
  const [form, setForm] = useState<Partial<UpdateUserPayload>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) setForm({ role: user.role, team: user.team, customer_access: user.customer_access, active_status: user.active_status, password: '' })
  }, [user])

  function set<K extends keyof UpdateUserPayload>(key: K, value: UpdateUserPayload[K]) {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => { const n = { ...e }; delete n[key]; return n })
  }

  // Unique role names for dropdown
  const roleOptions = useMemo(() =>
    [...new Set(roles.map(r => r.role_name))].sort().map(n => ({ value: n, label: n }))
    , [roles])

  function handleRoleChange(roleName: string) {
    set('role', roleName)
    const matched = roles.filter(r => r.role_name === roleName)
    if (matched.length >= 1) set('team', matched[0].team)
    else set('team', '')
  }

  async function handleSubmit() {
    const errs = validateEdit(form)
    if (Object.keys(errs).length) { setErrors(errs); return }
    if (!user) return
    setLoading(true)
    try {
      const payload: UpdateUserPayload = { ...form }
      if (!payload.password) delete payload.password
      const updated = await usersApi.update(user.id, payload)
      toast.success(`User "${updated.user_name}" updated successfully`)
      onUpdated(updated)
      onClose()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Failed to update user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Edit User — ${user?.user_name ?? ''}`} size="lg" footer={
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={loading}>
          {loading ? <><Spinner size="sm" />Saving...</> : 'Save Changes'}
        </Button>
      </div>
    }>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="User Name" value={user?.user_name ?? ''} disabled className="opacity-60" />
        <Input label="Email" value={user?.email ?? ''} disabled className="opacity-60" />
        <Input label="New Password" type="password" value={form.password ?? ''} onChange={e => set('password', e.target.value)}
          placeholder="Leave blank to keep current" hint="Leave blank to keep existing password" />
        <Select label="Role" required value={form.role ?? ''} onChange={e => handleRoleChange(e.target.value)} error={errors.role}
          options={roleOptions} placeholder="Select role" />
        <Input label="Team" value={form.team ?? ''} disabled className="opacity-70 cursor-not-allowed"
          placeholder="Auto-filled from role" hint="Set automatically when a role is selected" />
        <div className="sm:col-span-2">
          <MultiSelect label="Customer Access" options={customerOptions} value={form.customer_access ?? []}
            onChange={v => set('customer_access', v)} placeholder="Select customers..." />
        </div>
      </div>
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function UserManagement() {
  const navigate = useNavigate()
  const [users, setUsers]       = useState<User[]>([])
  const [roles, setRoles]       = useState<Role[]>([])
  const [clients, setClients]   = useState<{ division: string; company: string | null }[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [filterRole, setFilterRole]   = useState('')
  const [filterTeam, setFilterTeam]   = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [page, setPage]         = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser]     = useState<User | null>(null)
  const [confirmUser, setConfirmUser] = useState<User | null>(null)
  const [statusLoading, setStatusLoading] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([usersApi.list(), rolesApi.listActive(), clientsApi.list()])
      .then(([u, r, c]) => {
        setUsers(u); setRoles(r)
        setClients(c.map(x => ({ division: x.division ?? '', company: x.company })))
      })
      .catch(() => toast.error('Failed to load data'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return users.filter(u =>
      (!q || u.user_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
      (!filterRole   || u.role === filterRole) &&
      (!filterTeam   || u.team === filterTeam) &&
      (!filterStatus || (filterStatus === 'active' ? u.active_status : !u.active_status))
    )
  }, [users, search, filterRole, filterTeam, filterStatus])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageData   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [search, filterRole, filterTeam, filterStatus])

  async function handleToggleStatus(user: User) {
    if (!user.active_status) {
      // Reactivate immediately
      await doStatusChange(user, true)
    } else {
      setConfirmUser(user)
    }
  }

  async function doStatusChange(user: User, status: boolean) {
    setStatusLoading(user.id)
    try {
      const updated = await usersApi.setStatus(user.id, status)
      setUsers(us => us.map(u => u.id === updated.id ? updated : u))
      toast.success(`${updated.user_name} is now ${status ? 'active' : 'inactive'}`)
    } catch {
      toast.error('Failed to update status')
    } finally {
      setStatusLoading(null)
    }
  }

  const teamOptions = [...new Set(users.map(u => u.team))].sort()
  const customerOptions = clients.map(c => ({
    value: c.division,
    label: c.company ? `${c.division} — ${c.company}` : c.division,
  }))

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/settings')} className="p-2 rounded-lg hover:bg-card border border-transparent hover:border-border text-muted hover:text-text transition-all">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-text">User Management</h2>
          <p className="text-xs text-muted mt-0.5">{users.length} total users</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} leftIcon={<Plus size={15} />}>
          Create New User
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
                placeholder="Search by name or email..."
                className="w-full pl-9 pr-4 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-text placeholder:text-muted"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Filter size={14} className="text-muted" />
            <span className="text-xs text-muted font-medium">Filters:</span>
          </div>

          <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30 w-[140px]">
            <option value="">All Roles</option>
            {roles.map(r => <option key={r.role_name} value={r.role_name}>{r.role_name}</option>)}
          </select>

          <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30 w-[140px]">
            <option value="">All Teams</option>
            {teamOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30 w-[130px]">
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          <button
            onClick={() => { setSearch(''); setFilterRole(''); setFilterTeam(''); setFilterStatus('') }}
            className={`flex items-center gap-1 text-xs text-danger hover:underline transition-opacity ${
              search || filterRole || filterTeam || filterStatus ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
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
                  {['User', 'Email', 'Role', 'Team', 'Customer Access', 'Status', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageData.length === 0 ? (
                  <>
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-muted text-sm">No users found</td></tr>
                    {Array.from({ length: PAGE_SIZE - 1 }).map((_, i) => (
                      <tr key={`pad-${i}`}><td colSpan={7} className="py-[22px]" /></tr>
                    ))}
                  </>
                ) : (
                  <>
                    {pageData.map(user => (
                      <tr key={user.id} className="hover:bg-background/60 transition-colors">
                        {/* User */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, white)', color: 'var(--color-primary)' }}>
                              {user.user_name[0].toUpperCase()}
                            </div>
                            <span className="font-medium text-text">{user.user_name}</span>
                          </div>
                        </td>
                        {/* Email */}
                        <td className="px-4 py-3 text-muted">{user.email}</td>
                        {/* Role */}
                        <td className="px-4 py-3">
                          <Badge variant={statusToBadge('in-progress')} className="bg-purple-100 text-purple-700 border-purple-200">
                            {user.role}
                          </Badge>
                        </td>
                        {/* Team */}
                        <td className="px-4 py-3 text-text">{user.team}</td>
                        {/* Customer Access */}
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1 max-w-[180px]">
                            {user.customer_access.slice(0, 3).map(c => (
                              <span key={c} className="text-[10px] px-1.5 py-0.5 bg-accent text-primary rounded font-medium">{c}</span>
                            ))}
                            {user.customer_access.length > 3 && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-border text-muted rounded font-medium">+{user.customer_access.length - 3}</span>
                            )}
                          </div>
                        </td>
                        {/* Status toggle */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {statusLoading === user.id ? (
                              <Spinner size="sm" />
                            ) : (
                              <Toggle checked={user.active_status} onChange={() => handleToggleStatus(user)} />
                            )}
                            <span className={`text-xs font-medium ${user.active_status ? 'text-success' : 'text-muted'}`}>
                              {user.active_status ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </td>
                        {/* Actions */}
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setEditUser(user)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-accent rounded-lg hover:bg-primary hover:text-white transition-colors"
                          >
                            <Edit2 size={12} /> Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                    {Array.from({ length: PAGE_SIZE - pageData.length }).map((_, i) => (
                      <tr key={`pad-${i}`}><td colSpan={7} className="py-[22px]" /></tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>

            {/* Pagination — always rendered to prevent layout shift */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <p className="text-xs text-muted">
                Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} users
              </p>
              <div className={`flex items-center gap-1 ${totalPages <= 1 ? 'invisible' : ''}`}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed text-text transition-colors">
                  Previous
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setPage(p)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${p === page ? 'bg-primary text-white border-primary' : 'border-border hover:bg-background text-text'}`}>
                    {p}
                  </button>
                ))}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed text-text transition-colors">
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Modals */}
      <CreateUserModal
        isOpen={createOpen} onClose={() => setCreateOpen(false)}
        onCreated={u => setUsers(us => [u, ...us])}
        roles={roles} users={users}
        teams={teamOptions} customerOptions={customerOptions}
      />
      <EditUserModal
        isOpen={!!editUser} onClose={() => setEditUser(null)}
        onUpdated={u => setUsers(us => us.map(x => x.id === u.id ? u : x))}
        user={editUser} roles={roles}
        teams={teamOptions} customerOptions={customerOptions}
      />
      <ConfirmDialog
        isOpen={!!confirmUser}
        onClose={() => setConfirmUser(null)}
        onConfirm={async () => {
          if (confirmUser) {
            await doStatusChange(confirmUser, false)
            setConfirmUser(null)
          }
        }}
        title="Deactivate User"
        message={`Are you sure you want to deactivate "${confirmUser?.user_name}"? They will lose access to the system immediately.`}
        confirmLabel="Deactivate"
      />
    </div>
  )
}
