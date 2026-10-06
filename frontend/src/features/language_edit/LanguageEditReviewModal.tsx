import React, { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Languages,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Search,
  X,
  Download,
  Check,
  Edit3,
  Sliders,
  FileText,
  Save,
  RotateCcw,
  Sparkles,
  Info
} from 'lucide-react'
import apiClient from '@/api/client'
import { toast } from '@/store/useToastStore'

interface Finding {
  id: number
  para_index: number
  start_offset: number
  end_offset: number
  rule_id: string

  category: string
  severity: string
  original_text: string
  suggestion: string
  message: string
  autofixable: boolean
  status: 'pending' | 'accepted' | 'edited' | 'rejected'
  edited_text?: string
  reviewer?: string
  decided_at?: string
}

interface JobData {
  job_id: string
  file_id: number
  project_id: number
  status: string
  total_findings: number
  accepted_count: number
  edited_count: number
  rejected_count: number
}

interface StyleProfile {
  name: string
  description: string
  variant_to_canonical: Record<string, string>
  rules: any[]
}

interface LanguageEditReviewModalProps {
  isOpen: boolean
  onClose: () => void
  fileId: number | null
  fileName: string
  projectId: number
}

export const LanguageEditReviewModal: React.FC<LanguageEditReviewModalProps> = ({
  isOpen,
  onClose,
  fileId,
  fileName,
  projectId
}) => {
  const [activeTab, setActiveTab] = useState<'review' | 'rules'>('review')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [job, setJob] = useState<JobData | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  
  // Filtering & Search
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [searchQuery, setSearchQuery] = useState<string>('')
  
  // Edited text state per card
  const [editedInputs, setEditedInputs] = useState<Record<number, string>>({})

  // Rule Manager (CE Support) state
  const [loadingRules, setLoadingRules] = useState(false)
  const [savingRules, setSavingRules] = useState(false)
  const [selectedProfileKey, setSelectedProfileKey] = useState<string>('uk')
  const [availableProfiles, setAvailableProfiles] = useState<Record<string, StyleProfile>>({})
  const [activeRulesConfig, setActiveRulesConfig] = useState<any>(null)

  // Load / Analyze on modal open
  const initJob = useCallback(async () => {
    if (!fileId) return
    setLoading(true)
    try {
      const res = await apiClient.post(`/files/${fileId}/language-edit/analyze`)
      const jobId = res.data.job_id
      const findingsRes = await apiClient.get(`/language-edit/jobs/${jobId}/findings`)
      setJob(findingsRes.data.job)
      setFindings(findingsRes.data.findings || [])
      
      const editsMap: Record<number, string> = {}
      for (const f of findingsRes.data.findings || []) {
        editsMap[f.id] = f.edited_text || f.suggestion
      }
      setEditedInputs(editsMap)
    } catch (err: any) {
      console.error('Failed to run Language Edit analysis:', err)
      toast.error(err?.response?.data?.detail || 'Failed to execute Language Edit analysis.')
    } finally {
      setLoading(false)
    }
  }, [fileId])

  // Load Rule Profiles for CE Support tab
  const loadRulesConfig = useCallback(async () => {
    if (!projectId) return
    setLoadingRules(true)
    try {
      const res = await apiClient.get(`/projects/${projectId}/language-rules`)
      setAvailableProfiles(res.data.available_profiles || {})
      setActiveRulesConfig(res.data.active_rules || null)
      if (res.data.active_rules?.profile_key) {
        setSelectedProfileKey(res.data.active_rules.profile_key)
      }
    } catch (err) {
      console.error('Failed to load language rules:', err)
    } finally {
      setLoadingRules(false)
    }
  }, [projectId])

  useEffect(() => {
    if (isOpen && fileId) {
      initJob()
      loadRulesConfig()
    }
  }, [isOpen, fileId, initJob, loadRulesConfig])

  // Handle Finding Decision
  const handleDecide = async (findingId: number, status: 'accepted' | 'edited' | 'rejected') => {
    const editedText = editedInputs[findingId]
    try {
      await apiClient.post(`/language-edit/findings/${findingId}/decide`, {
        status,
        edited_text: editedText,
        reviewer: 'editor'
      })

      setFindings(prev =>
        prev.map(f => (f.id === findingId ? { ...f, status, edited_text: editedText } : f))
      )

      setJob(prev => {
        if (!prev) return prev
        const oldStatus = findings.find(f => f.id === findingId)?.status
        let accepted = prev.accepted_count
        let edited = prev.edited_count
        let rejected = prev.rejected_count

        if (oldStatus === 'accepted') accepted--
        if (oldStatus === 'edited') edited--
        if (oldStatus === 'rejected') rejected--

        if (status === 'accepted') accepted++
        if (status === 'edited') edited++
        if (status === 'rejected') rejected++

        return { ...prev, accepted_count: accepted, edited_count: edited, rejected_count: rejected }
      })

      toast.success(`Finding ${status}`)
    } catch (err) {
      toast.error('Failed to save decision')
    }
  }

  // Batch Accept All
  const handleAcceptAll = async () => {
    const pending = findings.filter(f => f.status === 'pending')
    if (pending.length === 0) {
      toast.info('No pending findings to accept.')
      return
    }

    for (const f of pending) {
      await handleDecide(f.id, 'accepted')
    }
    toast.success(`Accepted all ${pending.length} findings!`)
  }

  // Export Redlined DOCX (Word Tracked Changes with author='LangQA')
  const handleExportRedline = async () => {
    if (!job?.job_id) return
    setExporting(true)
    try {
      const response = await apiClient.post(
        `/language-edit/jobs/${job.job_id}/export`,
        {},
        { responseType: 'blob' }
      )
      
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      const stem = fileName.replace(/\.[^/.]+$/, '')
      link.setAttribute('download', `${stem}_redline.docx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      
      toast.success('Redlined DOCX with Tracked Changes exported!')
    } catch (err) {
      console.error('Failed to export redlined DOCX:', err)
      toast.error('Failed to export redlined DOCX.')
    } finally {
      setExporting(false)
    }
  }

  // Save Rule Configuration to CE Support
  const handleSaveRulesToCESupport = async () => {
    if (!projectId || !activeRulesConfig) return
    setSavingRules(true)
    try {
      await apiClient.post(`/projects/${projectId}/language-rules`, {
        profile_key: selectedProfileKey,
        rules: activeRulesConfig.rules,
        variant_to_canonical: activeRulesConfig.variant_to_canonical,
        profile_name: activeRulesConfig.name
      })

      toast.success('Language rules saved to project CE support directory!')
    } catch (err) {
      toast.error('Failed to save language rules.')
    } finally {
      setSavingRules(false)
    }
  }

  // Select a preset profile
  const handleSelectProfilePreset = (key: string) => {
    setSelectedProfileKey(key)
    const profile = availableProfiles[key]
    if (profile) {
      setActiveRulesConfig({
        profile_key: key,
        name: profile.name,
        description: profile.description,
        variant_to_canonical: { ...profile.variant_to_canonical },
        rules: [...profile.rules]
      })
    }
  }

  // Filtering
  const filteredFindings = useMemo(() => {
    return findings.filter(f => {
      if (categoryFilter !== 'ALL' && f.category.toUpperCase() !== categoryFilter) return false
      if (statusFilter !== 'ALL' && f.status.toUpperCase() !== statusFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchesText =
          f.original_text.toLowerCase().includes(q) ||
          f.suggestion.toLowerCase().includes(q) ||
          f.message.toLowerCase().includes(q) ||
          f.rule_id.toLowerCase().includes(q)
        if (!matchesText) return false
      }
      return true
    })
  }, [findings, categoryFilter, statusFilter, searchQuery])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Languages size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                Language Edit Workspace
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-mono">
                  {fileName}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Rule-Based Grammar, Spelling & Sentence QA with Human Validation & Word Tracked Changes
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center bg-slate-800 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => setActiveTab('review')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'review'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText size={14} /> Review Findings ({findings.length})
            </button>
            <button
              onClick={() => setActiveTab('rules')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'rules'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders size={14} /> Style Profiles & CE Support Rules
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="animate-spin text-indigo-400" size={32} />
            <p className="text-sm font-medium">Running Language Editing rule engine on document...</p>
          </div>
        ) : activeTab === 'review' ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-950">
            
            {/* Stats & Actions Bar */}
            <div className="px-6 py-3 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <div className="text-xs">
                  <span className="text-slate-400">Total Findings:</span>{' '}
                  <span className="font-semibold text-slate-200">{job?.total_findings || 0}</span>
                </div>
                <div className="text-xs">
                  <span className="text-emerald-400">Accepted:</span>{' '}
                  <span className="font-semibold text-emerald-300">{job?.accepted_count || 0}</span>
                </div>
                <div className="text-xs">
                  <span className="text-amber-400">Edited:</span>{' '}
                  <span className="font-semibold text-amber-300">{job?.edited_count || 0}</span>
                </div>
                <div className="text-xs">
                  <span className="text-rose-400">Rejected:</span>{' '}
                  <span className="font-semibold text-rose-300">{job?.rejected_count || 0}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleAcceptAll}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  <Check size={14} /> Accept All Pending
                </button>
                <button
                  onClick={handleExportRedline}
                  disabled={exporting}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50"
                >
                  {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  Export Redlined DOCX (Tracked Changes)
                </button>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="px-6 py-2.5 border-b border-slate-800/80 bg-slate-900/30 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search findings..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-8 pr-3 py-1 rounded-md bg-slate-800/80 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-48"
                  />
                </div>

                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span>Category:</span>
                  <select
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none"
                  >
                    <option value="ALL">All Categories</option>
                    <option value="GRAMMAR">Grammar</option>
                    <option value="SPELLING">Spelling</option>
                    <option value="SENTENCE">Sentence</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span>Status:</span>
                  <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="PENDING">Pending</option>
                    <option value="ACCEPTED">Accepted</option>
                    <option value="EDITED">Edited</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                </div>
              </div>

              <span className="text-xs text-slate-400 font-mono">
                Showing {filteredFindings.length} of {findings.length} findings
              </span>
            </div>

            {/* Findings List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {filteredFindings.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-sm">
                  No findings match the selected filters.
                </div>
              ) : (
                filteredFindings.map((f, idx) => {
                  const isPending = f.status === 'pending'
                  const isAccepted = f.status === 'accepted'
                  const isEdited = f.status === 'edited'
                  const isRejected = f.status === 'rejected'

                  return (
                    <div
                      key={f.id}
                      className={`p-4 rounded-xl border transition-all ${
                        isAccepted
                          ? 'bg-emerald-950/20 border-emerald-500/30'
                          : isEdited
                          ? 'bg-amber-950/20 border-amber-500/30'
                          : isRejected
                          ? 'bg-rose-950/20 border-rose-500/30 opacity-60'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 text-[10px] uppercase font-bold rounded ${
                              f.category === 'grammar'
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                : f.category === 'spelling'
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            }`}
                          >
                            {f.category}
                          </span>
                          <span className="text-xs font-mono text-slate-400">{f.rule_id}</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded ${
                              f.severity === 'error'
                                ? 'bg-rose-500/20 text-rose-300'
                                : f.severity === 'warning'
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-blue-500/20 text-blue-300'
                            }`}
                          >
                            {f.severity}
                          </span>
                        </div>

                        {/* Status Badge */}
                        <div className="flex items-center gap-1.5">
                          {isAccepted && (
                            <span className="text-xs font-medium text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 size={14} /> Accepted
                            </span>
                          )}
                          {isEdited && (
                            <span className="text-xs font-medium text-amber-400 flex items-center gap-1">
                              <Edit3 size={14} /> Edited
                            </span>
                          )}
                          {isRejected && (
                            <span className="text-xs font-medium text-rose-400 flex items-center gap-1">
                              <XCircle size={14} /> Rejected
                            </span>
                          )}
                          {isPending && (
                            <span className="text-xs font-medium text-slate-400">Pending Review</span>
                          )}
                        </div>
                      </div>

                      {/* Rule Message */}
                      <p className="mt-2 text-xs font-medium text-slate-200">{f.message}</p>

                      {/* Original vs Suggestion Box */}
                      <div className="mt-3 grid grid-cols-2 gap-4 p-3 rounded-lg bg-slate-950/80 border border-slate-800/80 text-xs">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                            Original Text
                          </span>
                          <span className="text-rose-300 font-mono bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                            {f.original_text}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                            Suggested Replacement
                          </span>
                          <input
                            type="text"
                            value={editedInputs[f.id] ?? f.suggestion}
                            onChange={e =>
                              setEditedInputs(prev => ({ ...prev, [f.id]: e.target.value }))
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-300 font-mono focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      </div>

                      {/* Decision Action Buttons */}
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleDecide(f.id, 'accepted')}
                          className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
                            isAccepted
                              ? 'bg-emerald-600 text-white'
                              : 'bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/30'
                          }`}
                        >
                          <Check size={12} /> Accept (A)
                        </button>

                        <button
                          onClick={() => handleDecide(f.id, 'edited')}
                          className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
                            isEdited
                              ? 'bg-amber-600 text-white'
                              : 'bg-amber-950/60 hover:bg-amber-900/60 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          <Edit3 size={12} /> Save Edit (E)
                        </button>

                        <button
                          onClick={() => handleDecide(f.id, 'rejected')}
                          className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
                            isRejected
                              ? 'bg-rose-600 text-white'
                              : 'bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30'
                          }`}
                        >
                          <X size={12} /> Reject (R)
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          /* Style Profiles & CE Support Rules Manager Tab */
          <div className="flex-1 flex flex-col overflow-y-auto p-6 bg-slate-950 space-y-6">
            <div className="bg-slate-900/80 p-5 rounded-xl border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    Editorial Style Profiles & Rule Manager
                  </h3>
                  <p className="text-xs text-slate-400">
                    Saved configuration is synced directly into the project's <code className="text-indigo-300">CE support</code> folder as JSON
                  </p>
                </div>

                <button
                  onClick={handleSaveRulesToCESupport}
                  disabled={savingRules}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50"
                >
                  {savingRules ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Rules to Project CE Support
                </button>
              </div>

              {/* Profile Selector Cards */}
              <div className="grid grid-cols-3 gap-3">
                {Object.entries(availableProfiles).map(([key, prof]) => (
                  <button
                    key={key}
                    onClick={() => handleSelectProfilePreset(key)}
                    className={`p-3 rounded-lg text-left border transition-all ${
                      selectedProfileKey === key
                        ? 'bg-indigo-950/40 border-indigo-500 text-slate-100 shadow-md shadow-indigo-500/10'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <span className="text-xs font-semibold block">{prof.name}</span>
                    <span className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{prof.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Variant to Canonical House Style Mapping */}
            {activeRulesConfig && (
              <div className="bg-slate-900/80 p-5 rounded-xl border border-slate-800 space-y-4">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  House Style Dictionary (Variant → Canonical)
                </h4>
                <div className="grid grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2">
                  {Object.entries(activeRulesConfig.variant_to_canonical || {}).map(([variant, canon]) => (
                    <div key={variant} className="flex items-center gap-2 bg-slate-950 p-2 rounded border border-slate-800 text-xs">
                      <span className="text-slate-400 font-mono w-1/2">{variant}</span>
                      <span className="text-slate-600">→</span>
                      <input
                        type="text"
                        value={canon as string}
                        onChange={e => {
                          const val = e.target.value
                          setActiveRulesConfig((prev: any) => ({
                            ...prev,
                            variant_to_canonical: {
                              ...prev.variant_to_canonical,
                              [variant]: val
                            }
                          }))
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs text-emerald-300 font-mono w-1/2 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
