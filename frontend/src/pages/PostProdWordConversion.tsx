import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw, ChevronRight, ArrowLeft, XCircle, Upload } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usersApi } from '@/api/users'

interface Chapter {
  id: number
  chapter_no: string
  status: string
  source_filename: string
  error_message?: string
  attempts: number
  completed_at?: string
}

interface PostProdProject {
  id: number
  customer_name: string
  project_name: string
  status: string
  assignee?: string
  created_at: string
  chapters: Chapter[]
}

interface ClientCompany {
  id: number
  company: string
}

export function PostProdWordConversion() {
  useDocumentTitle('Word Conversion — S4Carlisle CMS')
  const navigate = useNavigate()

  const [projects, setProjects] = useState<PostProdProject[]>([])
  const [clients, setClients] = useState<ClientCompany[]>([])
  const [users, setUsers] = useState<any[]>([])
  
  // Form states
  const [showAddProjectModal, setShowAddProjectModal] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [projectName, setProjectName] = useState('')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/v2/post-prod/projects')
      if (res.ok) {
        const data = await res.json()
        setProjects(data)
      }
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
    if (!customerName || !projectName || !zipFile) return

    setUploading(true)
    setErrorMsg(null)
    const formData = new FormData()
    formData.append('customer_name', customerName)
    formData.append('project_name', projectName)
    formData.append('file', zipFile)

    try {
      const res = await fetch('/api/v2/post-prod/projects', {
        method: 'POST',
        body: formData
      })
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.detail || 'Failed to create project')
      }
      
      setCustomerName('')
      setProjectName('')
      setZipFile(null)
      setShowAddProjectModal(false)
      await fetchProjects()
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during project creation.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6 text-text">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <button 
            onClick={() => navigate('/post-production')}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-text transition-colors mb-3"
          >
            <ArrowLeft size={14} /> Back to Hub
          </button>
          <h1 className="text-3xl font-bold font-serif text-text tracking-tight">Word Conversion</h1>
          <p className="text-sm text-muted mt-1">InDesign and PDF Ingestion & Automated Word Mapping</p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => fetchProjects()}
            className="p-2.5 bg-card border border-border hover:bg-accent rounded-xl text-muted hover:text-text transition-colors"
            title="Refresh list"
          >
            <RefreshCw size={16} />
          </button>
          <button 
            onClick={() => setShowAddProjectModal(true)}
            className="px-4 py-2.5 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <Plus size={18} /> Add Project
          </button>
        </div>
      </div>

      {/* Grid listing of all active projects */}
      {projects.length === 0 ? (
        <div className="text-center py-20 text-muted border border-dashed border-border rounded-xl bg-card/20">
          <p className="text-sm font-medium">No projects added yet</p>
          <button 
            onClick={() => setShowAddProjectModal(true)}
            className="mt-3 text-xs text-primary underline"
          >
            Create first project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((proj) => {
            const totalChapters = proj.chapters.length
            const completedCount = proj.chapters.filter(c => c.status === 'Completed').length
            
            return (
              <div 
                key={proj.id}
                onClick={() => navigate(`/post-production/word-conversion/${proj.id}`)}
                className="p-5 rounded-2xl border bg-card border-border hover:border-primary/50 cursor-pointer shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-base text-text truncate max-w-[200px]">{proj.project_name}</h3>
                      <p className="text-xs text-muted mt-0.5">{proj.customer_name}</p>
                    </div>
                    <ChevronRight size={18} className="text-muted" />
                  </div>

                  <div className="mt-4 flex items-center justify-between text-xs text-muted">
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <span>Assignee:</span>
                      <select
                        value={proj.assignee || ''}
                        onChange={async (e) => {
                          const newAssignee = e.target.value
                          try {
                            const res = await fetch(`/api/v2/post-prod/projects/${proj.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ assignee: newAssignee })
                            })
                            if (res.ok) {
                              fetchProjects()
                            }
                          } catch (err) {
                            console.error(err)
                          }
                        }}
                        className="bg-transparent border-none text-primary focus:outline-none cursor-pointer font-medium p-0"
                      >
                        <option value="" className="text-text bg-card">Unassigned</option>
                        {users.map(u => (
                          <option key={u.id} value={u.user_name} className="text-text bg-card">{u.user_name}</option>
                        ))}
                      </select>
                    </div>
                    <span className="capitalize font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full text-[10px]">
                      {proj.status}
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-muted">
                  <span>{new Date(proj.created_at).toLocaleDateString()}</span>
                  <span className="font-medium bg-accent px-2.5 py-1 rounded-full text-text">
                    {completedCount}/{totalChapters} Chapters Converted
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add Project Modal */}
      {showAddProjectModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border border-border rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-semibold text-text">Add New Project</h3>
                <p className="text-xs text-muted mt-0.5">Upload a ZIP package with chapters</p>
              </div>
              <button 
                onClick={() => {
                  setShowAddProjectModal(false)
                  setErrorMsg(null)
                }}
                className="text-muted hover:text-text transition-colors"
              >
                <XCircle size={20} />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-xl text-xs flex items-center gap-2">
                <XCircle size={16} />
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleAddProject} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Customer Name</label>
                <select 
                  value={customerName} 
                  onChange={e => setCustomerName(e.target.value)} 
                  className="w-full bg-surface border border-border rounded-lg px-3.5 py-2.5 text-sm text-text focus:outline-none focus:border-primary transition-colors"
                  required
                >
                  <option value="">Select Customer</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.company}>{c.company}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Project Name / Code</label>
                <input 
                  type="text" 
                  value={projectName} 
                  onChange={e => setProjectName(e.target.value)} 
                  className="w-full bg-surface border border-border rounded-lg px-3.5 py-2.5 text-sm text-text focus:outline-none focus:border-primary transition-colors placeholder:text-muted/50"
                  placeholder="e.g. Biology Vol 2"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Upload Chapters ZIP Package</label>
                <div className="border border-dashed border-border hover:border-primary rounded-xl p-6 text-center cursor-pointer transition-colors bg-surface/50">
                  <input 
                    type="file" 
                    accept=".zip" 
                    onChange={e => e.target.files && setZipFile(e.target.files[0])}
                    className="hidden" 
                    id="zip-upload"
                    required
                  />
                  <label htmlFor="zip-upload" className="cursor-pointer space-y-2 block">
                    <Upload className="mx-auto text-muted" size={28} />
                    <p className="text-xs font-medium text-text">Click or Drag ZIP Package</p>
                    <p className="text-[10px] text-muted">Supports .zip containing .indd or .pdf files</p>
                  </label>
                </div>
                {zipFile && (
                  <div className="mt-3 bg-surface border border-border rounded-lg p-2.5 text-xs text-muted flex items-center justify-between">
                    <span className="truncate max-w-[300px] font-medium text-text">{zipFile.name}</span>
                    <button 
                      type="button" 
                      onClick={() => setZipFile(null)}
                      className="text-red-600 hover:text-red-500 font-semibold"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddProjectModal(false)
                    setErrorMsg(null)
                  }}
                  className="px-4 py-2 bg-accent hover:bg-accent/80 text-text font-semibold rounded-lg transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !customerName || !projectName || !zipFile}
                  className="px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 text-sm"
                >
                  {uploading ? 'Processing ZIP...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
