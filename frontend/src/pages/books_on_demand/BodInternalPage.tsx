import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw, ChevronRight, ChevronDown, ArrowLeft, XCircle, Upload, CheckCircle2, Layers, AlertCircle, User, Search, Filter, FolderOpen, ArrowRight, Trash2, LayoutGrid, List, Clock, Download, Sparkles, Calendar, Edit3, ArrowUp, ArrowDown, ArrowUpDown, X, Send, Loader2, Zap } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useRBAC } from '@/hooks/useRBAC'
import { useSessionStore } from '@/stores/sessionStore'
import { usersApi } from '@/api/users'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { toast } from '@/store/useToastStore'
import api from '@/api/client'
import { getUserDisplayName as formatUserDisplayName } from '@/utils/userUtils'
import { formatDateTime, formatDate, parseUtcDate } from '@/utils/dateUtils'

export function BodInternalPage() {
  useDocumentTitle('Books on Demand — S4Carlisle CMS')
  const navigate = useNavigate()
  const { isAdmin, isManager } = useRBAC()
  const viewer = useSessionStore(s => s.viewer)

  const [jobs, setJobs] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])

  // Selection states for bulk dispatch
  const [selectedJobIds, setSelectedJobIds] = useState<number[]>([])
  const [isBulkDispatching, setIsBulkDispatching] = useState(false)
  const [dispatchingJobId, setDispatchingJobId] = useState<number | null>(null)

  // Form states
  const [showAddJobModal, setShowAddJobModal] = useState(false)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  type QuickFilter = 'all' | 'total_all' | 'fastrack' | 'total_intake' | 'total_backlog' | 'fresh_all' | 'fresh_today' | 'fresh_previous' | 'prod_all' | 'prod_yts' | 'prod_in_progress' | 'qc_all' | 'qc_yts' | 'qc_in_progress' | 'ready_to_dispatch' | 'overdue' | 'today_due' | 'tomorrow_due' | 'completed' | 'completed_all' | 'completed_ahead' | 'completed_ontime' | 'completed_delay'
  const [cardFilter, setCardFilter] = useState<QuickFilter>('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')
  const [togglingFastrackId, setTogglingFastrackId] = useState<number | null>(null)

  // Fastrack modal state
  const [fastrackModalJob, setFastrackModalJob] = useState<any | null>(null)
  const [fastrackExpectedDate, setFastrackExpectedDate] = useState('')
  const [savingFastrack, setSavingFastrack] = useState(false)

  // Date Filter states
  const [datePreset, setDatePreset] = useState<'all' | 'today' | 'yesterday' | 'tomorrow' | 'day_3' | 'day_4' | 'day_5' | 'week' | 'month' | 'custom'>('today')
  const [customFromDate, setCustomFromDate] = useState('')
  const [customToDate, setCustomToDate] = useState('')

  // Table heading filters & sorting
  const [colFilters, setColFilters] = useState({
    name: '',
    fastrack: 'all',
    pages: '',
    type: 'all',
    language: 'all',
    assignee: 'all',
    status: 'all',
    stage: 'all',
    created: '',
    dueDate: '',
    dispatchedDate: '',
  })
  const [sortField, setSortField] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

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

  const handleAdvanceJob = async (jobId: number) => {
    try {
      await api.post(`/bod/jobs/${jobId}/advance`)
      toast.success("Job moved to Production stage")
      fetchJobs()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to proceed to Production")
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

  const handleFastrackClick = (e: React.MouseEvent, job: any) => {
    e.stopPropagation()
    if (job.is_fastrack) {
      toggleFastrackOff(job.id)
    } else {
      setFastrackModalJob(job)
      const now = new Date()
      setFastrackExpectedDate(now.toISOString().slice(0, 10))
    }
  }

  const toggleFastrackOff = async (jobId: number) => {
    setTogglingFastrackId(jobId)
    try {
      await api.put(`/bod/jobs/${jobId}/fastrack`, { is_fastrack: false })
      toast.success("Job set to Normal")
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, is_fastrack: false, fastrack_requested_date: null } : j))
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to update Fastrack status")
    } finally {
      setTogglingFastrackId(null)
    }
  }

  const submitFastrackEnable = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fastrackModalJob || !fastrackExpectedDate) return

    if (fastrackModalJob.due_date) {
      const maxDate = new Date(fastrackModalJob.due_date.endsWith('Z') ? fastrackModalJob.due_date : fastrackModalJob.due_date + 'Z')
      const chosenDate = new Date(`${fastrackExpectedDate}T23:59:59`)
      if (chosenDate.getTime() > maxDate.getTime() + 60000) {
        toast.error(`Expected date must be on or before the due date (${formatDate(fastrackModalJob.due_date)})`)
        return
      }
    }

    setSavingFastrack(true)
    const finalDateStr = fastrackExpectedDate // e.g. "2026-10-30"

    try {
      const { data } = await api.put(`/bod/jobs/${fastrackModalJob.id}/fastrack`, {
        is_fastrack: true,
        fastrack_requested_date: finalDateStr
      })
      toast.success("Job marked as Fastrack with expected completion date")
      setJobs(prev => prev.map(j => j.id === fastrackModalJob.id ? {
        ...j,
        is_fastrack: true,
        fastrack_requested_date: data.fastrack_requested_date || finalDateStr
      } : j))
      setFastrackModalJob(null)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to enable Fastrack")
    } finally {
      setSavingFastrack(false)
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

  const getCompletedDate = (job: any): string | null => {
    const history = job.stage_history || {}
    if (history['Archive']?.end_time) return history['Archive'].end_time
    if (history['Archive']?.start_time) return history['Archive'].start_time
    if (history['Ready to Dispatch']?.end_time) return history['Ready to Dispatch'].end_time
    if (job.status === 'Completed' && job.updated_at) return job.updated_at
    return null
  }

  const parseSafeDate = (dateStr: string | null | undefined): Date | null => {
    if (!dateStr) return null
    if (/([+-]\d{2}:?\d{2}|Z)$/.test(dateStr)) {
      return new Date(dateStr)
    }
    return new Date(dateStr + 'Z')
  }

  const isOverdue = (dateStr: string | null | undefined, asOfDate?: Date) => {
    const dueDate = parseSafeDate(dateStr)
    if (!dueDate || isNaN(dueDate.getTime())) return false
    const ref = asOfDate ? new Date(asOfDate) : new Date()
    ref.setHours(0, 0, 0, 0)
    dueDate.setHours(0, 0, 0, 0)
    return dueDate < ref
  }

  const isDueToday = (dateStr: string | null | undefined) => {
    const dueDate = parseSafeDate(dateStr)
    if (!dueDate || isNaN(dueDate.getTime())) return false
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    dueDate.setHours(0, 0, 0, 0)
    return dueDate.getTime() === now.getTime()
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

  const isDateInPreset = (dateStr: string | null | undefined, preset: string): boolean => {
    if (!dateStr) return false
    const d = parseSafeDate(dateStr)
    if (!d || isNaN(d.getTime())) return false
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
    const startOfAfterTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0, 0)
    const startOfDay4 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 0, 0, 0, 0)
    const startOfDay5 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 4, 0, 0, 0, 0)
    const startOfDay6 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5, 0, 0, 0, 0)
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0)
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0, 0)

    if (preset === 'today') return d >= startOfToday && d < startOfTomorrow
    if (preset === 'yesterday') return d >= startOfYesterday && d < startOfToday
    if (preset === 'tomorrow') return d >= startOfTomorrow && d < startOfAfterTomorrow
    if (preset === 'day_3') return d >= startOfAfterTomorrow && d < startOfDay4
    if (preset === 'day_4') return d >= startOfDay4 && d < startOfDay5
    if (preset === 'day_5') return d >= startOfDay5 && d < startOfDay6
    if (preset === 'week') return d >= startOfWeek && d < startOfTomorrow
    if (preset === 'month') return d >= startOfMonth && d < startOfTomorrow
    if (preset === 'custom') {
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

  const matchesDateFilter = (job: any): boolean => {
    if (datePreset === 'all' && !customFromDate && !customToDate) return true

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
    const startOfAfterTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0, 0)
    const startOfDay4 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 0, 0, 0, 0)
    const startOfDay5 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 4, 0, 0, 0, 0)
    const startOfDay6 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5, 0, 0, 0, 0)
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0)
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0, 0)

    // Helper to test if a given date string falls within the selected preset
    const dateMatchesPreset = (dateStr: string | null | undefined): boolean => {
      if (!dateStr) return false
      const d = parseSafeDate(dateStr)
      if (!d || isNaN(d.getTime())) return false

      if (datePreset === 'today') return d >= startOfToday && d < startOfTomorrow
      if (datePreset === 'yesterday') return d >= startOfYesterday && d < startOfToday
      if (datePreset === 'tomorrow') return d >= startOfTomorrow && d < startOfAfterTomorrow
      if (datePreset === 'day_3') return d >= startOfAfterTomorrow && d < startOfDay4
      if (datePreset === 'day_4') return d >= startOfDay4 && d < startOfDay5
      if (datePreset === 'day_5') return d >= startOfDay5 && d < startOfDay6
      if (datePreset === 'week') return d >= startOfWeek && d < startOfTomorrow
      if (datePreset === 'month') return d >= startOfMonth && d < startOfTomorrow
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

    if (datePreset === 'all' && !customFromDate && !customToDate) {
      return true
    }

    // Active pipeline jobs (Fresh, Production, QC, Ready to Dispatch) are part of the daily operational floor
    if (!isJobCompleted(job)) {
      return true
    }

    // For tomorrow and future days, no jobs have been completed in the future
    if (datePreset === 'tomorrow' || datePreset === 'day_3' || datePreset === 'day_4' || datePreset === 'day_5') {
      return false
    }

    // Completed jobs are included only if they were completed/dispatched within the selected date window
    const compDateStr = getCompletedDate(job)
    return dateMatchesPreset(compDateStr) || dateMatchesPreset(job.created_at)
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

  const uniqueLanguages = React.useMemo(() => {
    const langs = new Set<string>()
    jobs.forEach(j => {
      if (j.pdf_language && j.pdf_language.trim()) {
        langs.add(j.pdf_language.trim())
      }
    })
    return Array.from(langs).sort()
  }, [jobs])

  const uniqueTypes = React.useMemo(() => {
    const types = new Set<string>(['Text PDF', 'Image PDF'])
    jobs.forEach(j => {
      if (j.pdf_type && j.pdf_type.trim()) {
        types.add(j.pdf_type.trim())
      }
    })
    return Array.from(types).sort()
  }, [jobs])

  const hasColFilters = Boolean(
    colFilters.name ||
    (colFilters.fastrack && colFilters.fastrack !== 'all') ||
    colFilters.pages ||
    (colFilters.type && colFilters.type !== 'all') ||
    (colFilters.language && colFilters.language !== 'all') ||
    (colFilters.assignee && colFilters.assignee !== 'all') ||
    (colFilters.status && colFilters.status !== 'all') ||
    (colFilters.stage && colFilters.stage !== 'all') ||
    colFilters.created ||
    colFilters.dueDate ||
    colFilters.dispatchedDate
  )

  const clearColFilters = () => {
    setColFilters({
      name: '',
      fastrack: 'all',
      pages: '',
      type: 'all',
      language: 'all',
      assignee: 'all',
      status: 'all',
      stage: 'all',
      created: '',
      dueDate: '',
      dispatchedDate: '',
    })
  }

  const handleSort = (field: string) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc')
      } else {
        setSortField(null)
        setSortDirection('asc')
      }
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const renderSortIcon = (field: string) => {
    if (sortField !== field) {
      return <ArrowUpDown size={11} className="opacity-35 group-hover:opacity-100 transition-opacity" />
    }
    return sortDirection === 'asc' ? (
      <ArrowUp size={11} className="text-primary font-bold" />
    ) : (
      <ArrowDown size={11} className="text-primary font-bold" />
    )
  }

  const hasBaseFiltersActive = searchQuery.trim() !== '' || assigneeFilter !== 'all' || isDateFilterActive

  // Base jobs filtered by base filters (Search, Assignee, Date)
  // When 'fastrack' card filter is selected, date filtering is bypassed because Fastrack is independent of the date filter
  const baseJobs = jobs.filter(j => {
    const query = searchQuery.trim().toLowerCase()
    const matchesSearch = !query
      || j.pdf_filename.toLowerCase().includes(query)
      || (j.client_name && j.client_name.toLowerCase().includes(query))

    const currentAssignee = j.current_assignee || null
    const matchesAssignee = assigneeFilter === 'all'
      || (assigneeFilter === 'unassigned' ? !currentAssignee : currentAssignee === assigneeFilter)

    const matchesDate = cardFilter === 'fastrack' ? true : matchesDateFilter(j)

    return matchesSearch && matchesAssignee && matchesDate
  })


  const getCompletionTiming = (completedAtStr: string | null, dueDateStr: string | null): 'Ahead' | 'On-time' | 'Delay' => {
    if (!dueDateStr || !completedAtStr) return 'On-time'
    const compDate = new Date(completedAtStr.endsWith('Z') || completedAtStr.includes('+') ? completedAtStr : `${completedAtStr}Z`)
    const dueDate = new Date(dueDateStr.endsWith('Z') || dueDateStr.includes('+') ? dueDateStr : `${dueDateStr}Z`)
    if (isNaN(compDate.getTime()) || isNaN(dueDate.getTime())) return 'On-time'
    const compDay = compDate.toISOString().slice(0, 10)
    const dueDay = dueDate.toISOString().slice(0, 10)
    if (compDay < dueDay) return 'Ahead'
    if (compDay === dueDay) return 'On-time'
    return 'Delay'
  }

  // Fastrack count: completely independent of date filter, counts active fastrack jobs
  const fastrackJobsCount = jobs.filter(j => !isJobCompleted(j) && Boolean(j.is_fastrack)).length

  // Metric card counts computed dynamically from baseJobs
  const totalJobs = baseJobs.length
  const totalIntakeJobs = baseJobs.filter(j => isDateInPreset(j.created_at, datePreset === 'all' ? 'today' : datePreset)).length
  const totalBacklogJobs = baseJobs.filter(j => !isDateInPreset(j.created_at, datePreset === 'all' ? 'today' : datePreset)).length
  const completedJobs = baseJobs.filter(isJobCompleted).length
  const activeJobs = baseJobs.filter(j => !isJobCompleted(j))
  const completedAhead = baseJobs.filter(j => isJobCompleted(j) && getCompletionTiming(getCompletedDate(j), j.due_date) === 'Ahead').length
  const completedOnTime = baseJobs.filter(j => isJobCompleted(j) && getCompletionTiming(getCompletedDate(j), j.due_date) === 'On-time').length
  const completedDelay = baseJobs.filter(j => isJobCompleted(j) && getCompletionTiming(getCompletedDate(j), j.due_date) === 'Delay').length

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

  // Ready to Dispatch: QC finished, awaiting FTP upload
  const dispatchJobs = activeJobs.filter(j => j.current_stage_name === 'Ready to Dispatch')
  const dispatchTotal = dispatchJobs.length

  // Determine the effective reference date for Overdue based on active date filter:
  // e.g. for "today", reference is start of today.
  // for "yesterday", reference is start of yesterday (jobs due before yesterday).
  // for "tomorrow", overdue is 0 as we don't know future overdue.
  // for "custom", if customFromDate is set, jobs due before customFromDate.
  const getOverdueDateRef = (): Date | null => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    if (datePreset === 'tomorrow' || datePreset === 'day_3' || datePreset === 'day_4' || datePreset === 'day_5') {
      return null // No overdue for future dates
    }
    if (datePreset === 'today' || datePreset === 'all') {
      return now
    }
    if (datePreset === 'yesterday') {
      const yest = new Date(now)
      yest.setDate(yest.getDate() - 1)
      return yest
    }
    if (datePreset === 'custom' && customFromDate) {
      const from = new Date(`${customFromDate}T00:00:00`)
      if (!isNaN(from.getTime())) return from
    }
    if (datePreset === 'week') {
      const wk = new Date(now)
      wk.setDate(wk.getDate() - 7)
      return wk
    }
    if (datePreset === 'month') {
      const m = new Date(now)
      m.setDate(m.getDate() - 30)
      return m
    }
    return now
  }
  const overdueRefDate = getOverdueDateRef()

  // Overdue: crossed due date before selected date window (active jobs only); Today Due: all jobs due in selected date filter (active + completed); Tomorrow Due: due tomorrow
  let overdueJobs = 0
  let todayDueJobs = 0
  let dueSoonJobs = 0
  const activePreset = datePreset === 'all' ? 'today' : datePreset

  activeJobs.forEach(job => {
    if (job.due_date) {
      if (overdueRefDate && isOverdue(job.due_date, overdueRefDate)) overdueJobs++
      if (isDueTomorrow(job.due_date)) dueSoonJobs++
    }
  })

  // Option A: Count ALL jobs due in the active preset/date range (including completed jobs)
  baseJobs.forEach(job => {
    if (job.due_date && isDateInPreset(job.due_date, activePreset)) {
      todayDueJobs++
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
      const timing = getCompletionTiming(getCompletedDate(job), job.due_date)
      if (timing === 'Ahead') {
        return {
          label: 'Completed (Ahead)',
          badgeClass: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-bold',
          timing: 'Ahead',
          isOverdue: false,
          isTomorrow: false,
        }
      } else if (timing === 'Delay') {
        return {
          label: 'Completed (Delay)',
          badgeClass: 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400 font-bold',
          timing: 'Delay',
          isOverdue: false,
          isTomorrow: false,
        }
      } else {
        return {
          label: 'Completed (On-time)',
          badgeClass: 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 font-bold',
          timing: 'On-time',
          isOverdue: false,
          isTomorrow: false,
        }
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

    if (job.current_stage_name === 'Ready to Dispatch') {
      return {
        label: 'Ready to Dispatch',
        badgeClass: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold',
        isOverdue: isOverdueJob,
        isTomorrow: isTomorrowJob,
      }
    }

    return {
      label: job.status || 'Active',
      badgeClass: 'bg-primary/10 border-primary/20 text-primary',
      isOverdue: isOverdueJob,
      isTomorrow: isTomorrowJob,
    }
  }

  const getStagePercent = (job: any) => {
    if (isJobCompleted(job)) return 100
    if (job.current_stage_name === 'Add job') return 10
    if (job.current_stage_name === 'Production') return 35
    if (job.current_stage_name === 'QC') return 65
    if (job.current_stage_name === 'Ready to Dispatch') return 90
    return Math.min(95, Math.round((job.current_stage_index / 4) * 100))
  }

  const getStatusBadgeClass = (job: any) => getJobStatusInfo(job).badgeClass
  const getStatusText = (job: any) => getJobStatusInfo(job).label

  const filteredJobs = baseJobs.filter(j => {
    const jobCompleted = isJobCompleted(j)

    let matchesFilter = true
    if (cardFilter === 'total_all' || cardFilter === 'all') {
      matchesFilter = true
    } else if (cardFilter === 'fastrack') {
      matchesFilter = !jobCompleted && Boolean(j.is_fastrack)
    } else if (cardFilter === 'total_intake') {
      matchesFilter = isDateInPreset(j.created_at, datePreset === 'all' ? 'today' : datePreset)
    } else if (cardFilter === 'total_backlog') {
      matchesFilter = !isDateInPreset(j.created_at, datePreset === 'all' ? 'today' : datePreset)
    } else if (cardFilter === 'fresh_all' || (cardFilter as any) === 'fresh') {
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
    } else if (cardFilter === 'ready_to_dispatch') {
      matchesFilter = !jobCompleted && j.current_stage_name === 'Ready to Dispatch'
    } else if (cardFilter === 'overdue') {
      matchesFilter = Boolean(overdueRefDate && !jobCompleted && isOverdue(j.due_date, overdueRefDate))
    } else if (cardFilter === 'today_due') {
      matchesFilter = isDateInPreset(j.due_date, datePreset === 'all' ? 'today' : datePreset)
    } else if (cardFilter === 'tomorrow_due') {
      matchesFilter = !jobCompleted && isDueTomorrow(j.due_date)
    } else if (cardFilter === 'completed' || cardFilter === 'completed_all') {
      matchesFilter = jobCompleted
    } else if (cardFilter === 'completed_ahead') {
      matchesFilter = jobCompleted && getCompletionTiming(getCompletedDate(j), j.due_date) === 'Ahead'
    } else if (cardFilter === 'completed_ontime') {
      matchesFilter = jobCompleted && getCompletionTiming(getCompletedDate(j), j.due_date) === 'On-time'
    } else if (cardFilter === 'completed_delay') {
      matchesFilter = jobCompleted && getCompletionTiming(getCompletedDate(j), j.due_date) === 'Delay'
    }

    if (!matchesFilter) return false

    // Column Filters from table heading
    if (colFilters.name) {
      const q = colFilters.name.toLowerCase().trim()
      const matchName = (j.pdf_filename && j.pdf_filename.toLowerCase().includes(q)) ||
        (j.epub_filename && j.epub_filename.toLowerCase().includes(q))
      if (!matchName) return false
    }

    if (colFilters.fastrack && colFilters.fastrack !== 'all') {
      if (colFilters.fastrack === 'fastrack' && !j.is_fastrack) return false
      if (colFilters.fastrack === 'normal' && j.is_fastrack) return false
    }

    if (colFilters.pages) {
      const p = colFilters.pages.trim()
      const pagesStr = String(j.pdf_page_count || '')
      if (!pagesStr.includes(p)) return false
    }

    if (colFilters.type && colFilters.type !== 'all') {
      if ((j.pdf_type || '').toLowerCase() !== colFilters.type.toLowerCase()) return false
    }

    if (colFilters.language && colFilters.language !== 'all') {
      if ((j.pdf_language || '').toLowerCase() !== colFilters.language.toLowerCase()) return false
    }

    if (colFilters.assignee && colFilters.assignee !== 'all') {
      if (colFilters.assignee === 'unassigned') {
        if (j.current_assignee) return false
      } else {
        if (j.current_assignee !== colFilters.assignee) return false
      }
    }

    if (colFilters.status && colFilters.status !== 'all') {
      const statusInfo = getJobStatusInfo(j)
      if (colFilters.status === 'completed') {
        if (!jobCompleted) return false
      } else if (colFilters.status === 'completed_ahead') {
        if (!jobCompleted || (statusInfo as any).timing !== 'Ahead') return false
      } else if (colFilters.status === 'completed_ontime') {
        if (!jobCompleted || (statusInfo as any).timing !== 'On-time') return false
      } else if (colFilters.status === 'completed_delay') {
        if (!jobCompleted || (statusInfo as any).timing !== 'Delay') return false
      } else if (colFilters.status === 'active') {
        if (jobCompleted) return false
      } else if (colFilters.status === 'overdue') {
        if (!statusInfo.isOverdue || jobCompleted) return false
      } else if (colFilters.status === 'tomorrow_due') {
        if (!statusInfo.isTomorrow || jobCompleted) return false
      } else if (colFilters.status === 'fresh') {
        if (jobCompleted || j.current_stage_name !== 'Add job') return false
      } else if (colFilters.status === 'yts') {
        if (jobCompleted) return false
        const isYts = (j.current_stage_name === 'Production' && !j.pdf_downloaded && !j.stage_history?.Production?.pdf_downloaded) ||
          (j.current_stage_name === 'QC' && !j.current_assignee)
        if (!isYts) return false
      } else if (colFilters.status === 'in_progress') {
        if (jobCompleted) return false
        const isInProgress = (j.current_stage_name === 'Production' && Boolean(j.pdf_downloaded || j.stage_history?.Production?.pdf_downloaded)) ||
          (j.current_stage_name === 'QC' && Boolean(j.current_assignee))
        if (!isInProgress) return false
      } else if (colFilters.status === 'ready_to_dispatch') {
        if (jobCompleted || j.current_stage_name !== 'Ready to Dispatch') return false
      }
    }

    if (colFilters.stage && colFilters.stage !== 'all') {
      if (colFilters.stage === 'Completed') {
        if (!jobCompleted) return false
      } else {
        if (j.current_stage_name !== colFilters.stage || jobCompleted) return false
      }
    }

    if (colFilters.created) {
      if (!j.created_at) return false
      const d = parseSafeDate(j.created_at)
      if (!d || isNaN(d.getTime())) return false
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`
      if (dateStr !== colFilters.created) return false
    }

    if (colFilters.dueDate) {
      if (!j.due_date) return false
      const d = parseSafeDate(j.due_date)
      if (!d || isNaN(d.getTime())) return false
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`
      if (dateStr !== colFilters.dueDate) return false
    }

    if (colFilters.dispatchedDate) {
      const dispDate = j.dispatched_at || getCompletedDate(j)
      if (!dispDate) return false
      const d = parseSafeDate(dispDate)
      if (!d || isNaN(d.getTime())) return false
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`
      if (dateStr !== colFilters.dispatchedDate) return false
    }

    return true
  }).sort((a, b) => {
    if (sortField) {
      let valA: any = ''
      let valB: any = ''

      if (sortField === 'name') {
        valA = (a.pdf_filename || '').toLowerCase()
        valB = (b.pdf_filename || '').toLowerCase()
      } else if (sortField === 'fastrack') {
        valA = a.is_fastrack ? 1 : 0
        valB = b.is_fastrack ? 1 : 0
      } else if (sortField === 'pages') {
        valA = Number(a.pdf_page_count) || 0
        valB = Number(b.pdf_page_count) || 0
      } else if (sortField === 'type') {
        valA = (a.pdf_type || '').toLowerCase()
        valB = (b.pdf_type || '').toLowerCase()
      } else if (sortField === 'language') {
        valA = (a.pdf_language || '').toLowerCase()
        valB = (b.pdf_language || '').toLowerCase()
      } else if (sortField === 'assignee') {
        valA = getUserDisplayName(a.current_assignee).toLowerCase()
        valB = getUserDisplayName(b.current_assignee).toLowerCase()
      } else if (sortField === 'status') {
        valA = getStatusText(a).toLowerCase()
        valB = getStatusText(b).toLowerCase()
      } else if (sortField === 'progress') {
        valA = a.status === 'Completed' ? 100 : Math.round((a.current_stage_index / 3) * 100)
        valB = b.status === 'Completed' ? 100 : Math.round((b.current_stage_index / 3) * 100)
      } else if (sortField === 'created') {
        valA = a.created_at ? new Date(a.created_at).getTime() : 0
        valB = b.created_at ? new Date(b.created_at).getTime() : 0
      } else if (sortField === 'dueDate') {
        valA = a.due_date ? new Date(a.due_date).getTime() : 0
        valB = b.due_date ? new Date(b.due_date).getTime() : 0
      } else if (sortField === 'dispatchedDate') {
        const dateA = a.dispatched_at || getCompletedDate(a)
        const dateB = b.dispatched_at || getCompletedDate(b)
        valA = dateA ? new Date(dateA).getTime() : 0
        valB = dateB ? new Date(dateB).getTime() : 0
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1
      return 0
    }

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

  const hasActiveFilters = searchQuery.trim() !== '' || cardFilter !== 'all' || assigneeFilter !== 'all' || isDateFilterActive || hasColFilters || sortField !== null
  const clearFilters = () => {
    setSearchQuery('')
    setCardFilter('all')
    setAssigneeFilter('all')
    setDatePreset('all')
    setCustomFromDate('')
    setCustomToDate('')
    clearColFilters()
    setSortField(null)
    setSortDirection('asc')
  }

  // Jobs eligible for dispatch in the currently filtered list
  const dispatchableJobs = filteredJobs.filter(j => j.current_stage_name === 'Ready to Dispatch' && !isJobCompleted(j))
  const allDispatchableSelected = dispatchableJobs.length > 0 && dispatchableJobs.every(j => selectedJobIds.includes(j.id))

  const toggleSelectAllDispatchable = () => {
    if (allDispatchableSelected) {
      setSelectedJobIds(prev => prev.filter(id => !dispatchableJobs.some(j => j.id === id)))
    } else {
      setSelectedJobIds(prev => Array.from(new Set([...prev, ...dispatchableJobs.map(j => j.id)])))
    }
  }

  const toggleSelectJob = (jobId: number) => {
    setSelectedJobIds(prev =>
      prev.includes(jobId) ? prev.filter(id => id !== jobId) : [...prev, jobId]
    )
  }

  const handleSingleDispatch = async (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation()
    setDispatchingJobId(jobId)
    try {
      await api.post(`/bod/jobs/${jobId}/dispatch`, {
        dispatched_by: viewer?.username || undefined
      })
      toast.success("Job dispatched successfully and uploaded to FTP!")
      setSelectedJobIds(prev => prev.filter(id => id !== jobId))
      fetchJobs()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to dispatch job to FTP")
    } finally {
      setDispatchingJobId(null)
    }
  }

  const handleBulkDispatch = async () => {
    if (selectedJobIds.length === 0) return
    setIsBulkDispatching(true)
    try {
      const { data } = await api.post('/bod/jobs/bulk-dispatch', {
        job_ids: selectedJobIds,
        dispatched_by: viewer?.username || undefined
      })
      if (data.failed_count === 0) {
        toast.success(`All ${data.success_count} job(s) dispatched successfully to FTP!`)
        setSelectedJobIds([])
      } else if (data.success_count === 0) {
        const errorDetails = data.results.filter((r: any) => !r.success).map((r: any) => `${r.job_name || r.job_id}: ${r.error}`).join('; ')
        toast.error(`Dispatch failed: ${errorDetails}`)
      } else {
        toast.warning(`${data.success_count} job(s) dispatched, ${data.failed_count} failed.`)
        const failedIds = data.results.filter((r: any) => !r.success).map((r: any) => r.job_id)
        setSelectedJobIds(failedIds)
      }
      fetchJobs()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to execute bulk dispatch")
    } finally {
      setIsBulkDispatching(false)
    }
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
          <div className="flex items-center bg-card border border-border rounded-lg p-0.5 shrink-0">
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
                Date filter active: {dateFilteredCount} matching job{dateFilteredCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-2">
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

            {/* 2. Today / Selected Date Due */}
            <div
              onClick={() => setCardFilter(cardFilter === 'today_due' ? 'all' : 'today_due')}
              className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-xs hover:shadow-sm col-span-1 min-h-[62px] ${cardFilter === 'today_due' ? 'border-amber-500/60 ring-2 ring-amber-500/20 bg-amber-500/[0.04]' : 'border-border/80 hover:border-amber-500/40'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider truncate">
                  {datePreset === 'today' || datePreset === 'all'
                    ? 'Today Due'
                    : datePreset === 'tomorrow'
                      ? 'Tomorrow Due'
                      : datePreset === 'day_3'
                        ? 'Day 3 Due'
                        : datePreset === 'day_4'
                          ? 'Day 4 Due'
                          : datePreset === 'day_5'
                            ? 'Day 5 Due'
                            : datePreset === 'yesterday'
                              ? 'Yesterday Due'
                              : 'Period Due'}
                </span>
                <div className="p-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded">
                  <Calendar size={12} />
                </div>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-lg font-bold text-amber-600 dark:text-amber-400 leading-none">{todayDueJobs}</span>
                <span className="text-[8px] text-amber-600/80 dark:text-amber-400/80 truncate">
                  {datePreset === 'today' || datePreset === 'all'
                    ? 'Due today'
                    : datePreset === 'tomorrow'
                      ? 'Due tomorrow'
                      : datePreset === 'day_3'
                        ? 'Due Day 3'
                        : datePreset === 'day_4'
                          ? 'Due Day 4'
                          : datePreset === 'day_5'
                            ? 'Due Day 5'
                            : datePreset === 'yesterday'
                              ? 'Due yesterday'
                              : 'Due in range'}
                </span>
              </div>
            </div>

            {/* 3. Today / Selected Date Receipt */}
            <div
              onClick={() => setCardFilter(cardFilter === 'total_intake' ? 'all' : 'total_intake')}
              className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-xs hover:shadow-sm col-span-1 min-h-[62px] ${cardFilter === 'total_intake' ? 'border-primary/60 ring-2 ring-primary/20 bg-primary/[0.04]' : 'border-border/80 hover:border-primary/40'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-primary font-bold uppercase tracking-wider truncate">
                  {datePreset === 'today' || datePreset === 'all'
                    ? 'Today Receipt'
                    : datePreset === 'yesterday'
                      ? 'Yesterday Receipt'
                      : datePreset === 'tomorrow'
                        ? 'Tomorrow Receipt'
                        : datePreset === 'day_3'
                          ? 'Day 3 Receipt'
                          : datePreset === 'day_4'
                            ? 'Day 4 Receipt'
                            : datePreset === 'day_5'
                              ? 'Day 5 Receipt'
                              : 'Period Receipt'}
                </span>
                <div className="p-1 bg-primary/10 text-primary rounded">
                  <Layers size={12} />
                </div>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-lg font-bold text-primary leading-none">{totalIntakeJobs}</span>
                <span className="text-[8px] text-primary/80 truncate">Intake count</span>
              </div>
            </div>

            {/* 4. Date Filters Card */}
            <div
              className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between transition-all duration-200 shadow-xs col-span-1 sm:col-span-2 lg:col-span-3 xl:col-span-3 min-h-[62px] ${isDateFilterActive ? 'border-primary/60 ring-2 ring-primary/20 bg-primary/[0.02]' : 'border-border/80 hover:border-primary/30'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1 border-b border-border/50">
                <div className="flex items-center gap-1.5">
                  <div className="p-0.5 bg-primary/10 text-primary rounded">
                    <Calendar size={11} />
                  </div>
                  <span className="text-[9px] font-bold text-primary uppercase tracking-wider">Date Filters</span>
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
                    { id: 'yesterday', label: 'Yesterday' },
                    { id: 'today', label: 'Today' },
                    { id: 'tomorrow', label: 'Tomorrow' },
                    { id: 'day_3', label: 'Day 3' },
                    { id: 'day_4', label: 'Day 4' },
                    { id: 'day_5', label: 'Day 5' },
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

            {/* 5. Completed: subdivided into Ahead, On Time, and Delay */}
            <div
              className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between transition-all duration-200 shadow-xs hover:shadow-sm col-span-1 sm:col-span-2 lg:col-span-2 xl:col-span-2 min-h-[62px] ${(cardFilter === 'completed' || cardFilter.startsWith('completed_')) ? 'border-emerald-500/60 ring-2 ring-emerald-500/20' : 'border-border/80 hover:border-emerald-500/30'}`}
            >
              <div className="flex items-center justify-between pb-1 border-b border-border/50">
                <div
                  onClick={() => setCardFilter(cardFilter === 'completed' || cardFilter === 'completed_all' ? 'all' : 'completed')}
                  className="flex items-center gap-1 cursor-pointer select-none group/title"
                  title="Show all Completed jobs"
                >
                  <div className="p-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded group-hover/title:bg-emerald-500/20 transition-colors">
                    <CheckCircle2 size={11} />
                  </div>
                  <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider group-hover/title:underline">Dispatched</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCardFilter(cardFilter === 'completed' || cardFilter === 'completed_all' ? 'all' : 'completed')}
                  className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-colors ${(cardFilter === 'completed' || cardFilter === 'completed_all') ? 'bg-emerald-600 text-white' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'}`}
                  title="Show all Completed jobs"
                >
                  Total {completedJobs}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => setCardFilter(cardFilter === 'completed_ahead' ? 'all' : 'completed_ahead')}
                  className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'completed_ahead' ? 'bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/30' : 'bg-background/60 border-border/60 hover:border-emerald-500/30 hover:bg-accent/40'}`}
                  title="Completed ahead of schedule"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[8px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1 truncate">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                      Ahead
                    </span>
                    <span className="text-xs font-bold text-text">{completedAhead}</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setCardFilter(cardFilter === 'completed_ontime' ? 'all' : 'completed_ontime')}
                  className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'completed_ontime' ? 'bg-blue-500/10 border-blue-500/40 ring-1 ring-blue-500/30' : 'bg-background/60 border-border/60 hover:border-blue-500/30 hover:bg-accent/40'}`}
                  title="Completed on time"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[8px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1 truncate">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                      On Time
                    </span>
                    <span className="text-xs font-bold text-text">{completedOnTime}</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setCardFilter(cardFilter === 'completed_delay' ? 'all' : 'completed_delay')}
                  className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'completed_delay' ? 'bg-rose-500/10 border-rose-500/40 ring-1 ring-rose-500/30' : 'bg-background/60 border-border/60 hover:border-rose-500/30 hover:bg-accent/40'}`}
                  title="Completed with delay"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[8px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-1 truncate">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
                      Delay
                    </span>
                    <span className="text-xs font-bold text-text">{completedDelay}</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Stages (Total, Fresh, Production, QC, Ready to Dispatch) */}
        <div>
          <div className="flex items-center justify-between mb-1 px-0.5">
            <span className="text-[10px] font-bold tracking-wider uppercase text-muted flex items-center gap-1.5">
              <Layers size={12} className="text-primary" />
              Workflow Stages
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-2">
            {/* Group the first 3 columns (spans 3 cols to align under Overdue + Today Due + Today Receipt = 3 cols) */}
            <div className="col-span-1 sm:col-span-2 lg:col-span-2 xl:col-span-3 grid grid-cols-12 gap-2">
              {/* 1. Fastrack (3 of 12 cols = 25%, independent of date filter) */}
              <div
                onClick={() => setCardFilter(cardFilter === 'fastrack' ? 'all' : 'fastrack')}
                className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-xs hover:shadow-sm col-span-12 sm:col-span-3 min-h-[62px] ${cardFilter === 'fastrack' ? 'border-amber-500/60 ring-2 ring-amber-500/20 bg-amber-500/[0.04]' : 'border-border/80 hover:border-amber-500/40'}`}
                title="Click to view all active Fastrack jobs (independent of date filter)"
              >
                <div className="flex items-center justify-between pb-1 border-b border-border/50">
                  <div className="flex items-center gap-1">
                    <div className="p-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded">
                      <Zap size={11} className="fill-amber-500 text-amber-500" />
                    </div>
                    <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider truncate">Fastrack</span>
                  </div>
                </div>
                <div className="flex items-baseline justify-between mt-1 pt-0.5">
                  <span className="text-lg font-bold text-amber-600 dark:text-amber-400 leading-none">{fastrackJobsCount}</span>
                  <span className="text-[8px] text-amber-600/80 dark:text-amber-400/80 truncate">Active</span>
                </div>
              </div>

              {/* 2. Total titles (reduced width: 3 of 12 cols = 25%) */}
              <div
                onClick={() => setCardFilter(cardFilter === 'total_all' || cardFilter === 'all' ? 'all' : 'total_all')}
                className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-xs hover:shadow-sm col-span-12 sm:col-span-3 min-h-[62px] ${(cardFilter === 'total_all' || (cardFilter === 'all' && !hasActiveFilters)) ? 'border-primary/60 ring-2 ring-primary/20 bg-primary/[0.03]' : 'border-border/80 hover:border-primary/40'}`}
              >
                <div className="flex items-center justify-between pb-1 border-b border-border/50">
                  <div className="flex items-center gap-1">
                    <div className="p-0.5 bg-primary/10 text-primary rounded">
                      <Layers size={11} />
                    </div>
                    <span className="text-[9px] font-bold text-primary uppercase tracking-wider truncate">Total titles</span>
                  </div>
                </div>
                <div className="flex items-baseline justify-between mt-1 pt-0.5">
                  <span className="text-lg font-bold text-text leading-none">{totalJobs}</span>
                </div>
              </div>

              {/* 3. Job Analysis (increased width: 6 of 12 cols = 50%) */}
              <div
                className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between transition-all duration-200 shadow-xs hover:shadow-sm col-span-12 sm:col-span-6 min-h-[62px] ${cardFilter.startsWith('fresh') ? 'border-amber-500/60 ring-2 ring-amber-500/20' : 'border-border/80 hover:border-amber-500/30'}`}
              >
                <div className="flex items-center justify-between pb-1 border-b border-border/50">
                  <div
                    onClick={() => setCardFilter(cardFilter === 'fresh_all' ? 'all' : 'fresh_all')}
                    className="flex items-center gap-1 cursor-pointer select-none group/title"
                    title="Show all Fresh jobs"
                  >
                    <div className="p-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded group-hover/title:bg-amber-500/20 transition-colors">
                      <Plus size={11} />
                    </div>
                    <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider group-hover/title:underline truncate">Job Analysis</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCardFilter(cardFilter === 'fresh_all' ? 'all' : 'fresh_all')}
                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-colors shrink-0 ${cardFilter === 'fresh_all' ? 'bg-amber-600 text-white' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'}`}
                    title="Show all Fresh (Add job) jobs"
                  >
                    Total {freshTotal}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setCardFilter(cardFilter === 'fresh_previous' ? 'all' : 'fresh_previous')}
                    className={`px-2 py-1 rounded text-left transition-all border ${cardFilter === 'fresh_previous' ? 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/30' : 'bg-background/60 border-border/60 hover:border-amber-500/30 hover:bg-accent/40'}`}
                    title="Fresh jobs added in previous days"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[8px] font-bold uppercase tracking-wider text-amber-600/80 dark:text-amber-400/80 flex items-center gap-1 truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 shrink-0"></span>
                        Backlog
                      </span>
                      <span className="text-xs font-bold text-text shrink-0">{freshPreviousJobs}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCardFilter(cardFilter === 'fresh_today' ? 'all' : 'fresh_today')}
                    className={`px-2 py-1 rounded text-left transition-all border ${cardFilter === 'fresh_today' ? 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/30' : 'bg-background/60 border-border/60 hover:border-amber-500/30 hover:bg-accent/40'}`}
                    title="Fresh jobs added today"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[8px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1 truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0"></span>
                        Today
                      </span>
                      <span className="text-xs font-bold text-text shrink-0">{freshTodayJobs}</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            {/* Container for Production & QC: exactly spanning 3 cols to fit under Date Filters (3 cols) */}
            <div className="col-span-1 sm:col-span-2 lg:col-span-2 xl:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* 3. Production: subdivided into YTS and In Progress */}
              <div
                className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between transition-all duration-200 shadow-xs hover:shadow-sm min-h-[62px] ${cardFilter.startsWith('prod_') ? 'border-purple-500/60 ring-2 ring-purple-500/20' : 'border-border/80 hover:border-purple-500/30'}`}
              >
                <div className="flex items-center justify-between pb-1 border-b border-border/50">
                  <div
                    onClick={() => setCardFilter(cardFilter === 'prod_all' ? 'all' : 'prod_all')}
                    className="flex items-center gap-1 cursor-pointer select-none group/title"
                    title="Show all Production jobs"
                  >
                    <div className="p-0.5 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded group-hover/title:bg-purple-500/20 transition-colors">
                      <RefreshCw size={11} />
                    </div>
                    <span className="text-[9px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider group-hover/title:underline truncate">Production</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCardFilter(cardFilter === 'prod_all' ? 'all' : 'prod_all')}
                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-colors shrink-0 ${cardFilter === 'prod_all' ? 'bg-purple-600 text-white' : 'bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20'}`}
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
                      <span className="text-[8px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1 truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
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
                      <span className="text-[8px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1 truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse shrink-0"></span>
                        In Progress
                      </span>
                      <span className="text-xs font-bold text-text">{prodInProgressJobs}</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* 4. QC: subdivided into YTS and In Progress */}
              <div
                className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between transition-all duration-200 shadow-xs hover:shadow-sm min-h-[62px] ${cardFilter.startsWith('qc_') ? 'border-blue-500/60 ring-2 ring-blue-500/20' : 'border-border/80 hover:border-blue-500/30'}`}
              >
                <div className="flex items-center justify-between pb-1 border-b border-border/50">
                  <div
                    onClick={() => setCardFilter(cardFilter === 'qc_all' ? 'all' : 'qc_all')}
                    className="flex items-center gap-1 cursor-pointer select-none group/title"
                    title="Show all QC jobs"
                  >
                    <div className="p-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded group-hover/title:bg-blue-500/20 transition-colors">
                      <CheckCircle2 size={11} />
                    </div>
                    <span className="text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider group-hover/title:underline truncate">QC</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCardFilter(cardFilter === 'qc_all' ? 'all' : 'qc_all')}
                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-colors shrink-0 ${cardFilter === 'qc_all' ? 'bg-blue-600 text-white' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20'}`}
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
                      <span className="text-[8px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1 truncate">
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
                      <span className="text-[8px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1 truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                        In Progress
                      </span>
                      <span className="text-xs font-bold text-text">{qcInProgressJobs}</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            {/* 5. Ready to Dispatch (Aligns under Dispatched = 2 cols) */}
            <div
              onClick={() => setCardFilter(cardFilter === 'ready_to_dispatch' ? 'all' : 'ready_to_dispatch')}
              className={`bg-card border rounded-lg px-2.5 py-1.5 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-xs hover:shadow-sm col-span-1 sm:col-span-1 lg:col-span-1 xl:col-span-2 min-h-[62px] ${cardFilter === 'ready_to_dispatch' ? 'border-emerald-500/60 ring-2 ring-emerald-500/20 bg-emerald-500/[0.03]' : 'border-border/80 hover:border-emerald-500/40'}`}
            >
              <div className="flex items-center justify-between pb-1 border-b border-border/50">
                <div className="flex items-center gap-1">
                  <div className="p-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded">
                    <Send size={11} />
                  </div>
                  <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Ready to Dispatch</span>
                </div>
                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  Total {dispatchTotal}
                </span>
              </div>
              <div className="flex items-baseline justify-between mt-1 pt-0.5">
                <span className="text-lg font-bold text-text leading-none">{dispatchTotal}</span>
                <span className="text-[8px] text-muted truncate">Awaiting FTP Delivery</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk dispatch toolbar */}
      {selectedJobIds.length > 0 && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-2.5 flex items-center justify-between shadow-xs animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-md">
              <Send size={15} />
            </div>
            <div>
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                {selectedJobIds.length} job{selectedJobIds.length > 1 ? 's' : ''} selected for dispatch
              </span>
              <span className="hidden sm:inline text-[11px] text-muted ml-2">
                (Click Dispatch to package deliverables and upload to FTP server)
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleBulkDispatch}
              disabled={isBulkDispatching}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-7 px-3 flex items-center gap-1.5"
              leftIcon={isBulkDispatching ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            >
              {isBulkDispatching ? 'Dispatching to FTP...' : `Dispatch Selected (${selectedJobIds.length})`}
            </Button>
            <button
              onClick={() => setSelectedJobIds([])}
              disabled={isBulkDispatching}
              className="text-xs text-muted hover:text-text px-2 py-1 transition-colors font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Grid listing of all active jobs */}
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
        ) : viewMode === 'list' ? (
          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-text table-fixed">
                <thead className="bg-accent/50 border-b border-border text-[11px] font-bold text-muted uppercase tracking-wider">
                  <tr className="select-none">
                    <th className="px-1 py-2 text-center w-[3%] overflow-hidden">
                      <input
                        type="checkbox"
                        checked={allDispatchableSelected}
                        onChange={toggleSelectAllDispatchable}
                        disabled={dispatchableJobs.length === 0}
                        title={dispatchableJobs.length === 0 ? "No dispatchable jobs in view" : "Select all Ready to Dispatch jobs"}
                        className="w-3.5 h-3.5 rounded border-border text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </th>
                    <th onClick={() => handleSort('name')} className="px-2 py-2 cursor-pointer hover:bg-accent/80 transition-colors group w-[17%] overflow-hidden">
                      <div className="flex items-center gap-1">
                        <span className="truncate">Job Name</span>
                        {renderSortIcon('name')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('fastrack')} className="px-1.5 py-2 cursor-pointer hover:bg-accent/80 transition-colors group w-[7%] text-center overflow-hidden">
                      <div className="flex items-center justify-center gap-0.5">
                        <Zap size={10} className="text-amber-500 fill-amber-500" />
                        <span className="truncate">Fastrack</span>
                        {renderSortIcon('fastrack')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('pages')} className="px-1 py-2 cursor-pointer hover:bg-accent/80 transition-colors group w-[5%] text-center overflow-hidden">
                      <div className="flex items-center justify-center gap-0.5">
                        <span className="truncate">Pages</span>
                        {renderSortIcon('pages')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('type')} className="px-1.5 py-2 cursor-pointer hover:bg-accent/80 transition-colors group w-[7%] overflow-hidden">
                      <div className="flex items-center gap-1">
                        <span className="truncate">Type</span>
                        {renderSortIcon('type')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('language')} className="px-1.5 py-2 cursor-pointer hover:bg-accent/80 transition-colors group w-[7%] overflow-hidden">
                      <div className="flex items-center gap-1">
                        <span className="truncate">Language</span>
                        {renderSortIcon('language')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('created')} className="px-1.5 py-2 cursor-pointer hover:bg-accent/80 transition-colors group w-[9%] overflow-hidden">
                      <div className="flex items-center gap-1">
                        <span className="truncate">Received On</span>
                        {renderSortIcon('created')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('dueDate')} className="px-1.5 py-2 cursor-pointer hover:bg-accent/80 transition-colors group w-[8%] overflow-hidden">
                      <div className="flex items-center gap-1">
                        <span className="truncate">Due Date</span>
                        {renderSortIcon('dueDate')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('dispatchedDate')} className="px-1.5 py-2 cursor-pointer hover:bg-accent/80 transition-colors group w-[9%] overflow-hidden">
                      <div className="flex items-center gap-1">
                        <span className="truncate">Dispatched Date</span>
                        {renderSortIcon('dispatchedDate')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('assignee')} className="px-1.5 py-2 cursor-pointer hover:bg-accent/80 transition-colors group w-[12%] overflow-hidden">
                      <div className="flex items-center gap-1">
                        <span className="truncate">Assignee</span>
                        {renderSortIcon('assignee')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('progress')} className="px-1.5 py-2 cursor-pointer hover:bg-accent/80 transition-colors group w-[11%] overflow-hidden">
                      <div className="flex items-center gap-1">
                        <span className="truncate">Progress</span>
                        {renderSortIcon('progress')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('status')} className="px-1.5 py-2 cursor-pointer hover:bg-accent/80 transition-colors group w-[10%] overflow-hidden">
                      <div className="flex items-center gap-1">
                        <span className="truncate">Status</span>
                        {renderSortIcon('status')}
                      </div>
                    </th>
                    <th className="px-1 py-2 text-center w-[4%]"></th>
                  </tr>

                  <tr className="border-b border-border bg-accent/20 font-normal normal-case tracking-normal">
                    {/* Select All placeholder */}
                    <th className="px-1 py-1 font-normal text-center overflow-hidden"></th>

                    {/* Job Name */}
                    <th className="px-1.5 py-1 font-normal overflow-hidden">
                      <div className="relative">
                        <input
                          type="text"
                          value={colFilters.name}
                          onChange={(e) => setColFilters(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Filter..."
                          className="w-full h-[26px] bg-background/90 hover:bg-background border border-border/80 hover:border-primary/50 focus:border-primary rounded-md px-2 text-[11px] font-medium text-text placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all font-sans shadow-xs"
                        />
                        {colFilters.name && (
                          <button
                            onClick={() => setColFilters(prev => ({ ...prev, name: '' }))}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                            title="Clear"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    </th>

                    {/* Fastrack filter */}
                    <th className="px-1 py-1 font-normal overflow-visible">
                      <Dropdown
                        options={[
                          { value: 'all', label: 'All' },
                          { value: 'fastrack', label: '⚡ Fastrack' },
                          { value: 'normal', label: 'Normal' },
                        ]}
                        value={colFilters.fastrack}
                        onChange={(val) => setColFilters(prev => ({ ...prev, fastrack: val }))}
                        className="h-[26px] py-0 px-1 text-[11px] font-medium bg-background/90 hover:bg-background border-border/80 rounded-md shadow-xs truncate"
                      />
                    </th>

                    {/* Pages */}
                    <th className="px-1 py-1 font-normal overflow-hidden">
                      <div className="relative">
                        <input
                          type="text"
                          value={colFilters.pages}
                          onChange={(e) => setColFilters(prev => ({ ...prev, pages: e.target.value }))}
                          placeholder="Pages"
                          className="w-full h-[26px] bg-background/90 hover:bg-background border border-border/80 hover:border-primary/50 focus:border-primary rounded-md px-1 text-[11px] text-center font-medium text-text placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all font-sans shadow-xs"
                        />
                        {colFilters.pages && (
                          <button
                            onClick={() => setColFilters(prev => ({ ...prev, pages: '' }))}
                            className="absolute right-1 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                            title="Clear"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    </th>

                    {/* Type */}
                    <th className="px-1.5 py-1 font-normal overflow-visible">
                      <Dropdown
                        options={[
                          { value: 'all', label: 'All Types' },
                          ...uniqueTypes.map(t => ({ value: t, label: t }))
                        ]}
                        value={colFilters.type}
                        onChange={(val) => setColFilters(prev => ({ ...prev, type: val }))}
                        className="h-[26px] py-0 px-2 text-[11px] font-medium bg-background/90 hover:bg-background border-border/80 rounded-md shadow-xs truncate"
                      />
                    </th>

                    {/* Language */}
                    <th className="px-1.5 py-1 font-normal overflow-visible">
                      <Dropdown
                        options={[
                          { value: 'all', label: 'All Langs' },
                          ...uniqueLanguages.map(l => ({ value: l, label: l }))
                        ]}
                        value={colFilters.language}
                        onChange={(val) => setColFilters(prev => ({ ...prev, language: val }))}
                        className="h-[26px] py-0 px-2 text-[11px] font-medium bg-background/90 hover:bg-background border-border/80 rounded-md shadow-xs truncate"
                      />
                    </th>

                    {/* Created */}
                    <th className="px-1 py-1 font-normal overflow-hidden">
                      <div className="relative">
                        <input
                          type="date"
                          value={colFilters.created}
                          onChange={(e) => setColFilters(prev => ({ ...prev, created: e.target.value }))}
                          className="w-full h-[26px] bg-background/90 hover:bg-background border border-border/80 hover:border-primary/50 focus:border-primary rounded-md px-1.5 text-[10px] font-medium text-text focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all font-sans shadow-xs"
                        />
                        {colFilters.created && (
                          <button
                            onClick={() => setColFilters(prev => ({ ...prev, created: '' }))}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                            title="Clear date"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    </th>

                    {/* Due Date */}
                    <th className="px-1 py-1 font-normal overflow-hidden">
                      <div className="relative">
                        <input
                          type="date"
                          value={colFilters.dueDate}
                          onChange={(e) => setColFilters(prev => ({ ...prev, dueDate: e.target.value }))}
                          className="w-full h-[26px] bg-background/90 hover:bg-background border border-border/80 hover:border-primary/50 focus:border-primary rounded-md px-1.5 text-[10px] font-medium text-text focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all font-sans shadow-xs"
                        />
                        {colFilters.dueDate && (
                          <button
                            onClick={() => setColFilters(prev => ({ ...prev, dueDate: '' }))}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                            title="Clear date"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    </th>

                    {/* Dispatched Date */}
                    <th className="px-1 py-1 font-normal overflow-hidden">
                      <div className="relative">
                        <input
                          type="date"
                          value={colFilters.dispatchedDate}
                          onChange={(e) => setColFilters(prev => ({ ...prev, dispatchedDate: e.target.value }))}
                          className="w-full h-[26px] bg-background/90 hover:bg-background border border-border/80 hover:border-primary/50 focus:border-primary rounded-md px-1.5 text-[10px] font-medium text-text focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all font-sans shadow-xs"
                        />
                        {colFilters.dispatchedDate && (
                          <button
                            onClick={() => setColFilters(prev => ({ ...prev, dispatchedDate: '' }))}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                            title="Clear date"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    </th>

                    {/* Assignee */}
                    <th className="px-1.5 py-1 font-normal overflow-visible">
                      <Dropdown
                        searchable
                        searchPlaceholder="Filter assignees..."
                        options={[
                          { value: 'all', label: 'All Assignees' },
                          { value: 'unassigned', label: 'Unassigned' },
                          ...assigneeOptions.map(a => ({ value: a, label: getUserDisplayName(a) }))
                        ]}
                        value={colFilters.assignee}
                        onChange={(val) => setColFilters(prev => ({ ...prev, assignee: val }))}
                        className="h-[26px] py-0 px-2 text-[11px] font-medium bg-background/90 hover:bg-background border-border/80 rounded-md shadow-xs truncate"
                      />
                    </th>

                    {/* Progress (Stage) */}
                    <th className="px-1.5 py-1 font-normal overflow-visible">
                      <Dropdown
                        options={[
                          { value: 'all', label: 'All Stages' },
                          { value: 'Add job', label: 'Add job' },
                          { value: 'Production', label: 'Production' },
                          { value: 'QC', label: 'QC' },
                          { value: 'Ready to Dispatch', label: 'Ready to Dispatch' },
                          { value: 'Completed', label: 'Completed' },
                        ]}
                        value={colFilters.stage}
                        onChange={(val) => setColFilters(prev => ({ ...prev, stage: val }))}
                        className="h-[26px] py-0 px-2 text-[11px] font-medium bg-background/90 hover:bg-background border-border/80 rounded-md shadow-xs truncate"
                      />
                    </th>

                    {/* Status */}
                    <th className="px-1.5 py-1 font-normal overflow-visible">
                      <Dropdown
                        options={[
                          { value: 'all', label: 'All Status' },
                          { value: 'fresh', label: 'Fresh' },
                          { value: 'yts', label: 'YTS' },
                          { value: 'in_progress', label: 'In-Progress' },
                          { value: 'ready_to_dispatch', label: 'Ready to Dispatch' },
                          { value: 'overdue', label: 'Overdue' },
                          { value: 'tomorrow_due', label: 'Due Soon' },
                          { value: 'completed', label: 'Completed (All)' },
                          { value: 'completed_ahead', label: 'Completed (Ahead)' },
                          { value: 'completed_ontime', label: 'Completed (On-time)' },
                          { value: 'completed_delay', label: 'Completed (Delay)' },
                        ]}
                        value={colFilters.status}
                        onChange={(val) => setColFilters(prev => ({ ...prev, status: val }))}
                        className="h-[26px] py-0 px-2 text-[11px] font-medium bg-background/90 hover:bg-background border-border/80 rounded-md shadow-xs truncate"
                      />
                    </th>

                    {/* Clear action */}
                    <th className="px-1 py-1 font-normal text-center overflow-hidden">
                      {hasColFilters ? (
                        <button
                          onClick={clearColFilters}
                          className="p-1 text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors inline-flex items-center justify-center"
                          title="Clear all column filters"
                        >
                          <X size={13} />
                        </button>
                      ) : null}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredJobs.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="text-center py-16 text-muted">
                        <p className="text-xs font-medium">No jobs match the current filters</p>
                        <button
                          onClick={clearFilters}
                          className="mt-2 text-xs text-primary hover:underline font-bold inline-block"
                        >
                          Clear filters
                        </button>
                      </td>
                    </tr>
                  ) : (
                    filteredJobs.map((job) => {
                      const percent = getStagePercent(job)
                      const currentAssignee = job.current_assignee || null

                      const assigneeOptions = [
                        { value: '', label: '— Unassigned —' },
                        ...users.filter(u => u.active_status).map(u => ({
                          value: u.user_name,
                          label: formatUserDisplayName(u)
                        }))
                      ]
                      if (currentAssignee && !assigneeOptions.some(o => o.value === currentAssignee)) {
                        assigneeOptions.push({ value: currentAssignee, label: getUserDisplayName(currentAssignee) })
                      }

                      const completed = isJobCompleted(job)

                      return (
                        <tr
                          key={job.id}
                          onClick={() => handleJobClick(job)}
                          className="hover:bg-accent/30 cursor-pointer transition-colors"
                        >
                          <td className="px-1 py-2 text-center overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            {job.current_stage_name === 'Ready to Dispatch' && !isJobCompleted(job) ? (
                              <input
                                type="checkbox"
                                checked={selectedJobIds.includes(job.id)}
                                onChange={() => toggleSelectJob(job.id)}
                                className="w-3.5 h-3.5 rounded border-border text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                title="Select for bulk dispatch"
                              />
                            ) : (
                              <input
                                type="checkbox"
                                disabled
                                className="w-3.5 h-3.5 rounded border-border opacity-20 cursor-not-allowed"
                                title="Only jobs in Ready to Dispatch stage can be dispatched"
                              />
                            )}
                          </td>
                          <td className="px-2 py-2 overflow-hidden">
                            <h3 className="font-semibold text-xs truncate m-0 text-text" title={job.pdf_filename}>{job.pdf_filename}</h3>
                            {job.epub_filename && (
                              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium truncate mt-0.5" title={job.epub_filename}>
                                {job.epub_filename}
                              </p>
                            )}
                          </td>
                          <td className="px-1.5 py-2 text-center overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            <div className="flex flex-col items-center gap-0.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  if (completed) return
                                  handleFastrackClick(e, job)
                                }}
                                disabled={completed || togglingFastrackId === job.id}
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border transition-all select-none ${
                                  completed
                                    ? job.is_fastrack
                                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-600/60 dark:text-amber-400/60 opacity-60 cursor-not-allowed'
                                      : 'bg-background/40 border-border/40 text-muted/50 opacity-50 cursor-not-allowed'
                                    : job.is_fastrack
                                      ? 'bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 ring-1 ring-amber-500/30 cursor-pointer'
                                      : 'bg-background/80 border-border/70 text-muted hover:text-text hover:border-border hover:bg-muted/30 cursor-pointer'
                                }`}
                                title={
                                  completed
                                    ? "Job completed — Fastrack status is locked"
                                    : job.is_fastrack
                                      ? "Fastrack Enabled — Click to disable"
                                      : "Normal — Click to enable Fastrack and set target date"
                                }
                              >
                                {togglingFastrackId === job.id ? (
                                  <Loader2 size={10} className="animate-spin text-amber-500" />
                                ) : (
                                  <Zap size={10} className={job.is_fastrack ? "text-amber-500 fill-amber-500" : "text-muted/60"} />
                                )}
                                <span>{job.is_fastrack ? "Fastrack" : "Normal"}</span>
                              </button>
                              {job.is_fastrack && job.fastrack_requested_date && (
                                <span
                                  className="text-[9px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-0.5 whitespace-nowrap"
                                  title={`Expected by customer: ${formatDateTime(job.fastrack_requested_date)}`}
                                >
                                  <Clock size={8} className="shrink-0" />
                                  {(() => {
                                    const raw = String(job.fastrack_requested_date).split('T')[0]
                                    const parts = raw.split('-')
                                    if (parts.length === 3) {
                                      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
                                      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                                    }
                                    return raw
                                  })()}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-1 py-2 text-center text-xs text-muted font-mono overflow-hidden">
                            {job.pdf_page_count || '-'}
                          </td>
                          <td className="px-1.5 py-2 text-xs text-muted font-medium truncate overflow-hidden" title={job.pdf_type || ''}>
                            {job.pdf_type ? job.pdf_type : '-'}
                          </td>
                          <td className="px-1.5 py-2 text-xs text-muted font-medium truncate overflow-hidden" title={job.pdf_language || ''}>
                            {job.pdf_language ? job.pdf_language : '-'}
                          </td>
                          <td className="px-1.5 py-2 text-[11px] text-muted font-medium overflow-hidden">
                            <p className="text-[11px] font-medium text-text m-0 truncate">{formatDate(job.created_at)}</p>
                            <p className="text-[9px] text-muted m-0 truncate">
                              {parseUtcDate(job.created_at)?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })}
                            </p>
                          </td>
                          <td
                            className={`px-1.5 py-2 text-[11px] font-medium overflow-hidden ${isManager ? 'text-primary hover:underline cursor-pointer' : 'text-muted'}`}
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
                              <div>
                                <p className={`text-[11px] font-medium m-0 truncate flex items-center gap-1 ${getJobStatusInfo(job).isOverdue ? 'text-red-600 dark:text-red-400 font-semibold' : getJobStatusInfo(job).isTomorrow ? 'text-orange-600 dark:text-orange-400 font-semibold' : ''}`}>
                                  {getJobStatusInfo(job).isOverdue && <Clock size={10} className="shrink-0" />}
                                  {getJobStatusInfo(job).isTomorrow && <Clock size={10} className="shrink-0" />}
                                  <span className="truncate">{formatDate(job.due_date)}</span>
                                </p>
                                <p className="text-[9px] text-muted m-0 truncate">
                                  {parseUtcDate(job.due_date)?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                </p>
                              </div>
                            ) : (
                              isManager ? <span className="text-primary text-[11px]">Set Date</span> : '-'
                            )}
                          </td>
                          <td className="px-1.5 py-2 text-[11px] text-muted font-medium overflow-hidden">
                            {(() => {
                              const dispDate = job.dispatched_at || getCompletedDate(job)
                              if (!dispDate) return <span className="text-muted/60">-</span>
                              return (
                                <div>
                                  <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 m-0 truncate">
                                    {formatDate(dispDate)}
                                  </p>
                                  <p className="text-[9px] text-muted m-0 truncate">
                                    {parseUtcDate(dispDate)?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                  </p>
                                </div>
                              )
                            })()}
                          </td>
                          <td className="px-1.5 py-2 overflow-visible" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1 text-muted min-w-0">
                              <User size={12} className="text-muted/70 shrink-0" />
                              <div className="min-w-0 flex-1 truncate">
                                <Dropdown
                                  variant="inline"
                                  searchable
                                  searchPlaceholder="Search assignees..."
                                  value={currentAssignee || ''}
                                  onChange={(val) => assignUser(job.id, val)}
                                  className="bg-transparent border-0 text-primary font-medium p-0 hover:text-primary-hover w-full shadow-none h-auto min-h-0 focus:border-transparent focus:ring-0 text-[11px] truncate"
                                  options={assigneeOptions}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-1.5 py-2 overflow-hidden">
                            <div className="flex items-center justify-between text-[9px] text-muted font-bold mb-1">
                              <span className="truncate">{job.current_stage_name}</span>
                              <span className="shrink-0 ml-1">{percent}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary transition-all duration-500 rounded-full"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </td>
                          <td className="px-1.5 py-2 overflow-hidden">
                            <span className={`capitalize font-bold px-1.5 py-0.5 rounded text-[9px] border truncate inline-block max-w-full ${getStatusBadgeClass(job)}`}>
                              {getStatusText(job)}
                            </span>
                          </td>
                          <td className="px-1 py-2 text-center overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1">
                              {job.current_stage_name === 'Ready to Dispatch' && !isJobCompleted(job) && (
                                <button
                                  onClick={(e) => handleSingleDispatch(e, job.id)}
                                  disabled={dispatchingJobId === job.id}
                                  className="p-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded transition-colors"
                                  title="Dispatch & Deliver to FTP"
                                >
                                  {dispatchingJobId === job.id ? (
                                    <Loader2 size={15} className="animate-spin text-emerald-600" />
                                  ) : (
                                    <Send size={15} />
                                  )}
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setShowDeleteModal(job.id); }}
                                  className="p-1 text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors"
                                  title="Delete Job"
                                >
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    }))}
                </tbody>
              </table>
            </div>
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
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredJobs.map((job) => {
              const percent = getStagePercent(job)
              const currentAssignee = job.current_assignee || null

              const assigneeOptions = [
                { value: '', label: '— Unassigned —' },
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
                      <div className="flex items-start gap-2 min-w-0">
                        {job.current_stage_name === 'Ready to Dispatch' && !isJobCompleted(job) && (
                          <div onClick={(e) => e.stopPropagation()} className="pt-0.5 shrink-0">
                            <input
                              type="checkbox"
                              checked={selectedJobIds.includes(job.id)}
                              onChange={() => toggleSelectJob(job.id)}
                              className="w-3.5 h-3.5 rounded border-border text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                              title="Select for bulk dispatch"
                            />
                          </div>
                        )}
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
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {job.current_stage_name === 'Ready to Dispatch' && !isJobCompleted(job) && (
                          <button
                            onClick={(e) => handleSingleDispatch(e, job.id)}
                            disabled={dispatchingJobId === job.id}
                            className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded transition-colors"
                            title="Dispatch & Deliver to FTP"
                          >
                            {dispatchingJobId === job.id ? (
                              <Loader2 size={15} className="animate-spin text-emerald-600" />
                            ) : (
                              <Send size={15} />
                            )}
                          </button>
                        )}
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
                          searchPlaceholder="Search assignees..."
                          value={currentAssignee || ''}
                          onChange={(val) => assignUser(job.id, val)}
                          className="bg-transparent border-0 text-primary font-medium p-0 hover:text-primary-hover w-auto shadow-none h-auto min-h-0 focus:border-transparent focus:ring-0 text-[11px]"
                          dropdownClassName="w-56 text-[11px] font-normal"
                          options={assigneeOptions}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="flex flex-col items-end gap-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              if (isJobCompleted(job)) return
                              handleFastrackClick(e, job)
                            }}
                            disabled={isJobCompleted(job) || togglingFastrackId === job.id}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all select-none ${
                              isJobCompleted(job)
                                ? job.is_fastrack
                                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-600/60 dark:text-amber-400/60 opacity-60 cursor-not-allowed'
                                  : 'bg-background/40 border-border/40 text-muted/50 opacity-50 cursor-not-allowed'
                                : job.is_fastrack
                                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 ring-1 ring-amber-500/30 cursor-pointer'
                                  : 'bg-background/80 border-border/70 text-muted hover:text-text hover:border-border hover:bg-muted/30 cursor-pointer'
                            }`}
                            title={
                              isJobCompleted(job)
                                ? "Job completed — Fastrack status is locked"
                                : job.is_fastrack
                                  ? "Fastrack Enabled — Click to disable"
                                  : "Normal — Click to enable Fastrack and set target date"
                            }
                          >
                            {togglingFastrackId === job.id ? (
                              <Loader2 size={10} className="animate-spin text-amber-500" />
                            ) : (
                              <Zap size={10} className={job.is_fastrack ? "text-amber-500 fill-amber-500" : "text-muted/60"} />
                            )}
                            <span>{job.is_fastrack ? "Fastrack" : "Normal"}</span>
                          </button>
                          {job.is_fastrack && job.fastrack_requested_date && (
                            <span
                              className="text-[8px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-0.5 whitespace-nowrap"
                              title={`Expected by customer: ${formatDate(job.fastrack_requested_date)}`}
                            >
                              <Clock size={8} className="shrink-0" />
                              {formatDate(job.fastrack_requested_date)}
                            </span>
                          )}
                        </div>
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

      {/* Add Job Modal */}
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

      {/* Delete Confirmation Modal */}
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

      {/* Edit Due Date Modal */}
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
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-muted">New Due Date</label>
                    {showEditDueDateModal && (
                      <button
                        type="button"
                        onClick={() => {
                          const isImg = (showEditDueDateModal.pdf_type || '').toLowerCase().includes('image')
                          const days = isImg ? 6 : 3
                          const base = showEditDueDateModal.created_at ? new Date(showEditDueDateModal.created_at) : new Date()
                          const result = new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
                          setNewDueDate(result.toISOString().slice(0, 10))
                        }}
                        className="text-[11px] text-primary hover:underline font-semibold"
                        title="Calculate based on: Text (3 days) | Image (6 days)"
                      >
                        Auto-calc ({((showEditDueDateModal.pdf_type || '').toLowerCase().includes('image') ? '6d' : '3d')})
                      </button>
                    )}
                  </div>
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

      {/* Fastrack Expected Date Modal */}
      {
        fastrackModalJob && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
            <div className="bg-card w-full max-w-sm rounded-xl shadow-2xl border border-border flex flex-col p-5 gap-4">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    <Zap size={16} className="fill-amber-500 text-amber-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-text text-sm m-0">Enable Fastrack</h3>
                    <p className="text-[10px] text-muted m-0 truncate max-w-[200px]" title={fastrackModalJob.pdf_filename}>
                      {fastrackModalJob.pdf_filename}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFastrackModalJob(null)}
                  className="text-muted hover:text-text transition-colors p-1 rounded-md"
                >
                  <XCircle size={16} />
                </button>
              </div>

              <form onSubmit={submitFastrackEnable} className="flex flex-col gap-4">
                <div className="bg-muted/30 border border-border/60 rounded-lg p-2.5 text-xs text-muted flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text">Current Due Date:</span>
                    <span className="font-mono text-amber-600 dark:text-amber-400 font-bold">
                      {fastrackModalJob.due_date ? formatDate(fastrackModalJob.due_date) : 'No due date set'}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground m-0">
                    Set the target date this Fastrack job should be completed by (on or before current due date).
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-text flex items-center gap-1">
                    <Calendar size={12} className="text-amber-500" />
                    Expected Completion Date
                  </label>
                  <input
                    type="date"
                    required
                    value={fastrackExpectedDate}
                    max={fastrackModalJob.due_date ? new Date(fastrackModalJob.due_date.endsWith('Z') ? fastrackModalJob.due_date : fastrackModalJob.due_date + 'Z').toISOString().slice(0, 10) : undefined}
                    onChange={(e) => setFastrackExpectedDate(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs text-text focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all shadow-xs"
                    style={{ colorScheme: 'light dark' }}
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2 border-t border-border/60">
                  <button
                    type="button"
                    onClick={() => setFastrackModalJob(null)}
                    disabled={savingFastrack}
                    className="px-3 py-1.5 bg-background border border-border hover:bg-muted/50 text-text font-semibold rounded-lg transition-colors text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingFastrack || !fastrackExpectedDate}
                    className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg transition-colors flex items-center gap-1.5 text-xs shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingFastrack && <Loader2 size={12} className="animate-spin" />}
                    Confirm & Enable Fastrack
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
