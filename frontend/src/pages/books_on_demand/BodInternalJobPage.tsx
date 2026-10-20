import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Upload, ArrowRight, User, CheckCircle2, Clock, Layers, Calendar, XCircle, CheckCircle, Loader2, FileText, Edit3, Check, Send } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useRBAC } from '@/hooks/useRBAC'
import { usersApi } from '@/api/users'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { toast } from '@/store/useToastStore'
import api from '@/api/client'
import { formatDateTime as fmtUtcDateTime } from '@/utils/dateUtils'
import { useUsersStore } from '@/stores/usersStore'
import { useSessionStore } from '@/stores/sessionStore'

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
  const [activeTab, setActiveTab] = useState<'stage' | 'assignment' | 'duedate'>('stage')
  const [aceFile, setAceFile] = useState<File | null>(null)
  const [epubcheckFile, setEpubcheckFile] = useState<File | null>(null)
  const [isUploadingReports, setIsUploadingReports] = useState(false)

  const [showQCModal, setShowQCModal] = useState(false)
  const [qcChecks, setQcChecks] = useState({
    ace: false,
    epubCheck: false,
    manualQC: false
  })

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
  const [analysisType, setAnalysisType] = useState<string>('Text PDF')
  const [analysisLanguage, setAnalysisLanguage] = useState<string>('English')
  const [analysisDueDate, setAnalysisDueDate] = useState<string>('')
  const [analysisReason, setAnalysisReason] = useState<string>('')

  const calculateDefaultDueDate = (type: string, pages: number | string, baseDate?: string | Date) => {
    const isImage = (type || '').toLowerCase().includes('image')
    const p = typeof pages === 'number' ? pages : parseInt(String(pages), 10)
    const pageNum = isNaN(p) ? 0 : p
    const days = isImage ? (pageNum > 250 ? 7 : 5) : (pageNum > 250 ? 4 : 3)

    const base = baseDate ? new Date(baseDate) : new Date()
    const result = new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
    return result.toISOString().slice(0, 10)
  }

  const startEditingAnalysis = () => {
    if (!job) return
    setAnalysisPages(job.pdf_page_count ?? '')
    setAnalysisType(job.pdf_type || 'Text PDF')
    setAnalysisLanguage(job.pdf_language || 'English')
    const dStr = job.due_date ? new Date(job.due_date.endsWith('Z') ? job.due_date : job.due_date + 'Z').toISOString().slice(0, 10) : ''
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

  const uploadEpub = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return
    const file = e.target.files[0]

    const formData = new FormData()
    formData.append('file', file)

    setIsUploading(true)
    try {
      await api.post(`/bod/jobs/${jobId}/upload-epub`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success("EPUB uploaded and moved to QC")
      navigate('/bod/internal')
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
    <div className="space-y-6 max-w-5xl mx-auto p-6 text-text animate-in fade-in">
      {/* Header / Breadcrumb */}
      <div className="flex items-center gap-3 text-muted">
        <button
          onClick={() => navigate('/bod/internal')}
          className="hover:text-primary transition-colors flex items-center gap-1 text-sm font-semibold"
        >
          <ArrowLeft size={16} /> Back to Jobs
        </button>
      </div>

      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold font-serif text-text m-0 flex items-center gap-3">
            {job.pdf_filename}
            <span className={`capitalize font-bold px-2.5 py-0.5 rounded-md text-[10px] border tracking-wider ${isCompleted
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
              : 'bg-primary/10 border-primary/20 text-primary'
              }`}>
              {job.status}
            </span>
          </h1>
          <div className="flex items-center gap-4 mt-1.5">
            <p className="text-sm text-muted m-0">{job.client_name} • Stage: <strong className="text-text">{job.current_stage_name}</strong></p>

            {!isCompleted && (
              <div className="flex items-center gap-1.5 text-muted text-xs">
                <User size={13} className="text-muted/70" />
                <div className="w-[180px]">
                  <Dropdown
                    variant="inline"
                    searchable
                    searchPlaceholder="Search assignees..."
                    value={job.current_assignee || ''}
                    onChange={(val) => assignUser(val)}
                    className="bg-transparent border-0 text-primary font-medium p-0 hover:text-primary-hover w-full shadow-none h-auto min-h-0 focus:border-transparent focus:ring-0 text-[12px]"
                    options={assigneeOptions}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {!isCompleted && job.current_stage_name === 'Add job' && (
            <Button
              variant="primary"
              onClick={proceedToProduction}
              disabled={isAdvancing}
              rightIcon={!isAdvancing ? <ArrowRight size={14} /> : undefined}
            >
              {isAdvancing ? 'Proceeding...' : 'Proceed to Production'}
            </Button>
          )}

          {!isCompleted && job.current_stage_name === 'QC' && (
            <Button variant="outline" onClick={() => setShowQCModal(true)} disabled={isAdvancing} rightIcon={!isAdvancing ? <ArrowRight size={14} /> : undefined}>
              {isAdvancing ? 'Loading...' : 'Completed'}
            </Button>
          )}

          {!isCompleted && job.current_stage_name === 'Ready to Dispatch' && (
            <Button
              variant="primary"
              onClick={dispatchJob}
              disabled={isDispatching}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              leftIcon={isDispatching ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            >
              {isDispatching ? 'Dispatching to FTP...' : 'Dispatch'}
            </Button>
          )}

          {canUploadEpub && (
            <div className="relative">
              <input
                type="file"
                accept=".epub"
                onChange={uploadEpub}
                disabled={isUploading}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10 disabled:cursor-not-allowed"
                title="Upload EPUB"
              />
              <Button variant="primary" disabled={isUploading} leftIcon={!isUploading ? <Upload size={14} /> : undefined}>
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-4">
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
          </div>
        </div>
      )}

      {/* Job Analysis Step Card (Only shown in Add job stage) */}
      {job.current_stage_name === 'Add job' && (
        <div className="bg-card border rounded-xl p-5 shadow-sm transition-all border-amber-500/40 ring-1 ring-amber-500/20">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg">
                <FileText size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-text m-0">Job Analysis Step</h3>
                  <span className="text-[10px] bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-bold px-2 py-0.5 rounded-full">
                    Add Job Analysis
                  </span>
                </div>
                <p className="text-xs text-muted m-0 mt-0.5">
                  Review and update document specifications (Pages, Type, Language, Due Date).
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
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
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Due Date</span>
                <p className="text-base font-bold text-text mt-1 m-0">
                  {job.due_date ? formatDateTime(job.due_date) : <span className="text-muted font-normal italic">No date set</span>}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
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
                <select
                  value={analysisType}
                  onChange={(e) => setAnalysisType(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary transition-colors"
                >
                  <option value="Text PDF">Text PDF</option>
                  <option value="Image PDF">Image PDF</option>
                  <option value="Scanned PDF">Scanned PDF</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted">Language</label>
                <input
                  type="text"
                  list="bod-language-options"
                  value={analysisLanguage}
                  onChange={(e) => setAnalysisLanguage(e.target.value)}
                  placeholder="e.g. English"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary transition-colors"
                />
                <datalist id="bod-language-options">
                  <option value="English" />
                  <option value="German" />
                  <option value="French" />
                  <option value="Spanish" />
                  <option value="Italian" />
                  <option value="Dutch" />
                  <option value="Portuguese" />
                  <option value="Russian" />
                  <option value="Chinese (Simplified)" />
                  <option value="Japanese" />
                </datalist>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted">Due Date</label>
                  <button
                    type="button"
                    onClick={() => {
                      const autoDate = calculateDefaultDueDate(analysisType, analysisPages, job.created_at)
                      setAnalysisDueDate(autoDate)
                    }}
                    className="text-[10px] text-primary hover:underline font-semibold"
                    title="Calculate based on: Text (<=250: 3d, >250: 4d) | Image (<=250: 5d, >250: 7d)"
                  >
                    Auto-calc
                  </button>
                </div>
                <input
                  type="date"
                  value={analysisDueDate}
                  onChange={(e) => setAnalysisDueDate(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              <div className="col-span-1 sm:col-span-2 lg:col-span-4 space-y-1">
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
            {job.due_date_history && Array.isArray(job.due_date_history) && job.due_date_history.length > 0 && (
              <button
                onClick={() => setActiveTab('duedate')}
                className={`pb-2 text-sm font-bold transition-colors border-b-2 ${activeTab === 'duedate' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
                  }`}
              >
                Update History
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {activeTab === 'stage' && (
              <div className="space-y-4">
                {Object.keys(job.stage_history || {})
                  .filter(stageName => {
                    const data = job.stage_history[stageName]
                    return stageName === job.current_stage_name || Boolean(data?.start_time || data?.end_time)
                  })
                  .map((stageName, idx, arr) => {
                    const data = job.stage_history[stageName]
                    const isCurrent = stageName === job.current_stage_name && !isCompleted

                    return (
                      <div key={idx} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${data.end_time ? 'bg-emerald-500/20 text-emerald-600' :
                            isCurrent ? 'bg-primary/20 text-primary border-2 border-primary/30' :
                              'bg-accent text-muted'
                            }`}>
                            {data.end_time ? <CheckCircle2 size={12} /> : <div className="w-1.5 h-1.5 rounded-full bg-current" />}
                          </div>
                          {idx !== arr.length - 1 && (
                            <div className="w-px h-full bg-border my-1" />
                          )}
                        </div>

                        <div className="pb-4 flex-1">
                          <h4 className={`text-sm font-bold ${isCurrent ? 'text-text' : 'text-text/70'}`}>{stageName}</h4>

                          <div className="mt-1.5 space-y-1">
                            {data.dispatched_by && (
                              <div className="flex items-center gap-1.5 text-xs text-muted">
                                <Send size={12} className="text-emerald-600 dark:text-emerald-400" /> Dispatched by: <strong className="text-text">{getUserDisplayName(data.dispatched_by)}</strong>
                              </div>
                            )}

                            {data.assignee && !data.dispatched_by && (
                              <div className="flex items-center gap-1.5 text-xs text-muted">
                                <User size={12} /> Assigned to: <strong className="text-text">{getUserDisplayName(data.assignee)}</strong>
                              </div>
                            )}

                            {data.start_time && (
                              <div className="flex items-center gap-1.5 text-xs text-muted">
                                <Clock size={12} /> Started: {formatDateTime(data.start_time)}
                              </div>
                            )}

                            {data.end_time && (
                              <div className="flex items-center gap-1.5 text-xs text-muted">
                                <CheckCircle2 size={12} /> Completed: {formatDateTime(data.end_time)}
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
                          {assignment.action || `Assigned to: ${getUserDisplayName(assignment.user_id)}`}
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

            {activeTab === 'duedate' && job.due_date_history && Array.isArray(job.due_date_history) && job.due_date_history.length > 0 && (
              <div className="space-y-3">
                {[...job.due_date_history].reverse().map((historyItem: any, idx: number) => {
                  const hasChanges = Array.isArray(historyItem.changes) && historyItem.changes.length > 0;
                  return (
                    <div key={idx} className="flex items-start justify-between bg-background border border-border rounded-lg p-3 gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="p-2 bg-primary/10 text-primary rounded-lg shrink-0 mt-0.5">
                          {hasChanges && historyItem.changes.length === 1 && historyItem.changes[0].field === 'Due Date' ? (
                            <Calendar size={14} />
                          ) : (
                            <Edit3 size={14} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {hasChanges ? (
                            <div className="space-y-1.5">
                              {historyItem.changes.map((change: any, cIdx: number) => (
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
    </div>
  )
}
