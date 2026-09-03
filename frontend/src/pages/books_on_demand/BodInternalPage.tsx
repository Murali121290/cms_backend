import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw, ChevronRight, ArrowLeft, XCircle, Upload, CheckCircle2, Layers, AlertCircle, User, Search, Filter, FolderOpen, ArrowRight, Trash2 } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useRBAC } from '@/hooks/useRBAC'
import { usersApi } from '@/api/users'
import { Button } from '@/components/ui/Button'
import { toast } from '@/store/useToastStore'
import api from '@/api/client'

export function BodInternalPage() {
  useDocumentTitle('Book on Demand — S4Carlisle CMS')
  const navigate = useNavigate()
  const { isAdmin } = useRBAC()

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
  
  // Delete Modal states
  const [showDeleteModal, setShowDeleteModal] = useState<number | null>(null)

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

  // Calculate metrics
  const totalJobs = jobs.length
  const completedJobs = jobs.filter(j => j.status === 'Completed').length
  const activeJobs = jobs.filter(j => j.status === 'Active')
  
  const unassignedJobs = activeJobs.filter(j => !j.current_assignee).length
  const addJobStageJobs = activeJobs.filter(j => j.current_stage_name === 'Add job').length
  const qcStageJobs = activeJobs.filter(j => j.current_stage_name === 'QC').length
  
  // Progress calculations: assume 4 stages (0,1,2,3). If completed, 100%
  let totalProgressStages = jobs.length * 3
  let completedProgressStages = jobs.reduce((acc, job) => {
      if (job.status === 'Completed') return acc + 3
      return acc + Math.min(job.current_stage_index, 3)
  }, 0)
  
  const completionPercentage = totalProgressStages > 0 ? Math.round((completedProgressStages / totalProgressStages) * 100) : 0

  // Filter options
  const statusOptions = Array.from(new Set(jobs.map(j => j.status))).sort()
  
  const getUserDisplayName = (username: string | null | undefined) => {
    if (!username) return ''
    if (!users || users.length === 0) return username
    const u = users.find(user => user.user_name === username)
    if (u && u.first_name) {
      return `${u.first_name} ${u.last_name || ''}`.trim()
    }
    return username
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
      
    const matchesStatus = statusFilter === 'all' || j.status === statusFilter
    
    const currentAssignee = j.current_assignee || null
    const matchesAssignee = assigneeFilter === 'all'
      || (assigneeFilter === 'unassigned' ? !currentAssignee : currentAssignee === assigneeFilter)
      
    return matchesSearch && matchesStatus && matchesAssignee
  }).sort((a, b) => b.id - a.id) // sort newest first

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
              <h1 className="text-xl font-bold font-serif text-text m-0">Book on Demand</h1>
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
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-card border border-border/70 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-primary/10 text-primary rounded-lg">
            <Layers size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Total Jobs</span>
            <span className="text-lg font-bold text-text">{totalJobs}</span>
          </div>
        </div>

        <div className="bg-card border border-border/70 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-rose-500/10 text-rose-600 rounded-lg">
            <User size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Unassigned</span>
            <span className="text-lg font-bold text-text">{unassignedJobs}</span>
          </div>
        </div>

        <div className="bg-card border border-border/70 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg">
            <RefreshCw size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Add Job Stage</span>
            <span className="text-lg font-bold text-text">{addJobStageJobs}</span>
          </div>
        </div>
        
        <div className="bg-card border border-border/70 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 text-blue-600 rounded-lg">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">QC Stage</span>
            <span className="text-lg font-bold text-text">{qcStageJobs}</span>
          </div>
        </div>

        <div className="bg-card border border-border/70 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-lg">
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
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-card border border-border rounded-lg px-2.5 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors"
            >
              <option value="all">All statuses</option>
              {statusOptions.map(s => (
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
              {assigneeOptions.map(assignee => (
                <option key={assignee} value={assignee}>{getUserDisplayName(assignee)}</option>
              ))}
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
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredJobs.map((job) => {
            const percent = job.status === 'Completed' ? 100 : Math.round((job.current_stage_index / 3) * 100)
            const currentAssignee = job.current_assignee || null

            return (
              <div 
                key={job.id}
                onClick={() => navigate(`/bod/internal/${job.id}`)}
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
                      <p className="text-[11px] text-muted mt-0.5">{job.client_name}</p>
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
                      <select
                        value={getUserDisplayName(currentAssignee)}
                        onChange={(e) => assignUser(job.id, e.target.value)}
                        className="bg-transparent border-0 text-primary font-medium focus:ring-0 focus:outline-none cursor-pointer p-0 text-[11px] hover:text-primary-hover"
                      >
                        <option value="" className="text-text bg-card">Unassigned</option>
                        {users.filter(u => u.active_status).map(u => {
                          const displayName = u.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : u.user_name;
                          return (
                            <option key={u.id} value={displayName} className="text-text bg-card">
                              {displayName}
                            </option>
                          )
                        })}
                      </select>
                    </div>
                    <span className={`capitalize font-bold px-2 py-0.5 rounded-md text-[9px] border ${
                      job.status === 'Completed'
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                        : 'bg-primary/10 border-primary/20 text-primary'
                    }`}>
                      {job.status}
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
                  <span>Created: {new Date(job.created_at.endsWith('Z') ? job.created_at : job.created_at + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</span>
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
                <p className="text-[10px] text-muted mt-0.5">Upload a PDF for Book on Demand</p>
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
                <select 
                  value={selectedClientId} 
                  onChange={e => setSelectedClientId(e.target.value)} 
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors"
                  required
                >
                  <option value="">Select Client</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.client_name}</option>
                  ))}
                </select>
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
    </div>
  )
}
