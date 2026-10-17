import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw, ChevronRight, ArrowLeft, XCircle, Upload, CheckCircle2, Layers, AlertCircle, User, Search, Filter, FolderOpen, ArrowRight, Trash2, LayoutGrid, List, Clock, Download, Sparkles, Calendar } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useRBAC } from '@/hooks/useRBAC'
import { useSessionStore } from '@/stores/sessionStore'
import { usersApi } from '@/api/users'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { toast } from '@/store/useToastStore'
import api from '@/api/client'
import { getUserDisplayName as formatUserDisplayName } from '@/utils/userUtils'
import { formatDateTime } from '@/utils/dateUtils'

export function BodInternalPage() {
  useDocumentTitle('Books on Demand — S4Carlisle CMS')
  const navigate = useNavigate()
  const { isAdmin, isManager } = useRBAC()
  const viewer = useSessionStore(s => s.viewer)

  const [jobs, setJobs] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])

  // Form states
  const [showAddJobModal, setShowAddJobModal] = useState(false)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  type QuickFilter = 'all' | 'fresh_all' | 'fresh_today' | 'fresh_previous' | 'prod_all' | 'prod_yts' | 'prod_in_progress' | 'qc_all' | 'qc_yts' | 'qc_in_progress' | 'overdue' | 'tomorrow_due' | 'completed'
  const [cardFilter, setCardFilter] = useState<QuickFilter>('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')

  // Date Filter states
  const [dateTarget, setDateTarget] = useState<'created' | 'due'>('created')
  const [datePreset, setDatePreset] = useState<'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'>('all')
  const [customFromDate, setCustomFromDate] = useState('')
  const [customToDate, setCustomToDate] = useState('')

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
    if (!pdfFile) return

    setUploading(true)
    setErrorMsg(null)
    const formData = new FormData()
    formData.append('file', pdfFile)

    try {
      await api.post('/bod/jobs', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success("Job created successfully")

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
  const isJobCompleted = (job: any) => job.status === 'Completed' || job.current_stage_name === 'Archive'

  const parseSafeDate = (dateStr: string | null | undefined): Date | null => {
    if (!dateStr) return null
    if (/([+-]\d{2}:?\d{2}|Z)$/.test(dateStr)) {
      return new Date(dateStr)
    }
    return new Date(dateStr + 'Z')
  }

  const isOverdue = (dateStr: string | null | undefined) => {
    const dueDate = parseSafeDate(dateStr)
    if (!dueDate || isNaN(dueDate.getTime())) return false
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    dueDate.setHours(0, 0, 0, 0)
    return dueDate < now
  }

  const isDueTomorrow = (dateStr: string | null | undefined) => {
    const dueDate = parseSafeDate(dateStr)
    if (!dueDate || isNaN(dueDate.getTime())) return false
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    dueDate.setHours(0, 0, 0, 0)
    return dueDate.getTime() === tomorrow.getTime()
  }

  const isCreatedToday = (dateStr: string | null | undefined) => {
    const d = parseSafeDate(dateStr)
    if (!d || isNaN(d.getTime())) return false
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return d >= now && d < tomorrow
  }

  const matchesDateFilter = (job: any): boolean => {
    if (datePreset === 'all' && !customFromDate && !customToDate) return true

    const targetStr = dateTarget === 'created' ? job.created_at : job.due_date
    if (!targetStr) return false

    const d = parseSafeDate(targetStr)
    if (!d || isNaN(d.getTime())) return false

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)

    if (datePreset === 'today') {
      return d >= startOfToday && d < startOfTomorrow
    }

    if (datePreset === 'yesterday') {
      const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0)
      return d >= startOfYesterday && d < startOfToday
    }

    if (datePreset === 'week') {
      const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0)
      return d >= startOfWeek && d < startOfTomorrow
    }

    if (datePreset === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0, 0)
      return d >= startOfMonth && d < startOfTomorrow
    }

    if (datePreset === 'custom') {
      if (customFromDate) {
        const from = new Date(`${customFromDate}T00:00:00`)
        if (d < from) return false
      }
      if (customToDate) {
        const to = new Date(`${customToDate}T23:59:59.999`)
        if (d > to) return false
      }
      return true
    }

    return true
  }

  const isDateFilterActive = datePreset !== 'all' || Boolean(customFromDate || customToDate)
  const dateFilteredCount = jobs.filter(matchesDateFilter).length

  const allAssignees = new Set<string>()
  jobs.forEach(j => {
    if (j.current_assignee) {
      allAssignees.add(j.current_assignee)
    }
  })
  const assigneeOptions = Array.from(allAssignees).sort()

  const hasBaseFiltersActive = searchQuery.trim() !== '' || assigneeFilter !== 'all' || isDateFilterActive

  // Base jobs filtered by base filters (Search, Assignee, Date)
  const baseJobs = jobs.filter(j => {
    const query = searchQuery.trim().toLowerCase()
    const matchesSearch = !query
      || j.pdf_filename.toLowerCase().includes(query)
      || (j.client_name && j.client_name.toLowerCase().includes(query))

    const currentAssignee = j.current_assignee || null
    const matchesAssignee = assigneeFilter === 'all'
      || (assigneeFilter === 'unassigned' ? !currentAssignee : currentAssignee === assigneeFilter)

    const matchesDate = matchesDateFilter(j)

    return matchesSearch && matchesAssignee && matchesDate
  })

  // Metric card counts computed dynamically from baseJobs
  const totalJobs = baseJobs.length
  const completedJobs = baseJobs.filter(isJobCompleted).length
  const activeJobs = baseJobs.filter(j => !isJobCompleted(j))

  // Fresh: means Add job stage, split into Today and Previous days
  const freshAllJobs = activeJobs.filter(j => j.current_stage_name === 'Add job')
  const freshTotal = freshAllJobs.length
  const freshTodayJobs = freshAllJobs.filter(j => isCreatedToday(j.created_at)).length
  const freshPreviousJobs = freshAllJobs.filter(j => !isCreatedToday(j.created_at)).length

  // Production: sub divided into YTS (pending PDF download) and In Progress (PDF downloaded)
  const prodJobs = activeJobs.filter(j => j.current_stage_name === 'Production')
  const prodTotal = prodJobs.length
  const prodInProgressJobs = prodJobs.filter(j => Boolean(j.pdf_downloaded || j.stage_history?.Production?.pdf_downloaded)).length
  const prodYtsJobs = prodJobs.filter(j => !j.pdf_downloaded && !j.stage_history?.Production?.pdf_downloaded).length

  // QC: sub divided into YTS (unassigned) and In Progress (assigned)
  const qcJobs = activeJobs.filter(j => j.current_stage_name === 'QC')
  const qcTotal = qcJobs.length
  const qcYtsJobs = qcJobs.filter(j => !j.current_assignee).length
  const qcInProgressJobs = qcJobs.filter(j => Boolean(j.current_assignee)).length

  // Overdue: crossed due date; Tomorrow Due: due soon (tomorrow)
  let overdueJobs = 0
  let dueSoonJobs = 0
  activeJobs.forEach(job => {
    if (job.due_date) {
      if (isOverdue(job.due_date)) overdueJobs++
      else if (isDueTomorrow(job.due_date)) dueSoonJobs++
    }
  })

  // Quick download PDF handler (starts work if in production)
  const handleDownloadPdf = async (e: React.MouseEvent, job: any) => {
    e.stopPropagation()
    try {
      const response = await api.get(`/bod/jobs/${job.id}/download-pdf`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', job.pdf_filename)
      document.body.appendChild(link)
      link.click()
      link.parentNode?.removeChild(link)
      toast.success("PDF downloaded. Work in progress.")
      fetchJobs()
    } catch (err) {
      toast.error("Failed to download PDF")
    }
  }

  const getUserDisplayName = (username: string | null | undefined) => {
    if (!username) return ''
    if (!users || users.length === 0) return username
    const u = users.find(user => user.user_name === username || (user as any).username === username || String(user.id) === String(username))
    if (u) {
      return formatUserDisplayName(u)
    }
    return username
  }

  const getJobStatusInfo = (job: any) => {
    if (isJobCompleted(job)) {
      return {
        label: 'Completed',
        badgeClass: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
        isOverdue: false,
        isTomorrow: false,
      }
    }

    const isOverdueJob = isOverdue(job.due_date)
    const isTomorrowJob = isDueTomorrow(job.due_date)

    if (job.current_stage_name === 'Add job') {
      const addedToday = isCreatedToday(job.created_at)
      return {
        label: addedToday ? 'Fresh (Today)' : 'Fresh (Previous)',
        badgeClass: addedToday
          ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 font-bold'
          : 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
        sublabel: addedToday ? 'Added Today' : 'Previous Days',
        isOverdue: isOverdueJob,
        isTomorrow: isTomorrowJob,
      }
    }

    if (job.current_stage_name === 'Production') {
      const isDownloaded = Boolean(job.pdf_downloaded || job.stage_history?.Production?.pdf_downloaded)
      if (isDownloaded) {
        return {
          label: 'In-Progress',
          badgeClass: 'bg-purple-500/10 border-purple-500/20 text-purple-600 dark:text-purple-400',
          isOverdue: isOverdueJob,
          isTomorrow: isTomorrowJob,
        }
      } else {
        return {
          label: 'YTS',
          badgeClass: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
          isOverdue: isOverdueJob,
          isTomorrow: isTomorrowJob,
        }
      }
    }

    if (job.current_stage_name === 'QC') {
      if (job.current_assignee) {
        return {
          label: 'In-Progress',
          badgeClass: 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400',
          isOverdue: isOverdueJob,
          isTomorrow: isTomorrowJob,
        }
      } else {
        return {
          label: 'YTS',
          badgeClass: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
          isOverdue: isOverdueJob,
          isTomorrow: isTomorrowJob,
        }
      }
    }

    return {
      label: job.status || 'Active',
      badgeClass: 'bg-primary/10 border-primary/20 text-primary',
      isOverdue: isOverdueJob,
      isTomorrow: isTomorrowJob,
    }
  }

  const getStatusBadgeClass = (job: any) => getJobStatusInfo(job).badgeClass
  const getStatusText = (job: any) => getJobStatusInfo(job).label

  const filteredJobs = baseJobs.filter(j => {
    const jobCompleted = isJobCompleted(j)

    let matchesFilter = true
    if (cardFilter === 'fresh_all' || (cardFilter as any) === 'fresh') {
      matchesFilter = !jobCompleted && j.current_stage_name === 'Add job'
    } else if (cardFilter === 'fresh_today') {
      matchesFilter = !jobCompleted && j.current_stage_name === 'Add job' && isCreatedToday(j.created_at)
    } else if (cardFilter === 'fresh_previous') {
      matchesFilter = !jobCompleted && j.current_stage_name === 'Add job' && !isCreatedToday(j.created_at)
    } else if (cardFilter === 'prod_all') {
      matchesFilter = !jobCompleted && j.current_stage_name === 'Production'
    } else if (cardFilter === 'prod_yts') {
      matchesFilter = !jobCompleted && j.current_stage_name === 'Production' && !j.pdf_downloaded && !j.stage_history?.Production?.pdf_downloaded
    } else if (cardFilter === 'prod_in_progress') {
      matchesFilter = !jobCompleted && j.current_stage_name === 'Production' && Boolean(j.pdf_downloaded || j.stage_history?.Production?.pdf_downloaded)
    } else if (cardFilter === 'qc_all') {
      matchesFilter = !jobCompleted && j.current_stage_name === 'QC'
    } else if (cardFilter === 'qc_yts') {
      matchesFilter = !jobCompleted && j.current_stage_name === 'QC' && !j.current_assignee
    } else if (cardFilter === 'qc_in_progress') {
      matchesFilter = !jobCompleted && j.current_stage_name === 'QC' && Boolean(j.current_assignee)
    } else if (cardFilter === 'overdue') {
      matchesFilter = !jobCompleted && isOverdue(j.due_date)
    } else if (cardFilter === 'tomorrow_due') {
      matchesFilter = !jobCompleted && isDueTomorrow(j.due_date)
    } else if (cardFilter === 'completed') {
      matchesFilter = jobCompleted
    }

    return matchesFilter
  }).sort((a, b) => {
    const aIsCompleted = isJobCompleted(a)
    const bIsCompleted = isJobCompleted(b)
    if (aIsCompleted && !bIsCompleted) return 1
    if (!aIsCompleted && bIsCompleted) return -1

    // Both active
    if (!aIsCompleted && !bIsCompleted) {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    }

    // Both completed
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const hasActiveFilters = searchQuery.trim() !== '' || cardFilter !== 'all' || assigneeFilter !== 'all' || isDateFilterActive
  const clearFilters = () => {
    setSearchQuery('')
    setCardFilter('all')
    setAssigneeFilter('all')
    setDatePreset('all')
    setCustomFromDate('')
    setCustomToDate('')
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
                {totalJobs} job{totalJobs !== 1 ? 's' : ''} {hasBaseFiltersActive && totalJobs !== jobs.length ? `(filtered from ${jobs.length})` : ''}
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

      {/* Metrics Section: 2 Compact Rows */}
      <div className="space-y-1.5">
        {/* Row 1: Deadlines & Dates (Overdue, Tomorrow Due, Completed, Date Filters) */}
        <div>
          <div className="flex items-center justify-between mb-1 px-0.5">
            <span className="text-[10px] font-bold tracking-wider uppercase text-muted flex items-center gap-1.5">
              <Clock size={12} className="text-orange-500" />
              Deadlines & Date Filters
            </span>
            {isDateFilterActive && (
              <span className="text-[9px] text-primary font-medium bg-primary/10 px-2 py-0.5 rounded-full">
                Date filter active: {dateFilteredCount} matching job{dateFilteredCount !== 1 ? 's' : ''} ({dateTarget === 'created' ? 'Created' : 'Due'} Date)
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2">
            {/* 1. Overdue */}
            <div
              onClick={() => setCardFilter(cardFilter === 'overdue' ? 'all' : 'overdue')}
              className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-xs hover:shadow-sm col-span-1 min-h-[62px] ${cardFilter === 'overdue' ? 'border-red-500/60 ring-2 ring-red-500/20 bg-red-500/[0.04]' : 'border-border/80 hover:border-red-500/40'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-red-500 font-bold uppercase tracking-wider">Overdue</span>
                <div className="p-1 bg-red-500/10 text-red-600 dark:text-red-400 rounded">
                  <Clock size={12} />
                </div>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-lg font-bold text-red-600 dark:text-red-400 leading-none">{overdueJobs}</span>
                <span className="text-[8px] text-red-500/80 truncate">Past due</span>
              </div>
            </div>

            {/* 2. Tomorrow Due */}
            <div
              onClick={() => setCardFilter(cardFilter === 'tomorrow_due' ? 'all' : 'tomorrow_due')}
              className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-xs hover:shadow-sm col-span-1 min-h-[62px] ${cardFilter === 'tomorrow_due' ? 'border-orange-500/60 ring-2 ring-orange-500/20 bg-orange-500/[0.04]' : 'border-border/80 hover:border-orange-500/40'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-orange-500 font-bold uppercase tracking-wider">Tomorrow Due</span>
                <div className="p-1 bg-orange-500/10 text-orange-600 dark:text-orange-400 rounded">
                  <Clock size={12} />
                </div>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-lg font-bold text-orange-600 dark:text-orange-400 leading-none">{dueSoonJobs}</span>
                <span className="text-[8px] text-orange-500/80 truncate">Due tomorrow</span>
              </div>
            </div>

            {/* 3. Completed */}
            <div
              onClick={() => setCardFilter(cardFilter === 'completed' ? 'all' : 'completed')}
              className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-xs hover:shadow-sm col-span-1 min-h-[62px] ${cardFilter === 'completed' ? 'border-emerald-500/60 ring-2 ring-emerald-500/20 bg-emerald-500/[0.04]' : 'border-border/80 hover:border-emerald-500/40'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-muted font-bold uppercase tracking-wider">Completed</span>
                <div className="p-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded">
                  <CheckCircle2 size={12} />
                </div>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 leading-none">{completedJobs}</span>
                <span className="text-[8px] text-muted truncate">Archived</span>
              </div>
            </div>

            {/* 4. Date Filters Card */}
            <div
              className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between transition-all duration-200 shadow-xs col-span-1 sm:col-span-2 lg:col-span-1 xl:col-span-4 min-h-[62px] ${isDateFilterActive ? 'border-primary/60 ring-2 ring-primary/20 bg-primary/[0.02]' : 'border-border/80 hover:border-primary/30'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1 border-b border-border/50">
                <div className="flex items-center gap-1.5">
                  <div className="p-0.5 bg-primary/10 text-primary rounded">
                    <Calendar size={11} />
                  </div>
                  <span className="text-[9px] font-bold text-primary uppercase tracking-wider">Date Filters</span>

                  {/* Target Toggle: Created Date vs Due Date */}
                  <div className="flex items-center bg-background/80 p-0.5 rounded border border-border/60 text-[8px] font-medium ml-0.5">
                    <button
                      type="button"
                      onClick={() => setDateTarget('created')}
                      className={`px-1.5 py-0.5 rounded transition-colors ${dateTarget === 'created' ? 'bg-primary text-primary-foreground font-bold shadow-xs' : 'text-muted hover:text-text'}`}
                      title="Filter jobs by when they were added/created"
                    >
                      Created Date
                    </button>
                    <button
                      type="button"
                      onClick={() => setDateTarget('due')}
                      className={`px-1.5 py-0.5 rounded transition-colors ${dateTarget === 'due' ? 'bg-primary text-primary-foreground font-bold shadow-xs' : 'text-muted hover:text-text'}`}
                      title="Filter jobs by due date"
                    >
                      Due Date
                    </button>
                  </div>
                </div>

                {isDateFilterActive && (
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-primary font-bold bg-primary/10 px-1.5 py-0.5 rounded">
                      {dateFilteredCount} jobs
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setDatePreset('all')
                        setCustomFromDate('')
                        setCustomToDate('')
                      }}
                      className="text-[8px] text-muted hover:text-red-500 font-semibold px-1 py-0.5 rounded hover:bg-red-500/10 transition-colors"
                      title="Clear date filter"
                    >
                      Reset
                    </button>
                  </div>
                )}
              </div>

              {/* Preset buttons + Custom Date Picker */}
              <div className="flex flex-wrap items-center justify-between gap-1 pt-1">
                <div className="flex items-center gap-1 flex-wrap">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'today', label: 'Today' },
                    { id: 'yesterday', label: 'Yesterday' },
                    { id: 'week', label: '7 Days' },
                    { id: 'month', label: 'Month' },
                    { id: 'custom', label: 'Custom' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setDatePreset(p.id as any)}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-semibold transition-all border ${datePreset === p.id
                        ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                        : 'bg-background/60 border-border/60 text-muted hover:text-text hover:bg-accent/50'
                        }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {datePreset === 'custom' && (
                  <div className="flex items-center gap-1 text-[9px]">
                    <div className="flex items-center gap-1 bg-background/60 border border-border/70 rounded px-1 py-0.5">
                      <span className="text-[8px] text-muted uppercase font-bold">From</span>
                      <input
                        type="date"
                        value={customFromDate}
                        onChange={(e) => setCustomFromDate(e.target.value)}
                        className="bg-transparent border-0 text-[9px] text-text p-0 focus:outline-none focus:ring-0 cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center gap-1 bg-background/60 border border-border/70 rounded px-1 py-0.5">
                      <span className="text-[8px] text-muted uppercase font-bold">To</span>
                      <input
                        type="date"
                        value={customToDate}
                        onChange={(e) => setCustomToDate(e.target.value)}
                        className="bg-transparent border-0 text-[9px] text-text p-0 focus:outline-none focus:ring-0 cursor-pointer"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Stages (Total, Fresh, Production, QC) */}
        <div>
          <div className="flex items-center justify-between mb-1 px-0.5">
            <span className="text-[10px] font-bold tracking-wider uppercase text-muted flex items-center gap-1.5">
              <Layers size={12} className="text-primary" />
              Workflow Stages
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2">
            {/* 1. Total */}
            <div
              onClick={() => setCardFilter('all')}
              className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-xs hover:shadow-sm col-span-1 min-h-[62px] ${cardFilter === 'all' && !hasActiveFilters ? 'border-primary/60 ring-2 ring-primary/20 bg-primary/[0.03]' : 'border-border/80 hover:border-primary/40'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-muted font-bold uppercase tracking-wider">Total</span>
                <div className="p-1 bg-primary/10 text-primary rounded">
                  <Layers size={12} />
                </div>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-lg font-bold text-text leading-none">{totalJobs}</span>
                <span className="text-[8px] text-muted truncate">{hasBaseFiltersActive && totalJobs !== jobs.length ? `${jobs.length} total` : 'All jobs'}</span>
              </div>
            </div>

            {/* 2. Fresh (Add Job): subdivided into Today and Previous Days */}
            <div
              className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between transition-all duration-200 shadow-xs hover:shadow-sm col-span-1 sm:col-span-1 lg:col-span-1 xl:col-span-2 min-h-[62px] ${cardFilter.startsWith('fresh') ? 'border-amber-500/60 ring-2 ring-amber-500/20' : 'border-border/80 hover:border-amber-500/30'}`}
            >
              <div className="flex items-center justify-between pb-1 border-b border-border/50">
                <div className="flex items-center gap-1">
                  <div className="p-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded">
                    <Plus size={11} />
                  </div>
                  <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Fresh (Add Job)</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCardFilter(cardFilter === 'fresh_all' ? 'all' : 'fresh_all')}
                  className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-colors ${cardFilter === 'fresh_all' ? 'bg-amber-600 text-white' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'}`}
                  title="Show all Fresh (Add job) jobs"
                >
                  Total {freshTotal}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => setCardFilter(cardFilter === 'fresh_today' ? 'all' : 'fresh_today')}
                  className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'fresh_today' ? 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/30' : 'bg-background/60 border-border/60 hover:border-amber-500/30 hover:bg-accent/40'}`}
                  title="Fresh jobs added today"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                      Today
                    </span>
                    <span className="text-xs font-bold text-text">{freshTodayJobs}</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setCardFilter(cardFilter === 'fresh_previous' ? 'all' : 'fresh_previous')}
                  className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'fresh_previous' ? 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/30' : 'bg-background/60 border-border/60 hover:border-amber-500/30 hover:bg-accent/40'}`}
                  title="Fresh jobs added in previous days"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-bold uppercase tracking-wider text-amber-600/80 dark:text-amber-400/80 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60"></span>
                      Previous
                    </span>
                    <span className="text-xs font-bold text-text">{freshPreviousJobs}</span>
                  </div>
                </button>
              </div>
            </div>

            {/* 3. Production: subdivided into YTS and In Progress */}
            <div
              className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between transition-all duration-200 shadow-xs hover:shadow-sm col-span-1 sm:col-span-1 lg:col-span-1 xl:col-span-2 min-h-[62px] ${cardFilter.startsWith('prod_') ? 'border-purple-500/60 ring-2 ring-purple-500/20' : 'border-border/80 hover:border-purple-500/30'}`}
            >
              <div className="flex items-center justify-between pb-1 border-b border-border/50">
                <div className="flex items-center gap-1">
                  <div className="p-0.5 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded">
                    <RefreshCw size={11} />
                  </div>
                  <span className="text-[9px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">Production</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCardFilter(cardFilter === 'prod_all' ? 'all' : 'prod_all')}
                  className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-colors ${cardFilter === 'prod_all' ? 'bg-purple-600 text-white' : 'bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20'}`}
                  title="Show all Production jobs"
                >
                  Total {prodTotal}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => setCardFilter(cardFilter === 'prod_yts' ? 'all' : 'prod_yts')}
                  className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'prod_yts' ? 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/30' : 'bg-background/60 border-border/60 hover:border-amber-500/30 hover:bg-accent/40'}`}
                  title="Assigned, pending PDF download"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      YTS
                    </span>
                    <span className="text-xs font-bold text-text">{prodYtsJobs}</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setCardFilter(cardFilter === 'prod_in_progress' ? 'all' : 'prod_in_progress')}
                  className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'prod_in_progress' ? 'bg-purple-500/10 border-purple-500/40 ring-1 ring-purple-500/30' : 'bg-background/60 border-border/60 hover:border-purple-500/30 hover:bg-accent/40'}`}
                  title="Work started, PDF downloaded"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></span>
                      In Progress
                    </span>
                    <span className="text-xs font-bold text-text">{prodInProgressJobs}</span>
                  </div>
                </button>
              </div>
            </div>

            {/* 4. QC: subdivided into YTS and In Progress */}
            <div
              className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between transition-all duration-200 shadow-xs hover:shadow-sm col-span-1 sm:col-span-1 lg:col-span-1 xl:col-span-2 min-h-[62px] ${cardFilter.startsWith('qc_') ? 'border-blue-500/60 ring-2 ring-blue-500/20' : 'border-border/80 hover:border-blue-500/30'}`}
            >
              <div className="flex items-center justify-between pb-1 border-b border-border/50">
                <div className="flex items-center gap-1">
                  <div className="p-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded">
                    <CheckCircle2 size={11} />
                  </div>
                  <span className="text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">QC</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCardFilter(cardFilter === 'qc_all' ? 'all' : 'qc_all')}
                  className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-colors ${cardFilter === 'qc_all' ? 'bg-blue-600 text-white' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20'}`}
                  title="Show all QC jobs"
                >
                  Total {qcTotal}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => setCardFilter(cardFilter === 'qc_yts' ? 'all' : 'qc_yts')}
                  className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'qc_yts' ? 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/30' : 'bg-background/60 border-border/60 hover:border-amber-500/30 hover:bg-accent/40'}`}
                  title="Unassigned in QC"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      YTS
                    </span>
                    <span className="text-xs font-bold text-text">{qcYtsJobs}</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setCardFilter(cardFilter === 'qc_in_progress' ? 'all' : 'qc_in_progress')}
                  className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'qc_in_progress' ? 'bg-blue-500/10 border-blue-500/40 ring-1 ring-blue-500/30' : 'bg-background/60 border-border/60 hover:border-blue-500/30 hover:bg-accent/40'}`}
                  title="Assigned in QC"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                      In Progress
                    </span>
                    <span className="text-xs font-bold text-text">{qcInProgressJobs}</span>
                  </div>
                </button>
              </div>
            </div>
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
          <div className="w-[190px]">
            <Dropdown
              value={cardFilter}
              onChange={(val) => setCardFilter(val as QuickFilter)}
              options={[
                { value: 'all', label: 'All Jobs' },
                { value: 'fresh_all', label: 'Fresh (All Add Job)' },
                { value: 'fresh_today', label: 'Fresh: Added Today' },
                { value: 'fresh_previous', label: 'Fresh: Previous Days' },
                { value: 'prod_all', label: 'Production (All)' },
                { value: 'prod_yts', label: 'Production: YTS (Pending PDF)' },
                { value: 'prod_in_progress', label: 'Production: In Progress' },
                { value: 'qc_all', label: 'QC (All)' },
                { value: 'qc_yts', label: 'QC: YTS (Unassigned)' },
                { value: 'qc_in_progress', label: 'QC: In Progress (Assigned)' },
                { value: 'overdue', label: 'Overdue' },
                { value: 'tomorrow_due', label: 'Tomorrow Due' },
                { value: 'completed', label: 'Completed' }
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
    )
  }

  {/* Grid listing of all active jobs */ }
  {
    jobs.length === 0 ? (
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
                    label: formatUserDisplayName(u)
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
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`capitalize font-bold px-2.5 py-1 rounded-md text-[10px] border ${getStatusBadgeClass(job)}`}>
                          {getStatusText(job)}
                        </span>
                        {getJobStatusInfo(job).isOverdue && (
                          <span className="font-bold px-1.5 py-0.5 rounded text-[9px] bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 inline-flex items-center gap-0.5" title="Crossed due date">
                            <Clock size={10} /> Overdue
                          </span>
                        )}
                        {getJobStatusInfo(job).isTomorrow && (
                          <span className="font-bold px-1.5 py-0.5 rounded text-[9px] bg-orange-500/10 border border-orange-500/20 text-orange-600 dark:text-orange-400 inline-flex items-center gap-0.5" title="Due tomorrow">
                            <Clock size={10} /> Due Soon
                          </span>
                        )}
                      </div>
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
                      {formatDateTime(job.created_at)}
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
                      {job.due_date ? (
                        <span className={`inline-flex items-center gap-1 ${getJobStatusInfo(job).isOverdue ? 'text-red-600 dark:text-red-400 font-semibold' : getJobStatusInfo(job).isTomorrow ? 'text-orange-600 dark:text-orange-400 font-semibold' : ''}`}>
                          {getJobStatusInfo(job).isOverdue && <Clock size={11} className="shrink-0" />}
                          {getJobStatusInfo(job).isTomorrow && <Clock size={11} className="shrink-0" />}
                          {formatDateTime(job.due_date)}
                        </span>
                      ) : (
                        isManager ? 'Set Date' : '-'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={(e) => handleDownloadPdf(e, job)}
                          className="p-1.5 text-muted hover:text-primary hover:bg-primary/10 rounded-md transition-colors"
                          title="Download PDF (Starts Work in Production)"
                        >
                          <Download size={15} />
                        </button>
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
            label: formatUserDisplayName(u)
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
                  <button
                    onClick={(e) => handleDownloadPdf(e, job)}
                    className="p-1.5 text-muted hover:text-primary hover:bg-primary/10 rounded transition-colors"
                    title="Download PDF (Starts Work in Production)"
                  >
                    <Download size={15} />
                  </button>
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
                <div className="flex items-center gap-1">
                  <span className={`capitalize font-bold px-2 py-0.5 rounded-md text-[9px] border ${getStatusBadgeClass(job)}`}>
                    {getStatusText(job)}
                  </span>
                  {getJobStatusInfo(job).isOverdue && (
                    <span className="font-bold px-1.5 py-0.5 rounded text-[9px] bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400">
                      Overdue
                    </span>
                  )}
                  {getJobStatusInfo(job).isTomorrow && (
                    <span className="font-bold px-1.5 py-0.5 rounded text-[9px] bg-orange-500/10 border border-orange-500/20 text-orange-600 dark:text-orange-400">
                      Due Soon
                    </span>
                  )}
                </div>
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
                <span>Created: {formatDateTime(job.created_at)}</span>
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
                  Due: {job.due_date ? (
                    <span className={getJobStatusInfo(job).isOverdue ? 'text-red-500 font-semibold' : getJobStatusInfo(job).isTomorrow ? 'text-orange-500 font-semibold' : ''}>
                      {formatDateTime(job.due_date)}
                    </span>
                  ) : (isManager ? 'Set Date' : '-')}
                </span>
              </div>
              <span className="flex items-center gap-1 text-primary">View Details <ArrowRight size={10} /></span>
            </div>
          </div>
        )
      })}
    </div>
  )
  }

  {/* Add Job Modal */ }
  {
    showAddJobModal && (
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
                disabled={uploading || !pdfFile}
                className="px-3.5 py-1.5 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/95 transition-colors disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5 text-xs"
              >
                {uploading ? 'Uploading...' : 'Create Job'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  {/* Delete Confirmation Modal */ }
  {
    showDeleteModal !== null && (
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
    )
  }

  {/* Edit Due Date Modal */ }
  {
    showEditDueDateModal && (
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
    )
  }
    </div >
  )
}
