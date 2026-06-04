import { useState, useEffect, useMemo } from 'react'
import {
  ArrowLeft, Plus, Search, Filter, Download, Eye, Edit2,
  RefreshCw, Building2, ChevronUp, ChevronDown,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { clientsApi, type Client, type ClientPayload } from '@/api/clients'
import { toast } from '@/store/useToastStore'
import { Toggle } from '@/components/ui/Toggle'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { Card } from '@/components/ui/Card'

// ── Constants ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 8
const CONTACT_TYPES = ['Customer', 'Vendor', 'Partner', 'Freelancer']
const CATEGORY_OPTIONS = [
  { value: 'person', label: 'Person' },
  { value: 'organization', label: 'Organization' },
]
const COUNTRIES = [
  'Australia', 'Canada', 'China', 'France', 'Germany', 'India', 'Ireland',
  'Japan', 'Netherlands', 'New Zealand', 'Singapore', 'South Africa',
  'United Arab Emirates', 'United Kingdom', 'United States',
]
const DRAFT_KEY = 'customer_form_draft'

// ── Helpers ───────────────────────────────────────────────────────────────────
function getDisplayName(c: Client): string {
  if (c.category_type === 'person') {
    const n = [c.first_name, c.surname].filter(Boolean).join(' ')
    return n || c.company || '—'
  }
  return c.name_company || c.company || '—'
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function exportCSV(rows: Client[]) {
  const headers = ['ID', 'Name', 'Company', 'Division', 'Contact Type', 'Email', 'Phone', 'Country', 'Status']
  const lines = rows.map(r => [
    r.id,
    `"${getDisplayName(r)}"`,
    `"${r.company ?? ''}"`,
    `"${r.division ?? ''}"`,
    r.contact_type,
    r.email ?? '',
    r.phone_main ?? '',
    r.country ?? '',
    r.active_status ? 'Active' : 'Inactive',
  ].join(','))
  const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'customers.csv'; a.click()
  URL.revokeObjectURL(url)
}

// ── Validation ────────────────────────────────────────────────────────────────
function validate(form: Partial<ClientPayload>, clients: Client[], editId?: number) {
  const e: Record<string, string> = {}
  if (!form.category_type)    e.category_type = 'Required'
  if (!form.contact_type)     e.contact_type  = 'Required'
  if (!form.company?.trim())  e.company       = 'Required'
  if (!form.division?.trim()) e.division      = 'Required'
  if (!form.email?.trim())    e.email = 'Email is required'
  else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Invalid email format'
  else if (clients.some(c => c.email === form.email && c.id !== editId)) e.email = 'Email already in use'
  if (form.website?.trim() && !/^https?:\/\/.+/.test(form.website))
    e.website = 'Must start with http:// or https://'
  return e
}

// ── Section Card ──────────────────────────────────────────────────────────────
function SectionCard({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className={`px-5 py-3 ${accent} border-b border-border`}>
        <h3 className="text-sm font-semibold text-text">{title}</h3>
      </div>
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {children}
      </div>
    </div>
  )
}

// ── Customer Form Modal ───────────────────────────────────────────────────────
const EMPTY: Partial<ClientPayload> = { active_status: true }

interface FormModalProps {
  open: boolean
  onClose: () => void
  onSaved: (c: Client, mode: 'create' | 'edit') => void
  clients: Client[]
  editCustomer?: Client | null
}

function CustomerFormModal({ open, onClose, onSaved, clients, editCustomer }: FormModalProps) {
  const [form, setForm] = useState<Partial<ClientPayload>>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const isEdit = !!editCustomer

  useEffect(() => {
    if (!open) return
    setErrors({})
    if (editCustomer) {
      setForm({
        category_type: editCustomer.category_type,
        contact_type: editCustomer.contact_type,
        first_name: editCustomer.first_name ?? undefined,
        surname: editCustomer.surname ?? undefined,
        name_company: editCustomer.name_company ?? undefined,
        company: editCustomer.company ?? undefined,
        division: editCustomer.division ?? undefined,
        designation: editCustomer.designation ?? undefined,
        department: editCustomer.department ?? undefined,
        email: editCustomer.email ?? undefined,
        website: editCustomer.website ?? undefined,
        vendor_number: editCustomer.vendor_number ?? undefined,
        address1: editCustomer.address1 ?? undefined,
        address2: editCustomer.address2 ?? undefined,
        city: editCustomer.city ?? undefined,
        state: editCustomer.state ?? undefined,
        country: editCustomer.country ?? undefined,
        zip_code: editCustomer.zip_code ?? undefined,
        sub_specialisation: editCustomer.sub_specialisation ?? undefined,
        working_hours: editCustomer.working_hours ?? undefined,
        contact_hours: editCustomer.contact_hours ?? undefined,
        phone_main: editCustomer.phone_main ?? undefined,
        phone_additional: editCustomer.phone_additional ?? undefined,
        active_status: editCustomer.active_status,
      })
    } else {
      try {
        const draft = localStorage.getItem(DRAFT_KEY)
        setForm(draft ? JSON.parse(draft) : EMPTY)
      } catch { setForm(EMPTY) }
    }
  }, [open, editCustomer])

  // Auto-save draft (create only)
  useEffect(() => {
    if (!open || isEdit) return
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)) } catch {}
  }, [form, open, isEdit])

  function set<K extends keyof ClientPayload>(key: K, value: ClientPayload[K]) {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => { const n = { ...e }; delete n[key]; return n })
  }

  async function handleSave() {
    const errs = validate(form, clients, editCustomer?.id)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true)
    try {
      const saved = isEdit
        ? await clientsApi.update(editCustomer!.id, form)
        : await clientsApi.create(form as ClientPayload)
      toast.success(`Customer ${isEdit ? 'updated' : 'created'} successfully`)
      localStorage.removeItem(DRAFT_KEY)
      onSaved(saved, isEdit ? 'edit' : 'create')
      onClose()
    } catch {
      toast.error(`Failed to ${isEdit ? 'update' : 'create'} customer`)
    } finally { setSaving(false) }
  }

  const isPerson = form.category_type === 'person'
  const isOrg    = form.category_type === 'organization'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit — ${getDisplayName(editCustomer!)}` : 'Create New Customer'}
      size="xl"
      footer={
        <>
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted hover:text-text border border-border rounded-lg hover:bg-background transition-colors">
            Cancel
          </button>
          <Button onClick={() => handleSave()} disabled={saving}>
            {saving ? <><Spinner size="sm" /> Saving…</> : isEdit ? 'Update Customer' : 'Save Customer'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Section 1 — Customer Information */}
        <SectionCard title="1. Customer Information" accent="bg-blue-50">
          <Select label="Category Type" required
            value={form.category_type ?? ''} onChange={e => set('category_type', e.target.value)}
            error={errors.category_type} options={CATEGORY_OPTIONS} placeholder="Select category" />
          <Select label="Contact Type" required
            value={form.contact_type ?? ''} onChange={e => set('contact_type', e.target.value)}
            error={errors.contact_type} options={CONTACT_TYPES.map(t => ({ value: t, label: t }))} placeholder="Select type" />

          {isPerson && (
            <>
              <Input label="First Name"
                value={form.first_name ?? ''} onChange={e => set('first_name', e.target.value)} placeholder="First name" />
              <Input label="Surname"
                value={form.surname ?? ''} onChange={e => set('surname', e.target.value)} placeholder="Surname" />
            </>
          )}
          {isOrg && (
            <div className="sm:col-span-2">
              <Input label="Organization Name"
                value={form.name_company ?? ''} onChange={e => set('name_company', e.target.value)} placeholder="Organization name" />
            </div>
          )}

          <Input label="Company" required
            value={form.company ?? ''} onChange={e => set('company', e.target.value)}
            error={errors.company} placeholder="Company name" />
          <Input label="Division" required
            value={form.division ?? ''} onChange={e => set('division', e.target.value)}
            error={errors.division} placeholder="Division code" />
          <Input label="Designation"
            value={form.designation ?? ''} onChange={e => set('designation', e.target.value)} placeholder="Job title" />
          <Input label="Department"
            value={form.department ?? ''} onChange={e => set('department', e.target.value)} placeholder="Department" />
        </SectionCard>

        {/* Section 2 — Contact Information */}
        <SectionCard title="2. Contact Information" accent="bg-green-50">
          <Input label="Email" required type="email"
            value={form.email ?? ''} onChange={e => set('email', e.target.value)}
            error={errors.email} placeholder="email@company.com" />
          <Input label="Website"
            value={form.website ?? ''} onChange={e => set('website', e.target.value)}
            error={errors.website} placeholder="https://..." />
          <Input label="Vendor Number"
            value={form.vendor_number ?? ''} onChange={e => set('vendor_number', e.target.value)} placeholder="Vendor #" />
          <Input label="Phone Main" type="tel"
            value={form.phone_main ?? ''} onChange={e => set('phone_main', e.target.value)} placeholder="+1 555 000 0000" />
          <Input label="Additional Phone" type="tel"
            value={form.phone_additional ?? ''} onChange={e => set('phone_additional', e.target.value)} placeholder="+1 555 000 0001" />
        </SectionCard>

        {/* Section 3 — Address Information */}
        <SectionCard title="3. Address Information" accent="bg-purple-50">
          <div className="sm:col-span-2">
            <Input label="Address Line 1"
              value={form.address1 ?? ''} onChange={e => set('address1', e.target.value)} placeholder="Street address" />
          </div>
          <div className="sm:col-span-2">
            <Input label="Address Line 2"
              value={form.address2 ?? ''} onChange={e => set('address2', e.target.value)} placeholder="Apt, suite, unit…" />
          </div>
          <Input label="City"
            value={form.city ?? ''} onChange={e => set('city', e.target.value)} placeholder="City" />
          <Input label="State / Province"
            value={form.state ?? ''} onChange={e => set('state', e.target.value)} placeholder="State" />
          <Select label="Country"
            value={form.country ?? ''} onChange={e => set('country', e.target.value)}
            options={COUNTRIES.map(c => ({ value: c, label: c }))} placeholder="Select country" />
          <Input label="ZIP / Postal Code"
            value={form.zip_code ?? ''} onChange={e => set('zip_code', e.target.value)} placeholder="ZIP code" />
        </SectionCard>

        {/* Section 4 — Additional Information */}
        <SectionCard title="4. Additional Information" accent="bg-orange-50">
          <div className="sm:col-span-2">
            <Input label="Sub Specialisation"
              value={form.sub_specialisation ?? ''} onChange={e => set('sub_specialisation', e.target.value)} placeholder="Specialisation area" />
          </div>
          <Input label="Working Hours"
            value={form.working_hours ?? ''} onChange={e => set('working_hours', e.target.value)} placeholder="e.g. 9am–6pm" />
          <Input label="Contact Hours"
            value={form.contact_hours ?? ''} onChange={e => set('contact_hours', e.target.value)} placeholder="e.g. 10am–4pm" />
        </SectionCard>
      </div>
    </Modal>
  )
}

// ── View Customer Modal ───────────────────────────────────────────────────────
function ViewCustomerModal({ open, onClose, customer, onEdit }: {
  open: boolean; onClose: () => void; customer: Client | null; onEdit: () => void
}) {
  if (!customer) return null

  function Field({ label, value, span2 }: { label: string; value?: string | null; span2?: boolean }) {
    return (
      <div className={span2 ? 'col-span-2' : ''}>
        <p className="text-[10px] font-semibold text-muted uppercase tracking-wide">{label}</p>
        <p className="text-sm text-text mt-0.5 break-words">{value || '—'}</p>
      </div>
    )
  }

  function ViewSection({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
    return (
      <div className="rounded-xl border border-border overflow-hidden">
        <div className={`px-5 py-3 ${accent} border-b border-border`}>
          <h3 className="text-sm font-semibold text-text">{title}</h3>
        </div>
        <div className="p-5 grid grid-cols-2 gap-x-6 gap-y-4">{children}</div>
      </div>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title={`Customer — ${getDisplayName(customer)}`} size="xl"
      footer={
        <>
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted hover:text-text border border-border rounded-lg hover:bg-background transition-colors">
            Close
          </button>
          <Button onClick={onEdit}><Edit2 size={14} /> Edit Customer</Button>
        </>
      }
    >
      <div className="space-y-5">
        <ViewSection title="1. Customer Information" accent="bg-blue-50">
          <Field label="Category Type" value={customer.category_type === 'person' ? 'Person' : 'Organization'} />
          <Field label="Contact Type" value={customer.contact_type} />
          {customer.category_type === 'person' ? (
            <>
              <Field label="First Name" value={customer.first_name} />
              <Field label="Surname" value={customer.surname} />
            </>
          ) : (
            <Field label="Organization Name" value={customer.name_company} span2 />
          )}
          <Field label="Company" value={customer.company} />
          <Field label="Division" value={customer.division} />
          <Field label="Designation" value={customer.designation} />
          <Field label="Department" value={customer.department} />
        </ViewSection>

        <ViewSection title="2. Contact Information" accent="bg-green-50">
          <Field label="Email" value={customer.email} />
          <Field label="Website" value={customer.website} />
          <Field label="Vendor Number" value={customer.vendor_number} />
          <Field label="Phone Main" value={customer.phone_main} />
          <Field label="Additional Phone" value={customer.phone_additional} />
        </ViewSection>

        <ViewSection title="3. Address Information" accent="bg-purple-50">
          <Field label="Address Line 1" value={customer.address1} span2 />
          <Field label="Address Line 2" value={customer.address2} span2 />
          <Field label="City" value={customer.city} />
          <Field label="State / Province" value={customer.state} />
          <Field label="Country" value={customer.country} />
          <Field label="ZIP / Postal Code" value={customer.zip_code} />
        </ViewSection>

        <ViewSection title="4. Additional Information" accent="bg-orange-50">
          <Field label="Sub Specialisation" value={customer.sub_specialisation} span2 />
          <Field label="Working Hours" value={customer.working_hours} />
          <Field label="Contact Hours" value={customer.contact_hours} />
          <Field label="Status" value={customer.active_status ? 'Active' : 'Inactive'} />
          <Field label="Created" value={fmtDate(customer.created_at)} />
        </ViewSection>
      </div>
    </Modal>
  )
}

// ── Sort helpers ──────────────────────────────────────────────────────────────
type SortKey = 'name' | 'company' | 'division' | 'contact_type' | 'country'
type SortDir = 'asc' | 'desc'

function sortClients(list: Client[], key: SortKey, dir: SortDir): Client[] {
  return [...list].sort((a, b) => {
    let va = '', vb = ''
    if (key === 'name')         { va = getDisplayName(a); vb = getDisplayName(b) }
    else if (key === 'company') { va = a.company ?? ''; vb = b.company ?? '' }
    else if (key === 'division'){ va = a.division ?? ''; vb = b.division ?? '' }
    else if (key === 'contact_type') { va = a.contact_type; vb = b.contact_type }
    else if (key === 'country') { va = a.country ?? ''; vb = b.country ?? '' }
    return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
  })
}

function contactBadgeClass(type: string) {
  switch (type.toLowerCase()) {
    case 'customer':   return 'bg-blue-100 text-blue-700 border-blue-200'
    case 'vendor':     return 'bg-purple-100 text-purple-700 border-purple-200'
    case 'partner':    return 'bg-green-100 text-green-700 border-green-200'
    case 'freelancer': return 'bg-orange-100 text-orange-700 border-orange-200'
    default:           return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function CustomerManagement() {
  const navigate = useNavigate()
  const [clients, setClients]     = useState<Client[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [filterType, setFilterType]     = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [filterStatus, setFilterStatus]   = useState('')
  const [sortKey, setSortKey]     = useState<SortKey>('name')
  const [sortDir, setSortDir]     = useState<SortDir>('asc')
  const [page, setPage]           = useState(1)
  const [createOpen, setCreateOpen]     = useState(false)
  const [editCustomer, setEditCustomer] = useState<Client | null>(null)
  const [viewCustomer, setViewCustomer] = useState<Client | null>(null)
  const [confirmItem, setConfirmItem]   = useState<Client | null>(null)
  const [statusLoading, setStatusLoading] = useState<number | null>(null)

  useEffect(() => {
    clientsApi.list()
      .then(setClients)
      .catch(() => toast.error('Failed to load customers'))
      .finally(() => setLoading(false))
  }, [])

  const countryOptions = useMemo(() =>
    [...new Set(clients.map(c => c.country).filter(Boolean) as string[])].sort()
  , [clients])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const rows = clients.filter(c =>
      (!q ||
        getDisplayName(c).toLowerCase().includes(q) ||
        (c.company ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q) ||
        (c.division ?? '').toLowerCase().includes(q)) &&
      (!filterType    || c.contact_type === filterType) &&
      (!filterCountry || c.country === filterCountry) &&
      (!filterStatus  || (filterStatus === 'active' ? c.active_status : !c.active_status))
    )
    return sortClients(rows, sortKey, sortDir)
  }, [clients, search, filterType, filterCountry, filterStatus, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageData   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [search, filterType, filterCountry, filterStatus, sortKey])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronUp size={11} className="opacity-30" />
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="text-primary" />
      : <ChevronDown size={11} className="text-primary" />
  }

  function ColHeader({ label, k }: { label: string; k?: SortKey }) {
    const base = 'px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap'
    if (!k) return <th className={base}>{label}</th>
    return (
      <th className={base}>
        <button onClick={() => toggleSort(k)} className="flex items-center gap-1 hover:text-text transition-colors">
          {label}<SortIcon k={k} />
        </button>
      </th>
    )
  }

  async function handleToggleStatus(c: Client) {
    if (!c.active_status) { await doStatusChange(c, true) }
    else setConfirmItem(c)
  }

  async function doStatusChange(c: Client, status: boolean) {
    setStatusLoading(c.id)
    try {
      const updated = await clientsApi.setStatus(c.id, status)
      setClients(cs => cs.map(x => x.id === updated.id ? updated : x))
      toast.success(`${getDisplayName(updated)} is now ${status ? 'active' : 'inactive'}`)
    } catch { toast.error('Failed to update status') }
    finally   { setStatusLoading(null) }
  }

  function handleSaved(c: Client, mode: 'create' | 'edit') {
    setClients(cs => mode === 'create' ? [c, ...cs] : cs.map(x => x.id === c.id ? c : x))
    setEditCustomer(null)
  }

  const hasFilters = !!(search || filterType || filterCountry || filterStatus)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/settings')}
          className="p-2 rounded-lg hover:bg-card border border-transparent hover:border-border text-muted hover:text-text transition-all">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-text">Customer Management</h2>
          <p className="text-xs text-muted mt-0.5">{clients.length} total customers</p>
        </div>
        <button onClick={() => exportCSV(filtered)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border text-muted hover:text-text hover:border-primary/40 rounded-lg transition-colors">
          <Download size={13} /> Export
        </button>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={15} /> Create Customer
        </Button>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex gap-3 items-center">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, company, email or division…"
              className="w-full pl-9 pr-4 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-text placeholder:text-muted" />
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Filter size={13} className="text-muted" />
            <span className="text-xs text-muted font-medium">Filters:</span>
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30 w-[140px]">
            <option value="">All Types</option>
            {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30 w-[150px]">
            <option value="">All Countries</option>
            {countryOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30 w-[130px]">
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button
            onClick={() => { setSearch(''); setFilterType(''); setFilterCountry(''); setFilterStatus('') }}
            className={`flex items-center gap-1 text-xs text-danger hover:underline transition-opacity flex-shrink-0 ${hasFilters ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'}`}>
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
                  <ColHeader label="Customer Name" k="name" />
                  <ColHeader label="Company"       k="company" />
                  <ColHeader label="Division"      k="division" />
                  <ColHeader label="Contact Type"  k="contact_type" />
                  <ColHeader label="Email" />
                  <ColHeader label="Phone" />
                  <ColHeader label="Country"       k="country" />
                  <ColHeader label="Status" />
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageData.length === 0 ? (
                  <>
                    <tr><td colSpan={9} className="px-4 py-12 text-center text-muted text-sm">No customers found</td></tr>
                    {Array.from({ length: PAGE_SIZE - 1 }).map((_, i) => (
                      <tr key={`ep-${i}`}><td colSpan={9} className="py-[22px]" /></tr>
                    ))}
                  </>
                ) : (
                  <>
                    {pageData.map(c => (
                      <tr key={c.id} className="hover:bg-background/60 transition-colors">
                        {/* Name */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                              style={{
                                backgroundColor: c.category_type === 'person'
                                  ? 'color-mix(in srgb, var(--color-primary) 12%, white)'
                                  : 'color-mix(in srgb, var(--color-success) 12%, white)',
                                color: c.category_type === 'person'
                                  ? 'var(--color-primary)'
                                  : 'var(--color-success)',
                              }}
                            >
                              {c.category_type === 'person'
                                ? getDisplayName(c).charAt(0).toUpperCase()
                                : <Building2 size={14} />}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-text truncate max-w-[130px]">{getDisplayName(c)}</p>
                              <p className="text-[10px] text-muted capitalize">{c.category_type}</p>
                            </div>
                          </div>
                        </td>
                        {/* Company */}
                        <td className="px-4 py-3 text-text">
                          <p className="truncate max-w-[120px] text-sm">{c.company || '—'}</p>
                        </td>
                        {/* Division */}
                        <td className="px-4 py-3">
                          <span className="text-[11px] font-mono bg-background border border-border px-2 py-0.5 rounded">
                            {c.division || '—'}
                          </span>
                        </td>
                        {/* Contact Type */}
                        <td className="px-4 py-3">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${contactBadgeClass(c.contact_type)}`}>
                            {c.contact_type}
                          </span>
                        </td>
                        {/* Email */}
                        <td className="px-4 py-3 text-muted">
                          <p className="truncate max-w-[150px] text-xs">{c.email || '—'}</p>
                        </td>
                        {/* Phone */}
                        <td className="px-4 py-3 text-muted text-xs whitespace-nowrap">{c.phone_main || '—'}</td>
                        {/* Country */}
                        <td className="px-4 py-3 text-text text-xs">{c.country || '—'}</td>
                        {/* Status */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {statusLoading === c.id
                              ? <Spinner size="sm" />
                              : <Toggle checked={c.active_status} onChange={() => handleToggleStatus(c)} />}
                            <span className={`text-xs font-medium ${c.active_status ? 'text-success' : 'text-muted'}`}>
                              {c.active_status ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </td>
                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => setViewCustomer(c)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted bg-surface rounded-lg hover:bg-border transition-colors">
                              <Eye size={12} /> View
                            </button>
                            <button onClick={() => setEditCustomer(c)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-accent rounded-lg hover:bg-primary hover:text-white transition-colors">
                              <Edit2 size={12} /> Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {Array.from({ length: PAGE_SIZE - pageData.length }).map((_, i) => (
                      <tr key={`pp-${i}`}><td colSpan={9} className="py-[22px]" /></tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>

            {/* Pagination — always rendered */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <p className="text-xs text-muted">
                Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} customers
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
      <CustomerFormModal
        open={createOpen} onClose={() => setCreateOpen(false)}
        onSaved={handleSaved} clients={clients} />
      <CustomerFormModal
        open={!!editCustomer} onClose={() => setEditCustomer(null)}
        onSaved={handleSaved} clients={clients} editCustomer={editCustomer} />
      <ViewCustomerModal
        open={!!viewCustomer} onClose={() => setViewCustomer(null)}
        customer={viewCustomer}
        onEdit={() => { setEditCustomer(viewCustomer); setViewCustomer(null) }} />
      <ConfirmDialog
        open={!!confirmItem} onClose={() => setConfirmItem(null)}
        onConfirm={async () => { if (confirmItem) { await doStatusChange(confirmItem, false); setConfirmItem(null) } }}
        title="Deactivate Customer"
        message={`Deactivate "${confirmItem ? getDisplayName(confirmItem) : ''}"? They will be hidden from active lists.`}
        confirmLabel="Deactivate" />
    </div>
  )
}
