import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Languages,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Search,
  ArrowLeft,
  Download,
  Check,
  Edit3,
  Sliders,
  FileText,
  Save,
  ChevronRight,
  RefreshCw,
  Highlighter,
  MessageSquare,
  Plus,
  Trash2,
  MessageCircle
} from 'lucide-react'
import apiClient from '@/api/client'
import { toast } from '@/store/useToastStore'
import { uiPaths } from '@/utils/appPaths'
import {
  listComments,
  createComment,
  updateComment,
  deleteComment,
  type CommentRecord
} from '@/api/comments'
import { useFileXhtmlQuery } from '@/features/technicalReview/useFileXhtmlQuery'
import {
  WysiwygEditor,
  useEditorSave,
  type WysiwygEditorHandle,
  type Occurrence
} from '@/features/editor'
import { useSessionStore } from '@/stores/sessionStore'

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
  status: 'pending' | 'accepted' | 'edited' | 'rejected' | 'highlighted'
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

export function LanguageReviewPage() {
  const navigate = useNavigate()
  const { projectId, chapterId, fileId } = useParams<{ projectId: string; chapterId: string; fileId: string }>()

  const parsedProjectId = Number.parseInt(projectId ?? '', 10)
  const parsedChapterId = Number.parseInt(chapterId ?? '', 10)
  const parsedFileId = Number.parseInt(fileId ?? '', 10)
  const normalizedFileId = Number.isInteger(parsedFileId) && parsedFileId > 0 ? parsedFileId : null

  const [activeRightTab, setActiveRightTab] = useState<'grammar' | 'spelling' | 'sentence' | 'compounds' | 'bias' | 'comments' | 'rules'>('grammar')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [job, setJob] = useState<JobData | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [fileName, setFileName] = useState<string>('manuscript.docx')
  const [selectedFindingId, setSelectedFindingId] = useState<number | null>(null)

  // Comments / Author Queries (AQ) state
  const [comments, setComments] = useState<CommentRecord[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [newCommentText, setNewCommentText] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [filterUnresolved, setFilterUnresolved] = useState(false)

  // Editor and Save Hooks
  const editorRef = useRef<WysiwygEditorHandle>(null)
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const xhtmlQuery = useFileXhtmlQuery(normalizedFileId)
  const editorSave = useEditorSave(normalizedFileId)

  const viewer = useSessionStore((s) => s.viewer)
  const currentUser = viewer?.username

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [editedInputs, setEditedInputs] = useState<Record<number, string>>({})

  // Rule Manager (CE Support) state
  const [savingRules, setSavingRules] = useState(false)
  const [selectedProfileKey, setSelectedProfileKey] = useState<string>('uk')
  const [availableProfiles, setAvailableProfiles] = useState<Record<string, StyleProfile>>({})
  const [activeRulesConfig, setActiveRulesConfig] = useState<any>(null)

  // Fetch comments
  const fetchComments = useCallback(async () => {
    if (!normalizedFileId) return
    setCommentsLoading(true)
    try {
      const list = await listComments(normalizedFileId)
      setComments(list)
    } catch (err) {
      console.error('Failed to load comments:', err)
    } finally {
      setCommentsLoading(false)
    }
  }, [normalizedFileId])

  const handleCreateComment = async (customText?: string) => {
    const textToPost = customText || newCommentText
    if (!normalizedFileId || !textToPost.trim()) return
    setSubmittingComment(true)
    try {
      const commentUuid = `cm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      await createComment(normalizedFileId, commentUuid, textToPost.trim())
      setNewCommentText('')
      toast.success('AQ Comment posted!')
      fetchComments()
    } catch (err) {
      toast.error('Failed to post comment.')
    } finally {
      setSubmittingComment(false)
    }
  }

  const handleToggleResolve = async (commentUuid: string, currentResolved: boolean) => {
    if (!normalizedFileId) return
    try {
      await updateComment(normalizedFileId, commentUuid, { resolved: !currentResolved })
      toast.success(!currentResolved ? 'Comment resolved' : 'Comment reopened')
      fetchComments()
    } catch (err) {
      toast.error('Failed to update comment status.')
    }
  }

  const handleDeleteComment = async (commentUuid: string) => {
    if (!normalizedFileId) return
    try {
      await deleteComment(normalizedFileId, commentUuid)
      toast.success('Comment deleted')
      fetchComments()
    } catch (err) {
      toast.error('Failed to delete comment.')
    }
  }

  // Initialize analysis job
  const initJob = useCallback(async () => {
    if (!parsedFileId) return
    setLoading(true)
    try {
      const res = await apiClient.post(`/files/${parsedFileId}/language-edit/analyze`)
      const jobId = res.data.job_id
      setFileName(res.data.file_name || 'manuscript.docx')
      const findingsRes = await apiClient.get(`/language-edit/jobs/${jobId}/findings`)
      setJob(findingsRes.data.job)
      const fetchedFindings: Finding[] = findingsRes.data.findings || []
      setFindings(fetchedFindings)

      if (fetchedFindings.length > 0) {
        setSelectedFindingId(fetchedFindings[0].id)
      }

      const editsMap: Record<number, string> = {}
      for (const f of fetchedFindings) {
        editsMap[f.id] = f.edited_text || f.suggestion
      }
      setEditedInputs(editsMap)
    } catch (err: any) {
      console.error('Failed to run Language Edit analysis:', err)
      toast.error(err?.response?.data?.detail || 'Failed to run Language Edit analysis.')
    } finally {
      setLoading(false)
    }
  }, [parsedFileId])

  // Load Rule Profiles for CE Support
  const loadRulesConfig = useCallback(async () => {
    if (!parsedProjectId) return
    try {
      const res = await apiClient.get(`/projects/${parsedProjectId}/language-rules`)
      setAvailableProfiles(res.data.available_profiles || {})
      setActiveRulesConfig(res.data.active_rules || null)
      if (res.data.active_rules?.profile_key) {
        setSelectedProfileKey(res.data.active_rules.profile_key)
      }
    } catch (err) {
      console.error('Failed to load language rules:', err)
    }
  }, [parsedProjectId])

  useEffect(() => {
    initJob()
    loadRulesConfig()
    fetchComments()
  }, [initJob, loadRulesConfig, fetchComments])

  // Scroll active finding card into view when selectedFindingId changes
  useEffect(() => {
    if (selectedFindingId && cardRefs.current[selectedFindingId]) {
      cardRefs.current[selectedFindingId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedFindingId])

  // Handle Finding Decision
  const handleDecide = async (findingId: number, status: 'accepted' | 'edited' | 'rejected' | 'highlighted') => {
    const finding = findings.find(f => f.id === findingId)
    const editedText = editedInputs[findingId] ?? finding?.suggestion ?? ''

    try {
      await apiClient.post(`/language-edit/findings/${findingId}/decide`, {
        status,
        edited_text: status === 'edited' ? editedText : undefined,
        reviewer: 'editor'
      })

      // Replace text or apply highlight directly inside WysiwygEditor
      if (editorRef.current && finding) {
        const occ: Occurrence = {
          para_index: finding.para_index,
          match_start: finding.start_offset,
          match_end: finding.end_offset,
          surface: finding.original_text,
          category: finding.category
        }
        if (status === 'highlighted') {
          editorRef.current.replaceOccurrence(occ, '', { highlightOnly: true })
        } else if (status === 'accepted' || status === 'edited') {
          const repText = status === 'edited' ? editedText : (finding.suggestion || '')
          editorRef.current.replaceOccurrence(occ, repText, { asTrackChanges: true })
        }
      }

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

  // Batch Highlight All Pending
  const handleHighlightAll = async () => {
    const pending = findings.filter(f => f.status === 'pending')
    if (pending.length === 0) {
      toast.info('No pending findings to highlight.')
      return
    }

    for (const f of pending) {
      await handleDecide(f.id, 'highlighted')
    }
    toast.success(`Highlighted all ${pending.length} pending findings!`)
  }

  // Export Redlined DOCX
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

      toast.success('Redlined DOCX exported!')
    } catch (err) {
      toast.error('Failed to export redlined DOCX.')
    } finally {
      setExporting(false)
    }
  }

  // Save Rule Configuration to CE Support
  const handleSaveRulesToCESupport = async () => {
    if (!parsedProjectId || !activeRulesConfig) return
    setSavingRules(true)
    try {
      await apiClient.post(`/projects/${parsedProjectId}/language-rules`, {
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

  // Map findings to editor occurrences
  const editorOccurrences = useMemo(() => {
    return findings.map(
      (f) =>
        ({
          para_index: f.para_index,
          match_start: f.start_offset,
          match_end: f.end_offset,
          surface: f.original_text,
          category: f.category,
        }) as Occurrence,
    )
  }, [findings])

  const selectedOccurrenceIndex = useMemo(() => {
    if (selectedFindingId === null) return -1
    return findings.findIndex((f) => f.id === selectedFindingId)
  }, [findings, selectedFindingId])

  const handleOccurrenceClick = (idx: number) => {
    const target = findings[idx]
    if (target) {
      setSelectedFindingId(target.id)
      if (['grammar', 'spelling', 'sentence', 'compounds', 'bias'].includes(target.category)) {
        setActiveRightTab(target.category as any)
      }
    }
  }

  // Category counts
  const grammarFindings = useMemo(() => findings.filter(f => f.category === 'grammar'), [findings])
  const spellingFindings = useMemo(() => findings.filter(f => f.category === 'spelling'), [findings])
  const sentenceFindings = useMemo(() => findings.filter(f => f.category === 'sentence'), [findings])
  const compoundsFindings = useMemo(() => findings.filter(f => f.category === 'compounds' || f.category === 'compound'), [findings])
  const biasFindings = useMemo(() => findings.filter(f => f.category === 'bias' || f.category === 'article'), [findings])

  const activeCategoryFindings = useMemo(() => {
    let list: Finding[] = []
    if (activeRightTab === 'grammar') list = grammarFindings
    else if (activeRightTab === 'spelling') list = spellingFindings
    else if (activeRightTab === 'sentence') list = sentenceFindings
    else if (activeRightTab === 'compounds') list = compoundsFindings
    else if (activeRightTab === 'bias') list = biasFindings

    if (!searchQuery.trim()) return list
    const q = searchQuery.toLowerCase()
    return list.filter(
      (f) =>
        f.original_text.toLowerCase().includes(q) ||
        f.message.toLowerCase().includes(q) ||
        f.rule_id.toLowerCase().includes(q),
    )
  }, [activeRightTab, grammarFindings, spellingFindings, sentenceFindings, compoundsFindings, biasFindings, searchQuery])

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
      
      {/* ══ HEADER BAR ══════════════════════════════════════════════════════════ */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between flex-shrink-0 z-20">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(uiPaths.chapterDetail(parsedProjectId, parsedChapterId))}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Link to={uiPaths.projectDetail(parsedProjectId)} className="hover:text-slate-200">
              Project #{parsedProjectId}
            </Link>
            <ChevronRight size={12} />
            <Link to={uiPaths.chapterDetail(parsedProjectId, parsedChapterId)} className="hover:text-slate-200">
              Chapter #{parsedChapterId}
            </Link>
            <ChevronRight size={12} />
            <span className="text-slate-100 font-semibold font-mono bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
              {fileName}
            </span>
          </div>

          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            Language Edit Full-Page Workspace
          </span>
        </div>

        {/* Stats & Actions */}
        <div className="flex items-center gap-4">
          <div className="text-xs text-slate-400 flex items-center gap-4 border-r border-slate-800 pr-4">
            <span>Total: <strong className="text-white">{job?.total_findings || 0}</strong></span>

            <span>Accepted: <strong className="text-emerald-400">{job?.accepted_count || 0}</strong></span>
            <span>Edited: <strong className="text-amber-400">{job?.edited_count || 0}</strong></span>
            <span>Rejected: <strong className="text-rose-400">{job?.rejected_count || 0}</strong></span>
          </div>

          <button
            onClick={handleAcceptAll}
            className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <Check size={14} /> Accept All Pending
          </button>

          <button
            onClick={handleHighlightAll}
            className="px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <Highlighter size={14} /> Highlight All Pending
          </button>

          <button
            onClick={handleExportRedline}
            disabled={exporting}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all disabled:opacity-50"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Export Redlined DOCX (Tracked Changes)
          </button>
        </div>
      </header>

      {/* ══ SPLIT SCREEN WORKSPACE ═════════════════════════════════════════════ */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 bg-slate-950">
          <Loader2 className="animate-spin text-indigo-400" size={32} />
          <p className="text-sm font-medium">Running Language Editing engine on document...</p>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          
          {/* ── LEFT SIDE: WYSIWYG EDITOR / MANUSCRIPT VIEW ── */}
          <main className="flex-1 bg-slate-950 flex flex-col border-r border-slate-800 overflow-hidden relative text-slate-900">
            <div className="h-10 bg-slate-900/60 border-b border-slate-800 px-4 flex items-center justify-between text-xs text-slate-400 flex-shrink-0">
              <span className="font-medium text-slate-300">Document Manuscript Editor</span>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span> Grammar
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-cyan-500"></span> Spelling
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-purple-500"></span> Sentence
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Compounds
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span> Inclusive
                </span>
              </div>
            </div>

            <div className="flex-1 relative min-h-0 overflow-hidden bg-slate-900 text-slate-900">
              {xhtmlQuery.isPending ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center space-y-3 bg-slate-950 text-slate-300">
                  <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
                  <div className="text-sm font-bold text-white">Loading Document Manuscript...</div>
                  <div className="text-xs text-slate-400">Preparing interactive WYSIWYG document editor layout</div>
                </div>
              ) : xhtmlQuery.isError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center space-y-3 bg-slate-950">
                  <AlertTriangle className="w-8 h-8 text-rose-500" />
                  <div className="text-sm font-bold text-white">Manuscript View Unavailable</div>
                  <div className="text-xs text-slate-400 max-w-sm">Failed to fetch XHTML document. Verify file conversion status.</div>
                </div>
              ) : (
                <WysiwygEditor
                  ref={editorRef}
                  key={`editor-${parsedFileId}`}
                  initialContent={xhtmlQuery.data?.content ?? ''}
                  onSave={async (html) => {
                    await editorSave.save(html)
                  }}
                  isSaving={editorSave.isPending}
                  saveLabel="Save Edits to DOCX"
                  documentTitle={fileName}
                  height="100%"
                  occurrences={editorOccurrences}
                  selectedOccurrenceIndex={selectedOccurrenceIndex}
                  onOccurrenceClick={handleOccurrenceClick}
                  currentUser={currentUser}
                  fileId={parsedFileId.toString()}
                />
              )}
            </div>
          </main>

          {/* ── RIGHT SIDE: TABBED INSPECTION PANEL ── */}
          <aside className="w-[480px] bg-slate-900 flex flex-col flex-shrink-0 overflow-hidden">
            
            {/* Tabs */}
            <div className="bg-slate-900 border-b border-slate-800 p-2 flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => setActiveRightTab('grammar')}
                className={`px-2.5 py-2 text-xs font-medium rounded-lg flex items-center justify-center gap-1 transition-all ${
                  activeRightTab === 'grammar'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                Grammar ({grammarFindings.length})
              </button>

              <button
                onClick={() => setActiveRightTab('spelling')}
                className={`px-2.5 py-2 text-xs font-medium rounded-lg flex items-center justify-center gap-1 transition-all ${
                  activeRightTab === 'spelling'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                Spelling ({spellingFindings.length})
              </button>

              <button
                onClick={() => setActiveRightTab('sentence')}
                className={`px-2.5 py-2 text-xs font-medium rounded-lg flex items-center justify-center gap-1 transition-all ${
                  activeRightTab === 'sentence'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                Sentence ({sentenceFindings.length})
              </button>

              <button
                onClick={() => setActiveRightTab('compounds')}
                className={`px-2.5 py-2 text-xs font-medium rounded-lg flex items-center justify-center gap-1 transition-all ${
                  activeRightTab === 'compounds'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                Compounds ({compoundsFindings.length})
              </button>

              <button
                onClick={() => setActiveRightTab('bias')}
                className={`px-2.5 py-2 text-xs font-medium rounded-lg flex items-center justify-center gap-1 transition-all ${
                  activeRightTab === 'bias'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                Inclusive ({biasFindings.length})
              </button>

              <button
                onClick={() => setActiveRightTab('comments')}
                className={`px-2.5 py-2 text-xs font-medium rounded-lg flex items-center justify-center gap-1 transition-all ${
                  activeRightTab === 'comments'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <MessageSquare size={13} />
                Comments / AQ ({comments.length})
              </button>

              <button
                onClick={() => setActiveRightTab('rules')}
                className={`px-2.5 py-2 text-xs font-medium rounded-lg transition-all ${
                  activeRightTab === 'rules'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
                title="CE Support Rules Manager"
              >
                <Sliders size={14} />
              </button>
            </div>

            {/* Search Box for Findings */}
            {activeRightTab !== 'rules' && activeRightTab !== 'comments' && (
              <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center gap-2 flex-shrink-0">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search findings in this tab..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            )}

            {/* Tab Panel Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/60">
              {activeRightTab === 'comments' ? (
                /* ── DEDICATED COMMENTS / AUTHOR QUERIES (AQ) TAB ── */
                <div className="space-y-4">
                  {/* Compose New AQ Comment */}
                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <MessageCircle size={14} className="text-indigo-400" /> Post Author Query / AQ Comment
                      </span>
                      <span className="text-[10px] text-slate-400">Attached to current document</span>
                    </div>

                    {/* Quick Preset Buttons */}
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        'AQ: Please cite reference in text.',
                        'AQ: Define abbreviation on first use.',
                        'AQ: Verify numerical data accuracy.',
                        'AQ: Confirm author name spelling.'
                      ].map((preset, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleCreateComment(preset)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium border border-slate-700 transition-colors flex items-center gap-1"
                        >
                          <Plus size={10} /> {preset}
                        </button>
                      ))}
                    </div>

                    <textarea
                      rows={3}
                      placeholder="Type an Author Query (AQ) comment or editor note..."
                      value={newCommentText}
                      onChange={(e) => setNewCommentText(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
                    />

                    <div className="flex justify-end">
                      <button
                        onClick={() => handleCreateComment()}
                        disabled={submittingComment || !newCommentText.trim()}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow transition-all disabled:opacity-50"
                      >
                        {submittingComment ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />}
                        Post AQ Comment
                      </button>
                    </div>
                  </div>

                  {/* Filter Header */}
                  <div className="flex items-center justify-between px-1 text-xs text-slate-400">
                    <span>
                      Total Comments: <strong className="text-slate-200">{comments.length}</strong>
                    </span>
                    <button
                      onClick={() => setFilterUnresolved(prev => !prev)}
                      className={`text-[11px] font-medium transition-colors ${
                        filterUnresolved ? 'text-amber-400 underline' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {filterUnresolved ? 'Showing Open AQ Only' : 'Show Open AQ Only'}
                    </button>
                  </div>

                  {/* Comments List */}
                  {commentsLoading ? (
                    <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
                      <Loader2 className="animate-spin text-indigo-400" size={20} />
                      Loading file comments...
                    </div>
                  ) : comments.filter(c => !filterUnresolved || !c.resolved).length === 0 ? (
                    <div className="py-12 text-center text-slate-500 text-xs bg-slate-900/40 rounded-xl border border-slate-800/60 p-6">
                      <MessageSquare size={24} className="mx-auto mb-2 text-slate-600" />
                      No comments or author queries found. Post a comment above to get started.
                    </div>
                  ) : (
                    comments
                      .filter(c => !filterUnresolved || !c.resolved)
                      .map(comment => (
                        <div
                          key={comment.comment_uuid}
                          className={`p-3.5 rounded-xl border transition-all ${
                            comment.resolved
                              ? 'bg-slate-900/40 border-slate-800 opacity-60'
                              : 'bg-slate-900 border-indigo-500/30 shadow'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-indigo-600/30 text-indigo-300 font-bold text-[10px] flex items-center justify-center border border-indigo-500/40">
                                {(comment.author_name || 'AQ').slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="text-xs font-medium text-slate-200">
                                  {comment.author_name || 'Reviewer'}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {comment.created_at ? new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                </div>
                              </div>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                comment.resolved
                                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30'
                                  : 'bg-amber-950/40 text-amber-300 border-amber-500/30'
                              }`}
                            >
                              {comment.resolved ? 'Resolved' : 'Open AQ'}
                            </span>
                          </div>

                          <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed mb-3">
                            {comment.text}
                          </p>

                          <div className="flex items-center justify-end gap-2 border-t border-slate-800/80 pt-2 text-[11px]">
                            <button
                              onClick={() => handleToggleResolve(comment.comment_uuid, comment.resolved)}
                              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
                                comment.resolved
                                  ? 'text-slate-400 hover:text-slate-200 bg-slate-800'
                                  : 'text-emerald-300 hover:bg-emerald-950/60 bg-emerald-950/30 border border-emerald-500/20'
                              }`}
                            >
                              <CheckCircle2 size={12} />
                              {comment.resolved ? 'Reopen AQ' : 'Resolve AQ'}
                            </button>

                            <button
                              onClick={() => handleDeleteComment(comment.comment_uuid)}
                              className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors"
                              title="Delete comment"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              ) : activeRightTab !== 'rules' ? (
                activeCategoryFindings.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs">
                    No findings found in this view.
                  </div>
                ) : (
                  activeCategoryFindings.map(f => {
                    const isSelected = f.id === selectedFindingId
                    const isAccepted = f.status === 'accepted'
                    const isEdited = f.status === 'edited'
                    const isRejected = f.status === 'rejected'

                    return (
                      <div
                        key={f.id}
                        ref={(el) => (cardRefs.current[f.id] = el)}
                        onClick={() => setSelectedFindingId(f.id)}
                        className={`p-4 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? 'ring-2 ring-indigo-500 border-indigo-500/80 bg-slate-800/90 shadow-lg'
                            : isAccepted
                            ? 'bg-emerald-950/20 border-emerald-500/30'
                            : isEdited
                            ? 'bg-amber-950/20 border-amber-500/30'
                            : isRejected
                            ? 'bg-rose-950/20 border-rose-500/30 opacity-60'
                            : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 text-[10px] uppercase font-bold rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              {f.rule_id}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                              {f.severity}
                            </span>
                          </div>
                          {isAccepted && <span className="text-xs text-emerald-400 font-medium">Accepted</span>}
                          {isEdited && <span className="text-xs text-amber-400 font-medium">Edited</span>}
                          {isRejected && <span className="text-xs text-rose-400 font-medium">Rejected</span>}
                        </div>

                        <p className="mt-2 text-xs font-medium text-slate-200">{f.message}</p>

                        <div className="mt-3 grid grid-cols-2 gap-3 p-2.5 bg-slate-950 rounded-lg border border-slate-800 text-xs">
                          <div>
                            <span className="text-[10px] text-slate-500 block">Original</span>
                            <span className="text-rose-300 font-mono bg-rose-500/10 px-1 py-0.5 rounded">
                              {f.original_text}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 block">Suggested Replacement</span>
                            <input
                              type="text"
                              value={editedInputs[f.id] ?? f.suggestion}
                              onChange={e =>
                                setEditedInputs(prev => ({ ...prev, [f.id]: e.target.value }))
                              }
                              onClick={(e) => e.stopPropagation()}
                              className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-emerald-300 font-mono focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDecide(f.id, 'accepted')
                            }}
                            className="px-3 py-1 rounded bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/30 text-xs font-medium transition-colors"
                          >
                            Accept (A)
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDecide(f.id, 'edited')
                            }}
                            className="px-3 py-1 rounded bg-amber-950/60 hover:bg-amber-900/60 text-amber-300 border border-amber-500/30 text-xs font-medium transition-colors"
                          >
                            Save Edit (E)
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDecide(f.id, 'rejected')
                            }}
                            className="px-3 py-1 rounded bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30 text-xs font-medium transition-colors"
                          >
                            Reject (R)
                          </button>
                        </div>
                      </div>
                    )
                  })
                )
              ) : (
                /* CE Support Rules Manager Tab */
                <div className="space-y-4">
                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-200">CE Support Rules Manager</h3>
                      <button
                        onClick={handleSaveRulesToCESupport}
                        disabled={savingRules}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {savingRules ? 'Saving...' : 'Save to CE Support'}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400">Select active style profile template:</p>
                    <select
                      value={selectedProfileKey}
                      onChange={e => setSelectedProfileKey(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      {Object.entries(availableProfiles).map(([key, prof]) => (
                        <option key={key} value={key}>{prof.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </aside>

        </div>
      )}
    </div>
  )
}
