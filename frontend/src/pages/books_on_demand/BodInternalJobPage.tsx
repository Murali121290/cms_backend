import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Upload, ArrowRight, User, CheckCircle2, Clock, Layers, Calendar, XCircle, CheckCircle, Loader2, FileText, Edit3, Check, Send, ExternalLink, Zap, Eye, FileSpreadsheet, X, Image as ImageIcon, PauseCircle, HelpCircle, AlertTriangle, RotateCcw, Paperclip, File } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useRBAC } from '@/hooks/useRBAC'
import { usersApi } from '@/api/users'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { toast } from '@/store/useToastStore'
import api from '@/api/client'
import { formatDateTime as fmtUtcDateTime, formatDate, parseUtcDate } from '@/utils/dateUtils'
import { useUsersStore } from '@/stores/usersStore'
import { useSessionStore } from '@/stores/sessionStore'

export const BOD_LANGUAGES = [
  'English',
  'German',
  'French',
  'Danish',
  'Swedish',
  'Finnish',
  'Italian',
  'Spanish',
  'Portuguese',
  'Norwegian',
  'Dutch',
  'Catalan',
  'Valencian',
]

export function BodInternalJobPage() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const { isAdmin } = useRBAC()
  const viewer = useSessionStore(s => s.viewer)

  const [job, setJob] = useState<any>(null)

  useDocumentTitle("Inkflow - Books on Demand")
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isUploadingCover, setIsUploadingCover] = useState(false)
  const [isOpeningValidator, setIsOpeningValidator] = useState(false)
  const [activeTab, setActiveTab] = useState<'stage' | 'assignment' | 'duedate' | 'priority' | 'files' | 'status' | 'reopen'>('stage')
  const [holdSupportFilter, setHoldSupportFilter] = useState<'all' | 'Hold' | 'Support'>('all')
  const [aceFile, setAceFile] = useState<File | null>(null)
  const [epubcheckFile, setEpubcheckFile] = useState<File | null>(null)
  const [isUploadingReports, setIsUploadingReports] = useState(false)

  // Reopen Modal State
  const [showReopenModal, setShowReopenModal] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [reopenFiles, setReopenFiles] = useState<File[]>([])
  const [isSubmittingReopen, setIsSubmittingReopen] = useState(false)

  // Hold / Support Modal State
  const [showHoldSupportModal, setShowHoldSupportModal] = useState(false)
  const [holdSupportType, setHoldSupportType] = useState<'Hold' | 'Support' | 'Active'>('Hold')
  const [holdSupportDescription, setHoldSupportDescription] = useState('')
  const [holdSupportFiles, setHoldSupportFiles] = useState<File[]>([])
  const [isSubmittingHoldSupport, setIsSubmittingHoldSupport] = useState(false)

  const [showQCModal, setShowQCModal] = useState(false)
  const [qcChecks, setQcChecks] = useState({
    ace: false,
    epubCheck: false,
    manualQC: false
  })

  // Build chronological sequence of stage events (without artificial grouping, preserving full cycle progression)
  const getChronologicalStageTimeline = (jobObj: any) => {
    if (!jobObj) return []
    const assigned: any[] = Array.isArray(jobObj.assigned_users) ? jobObj.assigned_users : []
    const stageHist = jobObj.stage_history || {}
    const reopens: any[] = Array.isArray(jobObj.reopen_history) ? jobObj.reopen_history : []
    const isJobDone = jobObj.status === 'Completed' || jobObj.current_stage_name === 'Archive'

    // If job has never been reopened, return simple linear stage history
    if (reopens.length === 0) {
      const standardOrder = ['Add job', 'Job Analysis', 'Production', 'QC', 'Ready to Dispatch', 'Archive']
      const items: any[] = []
      for (const s of standardOrder) {
        const d = stageHist[s]
        if (!d && s !== jobObj.current_stage_name) continue
        items.push({
          stageName: s,
          cycleVersion: null,
          startTime: d?.start_time || null,
          endTime: d?.end_time || null,
          assignee: d?.assignee || null,
          dispatchedBy: d?.dispatched_by || null,
          isCurrent: s === jobObj.current_stage_name && !isJobDone
        })
      }
      return items
    }

    // Reopen cycles present: reconstruct exact chronological flow
    const events: any[] = []

    // 1. Add job
    const addJobData = stageHist['Add job'] || {}
    events.append = undefined // safety
    events.push({
      stageName: 'Add job',
      cycleVersion: null,
      startTime: addJobData.start_time || null,
      endTime: addJobData.end_time || null,
      assignee: addJobData.assignee || null,
      dispatchedBy: null,
      isCurrent: false
    })

    let currEvent: any = null
    let currCycleVersion: string | null = null

    for (const entry of assigned) {
      const st = entry.stage
      const action = entry.action || ''
      const user = entry.user_id
      const t = entry.time

      // Check if entry is a reopen trigger
      if (action.includes('Reopened to QC')) {
        const m = action.match(/\((R\d+)\)/)
        currCycleVersion = m ? m[1] : 'Reopen'
      }

      if (!currEvent || currEvent.stageName !== st) {
        if (currEvent) {
          if (!currEvent.endTime) {
            currEvent.endTime = t
          }
          events.push(currEvent)
        }

        let startT = t
        if (currCycleVersion === null) {
          if (st === 'Production' && stageHist['Production']?.start_time) {
            startT = stageHist['Production'].start_time
          } else if (st === 'Job Analysis' && stageHist['Job Analysis']?.start_time) {
            startT = stageHist['Job Analysis'].start_time
          } else if (st === 'QC' && stageHist['Production']?.end_time) {
            startT = stageHist['Production'].end_time
          }
        }

        currEvent = {
          stageName: st,
          cycleVersion: currCycleVersion,
          startTime: startT,
          endTime: null,
          assignee: user,
          dispatchedBy: null,
          isCurrent: false
        }
      } else {
        if (user) {
          currEvent.assignee = user
        }
      }

      if (action.includes('Dispatched to FTP by')) {
        const dispUser = user || entry.assigned_by
        currEvent.dispatchedBy = dispUser
        currEvent.endTime = t
        events.push(currEvent)

        // Following FTP dispatch, Archive completes
        events.push({
          stageName: 'Archive',
          cycleVersion: currCycleVersion,
          startTime: t,
          endTime: t,
          assignee: dispUser,
          dispatchedBy: dispUser,
          isCurrent: false
        })
        currEvent = null
      }
    }

    if (currEvent) {
      events.push(currEvent)
    }

    // Set current active stage
    for (let idx = 0; idx < events.length; idx++) {
      const isCur = idx === events.length - 1 && !isJobDone
      events[idx].isCurrent = isCur
      if (isCur) {
        events[idx].endTime = null
      }
    }

    return events
  }

  const formatDateTime = (dateStr: string | null) => {
    return fmtUtcDateTime(dateStr)
  }

  const fetchJob = async () => {
    try {
      const { data } = await api.get(`/bod/jobs/${jobId}`)
      setJob(data)
    } catch (err) {
      console.error('Failed to fetch job', err)
      toast.error('Failed to load job details')
      navigate('/bod/internal')
    } finally {
      setLoading(false)
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
    fetchJob()
    fetchUsers()
    const timer = setInterval(() => {
      fetchJob()
    }, 5000)
    return () => clearInterval(timer)
  }, [jobId])

  const advanceStage = async () => {
    if (!job) return
    setIsAdvancing(true)

    // If in QC stage, we must upload the reports first
    if (job.current_stage_name === 'QC') {
      try {
        setIsUploadingReports(true)
        const formData = new FormData()
        if (aceFile) formData.append('ace_report', aceFile)
        if (epubcheckFile) formData.append('epubcheck_report', epubcheckFile)

        await api.post(`/bod/jobs/${job.id}/upload-qc-reports`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
      } catch (err: any) {
        console.error("Failed to upload reports", err)
        toast.error(err.response?.data?.detail || "Failed to upload QC reports.")
        setIsAdvancing(false)
        return // Stop execution if validation or upload fails
      } finally {
        setIsUploadingReports(false)
      }
    }

    try {
      await api.post(`/bod/jobs/${jobId}/advance`)
      toast.success("QC completed. Job moved to Ready to Dispatch.")
      setShowQCModal(false)
      navigate('/bod/internal')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to advance stage")
    } finally {
      setIsAdvancing(false)
    }
  }

  const [isDispatching, setIsDispatching] = useState(false)

  const dispatchJob = async () => {
    if (!job) return
    setIsDispatching(true)
    try {
      await api.post(`/bod/jobs/${jobId}/dispatch`, {
        dispatched_by: viewer?.username || undefined
      })
      toast.success("Job dispatched successfully and uploaded to FTP!")
      fetchJob()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to dispatch job to FTP")
    } finally {
      setIsDispatching(false)
    }
  }

  const openInEpubValidator = async () => {
    if (!job) return
    if (!job.epub_filename) {
      toast.error("No processed EPUB found. Please upload or produce an EPUB first.")
      return
    }

    setIsOpeningValidator(true)
    try {
      const { data } = await api.post(`/bod/jobs/${job.id}/sync-validator`)
      toast.success("Opening in EPUB Validator...")
      const projectId = data.project_id || data.project?.id || data.folder_name
      navigate(`/post-production/epub-validator/${projectId}?from=bod&bodJobId=${job.id}`)
    } catch (err: any) {
      console.error("Failed to sync to EPUB Validator", err)
      toast.error(err.response?.data?.detail || "Failed to open in EPUB Validator")
    } finally {
      setIsOpeningValidator(false)
    }
  }

  const proceedToJobAnalysis = async () => {
    if (!job) return
    setIsAdvancing(true)
    try {
      await api.post(`/bod/jobs/${jobId}/advance`)
      toast.success("Job moved to Job Analysis stage")
      fetchJob()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to proceed to Job Analysis")
    } finally {
      setIsAdvancing(false)
    }
  }

  const proceedToProduction = async () => {
    if (!job) return
    setIsAdvancing(true)
    try {
      await api.post(`/bod/jobs/${jobId}/advance`)
      toast.success("Job moved to Production stage")
      navigate('/bod/internal')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to proceed to Production")
      setIsAdvancing(false)
    }
  }

  const assignUser = async (username: string) => {
    if (!job) return
    try {
      await api.post(`/bod/jobs/${job.id}/assign`, { user_id: username || null })
      toast.success(username ? "User assigned" : "User unassigned")
      fetchJob()
    } catch (err) {
      toast.error("Failed to assign user")
    }
  }

  // Job Analysis Step State & Handlers
  const [isEditingAnalysis, setIsEditingAnalysis] = useState(false)
  const [isSavingAnalysis, setIsSavingAnalysis] = useState(false)
  const [analysisPages, setAnalysisPages] = useState<number | string>('')
  const [analysisEisbn, setAnalysisEisbn] = useState<string>('')
  const [analysisType, setAnalysisType] = useState<string>('Text PDF')
  const [analysisLanguage, setAnalysisLanguage] = useState<string>('English')
  const [analysisDueDate, setAnalysisDueDate] = useState<string>('')
  const [analysisReason, setAnalysisReason] = useState<string>('')

  const calculateDefaultDueDate = (type: string, baseDate?: string | Date) => {
    const isImage = (type || '').toLowerCase().includes('image')
    const days = isImage ? 6 : 3

    const base = baseDate ? new Date(baseDate) : new Date()
    const result = new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
    return result.toISOString().slice(0, 10)
  }

  const startEditingAnalysis = () => {
    if (!job) return
    setAnalysisPages(job.pdf_page_count ?? '')
    setAnalysisEisbn(job.eisbn || '')
    setAnalysisType(job.pdf_type || 'Text PDF')
    setAnalysisLanguage(job.pdf_language || 'English')
    const dStr = job.due_date ? (parseUtcDate(job.due_date)?.toISOString().slice(0, 10) || '') : ''
    setAnalysisDueDate(dStr)
    setAnalysisReason('')
    setIsEditingAnalysis(true)
  }

  const saveAnalysis = async () => {
    if (!job) return
    if (!analysisReason.trim()) {
      toast.error("Update reason is mandatory")
      return
    }
    setIsSavingAnalysis(true)
    try {
      const pageCountNum = analysisPages !== '' ? parseInt(String(analysisPages), 10) : null
      const formattedDueDate = analysisDueDate ? new Date(`${analysisDueDate}T23:59:59Z`).toISOString() : ''

      await api.put(`/bod/jobs/${job.id}/analysis`, {
        pdf_page_count: isNaN(pageCountNum as any) ? null : pageCountNum,
        eisbn: analysisEisbn.trim() || null,
        pdf_type: analysisType,
        pdf_language: analysisLanguage,
        due_date: formattedDueDate,
        due_date_reason: analysisReason.trim()
      })
      toast.success("Job analysis updated successfully")
      setIsEditingAnalysis(false)
      fetchJob()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to update job analysis")
    } finally {
      setIsSavingAnalysis(false)
    }
  }

  const uploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return
    const file = e.target.files[0]

    const formData = new FormData()
    formData.append('file', file)

    setIsUploadingCover(true)
    try {
      await api.post(`/bod/jobs/${jobId}/upload-cover`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success("Cover image uploaded successfully")
      fetchJob()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to upload cover image")
    } finally {
      setIsUploadingCover(false)
      if (e.target) e.target.value = ''
    }
  }

  const uploadEpub = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return
    const file = e.target.files[0]

    const MAX_EPUB_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB
    if (file.size > MAX_EPUB_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2)
      toast.error(`EPUB file size (${sizeMb} MB) exceeds the maximum allowed limit of 100 MB.`)
      if (e.target) e.target.value = ''
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    setIsUploading(true)
    try {
      await api.post(`/bod/jobs/${jobId}/upload-epub`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      if (job?.current_stage_name === 'QC') {
        toast.success("EPUB re-uploaded and validator workspace refreshed")
        fetchJob()
      } else {
        toast.success("EPUB uploaded and moved to QC")
        navigate('/bod/internal')
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to upload EPUB")
    } finally {
      setIsUploading(false)
      if (e.target) e.target.value = ''
    }
  }

  const downloadPdf = async () => {
    try {
      const response = await api.get(`/bod/jobs/${jobId}/download-pdf`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', job.pdf_filename)
      document.body.appendChild(link)
      link.click()
      link.parentNode?.removeChild(link)
      fetchJob()
    } catch (err) {
      toast.error("Failed to download PDF")
    }
  }

  const downloadCover = async () => {
    try {
      const response = await api.get(`/bod/jobs/${jobId}/download-cover`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', job.cover_filename || 'cover.jpg')
      document.body.appendChild(link)
      link.click()
      link.parentNode?.removeChild(link)
    } catch (err) {
      toast.error("Failed to download cover image")
    }
  }

  const downloadEpub = async () => {
    try {
      const response = await api.get(`/bod/jobs/${jobId}/download-epub`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', job.epub_filename)
      document.body.appendChild(link)
      link.click()
      link.parentNode?.removeChild(link)
    } catch (err) {
      toast.error("Failed to download EPUB")
    }
  }

  const downloadAce = async () => {
    try {
      const response = await api.get(`/bod/jobs/${jobId}/download-ace`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', job.ace_report_filename || `${job.pdf_filename.replace('.pdf', '')}_ace_report.zip`)
      document.body.appendChild(link)
      link.click()
      link.parentNode?.removeChild(link)
    } catch (err) {
      toast.error("Failed to download ACE report")
    }
  }

  const downloadEpubcheck = async () => {
    try {
      const response = await api.get(`/bod/jobs/${jobId}/download-epubcheck`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', job.epubcheck_report_filename || `${job.pdf_filename.replace('.pdf', '')}_log.txt`)
      document.body.appendChild(link)
      link.click()
      link.parentNode?.removeChild(link)
    } catch (err) {
      toast.error("Failed to download Epubcheck report")
    }
  }

  const [historyCsvContent, setHistoryCsvContent] = useState<string | null>(null)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const downloadHistoryCsv = async () => {
    try {
      const response = await api.get(`/bod/jobs/${jobId}/download-history-csv`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', 'history.csv')
      document.body.appendChild(link)
      link.click()
      link.parentNode?.removeChild(link)
    } catch (err) {
      toast.error("Failed to download history.csv")
    }
  }

  const viewHistoryCsv = async () => {
    setLoadingHistory(true)
    try {
      const response = await api.get(`/bod/jobs/${jobId}/view-history-csv`)
      setHistoryCsvContent(response.data?.content || '')
      setShowHistoryModal(true)
    } catch (err) {
      toast.error("Failed to load history.csv content")
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleHoldSupportSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!holdSupportDescription.trim()) {
      toast.error('Please enter a description or reason.')
      return
    }

    try {
      setIsSubmittingHoldSupport(true)
      const formData = new FormData()
      formData.append('status', holdSupportType)
      formData.append('description', holdSupportDescription.trim())
      for (const file of holdSupportFiles) {
        formData.append('files', file)
      }

      const res = await api.put(`/bod/jobs/${job.id}/hold-support`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success(holdSupportType === 'Active' ? 'Query resolved & job resumed (Unassigned)' : `Job status updated to ${holdSupportType}`)
      setShowHoldSupportModal(false)
      setHoldSupportDescription('')
      setHoldSupportFiles([])
      navigate('/bod/internal')
    } catch (err: any) {
      console.error('Failed to update job status:', err)
      toast.error(err.response?.data?.detail || 'Failed to update job status')
    } finally {
      setIsSubmittingHoldSupport(false)
    }
  }

  const handleReopenSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reopenReason.trim()) {
      toast.error('Please enter a reason/correction for reopening.')
      return
    }

    try {
      setIsSubmittingReopen(true)
      const formData = new FormData()
      formData.append('reason', reopenReason.trim())
      for (const file of reopenFiles) {
        formData.append('files', file)
      }

      const res = await api.post(`/bod/jobs/${job.id}/reopen`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success(res.data?.message || 'Job reopened successfully')
      setShowReopenModal(false)
      setReopenReason('')
      setReopenFiles([])
      navigate('/bod/internal')
    } catch (err: any) {
      console.error('Failed to reopen job:', err)
      toast.error(err.response?.data?.detail || 'Failed to reopen job')
    } finally {
      setIsSubmittingReopen(false)
    }
  }

  const openHoldSupportModal = () => {
    if (job.status === 'Hold' || job.status === 'Support') {
      setHoldSupportType('Active')
    } else {
      setHoldSupportType('Hold')
    }
    setHoldSupportDescription('')
    setHoldSupportFiles([])
    setShowHoldSupportModal(true)
  }

  if (loading) {
    return <div className="p-6 text-muted">Loading...</div>
  }

  if (!job) {
    return null
  }

  const isCompleted = job.status === 'Completed'
  const canUploadEpub = !isCompleted && (job.current_stage_name === 'Production' || job.current_stage_name === 'QC')

  const getUserDisplayName = (username: string | null | undefined) => {
    if (!username) return ''
    return useUsersStore.getState().getUserDisplayNameByUsername(username)
  }

  const assigneeOptions = [
    { value: '', label: '— Unassigned —' },
    ...users.filter((u: any) => u.active_status !== false).map((u: any) => ({
      value: u.user_name || u.username,
      label: getUserDisplayName(u.user_name || u.username) || (u.user_name || u.username)
    }))
  ]
  if (job?.current_assignee && !assigneeOptions.some(o => o.value === job.current_assignee)) {
    assigneeOptions.push({ value: job.current_assignee, label: getUserDisplayName(job.current_assignee) })
  }

  return (
    <div className="space-y-6 w-full max-w-[1400px] mx-auto p-6 text-text animate-in fade-in">
      {/* Header / Breadcrumb */}
      <div className="flex items-center gap-3 text-muted">
        <button
          onClick={() => navigate('/bod/internal')}
          className="hover:text-primary transition-colors flex items-center gap-1 text-sm font-semibold"
        >
          <ArrowLeft size={16} /> Back to Jobs
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold font-serif text-text m-0 flex flex-wrap items-center gap-3">
            <span className="truncate">{job.pdf_filename}</span>
            {job.revision && (
              <span
                className="font-bold font-mono px-2 py-0.5 rounded-md text-[10px] bg-rose-500/15 border border-rose-500/40 text-rose-600 dark:text-rose-400 tracking-wider shrink-0"
                title={`Revision: ${job.revision}`}
              >
                {job.revision}
              </span>
            )}
            <span className={`capitalize font-bold px-2.5 py-0.5 rounded-md text-[10px] border tracking-wider shrink-0 ${job.status === 'Completed'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
              : job.status === 'Hold'
                ? 'bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-600 dark:text-fuchsia-400'
                : job.status === 'Support'
                  ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-600 dark:text-indigo-400'
                  : 'bg-primary/10 border-primary/20 text-primary'
              }`}>
              {job.status}
            </span>
            {job.is_fastrack && (
              <span
                className="inline-flex items-center gap-1 font-bold px-2.5 py-0.5 rounded-md text-[10px] bg-amber-500/15 border border-amber-500/40 text-amber-600 dark:text-amber-400 tracking-wider shadow-xs shrink-0"
                title={job.fastrack_requested_date ? `Fastrack expected by customer: ${formatDateTime(job.fastrack_requested_date)}` : 'Fastrack enabled'}
              >
                <Zap size={11} className="fill-amber-500 text-amber-500" />
                Fastrack
              </span>
            )}
          </h1>
          <div className="flex items-center gap-4 mt-1.5 flex-wrap">
            <p className="text-sm text-muted m-0">{job.client_name} • Stage: <strong className="text-text">{job.current_stage_name}</strong></p>

            <div className="flex items-center gap-1.5 text-muted text-xs">
              <User size={13} className="text-muted/70" />
              <span className="font-semibold text-text">
                {getUserDisplayName(job.current_assignee) || job.current_assignee || 'Unassigned'}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {isCompleted && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setReopenReason('')
                setShowReopenModal(true)
              }}
              className="border-rose-500/50 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400 font-semibold h-9 px-3.5"
              leftIcon={<RotateCcw size={14} className="text-rose-500" />}
            >
              Reopen Job
            </Button>
          )}

          {!isCompleted && (
            <Button
              variant="outline"
              size="sm"
              onClick={openHoldSupportModal}
              className={`h-9 px-3.5 font-semibold ${job.status === 'Hold' || job.status === 'Support'
                ? "border-emerald-500/50 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                : "border-border text-text hover:bg-accent"
                }`}
              leftIcon={
                job.status === 'Hold' || job.status === 'Support'
                  ? <CheckCircle size={14} className="text-emerald-500" />
                  : <AlertTriangle size={14} className="text-amber-500" />
              }
            >
              {job.status === 'Hold' || job.status === 'Support' ? 'Resolve' : 'Report'}
            </Button>
          )}

          {!isCompleted && job.current_stage_name === 'Add job' && (
            <Button
              variant="primary"
              size="sm"
              onClick={proceedToJobAnalysis}
              disabled={isAdvancing}
              className="h-9 px-3.5 font-semibold"
              rightIcon={!isAdvancing ? <ArrowRight size={14} /> : undefined}
            >
              {isAdvancing ? 'Proceeding...' : 'Proceed to Job Analysis'}
            </Button>
          )}

          {!isCompleted && job.current_stage_name === 'Job Analysis' && (
            <Button
              variant="primary"
              size="sm"
              onClick={proceedToProduction}
              disabled={isAdvancing}
              className="h-9 px-3.5 font-semibold"
              rightIcon={!isAdvancing ? <ArrowRight size={14} /> : undefined}
            >
              {isAdvancing ? 'Proceeding...' : 'Proceed to Production'}
            </Button>
          )}

          {!isCompleted && job.epub_filename && (
            <Button
              variant="outline"
              size="sm"
              onClick={openInEpubValidator}
              disabled={isOpeningValidator}
              className="text-primary hover:text-primary-hover border-primary/30 hover:border-primary h-9 px-3.5 font-semibold"
              leftIcon={isOpeningValidator ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
            >
              {isOpeningValidator ? 'Opening Validator...' : 'Open in EPUB Validator'}
            </Button>
          )}

          {!isCompleted && job.current_stage_name === 'Ready to Dispatch' && (
            <Button
              variant="primary"
              size="sm"
              onClick={dispatchJob}
              disabled={isDispatching}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold h-9 px-3.5"
              leftIcon={isDispatching ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            >
              {isDispatching ? 'Dispatching to FTP...' : 'Dispatch'}
            </Button>
          )}

          {canUploadEpub && (
            <div className="relative inline-block">
              <input
                type="file"
                accept=".epub"
                onChange={uploadEpub}
                disabled={isUploading}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10 disabled:cursor-not-allowed"
                title="Upload EPUB"
              />
              <Button
                variant="primary"
                size="sm"
                disabled={isUploading}
                className="h-9 px-3.5 font-semibold"
                leftIcon={!isUploading ? <Upload size={14} /> : undefined}
              >
                {isUploading ? 'Uploading...' : 'Upload EPUB'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Ready to Dispatch Stage Card */}
      {job.current_stage_name === 'Ready to Dispatch' && !isCompleted && (
        <div className="bg-card border rounded-xl p-5 shadow-sm transition-all border-emerald-500/40 ring-1 ring-emerald-500/20">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg">
                <Send size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text m-0 flex items-center gap-2">
                  Ready to Dispatch
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    Awaiting FTP Delivery
                  </span>
                </h3>
                <p className="text-xs text-muted m-0">QC reports verified. Click Dispatch to package deliverables into a ZIP and upload to FTP delivery server.</p>
              </div>
            </div>

            <Button
              variant="primary"
              onClick={dispatchJob}
              disabled={isDispatching}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2"
              leftIcon={isDispatching ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            >
              {isDispatching ? 'Uploading to FTP...' : 'Dispatch & Deliver to FTP'}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4">
            <div className="p-3 bg-background/70 border border-border/60 rounded-lg flex items-center justify-between">
              <div className="min-w-0 pr-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted block mb-0.5">Processed EPUB</span>
                <p className="text-xs font-semibold text-text truncate m-0">{job.epub_filename || 'Not available'}</p>
              </div>
              {job.epub_filename && (
                <Button size="sm" variant="ghost" onClick={downloadEpub} className="h-7 px-2 text-xs text-primary" title="Download EPUB">
                  <Download size={13} />
                </Button>
              )}
            </div>

            <div className="p-3 bg-background/70 border border-border/60 rounded-lg flex items-center justify-between">
              <div className="min-w-0 pr-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted block mb-0.5">ACE Report</span>
                <p className="text-xs font-semibold text-text truncate m-0">
                  {job.ace_report_filename || (job.ace_report_filepath ? 'Uploaded' : 'Pending')}
                </p>
              </div>
              {job.ace_report_filepath && (
                <Button size="sm" variant="ghost" onClick={downloadAce} className="h-7 px-2 text-xs text-emerald-600" title="Download ACE Report">
                  <Download size={13} />
                </Button>
              )}
            </div>

            <div className="p-3 bg-background/70 border border-border/60 rounded-lg flex items-center justify-between">
              <div className="min-w-0 pr-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted block mb-0.5">Epubcheck Log</span>
                <p className="text-xs font-semibold text-text truncate m-0">
                  {job.epubcheck_report_filename || (job.epubcheck_report_filepath ? 'Uploaded' : 'Pending')}
                </p>
              </div>
              {job.epubcheck_report_filepath && (
                <Button size="sm" variant="ghost" onClick={downloadEpubcheck} className="h-7 px-2 text-xs text-emerald-600" title="Download Epubcheck Log">
                  <Download size={13} />
                </Button>
              )}
            </div>

            <div className="p-3 bg-background/70 border border-border/60 rounded-lg flex items-center justify-between">
              <div className="min-w-0 pr-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted block mb-0.5">History CSV</span>
                <p className="text-xs font-semibold text-text truncate m-0">
                  {job.has_history_csv || job.history_csv_filename ? 'history.csv' : 'Generated on QC'}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={viewHistoryCsv}
                  disabled={loadingHistory}
                  className="h-7 px-2 text-xs text-primary"
                  title="View history.csv"
                >
                  {loadingHistory ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={downloadHistoryCsv}
                  className="h-7 px-2 text-xs text-emerald-600"
                  title="Download history.csv"
                >
                  <Download size={13} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Job Stage Card (Waiting for CSV on FTP or manual move) */}
      {job.current_stage_name === 'Add job' && (
        <div className="bg-card border rounded-xl p-5 shadow-sm transition-all border-blue-500/40 ring-1 ring-blue-500/20">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg">
                <FileText size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-text m-0">Add Job Stage</h3>
                  <span className="text-[10px] bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 font-bold px-2 py-0.5 rounded-full">
                    Awaiting CSV Match
                  </span>
                </div>
                <p className="text-xs text-muted m-0 mt-0.5">
                  PDF fetched from FTP. Once matching CSV with ISBN is found on FTP, it moves to Job Analysis. Or click Proceed to advance manually.
                </p>
              </div>
            </div>

            <Button
              size="sm"
              variant="primary"
              onClick={proceedToJobAnalysis}
              disabled={isAdvancing}
              rightIcon={!isAdvancing ? <ArrowRight size={13} /> : undefined}
            >
              {isAdvancing ? 'Moving...' : 'Move to Job Analysis'}
            </Button>
          </div>
        </div>
      )}

      {/* Job Analysis Step Card (Shown in Job Analysis stage) */}
      {job.current_stage_name === 'Job Analysis' && (
        <div className="bg-card border rounded-xl p-5 shadow-sm transition-all border-cyan-500/40 ring-1 ring-cyan-500/20">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded-lg">
                <FileText size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-text m-0">Job Analysis Step</h3>
                  <span className="text-[10px] bg-cyan-500/10 border border-cyan-500/30 text-cyan-600 dark:text-cyan-400 font-bold px-2 py-0.5 rounded-full">
                    Review & Verify
                  </span>
                </div>
                <p className="text-xs text-muted m-0 mt-0.5">
                  Review and update document specifications (eISBN, Pages, Type, Language, Due Date). Due date is computed from the date moved to Job Analysis.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!isEditingAnalysis ? (
                <Button size="sm" variant="outline" onClick={startEditingAnalysis} leftIcon={<Edit3 size={13} />}>
                  Edit Analysis
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setIsEditingAnalysis(false)} disabled={isSavingAnalysis}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" onClick={saveAnalysis} disabled={isSavingAnalysis} leftIcon={<Check size={13} />}>
                    {isSavingAnalysis ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {!isEditingAnalysis ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-4">
              <div className="bg-background/70 border border-border/60 rounded-lg p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">eISBN</span>
                <p className="text-base font-bold text-text mt-1 m-0 truncate" title={job.eisbn || ''}>
                  {job.eisbn || <span className="text-muted font-normal italic">Not set</span>}
                </p>
              </div>

              <div className="bg-background/70 border border-border/60 rounded-lg p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Pages</span>
                <p className="text-base font-bold text-text mt-1 m-0">
                  {job.pdf_page_count ? `${job.pdf_page_count} pages` : <span className="text-muted font-normal italic">Not analyzed</span>}
                </p>
              </div>

              <div className="bg-background/70 border border-border/60 rounded-lg p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">PDF Type</span>
                <p className="text-base font-bold text-text mt-1 m-0">
                  {job.pdf_type || <span className="text-muted font-normal italic">Not analyzed</span>}
                </p>
              </div>

              <div className="bg-background/70 border border-border/60 rounded-lg p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Language</span>
                <p className="text-base font-bold text-text mt-1 m-0">
                  {job.pdf_language || <span className="text-muted font-normal italic">Not analyzed</span>}
                </p>
              </div>

              <div className="bg-background/70 border border-border/60 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Due Date</span>
                  {job.is_fastrack && (
                    <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 rounded flex items-center gap-0.5">
                      <Zap size={9} className="fill-amber-500" />
                      Fastrack
                    </span>
                  )}
                </div>
                <p className="text-base font-bold text-text mt-1 m-0">
                  {job.due_date ? formatDate(job.due_date) : <span className="text-muted font-normal italic">No date set</span>}
                </p>
                {job.is_fastrack && job.fastrack_requested_date && (
                  <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mt-1 m-0 flex items-center gap-1">
                    <Clock size={11} className="shrink-0" />
                    Target: {formatDate(job.fastrack_requested_date)}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 pt-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted">eISBN</label>
                <input
                  type="text"
                  value={analysisEisbn}
                  onChange={(e) => setAnalysisEisbn(e.target.value)}
                  placeholder="e.g. 9783696305819"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted">Pages</label>
                <input
                  type="number"
                  min="1"
                  value={analysisPages}
                  onChange={(e) => setAnalysisPages(e.target.value)}
                  placeholder="Page count"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted">PDF Type</label>
                <Dropdown
                  options={[
                    { value: 'Text PDF', label: 'Text PDF' },
                    { value: 'Image PDF', label: 'Image PDF' },
                  ]}
                  value={analysisType}
                  onChange={(newType) => {
                    setAnalysisType(newType)
                    const autoDate = calculateDefaultDueDate(newType, job?.created_at)
                    setAnalysisDueDate(autoDate)
                  }}
                  className="w-full h-[34px] px-3 py-1.5 text-xs bg-background border border-border rounded-lg shadow-none"
                  dropdownClassName="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted">Language</label>
                <Dropdown
                  searchable
                  searchPlaceholder="Search language..."
                  options={[
                    ...BOD_LANGUAGES.map((lang) => ({ value: lang, label: lang })),
                    ...(analysisLanguage && !BOD_LANGUAGES.includes(analysisLanguage)
                      ? [{ value: analysisLanguage, label: analysisLanguage }]
                      : [])
                  ]}
                  value={analysisLanguage}
                  onChange={(val) => setAnalysisLanguage(val)}
                  className="w-full h-[34px] px-3 py-1.5 text-xs bg-background border border-border rounded-lg shadow-none"
                  dropdownClassName="text-xs"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted">Due Date</label>
                  <button
                    type="button"
                    onClick={() => {
                      const autoDate = calculateDefaultDueDate(analysisType, job?.created_at)
                      setAnalysisDueDate(autoDate)
                    }}
                    className="text-[10px] text-primary hover:underline font-semibold"
                    title="Calculate based on: Text (3 days) | Image (6 days)"
                  >
                  </button>
                </div>
                <input
                  type="date"
                  value={analysisDueDate}
                  onChange={(e) => setAnalysisDueDate(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              <div className="col-span-1 sm:col-span-2 lg:col-span-5 space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted flex items-center gap-1">
                  Update Reason <span className="text-rose-500 font-bold">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={analysisReason}
                  onChange={(e) => setAnalysisReason(e.target.value)}
                  placeholder="Reason for change (Mandatory)"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary transition-colors"
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Files Panel */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex flex-col h-[500px]">
          <h3 className="text-sm font-bold border-b border-border pb-2 shrink-0">Files</h3>

          <div className="space-y-4 flex-1 overflow-y-auto pt-4 pr-1">

            <div className="bg-background border border-border rounded-lg p-3 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Source PDF</p>
                <p className="text-sm font-semibold truncate">{job.pdf_filename}</p>
              </div>
              <Button size="sm" variant="outline" onClick={downloadPdf} leftIcon={<Download size={14} />}>
                Download
              </Button>
            </div>

            {job.cover_filename ? (
              <div className="bg-background border border-border rounded-lg p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Cover Image</p>
                  <p className="text-sm font-semibold truncate text-emerald-600 dark:text-emerald-400">{job.cover_filename}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={downloadCover} leftIcon={<Download size={14} />}>
                    Download
                  </Button>
                  {!isCompleted && (
                    <div className="relative">
                      <input
                        type="file"
                        accept=".jpg,.jpeg"
                        onChange={uploadCover}
                        disabled={isUploadingCover}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10 disabled:cursor-not-allowed"
                        title="Replace Cover Image"
                      />
                      <Button size="sm" variant="outline" disabled={isUploadingCover} leftIcon={<Upload size={14} />}>
                        {isUploadingCover ? '...' : 'Replace'}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : !isCompleted ? (
              <div className="bg-background/60 border border-dashed border-border hover:border-primary/50 rounded-lg p-3 flex items-center justify-between transition-colors">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Cover Image</p>
                  <p className="text-xs text-muted">No cover image uploaded yet</p>
                </div>
                <div className="relative">
                  <input
                    type="file"
                    accept=".jpg,.jpeg"
                    onChange={uploadCover}
                    disabled={isUploadingCover}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10 disabled:cursor-not-allowed"
                    title="Upload Cover Image"
                  />
                  <Button size="sm" variant="outline" disabled={isUploadingCover} leftIcon={<Upload size={14} />}>
                    {isUploadingCover ? 'Uploading...' : 'Upload Cover'}
                  </Button>
                </div>
              </div>
            ) : null}

            {job.epub_filename && (
              <div className="bg-background border border-border rounded-lg p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Processed EPUB</p>
                  <p className="text-sm font-semibold truncate">{job.epub_filename}</p>
                </div>
                <Button size="sm" variant="outline" onClick={downloadEpub} leftIcon={<Download size={14} />}>
                  Download
                </Button>
              </div>
            )}

            {job.ace_report_filepath && (
              <div className="bg-background border border-border rounded-lg p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">ACE Validation Report</p>
                  <p className="text-sm font-semibold truncate">{job.ace_report_filename || 'ACE Report'}</p>
                </div>
                <Button size="sm" variant="outline" onClick={downloadAce} leftIcon={<Download size={14} />}>
                  Download
                </Button>
              </div>
            )}

            {job.epubcheck_report_filepath && (
              <div className="bg-background border border-border rounded-lg p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Epubcheck Validation Report</p>
                  <p className="text-sm font-semibold truncate">{job.epubcheck_report_filename || 'Epubcheck Log'}</p>
                </div>
                <Button size="sm" variant="outline" onClick={downloadEpubcheck} leftIcon={<Download size={14} />}>
                  Download
                </Button>
              </div>
            )}

            {(job.has_history_csv || job.history_csv_filename) && (
              <div className="bg-background border border-border rounded-lg p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">BOD History CSV</p>
                  <p className="text-sm font-semibold truncate">{job.history_csv_filename || 'history.csv'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={viewHistoryCsv} leftIcon={<Eye size={14} />}>
                    View
                  </Button>
                  <Button size="sm" variant="outline" onClick={downloadHistoryCsv} leftIcon={<Download size={14} />}>
                    Download
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Combined History Panel */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm lg:col-span-1 flex flex-col h-[500px]">
          <div className="flex items-center gap-4 border-b border-border mb-4 shrink-0 overflow-x-auto hide-scrollbar">
            <button
              onClick={() => setActiveTab('stage')}
              className={`pb-2 text-sm font-bold transition-colors border-b-2 ${activeTab === 'stage' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
                }`}
            >
              Stage History
            </button>
            {job.assigned_users && Array.isArray(job.assigned_users) && job.assigned_users.length > 0 && (
              <button
                onClick={() => setActiveTab('assignment')}
                className={`pb-2 text-sm font-bold transition-colors border-b-2 ${activeTab === 'assignment' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
                  }`}
              >
                Assignment History
              </button>
            )}
            {job.due_date_history && Array.isArray(job.due_date_history) && job.due_date_history.some((h: any) =>
              (!h.changes || h.changes.length === 0) || h.changes.some((c: any) => c.field === 'Due Date')
            ) && (
                <button
                  onClick={() => setActiveTab('duedate')}
                  className={`pb-2 text-sm font-bold transition-colors border-b-2 ${activeTab === 'duedate' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
                    }`}
                >
                  Due Date History
                </button>
              )}
            {job.due_date_history && Array.isArray(job.due_date_history) && job.due_date_history.some((h: any) =>
              h.changes && h.changes.some((c: any) => c.field === 'Priority' || c.field === 'Fastrack Date')
            ) && (
                <button
                  onClick={() => setActiveTab('priority')}
                  className={`pb-2 text-sm font-bold transition-colors border-b-2 ${activeTab === 'priority' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
                    }`}
                >
                  Priority History
                </button>
              )}
            {job.file_history && Array.isArray(job.file_history) && job.file_history.length > 0 && (
              <button
                onClick={() => setActiveTab('files')}
                className={`pb-2 text-sm font-bold transition-colors border-b-2 ${activeTab === 'files' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
                  }`}
              >
                File History
              </button>
            )}
            {((job.hold_support_history && job.hold_support_history.length > 0) || (job.due_date_history && Array.isArray(job.due_date_history) && job.due_date_history.some((h: any) =>
              h.field === 'Status' || (h.changes && h.changes.some((c: any) => c.field === 'Status'))
            ))) && (
                <button
                  onClick={() => setActiveTab('status')}
                  className={`pb-2 text-sm font-bold transition-colors border-b-2 flex items-center gap-1.5 ${activeTab === 'status' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
                    }`}
                >
                  Hold & Support History
                  {job.hold_support_history && job.hold_support_history.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-accent border border-border text-text font-mono font-normal">
                      {job.hold_support_history.length}
                    </span>
                  )}
                </button>
              )}
            {((job.reopen_history && job.reopen_history.length > 0) || (job.due_date_history && Array.isArray(job.due_date_history) && job.due_date_history.some((h: any) =>
              h.field === 'Reopen' || (h.changes && h.changes.some((c: any) => c.field === 'Reopen'))
            ))) && (
                <button
                  onClick={() => setActiveTab('reopen')}
                  className={`pb-2 text-sm font-bold transition-colors border-b-2 flex items-center gap-1.5 ${activeTab === 'reopen' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
                    }`}
                >
                  Reopen History
                  {job.reopen_history && job.reopen_history.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 font-mono font-bold">
                      {job.reopen_history.length}
                    </span>
                  )}
                </button>
              )}
          </div>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {activeTab === 'stage' && (
              <div className="space-y-4">
                {getChronologicalStageTimeline(job).map((event: any, idx: number, arr: any[]) => {
                  const isCurrent = event.isCurrent

                  return (
                    <div key={idx} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${event.endTime ? 'bg-emerald-500/20 text-emerald-600' :
                          isCurrent ? 'bg-primary/20 text-primary border-2 border-primary/30' :
                            'bg-accent text-muted'
                          }`}>
                          {event.endTime ? <CheckCircle2 size={12} /> : <div className="w-1.5 h-1.5 rounded-full bg-current" />}
                        </div>
                        {idx !== arr.length - 1 && (
                          <div className="w-px h-full bg-border my-1" />
                        )}
                      </div>

                      <div className="pb-4 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className={`text-sm font-bold m-0 ${isCurrent ? 'text-text' : 'text-text/70'}`}>
                            {event.stageName}
                          </h4>
                          {event.cycleVersion && (
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400">
                              {event.cycleVersion}
                            </span>
                          )}
                          {isCurrent && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary animate-pulse">
                              In Progress
                            </span>
                          )}
                        </div>

                        <div className="mt-1.5 space-y-1">
                          {event.dispatchedBy && (
                            <div className="flex items-center gap-1.5 text-xs text-muted">
                              <Send size={12} className="text-emerald-600 dark:text-emerald-400" /> Dispatched by: <strong className="text-text">{getUserDisplayName(event.dispatchedBy)}</strong>
                            </div>
                          )}

                          {event.assignee && !event.dispatchedBy && (
                            <div className="flex items-center gap-1.5 text-xs text-muted">
                              <User size={12} /> Assigned to: <strong className="text-text">{getUserDisplayName(event.assignee)}</strong>
                            </div>
                          )}

                          {event.startTime && (
                            <div className="flex items-center gap-1.5 text-xs text-muted">
                              <Clock size={12} /> Started: {formatDateTime(event.startTime)}
                            </div>
                          )}

                          {event.endTime && (
                            <div className="flex items-center gap-1.5 text-xs text-muted">
                              <CheckCircle2 size={12} /> Completed: {formatDateTime(event.endTime)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {activeTab === 'assignment' && job.assigned_users && Array.isArray(job.assigned_users) && job.assigned_users.length > 0 && (
              <div className="space-y-3">
                {job.assigned_users.map((assignment: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between bg-background border border-border rounded-lg p-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 text-primary rounded-lg shrink-0">
                        {assignment.action && assignment.action.toLowerCase().includes('dispatch') ? (
                          <Send size={14} className="text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <User size={14} />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-text m-0">
                          {assignment.action && assignment.user_id
                            ? assignment.action.replace(new RegExp(`\\b${assignment.user_id}\\b`, 'g'), getUserDisplayName(assignment.user_id))
                            : (assignment.action || `Assigned to: ${getUserDisplayName(assignment.user_id)}`)}
                        </p>
                        <p className="text-[10px] text-muted m-0 mt-0.5">
                          Stage: {assignment.stage} {assignment.assigned_by ? `• By: ${getUserDisplayName(assignment.assigned_by)}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="text-xs text-muted font-medium">
                      {formatDateTime(assignment.time)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'duedate' && job.due_date_history && Array.isArray(job.due_date_history) && (
              <div className="space-y-3">
                {[...job.due_date_history]
                  .filter((historyItem: any) =>
                    (!historyItem.changes || historyItem.changes.length === 0) ||
                    historyItem.changes.some((c: any) => c.field === 'Due Date')
                  )
                  .reverse().map((historyItem: any, idx: number) => {
                    const hasChanges = Array.isArray(historyItem.changes) && historyItem.changes.length > 0;
                    return (
                      <div key={idx} className="flex items-start justify-between bg-background border border-border rounded-lg p-3 gap-3">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className="p-2 bg-primary/10 text-primary rounded-lg shrink-0 mt-0.5">
                            <Calendar size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            {hasChanges ? (
                              <div className="space-y-1.5">
                                {historyItem.changes.filter((c: any) => c.field === 'Due Date').map((change: any, cIdx: number) => (
                                  <div key={cIdx} className="flex flex-wrap items-center gap-1.5 text-xs">
                                    <span className="font-semibold text-text bg-accent px-1.5 py-0.5 rounded border border-border text-[10px] uppercase tracking-wider">
                                      {change.field}
                                    </span>
                                    {change.old !== undefined && change.old !== null && change.old !== '' && change.old !== 'None' ? (
                                      <>
                                        <span className="text-muted line-through">{String(change.old)}</span>
                                        <span className="text-muted text-[10px]">→</span>
                                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">{String(change.new)}</span>
                                      </>
                                    ) : (
                                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">set to {String(change.new)}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm font-semibold text-text m-0">
                                Changed Due Date to: {historyItem.date ? new Date(historyItem.date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }) : 'None'}
                              </p>
                            )}

                            {historyItem.reason && (
                              <p className="text-xs text-text/80 mt-1.5 mb-0 break-words">
                                <span className="text-muted">Reason:</span> {historyItem.reason}
                              </p>
                            )}
                            <p className="text-[10px] text-muted m-0 mt-1">
                              Changed By: <span className="font-medium text-text/90">{historyItem.changed_by || 'Unknown'}</span>
                            </p>
                          </div>
                        </div>
                        <div className="text-xs text-muted font-medium shrink-0 pt-0.5 text-right whitespace-nowrap">
                          {formatDateTime(historyItem.timestamp)}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            {activeTab === 'priority' && job.due_date_history && Array.isArray(job.due_date_history) && (
              <div className="space-y-3">
                {[...job.due_date_history]
                  .filter((historyItem: any) =>
                    historyItem.changes && historyItem.changes.some((c: any) => c.field === 'Priority' || c.field === 'Fastrack Date')
                  )
                  .reverse().map((historyItem: any, idx: number) => (
                    <div key={idx} className="flex items-start justify-between bg-background border border-border rounded-lg p-3 gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="p-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg shrink-0 mt-0.5">
                          <Zap size={14} className="fill-amber-500 text-amber-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="space-y-1.5">
                            {historyItem.changes.filter((c: any) => c.field === 'Priority' || c.field === 'Fastrack Date').map((change: any, cIdx: number) => (
                              <div key={cIdx} className="flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="font-semibold text-text bg-accent px-1.5 py-0.5 rounded border border-border text-[10px] uppercase tracking-wider">
                                  {change.field}
                                </span>
                                {change.old !== undefined && change.old !== null && change.old !== '' && change.old !== 'None' ? (
                                  <>
                                    <span className="text-muted line-through">{String(change.old)}</span>
                                    <span className="text-muted text-[10px]">→</span>
                                    <span className="font-semibold text-amber-600 dark:text-amber-400">{String(change.new)}</span>
                                  </>
                                ) : (
                                  <span className="font-semibold text-amber-600 dark:text-amber-400">set to {String(change.new)}</span>
                                )}
                              </div>
                            ))}
                          </div>

                          {historyItem.reason && (
                            <p className="text-xs text-text/80 mt-1.5 mb-0 break-words">
                              <span className="text-muted">Reason / Note:</span> {historyItem.reason}
                            </p>
                          )}
                          <p className="text-[10px] text-muted m-0 mt-1">
                            Changed By: <span className="font-medium text-text/90">{historyItem.changed_by || 'Unknown'}</span>
                          </p>
                        </div>
                      </div>
                      <div className="text-xs text-muted font-medium shrink-0 pt-0.5 text-right whitespace-nowrap">
                        {formatDateTime(historyItem.timestamp)}
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {activeTab === 'files' && job.file_history && Array.isArray(job.file_history) && job.file_history.length > 0 && (
              <div className="space-y-3">
                {[...job.file_history].reverse().map((fItem: any, idx: number) => (
                  <div key={idx} className="flex items-start justify-between bg-background border border-border rounded-lg p-3 gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="p-2 bg-primary/10 text-primary rounded-lg shrink-0 mt-0.5">
                        <FileText size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-text m-0 truncate">
                          {fItem.new_filename || fItem.original_filename}
                        </p>
                        {fItem.backup_filename && (
                          <p className="text-[10px] text-muted font-mono mt-1 mb-0 break-all">
                            Backed up as: <span className="text-amber-600 dark:text-amber-400 font-medium">{fItem.backup_filename}</span>
                          </p>
                        )}
                        <p className="text-[10px] text-muted m-0 mt-1">
                          Stage: <span className="font-semibold text-text/90">{fItem.stage || 'QC'}</span> • Uploaded By: <span className="font-medium text-text/90">{fItem.user || 'Unknown'}</span>
                        </p>
                      </div>
                    </div>
                    <div className="text-[11px] text-muted font-medium shrink-0 pt-0.5 text-right whitespace-nowrap">
                      {formatDateTime(fItem.timestamp)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'status' && (
              <div className="space-y-4">
                {/* 1. Structured Hold & Support Resolution History */}
                {job.hold_support_history && Array.isArray(job.hold_support_history) && job.hold_support_history.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 mb-2 pb-1 border-b border-border/40">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                        Hold & Support Tickets ({job.hold_support_history.length})
                      </span>
                      {/* Filter Buttons: Hold and Support */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setHoldSupportFilter(holdSupportFilter === 'Hold' ? 'all' : 'Hold')}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded transition-all border ${holdSupportFilter === 'Hold'
                            ? 'bg-fuchsia-600 text-white border-fuchsia-600 shadow-xs ring-1 ring-fuchsia-400'
                            : 'bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-600 dark:text-fuchsia-400 hover:bg-fuchsia-500/20'
                            }`}
                          title={holdSupportFilter === 'Hold' ? 'Click to show both Hold and Support' : 'Click to filter Hold only'}
                        >
                          Hold {job.hold_support_history.filter((h: any) => h.type === 'Hold').length > 0 && `(${job.hold_support_history.filter((h: any) => h.type === 'Hold').length})`}
                        </button>
                        <button
                          type="button"
                          onClick={() => setHoldSupportFilter(holdSupportFilter === 'Support' ? 'all' : 'Support')}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded transition-all border ${holdSupportFilter === 'Support'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs ring-1 ring-indigo-400'
                            : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20'
                            }`}
                          title={holdSupportFilter === 'Support' ? 'Click to show both Hold and Support' : 'Click to filter Support only'}
                        >
                          Support {job.hold_support_history.filter((h: any) => h.type === 'Support').length > 0 && `(${job.hold_support_history.filter((h: any) => h.type === 'Support').length})`}
                        </button>
                      </div>
                    </div>
                    {[...job.hold_support_history]
                      .filter((record: any) => holdSupportFilter === 'all' || record.type === holdSupportFilter)
                      .reverse()
                      .map((record: any, idx: number) => {
                        const isOpen = record.status === 'Open'
                        const isHold = record.type === 'Hold'
                        const isSupport = record.type === 'Support'

                        return (
                          <div
                            key={record.id || idx}
                            className={`bg-background border rounded-lg p-3.5 space-y-3 ${isOpen
                              ? isHold
                                ? 'border-fuchsia-500/50 ring-1 ring-fuchsia-500/20'
                                : 'border-indigo-500/50 ring-1 ring-indigo-500/20'
                              : 'border-border'
                              }`}
                          >
                            {/* Header */}
                            <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${isHold
                                  ? 'bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-600 dark:text-fuchsia-400'
                                  : isSupport
                                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400'
                                    : 'bg-accent border-border text-text'
                                  }`}>
                                  {record.type}
                                </span>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isOpen
                                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 animate-pulse'
                                  : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                  }`}>
                                  {isOpen ? '● Pending / Open' : '✓ Resolved'}
                                </span>
                              </div>
                              <span className="text-[11px] font-mono text-muted">
                                {record.id}
                              </span>
                            </div>

                            {/* Query Reason */}
                            <div className="space-y-1">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-muted m-0">Query / Reason</p>
                              <p className="text-xs text-text leading-relaxed bg-accent/40 p-2.5 rounded border border-border/40 m-0 break-words font-sans">
                                {record.query_reason}
                              </p>
                              <p className="text-[10px] text-muted m-0 pt-0.5">
                                Reported by <strong className="text-text/90">{record.created_by || 'Unknown'}</strong> at stage "{record.stage_at_hold || job.current_stage_name}" • {formatDateTime(record.created_at)}
                              </p>
                            </div>

                            {/* Attachments for query */}
                            {record.attachments && Array.isArray(record.attachments) && record.attachments.length > 0 && (
                              <div className="space-y-1.5 pt-1 border-t border-border/40">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-muted m-0 flex items-center gap-1">
                                  <Paperclip size={11} className="text-amber-500" />
                                  Attached Screenshots / Files ({record.attachments.length})
                                </p>
                                <div className="space-y-1.5">
                                  {record.attachments.map((att: any, aIdx: number) => {
                                    const downloadUrl = `/api/v2/bod/jobs/${job.id}/hold-attachments/${record.id}/${encodeURIComponent(att.saved_filename || att.filename)}`
                                    const ext = (att.filename || '').split('.').pop()?.toLowerCase()
                                    const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)
                                    const isPdf = ext === 'pdf'
                                    const isViewable = isImg || isPdf || ext === 'txt'
                                    const isSheet = ['xlsx', 'xls', 'csv'].includes(ext)

                                    return (
                                      <a
                                        key={aIdx}
                                        href={downloadUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        {...(!isViewable ? { download: att.filename } : {})}
                                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-background border border-border hover:border-amber-500/40 hover:bg-amber-500/5 transition-all group/att"
                                      >
                                        <div className="flex items-center gap-2 min-w-0">
                                          <div className="p-1 rounded bg-muted/20 text-muted group-hover/att:text-amber-600 dark:group-hover/att:text-amber-400 group-hover/att:bg-amber-500/10 shrink-0">
                                            {isImg ? <ImageIcon size={13} /> : isSheet ? <FileSpreadsheet size={13} /> : <FileText size={13} />}
                                          </div>
                                          <div className="min-w-0">
                                            <p className="text-xs font-medium text-text group-hover/att:text-amber-600 dark:group-hover/att:text-amber-400 truncate m-0">
                                              {att.filename}
                                            </p>
                                            <p className="text-[10px] text-muted m-0">
                                              {((att.size || 0) / 1024).toFixed(1)} KB
                                            </p>
                                          </div>
                                        </div>
                                        <Download size={13} className="text-muted group-hover/att:text-amber-600 dark:group-hover/att:text-amber-400 shrink-0" />
                                      </a>
                                    )
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Resolution Details */}
                            {record.status === 'Resolved' && (
                              <div className="space-y-1 bg-emerald-500/5 p-2.5 rounded border border-emerald-500/20">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 m-0 flex items-center gap-1">
                                  <CheckCircle size={12} /> Resolution Notes
                                </p>
                                <p className="text-xs text-text leading-relaxed m-0 break-words font-sans">
                                  {record.resolution_notes || <span className="text-muted italic">No resolution notes recorded</span>}
                                </p>
                                <p className="text-[10px] text-muted m-0 pt-0.5">
                                  Resolved by <strong className="text-text/90">{record.resolved_by || 'Unknown'}</strong> • {formatDateTime(record.resolved_at)}
                                </p>
                                {record.resolution_attachments && Array.isArray(record.resolution_attachments) && record.resolution_attachments.length > 0 && (
                                  <div className="space-y-1 pt-1.5 border-t border-emerald-500/20">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 m-0 flex items-center gap-1">
                                      <Paperclip size={11} /> Resolution Attachments ({record.resolution_attachments.length})
                                    </p>
                                    <div className="space-y-1">
                                      {record.resolution_attachments.map((att: any, aIdx: number) => {
                                        const downloadUrl = `/api/v2/bod/jobs/${job.id}/hold-attachments/${record.id}/${encodeURIComponent(att.saved_filename || att.filename)}`
                                        const ext = (att.filename || '').split('.').pop()?.toLowerCase()
                                        const isViewable = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'txt'].includes(ext)
                                        return (
                                          <a
                                            key={aIdx}
                                            href={downloadUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            {...(!isViewable ? { download: att.filename } : {})}
                                            className="flex items-center justify-between gap-2 p-1.5 rounded bg-background border border-emerald-500/20 hover:border-emerald-500/40 text-xs transition-all"
                                          >
                                            <span className="truncate text-[11px] font-medium text-text">{att.filename}</span>
                                            <Download size={12} className="text-muted shrink-0" />
                                          </a>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                ) : null}

                {/* 2. Timeline fallback / Status transitions */}
                {job.due_date_history && Array.isArray(job.due_date_history) && job.due_date_history.some((h: any) => h.field === 'Status' || (h.changes && h.changes.some((c: any) => c.field === 'Status'))) && (
                  <div className="space-y-2 pt-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted block">
                      Status Change Activity Log
                    </span>
                    {[...job.due_date_history]
                      .filter((h: any) => h.field === 'Status' || (h.changes && h.changes.some((c: any) => c.field === 'Status')))
                      .reverse()
                      .map((historyItem: any, idx: number) => {
                        const statusChange = historyItem.changes?.find((c: any) => c.field === 'Status')
                        const newSt = statusChange?.new || historyItem.new_status
                        const oldSt = statusChange?.old || historyItem.old_status

                        const isHold = newSt === 'Hold'
                        const isSupport = newSt === 'Support'

                        return (
                          <div key={idx} className="flex items-start justify-between bg-background border border-border rounded-lg p-2.5 gap-3">
                            <div className="flex items-start gap-2.5 flex-1 min-w-0">
                              <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${isHold ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                : isSupport ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                                  : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                }`}>
                                {isHold ? <PauseCircle size={13} /> : isSupport ? <HelpCircle size={13} /> : <CheckCircle size={13} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 text-xs mb-0.5">
                                  {oldSt ? (
                                    <>
                                      <span className="text-muted line-through text-[11px]">{oldSt}</span>
                                      <span className="text-muted text-[9px]">→</span>
                                    </>
                                  ) : null}
                                  <span className={`font-bold text-xs ${isHold ? 'text-amber-600 dark:text-amber-400'
                                    : isSupport ? 'text-indigo-600 dark:text-indigo-400'
                                      : 'text-emerald-600 dark:text-emerald-400'
                                    }`}>
                                    {newSt}
                                  </span>
                                  {historyItem.action && (
                                    <span className="text-[10px] text-muted">({historyItem.action})</span>
                                  )}
                                </div>

                                {historyItem.reason && (
                                  <p className="text-[11px] text-text/80 m-0 break-words">
                                    <span className="text-muted font-medium">Notes:</span> {historyItem.reason}
                                  </p>
                                )}

                                <p className="text-[10px] text-muted m-0 mt-1">
                                  User: <span className="font-medium text-text/90">{historyItem.changed_by || 'Unknown'}</span>
                                </p>
                              </div>
                            </div>
                            <div className="text-[10px] text-muted font-medium shrink-0 pt-0.5 text-right whitespace-nowrap">
                              {formatDateTime(historyItem.timestamp)}
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'reopen' && (
              <div className="space-y-4">
                {/* Reopen Cycle History */}
                {job.reopen_history && Array.isArray(job.reopen_history) && job.reopen_history.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 mb-2 pb-1 border-b border-border/40">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                        <RotateCcw size={12} className="text-rose-500" />
                        Reopen ({job.reopen_history.length})
                      </span>
                      <span className="text-[10px] text-muted font-medium">
                        Current Revision: <strong className="text-rose-600 dark:text-rose-400 font-mono">{job.revision || 'R0'}</strong>
                      </span>
                    </div>

                    {[...job.reopen_history].reverse().map((record: any, idx: number) => (
                      <div
                        key={idx}
                        className="bg-background border border-rose-500/30 rounded-lg p-3.5 space-y-3 ring-1 ring-rose-500/10 shadow-xs"
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/40 text-rose-600 dark:text-rose-400">
                              {record.revision}
                            </span>
                            <span className="text-[10px] font-semibold text-muted">
                              Moved back to: <strong className="text-text">QC (Yet to Start)</strong>
                            </span>
                          </div>
                          <span className="text-[10px] text-muted">
                            {formatDateTime(record.reopened_at)}
                          </span>
                        </div>

                        {/* Correction / Reason */}
                        <div className="space-y-1">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-muted m-0">Correction / Reason</p>
                          <p className="text-xs text-text leading-relaxed bg-accent/40 p-2.5 rounded border border-border/40 m-0 break-words font-sans">
                            {record.reason}
                          </p>
                          <p className="text-[10px] text-muted m-0 pt-0.5">
                            Reopened by <strong className="text-text/90">{record.reopened_by || 'Unknown'}</strong>
                            {record.previous_stage ? ` from stage "${record.previous_stage}"` : ''}
                          </p>
                        </div>

                        {/* Attached Files (if any) */}
                        {record.attachments && Array.isArray(record.attachments) && record.attachments.length > 0 && (
                          <div className="space-y-1.5 pt-1 border-t border-border/40">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted m-0 flex items-center gap-1">
                              <Paperclip size={11} className="text-rose-500" />
                              Attached Files ({record.attachments.length})
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {record.attachments.map((att: any, aIdx: number) => {
                                const rev = record.revision
                                const downloadUrl = `/api/v2/bod/jobs/${job.id}/reopen-attachments/${rev}/${encodeURIComponent(att.saved_filename || att.filename)}`
                                const ext = (att.filename || '').split('.').pop()?.toLowerCase()
                                const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)
                                const isPdf = ext === 'pdf'
                                const isViewable = isImg || isPdf || ext === 'txt'
                                const isSheet = ['xlsx', 'xls', 'csv'].includes(ext)

                                return (
                                  <a
                                    key={aIdx}
                                    href={downloadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    {...(!isViewable ? { download: att.filename } : {})}
                                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-background border border-border hover:border-rose-500/40 hover:bg-rose-500/5 transition-all group/att"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="p-1.5 rounded bg-muted/20 text-muted group-hover/att:text-rose-600 dark:group-hover/att:text-rose-400 group-hover/att:bg-rose-500/10 shrink-0">
                                        {isImg ? <ImageIcon size={14} /> : isSheet ? <FileSpreadsheet size={14} /> : <FileText size={14} />}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-xs font-medium text-text group-hover/att:text-rose-600 dark:group-hover/att:text-rose-400 truncate m-0">
                                          {att.filename}
                                        </p>
                                        {att.size ? (
                                          <p className="text-[10px] text-muted m-0">
                                            {(att.size / 1024).toFixed(1)} KB
                                          </p>
                                        ) : null}
                                      </div>
                                    </div>
                                    <Download size={14} className="text-muted group-hover/att:text-rose-600 dark:group-hover/att:text-rose-400 shrink-0 mr-1" />
                                  </a>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted text-xs">
                    No reopen history recorded yet for this job.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* QC Completion Modal */}
      {showQCModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowQCModal(false)} />
          <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-xl flex flex-col max-h-[85vh] border border-border">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-muted/5 rounded-t-xl">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <CheckCircle className="text-emerald-500" size={20} />
                Quality Control (Books on Demand)
              </h2>
              <button onClick={() => setShowQCModal(false)} className="text-muted hover:text-text transition-colors">
                &times;
              </button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto space-y-6">
              {/* Stage 1 */}
              <div className="p-4 rounded-lg border bg-emerald-500/10 border-emerald-500/20">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-500/20 text-emerald-500">
                    <CheckCircle size={16} />
                  </div>
                  <div className="w-full">
                    <h4 className="font-semibold text-sm">Stage 1: ACE Validation</h4>
                    <p className="text-xs text-muted mb-2">
                      Upload the ACE validation report (.zip)
                    </p>
                    <input
                      type="file"
                      accept=".zip"
                      onChange={(e) => setAceFile(e.target.files?.[0] || null)}
                      className="block w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 border border-border rounded-md"
                    />
                  </div>
                </div>
              </div>

              {/* Stage 2 */}
              <div className="p-4 rounded-lg border bg-emerald-500/10 border-emerald-500/20">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-500/20 text-emerald-500">
                    <CheckCircle size={16} />
                  </div>
                  <div className="w-full">
                    <h4 className="font-semibold text-sm">Stage 2: Epub Check Validation</h4>
                    <p className="text-xs text-muted mb-2">
                      Upload the Epubcheck report (.txt)
                    </p>
                    <input
                      type="file"
                      accept=".txt"
                      onChange={(e) => setEpubcheckFile(e.target.files?.[0] || null)}
                      className="block w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 border border-border rounded-md"
                    />
                  </div>
                </div>
              </div>

              {/* Stage 3 */}
              <div className="p-4 rounded-lg border bg-blue-500/10 border-blue-500/20">
                <div className="flex gap-3">
                  <div className="mt-0.5 w-8 h-8 rounded-full flex shrink-0 items-center justify-center bg-blue-500/20 text-blue-500">
                    3
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm">Stage 3: Manual Verification</h4>
                    <p className="text-xs text-muted mt-1 mb-3">
                      Please verify the contents match the original PDF structure and text before marking as complete.
                    </p>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                        checked={qcChecks.manualQC}
                        onChange={(e) => setQcChecks(prev => ({ ...prev, manualQC: e.target.checked }))}
                      />
                      <span className="select-none font-medium text-text">I have manually verified the EPUB output.</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end gap-3 bg-muted/5 rounded-b-xl">
              <Button variant="outline" onClick={() => setShowQCModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => advanceStage()}
                disabled={!qcChecks.manualQC || isAdvancing || isUploadingReports || !aceFile || !epubcheckFile}
                className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[140px]"
              >
                {(isAdvancing || isUploadingReports) ? (
                  <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> {isUploadingReports ? 'Uploading...' : 'Completing...'}</span>
                ) : (
                  <span className="flex items-center gap-2"><CheckCircle size={16} /> Complete & Move to Dispatch</span>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* History CSV Preview Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg">
                  <FileSpreadsheet size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-base text-text m-0">history.csv Preview</h3>
                  <p className="text-xs text-muted m-0">Generated deliverable metadata record for BOD dispatch</p>
                </div>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="p-1 rounded-lg hover:bg-accent text-muted hover:text-text transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {historyCsvContent ? (
                (() => {
                  const lines = historyCsvContent.trim().split('\n')
                  const headers = lines[0] ? lines[0].split(',') : []
                  const values = lines[1] ? lines[1].split(',') : []

                  return (
                    <div className="space-y-4">
                      <div className="border border-border/80 rounded-xl overflow-hidden shadow-xs">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs text-left">
                            <thead className="bg-muted/40 text-[10px] uppercase font-bold tracking-wider text-muted border-b border-border/70">
                              <tr>
                                {headers.map((h, idx) => (
                                  <th key={idx} className="px-3 py-2.5 whitespace-nowrap">
                                    {h.trim()}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60 bg-background/50 font-mono text-xs">
                              <tr>
                                {values.map((v, idx) => (
                                  <td key={idx} className="px-3 py-2.5 whitespace-nowrap text-text font-medium">
                                    {v.trim() || <span className="text-muted/50 italic">—</span>}
                                  </td>
                                ))}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted block mb-1">
                          Raw CSV Content
                        </span>
                        <pre className="p-3 bg-muted/20 border border-border/60 rounded-lg text-xs font-mono text-text whitespace-pre-wrap break-all">
                          {historyCsvContent}
                        </pre>
                      </div>
                    </div>
                  )
                })()
              ) : (
                <div className="p-8 text-center text-muted text-sm">
                  No content found in history.csv
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-border flex items-center justify-between bg-muted/5">
              <span className="text-xs text-muted">Ready for delivery verification</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowHistoryModal(false)}>
                  Close
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={downloadHistoryCsv}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                  leftIcon={<Download size={14} />}
                >
                  Download CSV
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hold / Support Status Modal */}
      {showHoldSupportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowHoldSupportModal(false)} />
          <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-lg flex flex-col border border-border animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-muted/5 rounded-t-xl">
              <h2 className="text-lg font-bold flex items-center gap-2 text-text m-0">
                {holdSupportType === 'Active' ? (
                  <>
                    <CheckCircle className="text-emerald-500" size={20} />
                    Resolve Query / Resume Job
                  </>
                ) : (
                  <>
                    <AlertTriangle className="text-amber-500" size={20} />
                    Report Query / Hold Job
                  </>
                )}
              </h2>
              <button
                onClick={() => setShowHoldSupportModal(false)}
                className="text-muted hover:text-text transition-colors p-1 rounded-md"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleHoldSupportSubmit}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                    Action / Target Status <span className="text-rose-500">*</span>
                  </label>
                  <Dropdown
                    value={holdSupportType}
                    onChange={(val) => setHoldSupportType(val as any)}
                    options={
                      job.status === 'Hold'
                        ? [
                          { value: 'Active', label: 'Active (Resolve Query & Resume Work)' },
                          { value: 'Support', label: 'Support (Internal Help / Technical Support)' }
                        ]
                        : job.status === 'Support'
                          ? [
                            { value: 'Active', label: 'Active (Resolve Query & Resume Work)' },
                            { value: 'Hold', label: 'Hold (Customer Support Query / External Hold)' }
                          ]
                          : [
                            { value: 'Support', label: 'Support (Internal Help / Technical Support)' },
                            { value: 'Hold', label: 'Hold (Customer Support Query / External Hold)' }
                          ]
                    }
                    className="w-full"
                  />
                  <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
                    {holdSupportType === 'Support' && 'Marks job as needing internal technical assistance or team support.'}
                    {holdSupportType === 'Hold' && 'Puts job on Hold due to query with customer support or waiting for customer clarification.'}
                    {holdSupportType === 'Active' && 'Resolves any pending query and returns job to normal active workflow.'}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                    {holdSupportType === 'Active' ? 'Resolution Notes / Reason' : 'Description / Query Reason'} <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={4}
                    required
                    placeholder={
                      holdSupportType === 'Active'
                        ? 'Explain how the query was resolved or why the job is resuming...'
                        : 'Describe the query, customer issue, or internal assistance required...'
                    }
                    value={holdSupportDescription}
                    onChange={(e) => setHoldSupportDescription(e.target.value)}
                    className="w-full p-3 bg-background border border-border rounded-lg text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y"
                  />
                </div>

                {/* Screenshot & File Attachments */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5 flex items-center gap-1.5">
                    <Paperclip size={13} className="text-amber-500" />
                    Attach Screenshots / Reference Files <span className="text-[10px] text-muted font-normal lowercase">(optional)</span>
                  </label>
                  <div className="border border-dashed border-border hover:border-amber-500/50 rounded-lg p-3.5 text-center bg-muted/5 transition-colors">
                    <input
                      type="file"
                      id="hold-support-file-input"
                      multiple
                      accept="image/*,.pdf,.xlsx,.xls,.csv,.doc,.docx"
                      onChange={(e) => {
                        if (e.target.files) {
                          const newFiles = Array.from(e.target.files)
                          setHoldSupportFiles(prev => [...prev, ...newFiles])
                          e.target.value = ''
                        }
                      }}
                      className="hidden"
                    />
                    <label
                      htmlFor="hold-support-file-input"
                      className="cursor-pointer flex flex-col items-center justify-center gap-1.5 text-xs text-muted hover:text-text"
                    >
                      <Paperclip size={18} className="text-amber-500" />
                      <span>
                        <span className="font-semibold text-amber-600 dark:text-amber-400">Click to attach screenshot/file</span> or drag and drop
                      </span>
                      <span className="text-[10px] text-muted">
                        Supports screenshot images (.png, .jpg, .jpeg), PDF, Excel, Word
                      </span>
                    </label>
                  </div>

                  {holdSupportFiles.length > 0 && (
                    <div className="mt-2.5 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {holdSupportFiles.map((file, fIdx) => (
                        <div
                          key={fIdx}
                          className="flex items-center justify-between gap-2 p-2 rounded-md bg-background border border-border text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <File size={14} className="text-amber-500 shrink-0" />
                            <span className="font-medium text-text truncate max-w-[260px]">{file.name}</span>
                            <span className="text-[10px] text-muted shrink-0">({(file.size / 1024).toFixed(1)} KB)</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setHoldSupportFiles(prev => prev.filter((_, i) => i !== fIdx))}
                            className="text-muted hover:text-rose-600 p-1 rounded transition-colors"
                            title="Remove file"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="px-6 py-4 border-t border-border flex justify-end gap-3 bg-muted/5 rounded-b-xl">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowHoldSupportModal(false)}
                  disabled={isSubmittingHoldSupport}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmittingHoldSupport || !holdSupportDescription.trim()}
                  className={
                    holdSupportType === 'Hold'
                      ? 'bg-amber-600 hover:bg-amber-700 text-white min-w-[120px]'
                      : holdSupportType === 'Support'
                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white min-w-[120px]'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white min-w-[120px]'
                  }
                >
                  {isSubmittingHoldSupport ? (
                    <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Submitting...</span>
                  ) : (
                    <span>{holdSupportType === 'Active' ? 'Resolve & Resume' : 'Submit'}</span>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reopen Job Modal */}
      {showReopenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowReopenModal(false)} />
          <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-lg flex flex-col border border-border animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-rose-500/5 rounded-t-xl">
              <h2 className="text-lg font-bold flex items-center gap-2 text-rose-600 dark:text-rose-400 m-0">
                <RotateCcw size={20} />
                Reopen Completed Job
              </h2>
              <button
                onClick={() => setShowReopenModal(false)}
                className="text-muted hover:text-text transition-colors p-1 rounded-md"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleReopenSubmit}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                    Correction Reason <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={4}
                    required
                    placeholder="Specify the correction reason required for reopening this job (Mandatory)..."
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    className="w-full p-3 bg-background border border-border rounded-lg text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 resize-y"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted">
                      Attach Files (Images, PDF, Excel, DOCX)
                    </label>
                    <span className="text-[11px] text-muted">Optional</span>
                  </div>

                  <div className="border border-dashed border-border rounded-lg p-3 bg-accent/20 hover:bg-accent/40 transition-colors text-center">
                    <input
                      type="file"
                      id="reopen-file-input"
                      multiple
                      accept="image/*,.pdf,.xlsx,.xls,.csv,.doc,.docx"
                      onChange={(e) => {
                        if (e.target.files) {
                          const newFiles = Array.from(e.target.files)
                          setReopenFiles(prev => [...prev, ...newFiles])
                          e.target.value = ''
                        }
                      }}
                      className="hidden"
                    />
                    <label
                      htmlFor="reopen-file-input"
                      className="cursor-pointer flex flex-col items-center justify-center gap-1.5 text-xs text-muted hover:text-text"
                    >
                      <Paperclip size={20} className="text-rose-500" />
                      <span>
                        <span className="font-semibold text-rose-600 dark:text-rose-400">Click to browse</span> or drag and drop files
                      </span>
                      <span className="text-[10px] text-muted">
                        Supports images, PDF, Excel (.xlsx, .xls, .csv), Word (.doc, .docx)
                      </span>
                    </label>
                  </div>

                  {reopenFiles.length > 0 && (
                    <div className="mt-2.5 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {reopenFiles.map((file, fIdx) => (
                        <div
                          key={fIdx}
                          className="flex items-center justify-between gap-2 p-2 rounded-md bg-background border border-border text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <File size={14} className="text-rose-500 shrink-0" />
                            <span className="font-medium text-text truncate max-w-[260px]">{file.name}</span>
                            <span className="text-[10px] text-muted shrink-0">({(file.size / 1024).toFixed(1)} KB)</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setReopenFiles(prev => prev.filter((_, i) => i !== fIdx))}
                            className="text-muted hover:text-rose-600 p-1 rounded transition-colors"
                            title="Remove file"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="px-6 py-4 border-t border-border flex justify-end gap-3 bg-muted/5 rounded-b-xl">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowReopenModal(false)}
                  disabled={isSubmittingReopen}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmittingReopen || !reopenReason.trim()}
                  className="bg-rose-600 hover:bg-rose-700 text-white min-w-[130px]"
                >
                  {isSubmittingReopen ? (
                    <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Reopening...</span>
                  ) : (
                    <span className="flex items-center gap-1.5"><RotateCcw size={14} /> Reopen to QC</span>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
