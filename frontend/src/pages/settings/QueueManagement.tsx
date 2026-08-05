import { useState, useEffect, useTransition } from 'react'
import { ArrowLeft, RefreshCw, Search, Filter, Clock, CheckCircle2, AlertCircle, Trash2, ArrowUp, ArrowDown, Play } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { v2Client, getApiErrorMessage } from '@/api/v2client'
import { toast } from '@/store/useToastStore'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'

interface ProcessingJob {
  id: number
  file_id: number
  process_type: string
  status: string
  current_step: string | null
  progress_pct: number
  error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  filename: string | null
  project_code: string | null
  chapter_number: string | null
  priority: number
  options: Record<string, unknown> | null
}

export function QueueManagement() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<ProcessingJob[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [search, setSearch] = useState('')
  const [, startTransition] = useTransition()

  async function fetchJobs(isSilent = false) {
    if (!isSilent) setRefreshing(true)
    try {
      const response = await v2Client.get<ProcessingJob[]>('/processing-jobs')
      setJobs(response.data)
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void fetchJobs()
    const timer = setInterval(() => {
      void fetchJobs(true)
    }, 8000)
    return () => clearInterval(timer)
  }, [])

  async function handleCancel(jobId: number) {
    try {
      await v2Client.post(`/processing-jobs/${jobId}/cancel`)
      toast.success(`Job #${jobId} cancelled successfully`)
      void fetchJobs(true)
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  async function handleUpdatePriority(jobId: number, currentPriority: number, diff: number) {
    try {
      await v2Client.post(`/processing-jobs/${jobId}/priority`, {
        priority: currentPriority + diff
      })
      toast.success(`Priority updated for Job #${jobId}`)
      void fetchJobs(true)
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  async function handleRetry(job: ProcessingJob) {
    try {
      if (job.process_type === 'post_prod_conversion') {
        const chapterId = job.options?.chapter_id
        if (!chapterId) {
          toast.error("Cannot retry: missing chapter ID in options")
          return
        }
        await v2Client.post(`/post-prod/chapters/${chapterId}/convert`)
        toast.success(`Retry enqueued for post-production chapter "${job.filename || chapterId}"`)
      } else {
        await v2Client.post(`/files/${job.file_id}/processing-jobs`, {
          process_type: job.process_type,
          mode: 'style',
          options: job.options || {}
        })
        toast.success(`Retry enqueued for file "${job.filename || job.file_id}"`)
      }
      void fetchJobs(true)
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  const filtered = jobs.filter(j => {
    const matchesStatus = filterStatus ? j.status === filterStatus : true
    const matchesType = filterType ? j.process_type === filterType : true
    const matchesSearch = search
      ? (j.filename?.toLowerCase().includes(search.toLowerCase()) ||
         j.project_code?.toLowerCase().includes(search.toLowerCase()) ||
         j.chapter_number?.toLowerCase().includes(search.toLowerCase()))
      : true
    return matchesStatus && matchesType && matchesSearch
  })

  function fmtDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'completed':
        return <Badge variant="success" className="bg-green-100 text-green-700 border-green-200"><CheckCircle2 size={12} className="mr-1" />Completed</Badge>
      case 'failed':
        return <Badge variant="error" className="bg-red-100 text-red-700 border-red-200"><AlertCircle size={12} className="mr-1" />Failed</Badge>
      case 'cancelled':
        return <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">Cancelled</Badge>
      case 'processing':
        return <Badge variant="warning" className="bg-yellow-100 text-yellow-700 border-yellow-200"><Spinner size="sm" className="mr-1" />Processing</Badge>
      default:
        return <Badge variant="info" className="bg-blue-100 text-blue-700 border-blue-200"><Clock size={12} className="mr-1" />Pending</Badge>
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/settings')} className="p-2 rounded-lg hover:bg-card border border-transparent hover:border-border text-muted hover:text-text transition-all">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-text">Conversion Queue Management</h2>
          <p className="text-xs text-muted mt-0.5">{jobs.length} total background jobs tracked</p>
        </div>
        <Button onClick={() => void fetchJobs()} disabled={refreshing} variant="secondary" leftIcon={<RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />}>
          Refresh Queue
        </Button>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[240px]">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={e => startTransition(() => setSearch(e.target.value))}
                placeholder="Search by file, project, or chapter..."
                type="search"
                className="w-full pl-9 pr-4 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-text"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Filter size={14} className="text-muted" />
            <span className="text-xs text-muted font-medium">Filters:</span>
          </div>

          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30 w-[140px]">
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="failed">Failed</option>
          </select>

          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30 w-[170px]">
            <option value="">All Process Types</option>
            <option value="xml_to_indesign">XML to InDesign</option>
            <option value="word_to_xml">Word to XML</option>
            <option value="ppd_generation">PPD Generation</option>
            <option value="post_prod_conversion">Post-Production</option>
          </select>
        </div>
      </Card>

      {/* Queue Table */}
      <Card>
        {loading ? <FullPageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background">
                  {['Job ID', 'Priority', 'Project', 'Chapter', 'File Info', 'Process Type', 'Progress / Status', 'Timestamps', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-muted text-sm">No conversion jobs found</td></tr>
                ) : (
                  filtered.map(job => (
                    <tr key={job.id} className="hover:bg-background/60 transition-colors">
                      <td className="px-4 py-3 font-semibold text-text">#{job.id}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-text w-6 text-center">{job.priority}</span>
                          {['pending', 'processing'].includes(job.status) && (
                            <div className="flex flex-col">
                              <button onClick={() => void handleUpdatePriority(job.id, job.priority, 1)} className="p-0.5 text-muted hover:text-primary transition-colors">
                                <ArrowUp size={12} />
                              </button>
                              <button onClick={() => void handleUpdatePriority(job.id, job.priority, -1)} className="p-0.5 text-muted hover:text-primary transition-colors">
                                <ArrowDown size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text font-medium">{job.project_code || '—'}</td>
                      <td className="px-4 py-3 text-muted">{job.chapter_number || '—'}</td>
                      <td className="px-4 py-3 max-w-[180px] truncate text-text" title={job.filename || ''}>{job.filename || '—'}</td>
                      <td className="px-4 py-3 text-text font-medium">{fmtType(job.process_type)}</td>
                      <td className="px-4 py-3">
                        <div className="space-y-1.5 min-w-[120px]">
                          <div>{getStatusBadge(job.status)}</div>
                          {job.status === 'processing' && (
                            <div className="w-full bg-border rounded-full h-1.5 overflow-hidden">
                              <div className="bg-primary h-full transition-all duration-300" style={{ width: `${job.progress_pct}%` }}></div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted leading-relaxed">
                        <div>Created: {fmtDate(job.created_at)}</div>
                        {job.completed_at && <div>Ended: {fmtDate(job.completed_at)}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          {['pending', 'processing'].includes(job.status) && (
                            <button
                              onClick={() => void handleCancel(job.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-danger bg-red-50 border border-red-200 rounded-lg hover:bg-danger hover:text-white transition-all"
                            >
                              <Trash2 size={12} /> Cancel
                            </button>
                          )}
                          {['failed', 'cancelled'].includes(job.status) && (
                            <button
                              onClick={() => void handleRetry(job)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-accent rounded-lg hover:bg-primary hover:text-white transition-all"
                            >
                              <Play size={12} /> Retry
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function fmtType(type: string) {
  switch (type) {
    case 'xml_to_indesign': return 'XML to InDesign'
    case 'word_to_xml': return 'Word to XML'
    case 'ppd_generation': return 'PPD Generation'
    case 'post_prod_conversion': return 'Post-Production Conversion'
    default: return type
  }
}
