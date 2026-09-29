import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw, ChevronRight, ArrowLeft, XCircle, Upload, CheckCircle2, Layers, AlertCircle, User, Search, Filter, FolderOpen, ArrowRight, Trash2, LayoutGrid, List, Clock } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useRBAC } from '@/hooks/useRBAC'
import { useSessionStore } from '@/stores/sessionStore'
import { usersApi } from '@/api/users'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { toast } from '@/store/useToastStore'
import api from '@/api/client'

export function BodInternalPage() {
  useDocumentTitle('Books on Demand — S4Carlisle CMS')
  const navigate = useNavigate()
  const { isAdmin, isManager } = useRBAC()
  const viewer = useSessionStore(s => s.viewer)

  const [jobs, setJobs] = useState<any[]>([])
  const [clients, setClients] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])

  // Form states
  const [showAddJobModal, setShowAddJobModal] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [stageFilter, setStageFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')

  // Delete Modal states
  const [showDeleteModal, setShowDeleteModal] = useState<number | null>(null)

  // Edit Due Date Modal states
  const [showEditDueDateModal, setShowEditDueDateModal] = useState<any>(null)
  const [newDueDate, setNewDueDate] = useState('')
  const [dueDateReason, setDueDateReason] = useState('')
  const [savingDueDate, setSavingDueDate] = useState(false)

  const fetchJobs = async () => {
    try {
      const { data } = await api.get('/bod/jobs')
      setJobs(data)
    } catch (err) {
      console.error('Failed to fetch jobs', err)
    }
  }

  const fetchClients = async () => {
    try {
      const { data } = await api.get('/bod/configs')
      setClients(data)
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
    fetchJobs()
    fetchClients()
    fetchUsers()
    const timer = setInterval(() => {
      fetchJobs()
    }, 5000)
    return () => clearInterval(timer)
  }, [])
  const handleJobClick = (job: any) => {
    const assigned = (job.current_assignee || '').trim().toLowerCase()
    const myUsername = (viewer?.username || '').trim().toLowerCase()

    if (!assigned) {
      toast.error('This job is not assigned to anyone. Assign it to open it.')
      return
    }

    if (assigned && myUsername && assigned !== myUsername) {
      toast.error(`This job is assigned to ${getUserDisplayName(job.current_assignee)}. You cannot open it.`)
      return
    }

    navigate(`/bod/internal/${job.id}`)
  }

  const handleAddJob = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedClientId || !pdfFile) return

    setUploading(true)
    setErrorMsg(null)
    const formData = new FormData()
    formData.append('client_id', selectedClientId)
    formData.append('file', pdfFile)

    try {
      await api.post('/bod/jobs', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success("Job created successfully")

      setSelectedClientId('')
      setPdfFile(null)
      setShowAddJobModal(false)
      fetchJobs()
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to create job')
    } finally {
      setUploading(false)
    }
  }



  const assignUser = async (jobId: number, username: string) => {
    try {
      await api.post(`/bod/jobs/${jobId}/assign`, { user_id: username })
      toast.success("User assigned")
      fetchJobs()
    } catch (err) {
      toast.error("Failed to assign user")
    }
  }

  const deleteJob = async (jobId: number) => {
    try {
      await api.delete(`/bod/jobs/${jobId}`)
      toast.success("Job deleted successfully")
      setShowDeleteModal(null)
      fetchJobs()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to delete job")
    }
  }

  const updateDueDate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!showEditDueDateModal || !newDueDate || !dueDateReason) return
    setSavingDueDate(true)
    try {
      // Create a local date at 23:59:59, then convert to UTC ISO string
      const localDate = new Date(`${newDueDate}T23:59:59`)
      const finalDate = localDate.toISOString()

      await api.put(`/bod/jobs/${showEditDueDateModal.id}/due-date`, {
        due_date: finalDate,
        reason: dueDateReason
      })
      toast.success("Due date updated")
      setShowEditDueDateModal(null)
      fetchJobs()
    } catch (err) {
      toast.error("Failed to update due date")
    } finally {
      setSavingDueDate(false)
    }
  }

  // Calculate metrics
  const totalJobs = jobs.length
  const completedJobs = jobs.filter(j => j.status === 'Completed').length
  const activeJobs = jobs.filter(j => j.status === 'Active')

  const unassignedJobs = activeJobs.filter(j => !j.current_assignee).length
  const addJobStageJobs = activeJobs.filter(j => j.current_stage_name === 'Add job').length
  const productionStageJobs = activeJobs.filter(j => j.current_stage_name === 'Production').length
  const qcStageJobs = activeJobs.filter(j => j.current_stage_name === 'QC').length

  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)

  let overdueJobs = 0
  let dueSoonJobs = 0

  activeJobs.forEach(job => {
    if (job.due_date) {
      const dueDate = new Date(job.due_date.endsWith('Z') ? job.due_date : job.due_date + 'Z')
      dueDate.setHours(0, 0, 0, 0)
      if (dueDate < now) overdueJobs++
      else if (dueDate.getTime() === tomorrow.getTime()) dueSoonJobs++
    }
  })

  // Progress calculations: assume 4 stages (0,1,2,3). If completed, 100%
  let totalProgressStages = jobs.length * 3
  let completedProgressStages = jobs.reduce((acc, job) => {
    if (job.status === 'Completed') return acc + 3
    return acc + Math.min(job.current_stage_index, 3)
  }, 0)

  const completionPercentage = totalProgressStages > 0 ? Math.round((completedProgressStages / totalProgressStages) * 100) : 0

  // Filter options
  const statusOptions = ['Active', 'In-Progress', 'YTS', 'Due Soon', 'Overdue', 'Completed']

  const getUserDisplayName = (username: string | null | undefined) => {
    if (!username) return ''
    if (!users || users.length === 0) return username
    const u = users.find(user => user.user_name === username)
    if (u && u.first_name) {
      return `${u.first_name} ${u.last_name || ''}`.trim()
    }
    return username
  }

  const getStatusBadgeClass = (job: any) => {
    if (job.status === 'Completed') return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'

    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)

    if (job.due_date && job.status !== 'Completed') {
      const dueDate = new Date(job.due_date.endsWith('Z') ? job.due_date : job.due_date + 'Z')
      dueDate.setHours(0, 0, 0, 0)

      if (dueDate < now) {
        return 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
      }
      if (dueDate.getTime() === tomorrow.getTime()) {
        return 'bg-orange-500/10 border-orange-500/20 text-orange-600 dark:text-orange-400'
      }
    }

    if (job.created_at && job.status !== 'Completed') {
      const createdDate = new Date(job.created_at.endsWith('Z') ? job.created_at : job.created_at + 'Z')
      createdDate.setHours(0, 0, 0, 0)
      if (createdDate.getTime() === now.getTime()) {
        return 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400'
      }
    }

    return 'bg-primary/10 border-primary/20 text-primary'
  }

  const getStatusText = (job: any) => {
    if (job.status === 'Completed') return 'Completed'

    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)

    if (job.due_date && job.status !== 'Completed') {
      const dueDate = new Date(job.due_date.endsWith('Z') ? job.due_date : job.due_date + 'Z')
      dueDate.setHours(0, 0, 0, 0)

      if (dueDate < now) {
        return 'Overdue'
      }
      if (dueDate.getTime() === tomorrow.getTime()) {
        return 'Due Soon'
      }
    }

    if (job.created_at && job.status !== 'Completed') {
      const createdDate = new Date(job.created_at.endsWith('Z') ? job.created_at : job.created_at + 'Z')
      createdDate.setHours(0, 0, 0, 0)
      if (createdDate.getTime() === now.getTime()) {
        return 'Active'
      }
    }

    if (!job.current_assignee) {
      return 'YTS'
    }

    return 'In-Progress'
  }


  const allAssignees = new Set<string>()
  jobs.forEach(j => {
    if (j.current_assignee) {
      allAssignees.add(j.current_assignee)
    }
  })
  const assigneeOptions = Array.from(allAssignees).sort()

  const filteredJobs = jobs.filter(j => {
    const query = searchQuery.trim().toLowerCase()
    const matchesSearch = !query
      || j.pdf_filename.toLowerCase().includes(query)
      || (j.client_name && j.client_name.toLowerCase().includes(query))

    let matchesStatus = true
    if (statusFilter !== 'all') {
      matchesStatus = getStatusText(j) === statusFilter
    }

    const currentAssignee = j.current_assignee || null
    const matchesAssignee = assigneeFilter === 'all'
      || (assigneeFilter === 'unassigned' ? !currentAssignee : currentAssignee === assigneeFilter)

    const matchesStage = stageFilter === 'all' || j.current_stage_name === stageFilter

    return matchesSearch && matchesStatus && matchesAssignee && matchesStage
  }).sort((a, b) => {
    const aIsCompleted = a.status === 'Completed'
    const bIsCompleted = b.status === 'Completed'
    if (aIsCompleted && !bIsCompleted) return 1
    if (!aIsCompleted && bIsCompleted) return -1

    // Both active
    if (!aIsCompleted && !bIsCompleted) {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    }

    // Both completed
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const hasActiveFilters = searchQuery.trim() !== '' || statusFilter !== 'all' || assigneeFilter !== 'all' || stageFilter !== 'all'
  const clearFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setAssigneeFilter('all')
    setStageFilter('all')
  }

  return (
    <div className="space-y-6 w-full mx-auto p-6 text-text">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/bod/report')}
            className="p-1.5 text-muted hover:text-text hover:bg-white/5 rounded-md transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent rounded-lg">
              <FolderOpen size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold font-serif text-text m-0">Books on Demand</h1>
              <p className="text-sm text-muted">
                {totalJobs} job{totalJobs !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => setShowAddJobModal(true)} leftIcon={<Plus size={15} />}>
            Create Job
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
        <div
          onClick={clearFilters}
          className={`bg-card border rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-colors ${!hasActiveFilters ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border/70 hover:border-primary/30'}`}
        >
          <div className="p-2 bg-primary/10 text-primary rounded-lg hidden xl:block">
            <Layers size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Total</span>
            <span className="text-lg font-bold text-text">{totalJobs}</span>
          </div>
        </div>

        <div
          onClick={() => { clearFilters(); setAssigneeFilter('unassigned') }}
          className={`bg-card border rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-colors ${assigneeFilter === 'unassigned' ? 'border-rose-500/50 ring-1 ring-rose-500/20' : 'border-border/70 hover:border-rose-500/30'}`}
        >
          <div className="p-2 bg-rose-500/10 text-rose-600 rounded-lg hidden xl:block">
            <User size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Unassigned</span>
            <span className="text-lg font-bold text-text">{unassignedJobs}</span>
          </div>
        </div>

        <div
          onClick={() => { clearFilters(); setStageFilter('Add job') }}
          className={`bg-card border rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-colors ${stageFilter === 'Add job' ? 'border-amber-500/50 ring-1 ring-amber-500/20' : 'border-border/70 hover:border-amber-500/30'}`}
        >
          <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg hidden xl:block">
            <RefreshCw size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Add Job</span>
            <span className="text-lg font-bold text-text">{addJobStageJobs}</span>
          </div>
        </div>

        <div
          onClick={() => { clearFilters(); setStageFilter('Production') }}
          className={`bg-card border rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-colors ${stageFilter === 'Production' ? 'border-purple-500/50 ring-1 ring-purple-500/20' : 'border-border/70 hover:border-purple-500/30'}`}
        >
          <div className="p-2 bg-purple-500/10 text-purple-600 rounded-lg hidden xl:block">
            <RefreshCw size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Production</span>
            <span className="text-lg font-bold text-text">{productionStageJobs}</span>
          </div>
        </div>

        <div
          onClick={() => { clearFilters(); setStageFilter('QC') }}
          className={`bg-card border rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-colors ${stageFilter === 'QC' ? 'border-blue-500/50 ring-1 ring-blue-500/20' : 'border-border/70 hover:border-blue-500/30'}`}
        >
          <div className="p-2 bg-blue-500/10 text-blue-600 rounded-lg hidden xl:block">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">QC</span>
            <span className="text-lg font-bold text-text">{qcStageJobs}</span>
          </div>
        </div>

        <div
          onClick={() => { clearFilters(); setStatusFilter('Overdue') }}
          className={`bg-card border rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-colors ${statusFilter === 'Overdue' ? 'border-red-500/50 ring-1 ring-red-500/20' : 'border-border/70 hover:border-red-500/30'}`}
        >
          <div className="p-2 bg-red-500/10 text-red-600 rounded-lg hidden xl:block">
            <Clock size={18} />
          </div>
          <div>
            <span className="text-[10px] text-red-500 font-bold uppercase tracking-wider block">Overdue</span>
            <span className="text-lg font-bold text-text">{overdueJobs}</span>
          </div>
        </div>

        <div
          onClick={() => { clearFilters(); setStatusFilter('Due Soon') }}
          className={`bg-card border rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-colors ${statusFilter === 'Due Soon' ? 'border-orange-500/50 ring-1 ring-orange-500/20' : 'border-border/70 hover:border-orange-500/30'}`}
        >
          <div className="p-2 bg-orange-500/10 text-orange-600 rounded-lg hidden xl:block">
            <Clock size={18} />
          </div>
          <div>
            <span className="text-[10px] text-orange-500 font-bold uppercase tracking-wider block">Due Soon</span>
            <span className="text-lg font-bold text-text">{dueSoonJobs}</span>
          </div>
        </div>

        <div
          onClick={() => { clearFilters(); setStatusFilter('Completed') }}
          className={`bg-card border rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-colors ${statusFilter === 'Completed' ? 'border-emerald-500/50 ring-1 ring-emerald-500/20' : 'border-border/70 hover:border-emerald-500/30'}`}
        >
          <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-lg hidden xl:block">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Completed</span>
            <span className="text-lg font-bold text-text">{completedJobs}</span>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      {jobs.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by filename or customer…"
              className="w-full bg-card border border-border rounded-lg pl-8 pr-3 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors placeholder:text-muted/50"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter size={13} className="text-muted shrink-0" />
            <div className="w-[140px]">
              <Dropdown
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: 'all', label: 'All statuses' },
                  ...statusOptions.map(s => ({ value: s, label: s }))
                ]}
              />
            </div>

            <div className="w-[150px]">
              <Dropdown
                value={assigneeFilter}
                onChange={setAssigneeFilter}
                options={[
                  { value: 'all', label: 'All assignees' },
                  { value: 'unassigned', label: 'Unassigned' },
                  ...assigneeOptions.map(a => ({ value: a, label: getUserDisplayName(a) }))
                ]}
              />
            </div>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-primary hover:underline font-semibold whitespace-nowrap"
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="flex items-center ml-auto bg-card border border-border rounded-lg p-0.5 shrink-0">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-accent text-primary shadow-sm' : 'text-muted hover:text-text'}`}
              title="Grid View"
            >
              <LayoutGrid size={15} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-accent text-primary shadow-sm' : 'text-muted hover:text-text'}`}
              title="List View"
            >
              <List size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Grid listing of all active jobs */}
      {jobs.length === 0 ? (
        <div className="text-center py-16 text-muted border border-dashed border-border rounded-xl bg-card/10">
          <p className="text-xs font-medium">No jobs added yet</p>
          <button
            onClick={() => setShowAddJobModal(true)}
            className="mt-2 text-xs text-primary hover:underline font-bold"
          >
            Create first job
          </button>
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="text-center py-16 text-muted border border-dashed border-border rounded-xl bg-card/10">
          <p className="text-xs font-medium">No jobs match the current filters</p>
          <button
            onClick={clearFilters}
            className="mt-2 text-xs text-primary hover:underline font-bold"
          >
            Clear filters
          </button>
        </div>
      ) : viewMode === 'list' ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-text whitespace-nowrap">
              <thead className="bg-accent/50 border-b border-border text-xs font-bold text-muted uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Job Name</th>
                  <th className="px-4 py-3">Pages</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Language</th>
                  <th className="px-4 py-3">Assignee</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 min-w-[150px]">Progress</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredJobs.map((job) => {
                  const percent = job.status === 'Completed' ? 100 : Math.round((job.current_stage_index / 3) * 100)
                  const currentAssignee = job.current_assignee || null

                  const assigneeOptions = [
                    { value: '', label: 'Unassigned' },
                    ...users.filter(u => u.active_status).map(u => ({
                      value: u.user_name,
                      label: u.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : u.user_name
                    }))
                  ]
                  if (currentAssignee && !assigneeOptions.some(o => o.value === currentAssignee)) {
                    assigneeOptions.push({ value: currentAssignee, label: getUserDisplayName(currentAssignee) })
                  }

                  return (
                    <tr
                      key={job.id}
                      onClick={() => handleJobClick(job)}
                      className="hover:bg-accent/30 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 min-w-[200px] max-w-[300px]">
                        <h3 className="font-semibold text-sm truncate m-0" title={job.pdf_filename}>{job.pdf_filename}</h3>
                        {job.epub_filename && (
                          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium truncate mt-0.5" title={job.epub_filename}>
                            {job.epub_filename}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted font-mono">
                        {job.pdf_page_count || '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted font-medium">
                        {job.pdf_type ? job.pdf_type : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted font-medium">
                        {job.pdf_language ? job.pdf_language : '-'}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 text-muted">
                          <User size={13} className="text-muted/70" />
                          <Dropdown
                            variant="inline"
                            searchable
                            value={currentAssignee || ''}
                            onChange={(val) => assignUser(job.id, val)}
                            className="bg-transparent border-0 text-primary font-medium p-0 hover:text-primary-hover w-full shadow-none h-auto min-h-0 focus:border-transparent focus:ring-0 text-[12px]"
                            options={assigneeOptions}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`capitalize font-bold px-2.5 py-1 rounded-md text-[10px] border ${getStatusBadgeClass(job)}`}>
                          {getStatusText(job)}
                        </span>
                      </td>
                      <td className="px-4 py-3 w-[200px]">
                        <div className="flex items-center justify-between text-[10px] text-muted font-bold mb-1.5">
                          <span>{job.current_stage_name}</span>
                          <span>{percent}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all duration-500 rounded-full"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-muted font-medium">
                        {new Date(job.created_at.endsWith('Z') ? job.created_at : job.created_at + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td
                        className={`px-4 py-3 text-[11px] font-medium ${isManager ? 'text-primary hover:underline cursor-pointer' : 'text-muted'}`}
                        onClick={(e) => {
                          if (isManager) {
                            e.stopPropagation()
                            setShowEditDueDateModal(job)
                            setNewDueDate(job.due_date ? new Date(job.due_date.endsWith('Z') ? job.due_date : job.due_date + 'Z').toISOString().slice(0, 10) : '')
                            setDueDateReason('')
                          }
                        }}
                      >
                        {job.due_date ? new Date(job.due_date.endsWith('Z') ? job.due_date : job.due_date + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }) : (isManager ? 'Set Date' : '-')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isAdmin && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setShowDeleteModal(job.id); }}
                              className="p-1.5 text-muted hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                              title="Delete Job"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                          <ChevronRight size={18} className="text-muted" />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredJobs.map((job) => {
            const percent = job.status === 'Completed' ? 100 : Math.round((job.current_stage_index / 3) * 100)
            const currentAssignee = job.current_assignee || null

            const assigneeOptions = [
              { value: '', label: 'Unassigned' },
              ...users.filter(u => u.active_status).map(u => ({
                value: u.user_name,
                label: u.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : u.user_name
              }))
            ]
            if (currentAssignee && !assigneeOptions.some(o => o.value === currentAssignee)) {
              assigneeOptions.push({ value: currentAssignee, label: getUserDisplayName(currentAssignee) })
            }

            return (
              <div
                key={job.id}
                onClick={() => handleJobClick(job)}
                className="p-4 rounded-xl border bg-card border-border shadow-sm flex flex-col justify-between cursor-pointer hover:border-primary/50 transition-colors"
              >
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm text-text truncate m-0" title={job.pdf_filename}>{job.pdf_filename}</h3>
                      {job.epub_filename && (
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium truncate mt-0.5" title={job.epub_filename}>
                          {job.epub_filename}
                        </p>
                      )}
                      <p className="text-[11px] text-muted mt-0.5 flex items-center flex-wrap gap-2">
                        {job.pdf_page_count ? `${job.pdf_page_count} Pages` : 'No Pages Info'}
                        {job.pdf_type && (
                          <span>({job.pdf_type})</span>
                        )}
                        {job.pdf_language && (
                          <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px] font-bold">{job.pdf_language}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isAdmin && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowDeleteModal(job.id); }}
                          className="p-1.5 text-muted hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                          title="Delete Job"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                      <ChevronRight size={18} className="text-muted" />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1 text-muted" onClick={(e) => e.stopPropagation()}>
                      <User size={12} className="text-muted/70" />
                      <Dropdown
                        variant="inline"
                        searchable
                        value={currentAssignee || ''}
                        onChange={(val) => assignUser(job.id, val)}
                        className="bg-transparent border-0 text-primary font-medium p-0 hover:text-primary-hover w-auto shadow-none h-auto min-h-0 focus:border-transparent focus:ring-0 text-[11px]"
                        dropdownClassName="w-48 text-[11px] font-normal"
                        options={assigneeOptions}
                      />
                    </div>
                    <span className={`capitalize font-bold px-2 py-0.5 rounded-md text-[9px] border ${getStatusBadgeClass(job)}`}>
                      {getStatusText(job)}
                    </span>
                  </div>

                  {/* Progress bar visual indicator */}
                  <div className="mt-3 mb-3">
                    <div className="flex items-center justify-between text-[10px] text-muted font-bold mb-1">
                      <span>Progress</span>
                      <span>Stage: {job.current_stage_name}</span>
                    </div>
                    <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-500 rounded-full"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-2.5 border-t border-border/60 flex items-center justify-between text-[10px] text-muted font-medium">
                  <div className="flex flex-col gap-0.5">
                    <span>Created: {new Date(job.created_at.endsWith('Z') ? job.created_at : job.created_at + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</span>
                    <span
                      className={isManager ? 'text-primary hover:underline cursor-pointer' : ''}
                      onClick={(e) => {
                        if (isManager) {
                          e.stopPropagation()
                          setShowEditDueDateModal(job)
                          setNewDueDate(job.due_date ? new Date(job.due_date.endsWith('Z') ? job.due_date : job.due_date + 'Z').toISOString().slice(0, 10) : '')
                          setDueDateReason('')
                        }
                      }}
                    >
                      Due: {job.due_date ? new Date(job.due_date.endsWith('Z') ? job.due_date : job.due_date + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }) : (isManager ? 'Set Date' : '-')}
                    </span>
                  </div>
                  <span className="flex items-center gap-1 text-primary">View Details <ArrowRight size={10} /></span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add Job Modal */}
      {showAddJobModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-5 shadow-xl space-y-4">
            <div className="flex justify-between items-start border-b border-border/60 pb-2">
              <div>
                <h3 className="text-base font-bold text-text m-0">Add New Job</h3>
                <p className="text-[10px] text-muted mt-0.5">Upload a PDF for Books on Demand</p>
              </div>
              <button
                onClick={() => {
                  setShowAddJobModal(false)
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

            <form onSubmit={handleAddJob} className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Client Configuration</label>
                <Dropdown
                  value={selectedClientId}
                  onChange={setSelectedClientId}
                  placeholder="Select Client"
                  options={clients.map(c => ({ value: c.id.toString(), label: c.client_name }))}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Upload PDF Document</label>
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
                    <p className="text-xs font-semibold text-text">Click to choose PDF</p>
                    <p className="text-[9px] text-muted">Must be a valid PDF file</p>
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
                    setShowAddJobModal(false)
                    setErrorMsg(null)
                  }}
                  className="px-3.5 py-1.5 bg-background border border-border hover:bg-accent text-text font-bold rounded-lg transition-colors text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !selectedClientId || !pdfFile}
                  className="px-3.5 py-1.5 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/95 transition-colors disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5 text-xs"
                >
                  {uploading ? 'Uploading...' : 'Create Job'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-xl max-w-sm w-full p-5 shadow-xl space-y-4">
            <div className="flex justify-between items-start border-b border-border/60 pb-2">
              <div>
                <h3 className="text-base font-bold text-text m-0 flex items-center gap-2">
                  <AlertCircle size={18} className="text-red-500" />
                  Confirm Deletion
                </h3>
              </div>
              <button
                onClick={() => setShowDeleteModal(null)}
                className="text-muted hover:text-text transition-colors p-1"
              >
                <XCircle size={18} />
              </button>
            </div>

            <p className="text-sm text-muted">
              Are you sure you want to delete this job and its files? This action cannot be undone.
            </p>

            <div className="pt-2 flex justify-end gap-2.5">
              <button
                onClick={() => setShowDeleteModal(null)}
                className="px-3.5 py-1.5 bg-background border border-border hover:bg-accent text-text font-bold rounded-lg transition-colors text-xs"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteJob(showDeleteModal)}
                className="px-3.5 py-1.5 bg-red-500 text-white font-bold rounded-lg hover:bg-red-600 transition-colors flex items-center gap-1.5 text-xs"
              >
                Delete Job
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Due Date Modal */}
      {showEditDueDateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card w-full max-w-sm rounded-xl shadow-xl border border-border flex flex-col p-5 gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-text text-sm">Update Due Date</h3>
              <button
                onClick={() => setShowEditDueDateModal(null)}
                className="text-muted hover:text-text transition-colors p-1"
              >
                <XCircle size={18} />
              </button>
            </div>

            <form onSubmit={updateDueDate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-muted">New Due Date</label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm appearance-none cursor-pointer [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-50 hover:[&::-webkit-calendar-picker-indicator]:opacity-100"
                    style={{ colorScheme: 'light dark' }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-muted">Reason for Change</label>
                <textarea
                  required
                  value={dueDateReason}
                  onChange={(e) => setDueDateReason(e.target.value)}
                  placeholder="Why is the date changing?"
                  className="px-3 py-2 bg-background border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary transition-colors min-h-[80px] resize-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowEditDueDateModal(null)}
                  className="px-3.5 py-1.5 bg-background border border-border hover:bg-accent text-text font-bold rounded-lg transition-colors text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDueDate}
                  className="px-3.5 py-1.5 bg-primary text-white font-bold rounded-lg hover:bg-primary/90 transition-colors text-xs disabled:opacity-70"
                >
                  {savingDueDate ? 'Saving...' : 'Save Date'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
