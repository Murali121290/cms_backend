import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw, ChevronRight, ArrowLeft, XCircle, Upload, CheckCircle2, Layers, AlertCircle, User, Search, Filter, FolderOpen, Trash2, Download } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { xmlConversionApi } from '@/api/xmlConversion'
import { usersApi } from '@/api/users'
import { Button } from '@/components/ui/Button'
import { toast } from '@/store/useToastStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useRBAC } from '@/hooks/useRBAC'
import { Modal } from '@/components/ui/Modal'

// ── Assignee Dropdown ────────────────────────────────────────────────────────

function AssigneeDropdown({
  value,
  onChange,
  users,
}: {
  value: string;
  onChange: (val: string) => void;
  users: any[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', onClickOutside);
    if (!isOpen) setSearchQuery('');
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isOpen]);

  const activeUsers = users.filter((u) => u.active_status);

  const filteredUsers = activeUsers.filter((u) => {
    if (!searchQuery) return true;
    const display = u.first_name || u.last_name
      ? `${u.first_name || ''} ${u.last_name || ''}`.trim()
      : u.user_name;
    return display.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const currentLabel = (() => {
    if (!value) return '— Unassigned —';
    const u = activeUsers.find((u) => u.user_name === value);
    if (!u) return value;
    return u.first_name || u.last_name
      ? `${u.first_name || ''} ${u.last_name || ''}`.trim()
      : u.user_name;
  })();

  return (
    <div className="relative flex items-center" ref={popoverRef}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setIsOpen((prev) => !prev); }}
        className={`flex items-center justify-between min-w-[130px] max-w-[200px] text-[11px] bg-transparent border rounded-md pl-2 pr-6 py-0.5 text-primary font-medium focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors relative ${isOpen ? 'border-primary ring-1 ring-primary/40' : 'border-transparent hover:border-border'
          } cursor-pointer`}
        title={currentLabel}
      >
        <span className="truncate leading-tight block w-full text-left">{currentLabel}</span>
        <span
          className="pointer-events-none absolute right-1.5 text-muted transition-transform duration-200 flex-shrink-0 text-[9px]"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
        >▾</span>
      </button>

      {isOpen && (
        <div className="absolute top-[calc(100%+6px)] left-0 min-w-[200px] w-max max-w-[260px] bg-card border border-border shadow-[0_12px_40px_-8px_rgba(0,0,0,0.18)] rounded-xl py-1.5 z-[200] max-h-72 flex flex-col backdrop-blur-3xl ring-1 ring-black/5">
          <div className="px-1.5 pb-1 mb-1 border-b border-border/50 shrink-0 space-y-1">
            <div className="relative px-1 pt-1 pb-1">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search assignee..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-muted/50 border-none text-[11px] rounded-md pl-6 pr-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground rounded-md transition-all flex items-center gap-2 group"
              onClick={(e) => { e.stopPropagation(); setIsOpen(false); if (value !== '') onChange(''); }}
            >
              <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${value === '' ? 'text-primary' : 'text-transparent'}`}>
                {value === '' && <CheckCircle2 size={12} strokeWidth={3} />}
              </div>
              <span className="group-hover:translate-x-0.5 transition-transform duration-200">— Unassigned —</span>
            </button>
          </div>
          <div className="px-1.5 flex flex-col gap-0.5 overflow-y-auto">
            {filteredUsers.length === 0 ? (
              <div className="text-[11px] text-muted-foreground px-2.5 py-3 text-center">No results found</div>
            ) : (
              filteredUsers.map((u) => {
                const label = u.first_name || u.last_name
                  ? `${u.first_name || ''} ${u.last_name || ''}`.trim()
                  : u.user_name;
                const isSelected = value === u.user_name;
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={`w-full text-left px-2.5 py-1.5 text-[11px] transition-all rounded-md flex items-center gap-2 group ${isSelected ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-muted/40'
                      }`}
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); if (value !== u.user_name) onChange(u.user_name); }}
                  >
                    <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'text-primary' : 'text-transparent'}`}>
                      {isSelected && <CheckCircle2 size={12} strokeWidth={3} />}
                      {!isSelected && <User size={12} strokeWidth={2} className="opacity-0 group-hover:opacity-40 text-muted-foreground transition-opacity" />}
                    </div>
                    <span className={`truncate transition-transform duration-200 ${!isSelected && 'group-hover:translate-x-0.5'}`}>{label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PostProdXmlConversion() {
  useDocumentTitle('XML Conversion — S4Carlisle CMS')
  const navigate = useNavigate()
  const viewer = useSessionStore((s) => s.viewer)
  const { isTeamLead } = useRBAC()

  const [projects, setProjects] = useState<any[]>([])
  const [clients, setClients] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])

  // Form states
  const [showAddProjectModal, setShowAddProjectModal] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [clientCode, setClientCode] = useState('')
  const [projectName, setProjectName] = useState('')
  const [targetFormat, setTargetFormat] = useState('JATS')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [projectToDelete, setProjectToDelete] = useState<number | null>(null)

  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')

  const fetchProjects = async () => {
    try {
      const data = await xmlConversionApi.getProjects()
      setProjects(data)
    } catch (err) {
      console.error('Failed to fetch projects', err)
    }
  }

  const fetchClients = async () => {
    try {
      const res = await fetch('/api/v2/clients/active')
      if (res.ok) {
        const data = await res.json()
        setClients(data)
      }
    } catch (err) {
      console.error('Failed to fetch clients', err)
    }
  }

  const fetchUsers = async () => {
    try {
      const uList = await usersApi.list()
      setUsers(uList)
    } catch (err) {
      console.error('Failed to fetch users', err)
    }
  }

  useEffect(() => {
    fetchProjects()
    fetchClients()
    fetchUsers()
    const timer = setInterval(() => {
      fetchProjects()
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientCode || !projectName || !pdfFile) return

    setUploading(true)
    setErrorMsg(null)

    try {
      await xmlConversionApi.createProject(clientCode, projectName, targetFormat, pdfFile)

      setCustomerName('')
      setClientCode('')
      setProjectName('')
      setPdfFile(null)
      setShowAddProjectModal(false)
      toast.success('Project created successfully')
      await fetchProjects()
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during project creation.')
    } finally {
      setUploading(false)
    }
  }

  const handleConvert = async (e: React.MouseEvent, projectId: number) => {
    e.stopPropagation()
    try {
      await xmlConversionApi.triggerConversion(projectId)
      toast.success('Conversion started')
      fetchProjects()
    } catch (err) {
      toast.error('Failed to trigger conversion')
    }
  }

  const handleDelete = async () => {
    if (!projectToDelete) return
    try {
      const res = await fetch(`/api/v2/post-prod/xml-conversion/projects/${projectToDelete}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        toast.success('Project deleted successfully')
        fetchProjects()
      } else {
        const data = await res.json()
        toast.error(data.detail || 'Failed to delete project')
      }
    } catch (err) {
      toast.error('An error occurred while deleting project')
    } finally {
      setProjectToDelete(null)
    }
  }

  const handleDownload = async (e: React.MouseEvent, projectId: number, filename: string, format: string) => {
    e.stopPropagation()
    try {
      const blob = await xmlConversionApi.downloadConvertedXml(projectId)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename.replace('.pdf', `.${format.toLowerCase()}.xml`)
      a.click()
    } catch (err) {
      toast.error('Download failed')
    }
  }

  const handleAssigneeChange = async (projectId: number, newAssignee: string) => {
    try {
      const res = await fetch(`/api/v2/post-prod/xml-conversion/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee: newAssignee })
      })
      if (res.ok) {
        if (newAssignee) {
          const matchedUser = users.find((u) => u.user_name === newAssignee);
          const displayName = matchedUser?.first_name || matchedUser?.last_name
            ? `${matchedUser.first_name || ''} ${matchedUser.last_name || ''}`.trim()
            : newAssignee;
          toast.success(`Assigned to ${displayName} successfully`)
        } else {
          toast.success('Unassigned successfully')
        }
        fetchProjects()
      } else {
        toast.error('Failed to update assignee')
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to update assignee')
    }
  }

  // Calculate metrics
  const totalProjects = projects.length
  const completedProjects = projects.filter(p => p.conversion_status === 'Completed').length
  const completionPercentage = totalProjects > 0 ? Math.round((completedProjects / totalProjects) * 100) : 0

  // Filter options
  const statusOptions = Array.from(new Set(projects.map(p => p.conversion_status).filter(Boolean))).sort()
  const assigneeOptions = Array.from(new Set(projects.map(p => p.assignee).filter((a): a is string => !!a))).sort()

  const filteredProjects = projects.filter(p => {
    const query = searchQuery.trim().toLowerCase()
    const matchesSearch = !query
      || p.project_name.toLowerCase().includes(query)
      || p.client_code.toLowerCase().includes(query)
      || p.filename?.toLowerCase().includes(query)

    const projStatus = p.conversion_status || 'YTS'
    const matchesStatus = statusFilter === 'all' || projStatus === statusFilter
    const matchesAssignee = assigneeFilter === 'all'
      || (assigneeFilter === 'unassigned' ? !p.assignee : p.assignee === assigneeFilter)

    return matchesSearch && matchesStatus && matchesAssignee
  })

  const hasActiveFilters = searchQuery.trim() !== '' || statusFilter !== 'all' || assigneeFilter !== 'all'
  const clearFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setAssigneeFilter('all')
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6 text-text">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/post-production')}
            className="p-2 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent rounded-lg">
              <FolderOpen size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold font-serif text-text m-0">XML Conversion</h1>
              <p className="text-sm text-muted">
                {totalProjects} project{totalProjects !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
        {isTeamLead && (
          <Button onClick={() => setShowAddProjectModal(true)} leftIcon={<Plus size={15} />}>
            Create Project
          </Button>
        )}
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border/70 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-primary/10 text-primary rounded-lg">
            <Layers size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Total Projects</span>
            <span className="text-lg font-bold text-text">{totalProjects}</span>
          </div>
        </div>

        <div className="bg-card border border-border/70 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-lg">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Fully Completed</span>
            <span className="text-lg font-bold text-text">{completedProjects} <span className="text-xs font-normal text-muted">projects</span></span>
          </div>
        </div>

        <div className="bg-card border border-border/70 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg">
            <RefreshCw size={18} className={projects.some(p => p.history?.some((h: any) => h.conversion_status === 'Processing')) ? 'animate-spin' : ''} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Overall Progress</span>
            <span className="text-lg font-bold text-text">{completionPercentage}% <span className="text-xs font-normal text-muted">({completedProjects}/{totalProjects} proj)</span></span>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      {projects.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by project or customer…"
              className="w-full bg-card border border-border rounded-lg pl-8 pr-3 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors placeholder:text-muted/50"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter size={13} className="text-muted shrink-0" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-card border border-border rounded-lg px-2.5 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors"
            >
              <option value="all">All statuses</option>
              {statusOptions.map((s: any) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <select
              value={assigneeFilter}
              onChange={e => setAssigneeFilter(e.target.value)}
              className="bg-card border border-border rounded-lg px-2.5 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors"
            >
              <option value="all">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {assigneeOptions.map(a => {
                const matchedUser = users.find((u) => u.user_name === a);
                const displayName = matchedUser?.first_name || matchedUser?.last_name
                  ? `${matchedUser.first_name || ''} ${matchedUser.last_name || ''}`.trim()
                  : a;
                return (
                  <option key={a} value={a}>
                    {displayName}
                  </option>
                );
              })}
            </select>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-primary hover:underline font-semibold whitespace-nowrap"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Grid listing of all active projects */}
      {projects.length === 0 ? (
        <div className="text-center py-16 text-muted border border-dashed border-border rounded-xl bg-card/10">
          <p className="text-xs font-medium">No projects added yet</p>
          <button
            onClick={() => setShowAddProjectModal(true)}
            className="mt-2 text-xs text-primary hover:underline font-bold"
          >
            Create first project
          </button>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-16 text-muted border border-dashed border-border rounded-xl bg-card/10">
          <p className="text-xs font-medium">No projects match the current filters</p>
          <button
            onClick={clearFilters}
            className="mt-2 text-xs text-primary hover:underline font-bold"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredProjects.map((proj) => {
            const status = proj.conversion_status || 'YTS'
            const isCompleted = status === 'Completed'
            const isProcessing = status === 'Processing'
            const completedStages = [proj.raw_xml_status, proj.final_xml_status, proj.qc_status].filter(s => s === 'Completed').length
            const percent = Math.round((completedStages / 3) * 100)

            return (
              <div
                key={proj.id}
                onClick={() => {
                  const assigned = (proj.assignee || '').trim().toLowerCase()
                  const myUsername = (viewer?.username || '').trim().toLowerCase()
                  if (!assigned) {
                    toast.error('This project is not assigned to anyone. Assign it to open it.')
                    return
                  }
                  if (myUsername && assigned !== myUsername) {
                    const assignedUser = users.find((u: any) =>
                      (u.user_name || '').toLowerCase() === assigned ||
                      String(u.id) === assigned
                    )
                    const assigneeName = assignedUser
                      ? ((assignedUser.first_name || assignedUser.last_name)
                        ? `${assignedUser.first_name || ''} ${assignedUser.last_name || ''}`.trim()
                        : assignedUser.user_name)
                      : proj.assignee
                    toast.error(`This project is assigned to ${assigneeName}. You cannot open it.`)
                    return
                  }
                  navigate(`/post-production/xml-conversion/${proj.id}`)
                }}
                className="p-4 rounded-xl border bg-card border-border shadow-sm hover:shadow-md hover:border-primary/50 transition-all duration-300 flex flex-col justify-between cursor-pointer group"
              >
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm text-text truncate m-0 group-hover:text-primary transition-colors" title={proj.project_name}>{proj.project_name}</h3>
                      <p className="text-[11px] text-muted mt-0.5">{proj.client_code}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isTeamLead && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setProjectToDelete(proj.id) }}
                          className="text-muted hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30"
                          title="Delete Project"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}

                      {isCompleted && (
                        <button
                          onClick={(e) => handleDownload(e, proj.id, proj.filename, proj.target_format)}
                          className="p-1.5 text-green-600 hover:bg-green-500/10 rounded transition-colors"
                          title="Download XML"
                        >
                          <Download size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1 text-muted" onClick={(e) => e.stopPropagation()}>
                      <User size={12} className="text-muted/70 shrink-0" />
                      <AssigneeDropdown
                        value={proj.assignee || ''}
                        onChange={(val) => handleAssigneeChange(proj.id, val)}
                        users={users}
                      />
                    </div>
                    <span className={`capitalize font-bold px-2 py-0.5 rounded-md text-[9px] border ${isCompleted
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      : isProcessing
                        ? 'bg-blue-500/10 border-blue-500/20 text-blue-500'
                        : status === 'Failed'
                          ? 'bg-red-500/10 border-red-500/20 text-red-500'
                          : 'bg-primary/10 border-primary/20 text-primary'
                      }`}>
                      {status}
                    </span>
                  </div>

                  {/* Progress bar visual indicator */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10px] text-muted font-bold mb-1">
                      <span>Progress</span>
                      <span>{completedStages}/3 Stages</span>
                    </div>
                    <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 rounded-full ${status === 'Failed' ? 'bg-red-500' : 'bg-primary'}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  {status === 'Failed' && (
                    <p className="mt-2 text-[10px] text-red-500 truncate" title="Conversion failed">
                      Conversion failed
                    </p>
                  )}
                </div>

                <div className="mt-4 pt-2.5 border-t border-border/60 flex items-center justify-between text-[10px] text-muted font-medium">
                  <span>Created: {new Date(proj.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</span>
                  <span>{percent}% Done</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add Project Modal */}
      {showAddProjectModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-5 shadow-xl space-y-4">
            <div className="flex justify-between items-start border-b border-border/60 pb-2">
              <div>
                <h3 className="text-base font-bold text-text m-0">Add New Project</h3>
                <p className="text-[10px] text-muted mt-0.5">Upload a PDF file for XML conversion</p>
              </div>
              <button
                onClick={() => {
                  setShowAddProjectModal(false)
                  setErrorMsg(null)
                }}
                className="text-muted hover:text-text transition-colors p-1"
              >
                <XCircle size={18} />
              </button>
            </div>

            {errorMsg && (
              <div className="p-2.5 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-lg text-xs flex items-center gap-1.5">
                <AlertCircle size={14} className="shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleAddProject} className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Client Name</label>
                <select
                  value={customerName}
                  onChange={e => {
                    const selectedVal = e.target.value;
                    setCustomerName(selectedVal);
                    const matched = clients.find(c => c.company === selectedVal);
                    if (matched && matched.division) {
                      setClientCode(matched.division);
                    } else {
                      setClientCode('');
                    }
                  }}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors"
                  required
                >
                  <option value="">Select Client</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.company}>{c.company}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Client Code</label>
                <input
                  type="text"
                  value={clientCode}
                  onChange={e => setClientCode(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors placeholder:text-muted/40"
                  placeholder="e.g. BIO101"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Project Name</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors placeholder:text-muted/40"
                  placeholder="e.g. Biology Vol 2"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Upload Source PDF</label>
                <div className="border border-dashed border-border hover:border-primary/60 rounded-lg p-5 text-center cursor-pointer transition-colors bg-background/50">
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={e => e.target.files && setPdfFile(e.target.files[0])}
                    className="hidden"
                    id="pdf-upload"
                    required
                  />
                  <label htmlFor="pdf-upload" className="cursor-pointer space-y-1.5 block">
                    <Upload className="mx-auto text-muted/80" size={22} />
                    <p className="text-xs font-semibold text-text">Click to choose PDF Document</p>
                    <p className="text-[9px] text-muted">Supports .pdf files</p>
                  </label>
                </div>
                {pdfFile && (
                  <div className="mt-2 bg-background border border-border rounded-lg p-2 text-xs text-muted flex items-center justify-between">
                    <span className="truncate max-w-[280px] font-medium text-text">{pdfFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setPdfFile(null)}
                      className="text-red-600 hover:text-red-500 font-bold text-[10px]"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddProjectModal(false)
                    setErrorMsg(null)
                  }}
                  className="px-3.5 py-1.5 bg-background border border-border hover:bg-accent text-text font-bold rounded-lg transition-colors text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !clientCode || !projectName || !pdfFile}
                  className="px-3.5 py-1.5 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/95 transition-colors disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5 text-xs"
                >
                  {uploading ? 'Uploading...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <Modal
        isOpen={projectToDelete !== null}
        onClose={() => setProjectToDelete(null)}
        onConfirm={handleDelete}
        title="Delete Project"
        description="Are you sure you want to delete this project? This action cannot be undone."
        confirmLabel="Delete"
      />
    </div>
  )
}
