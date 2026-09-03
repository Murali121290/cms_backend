import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Upload, ArrowRight, User, CheckCircle2, Clock, Layers } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useRBAC } from '@/hooks/useRBAC'
import { usersApi } from '@/api/users'
import { Button } from '@/components/ui/Button'
import { toast } from '@/store/useToastStore'
import api from '@/api/client'

export function BodInternalJobPage() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const { isAdmin } = useRBAC()

  const [job, setJob] = useState<any>(null)

  useDocumentTitle("Inkflow - Books on Demand")
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'stage' | 'assignment'>('stage')

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return ''
    try {
      // Check if it already has a timezone indicator (+00:00, -05:00, or Z)
      const hasTz = dateStr.endsWith('Z') || dateStr.includes('+') || !!dateStr.match(/-\d{2}:\d{2}$/)
      const validStr = hasTz ? dateStr : `${dateStr}Z`
      const d = new Date(validStr)
      if (isNaN(d.getTime())) return 'Invalid Date'
      return d.toLocaleString('en-IN')
    } catch {
      return 'Invalid Date'
    }
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
    try {
      await api.post(`/bod/jobs/${jobId}/advance`)
      toast.success("Job advanced to next stage")
      fetchJob()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to advance stage")
    }
  }

  const uploadEpub = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return
    const file = e.target.files[0]

    const formData = new FormData()
    formData.append('file', file)

    try {
      await api.post(`/bod/jobs/${jobId}/upload-epub`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success("EPUB uploaded and job advanced")
      fetchJob()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to upload EPUB")
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

  if (loading) {
    return <div className="p-6 text-muted">Loading...</div>
  }

  if (!job) {
    return null
  }

  const isCompleted = job.status === 'Completed'
  const canUploadEpub = !isCompleted && (job.current_stage_name === 'Production' || job.current_stage_name === 'QC')
  const percent = isCompleted ? 100 : Math.round((job.current_stage_index / 3) * 100)

  const getUserDisplayName = (username: string | null | undefined) => {
    if (!username) return ''
    if (!users || users.length === 0) return username
    const u = users.find(user => user.user_name === username)
    if (u && u.first_name) {
      return `${u.first_name} ${u.last_name || ''}`.trim()
    }
    return username
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
              <div className="flex items-center gap-1 text-muted text-xs">
                <User size={13} className="text-muted/70" />
                <span className="text-primary font-medium">
                  {job.current_assignee ? getUserDisplayName(job.current_assignee) : 'Unassigned'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {!isCompleted && job.current_stage_name === 'QC' && (
            <Button variant="outline" onClick={advanceStage} rightIcon={<ArrowRight size={14} />}>
              Advance Stage
            </Button>
          )}

          {canUploadEpub && (
            <div className="relative">
              <input
                type="file"
                accept=".epub"
                onChange={uploadEpub}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                title="Upload EPUB"
              />
              <Button variant="primary" leftIcon={<Upload size={14} />}>
                Upload EPUB
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between text-xs text-muted font-bold mb-2">
          <span>Overall Progress</span>
          <span>{percent}%</span>
        </div>
        <div className="h-2 w-full bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500 rounded-full"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Files Panel */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold border-b border-border pb-2">Files</h3>

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
        </div>

        {/* Combined History Panel */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm lg:col-span-1">
          <div className="flex items-center gap-4 border-b border-border mb-4">
            <button
              onClick={() => setActiveTab('stage')}
              className={`pb-2 text-sm font-bold transition-colors border-b-2 ${
                activeTab === 'stage' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
              }`}
            >
              Stage History
            </button>
            {job.assigned_users && Array.isArray(job.assigned_users) && job.assigned_users.length > 0 && (
              <button
                onClick={() => setActiveTab('assignment')}
                className={`pb-2 text-sm font-bold transition-colors border-b-2 ${
                  activeTab === 'assignment' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
                }`}
              >
                Assignment History
              </button>
            )}
          </div>

          {activeTab === 'stage' && (
            <div className="space-y-4">
              {Object.keys(job.stage_history || {}).map((stageName, idx) => {
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
                      {idx !== Object.keys(job.stage_history).length - 1 && (
                        <div className="w-px h-full bg-border my-1" />
                      )}
                    </div>

                    <div className="pb-4 flex-1">
                      <h4 className={`text-sm font-bold ${isCurrent ? 'text-text' : 'text-text/70'}`}>{stageName}</h4>

                      <div className="mt-1.5 space-y-1">
                        {data.assignee && (
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
                      <User size={14} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-text m-0">Assigned to: {getUserDisplayName(assignment.user_id)}</p>
                      <p className="text-[10px] text-muted m-0 mt-0.5">Stage: {assignment.stage} • Assigned By: {getUserDisplayName(assignment.assigned_by) || 'System'}</p>
                    </div>
                  </div>
                  <div className="text-xs text-muted font-medium">
                    {formatDateTime(assignment.time)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
