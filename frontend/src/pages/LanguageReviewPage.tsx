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
  MessageCircle,
  Sparkles,
  ArrowRight,
  Eye,
  Smile
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

  const [activeRightTab, setActiveRightTab] = useState<'all' | 'grammar' | 'spelling' | 'sentence' | 'compounds' | 'bias' | 'comments' | 'rules'>('all')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [job, setJob] = useState<JobData | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [fileName, setFileName] = useState<string>('manuscript.docx')
  const [selectedFindingId, setSelectedFindingId] = useState<number | null>(null)
  const [editingFindingId, setEditingFindingId] = useState<number | null>(null)

  // Comments / Author Queries (AQ) state
  const [comments, setComments] = useState<CommentRecord[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [newCommentText, setNewCommentText] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [filterUnresolved, setFilterUnresolved] = useState(false)
  const [selectedEditorText, setSelectedEditorText] = useState<string>('')
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null)

  // Editor and Save Hooks
  const editorRef = useRef<WysiwygEditorHandle>(null)
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const commentCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
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
      
      if (selectedEditorText && editorRef.current) {
        editorRef.current.addCommentToSelection(commentUuid)
      }

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

  // Parse XHTML inline comments on load
  useEffect(() => {
    if (xhtmlQuery.data?.content) {
      try {
        const parser = new DOMParser()
        const doc = parser.parseFromString(xhtmlQuery.data.content, 'text/html')
        const commentNodes = doc.querySelectorAll('span[data-comment-id], span.comment[data-comment], [data-comment-id]')
        const parsedComments: CommentRecord[] = []

        commentNodes.forEach((el, idx) => {
          const uuid = el.getAttribute('data-comment-id') || `xhtml-cm-${idx}`
          const commentText = el.getAttribute('data-comment') || el.getAttribute('title') || 'Inline XHTML Comment'
          const quotedText = el.textContent?.trim() || ''

          parsedComments.push({
            comment_uuid: uuid,
            author_id: null,
            author_name: 'Author Query',
            text: commentText + (quotedText ? ` (On: "${quotedText}")` : ''),
            resolved: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
        })

        if (parsedComments.length > 0) {
          setComments((prev) => {
            const existingUuids = new Set(prev.map((c) => c.comment_uuid))
            const newInline = parsedComments.filter((c) => !existingUuids.has(c.comment_uuid))
            return [...prev, ...newInline]
          })
        }
      } catch (e) {
        console.error('Failed to parse XHTML comments:', e)
      }
    }
  }, [xhtmlQuery.data?.content, normalizedFileId])

  // Scroll active comment card into view when selectedCommentId changes
  useEffect(() => {
    if (selectedCommentId && commentCardRefs.current[selectedCommentId]) {
      commentCardRefs.current[selectedCommentId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedCommentId])

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

      if (editingFindingId === findingId) {
        setEditingFindingId(null)
      }

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

  // Bi-directional click: when user clicks an occurrence in WysiwygEditor canvas
  const handleOccurrenceClick = (idx: number) => {
    const target = findings[idx]
    if (target) {
      setSelectedFindingId(target.id)
      if (activeRightTab !== 'all' && ['grammar', 'spelling', 'sentence', 'compounds', 'bias'].includes(target.category)) {
        setActiveRightTab(target.category as any)
      }
    }
  }

  // Category counts & filtered findings
  const grammarFindings = useMemo(() => findings.filter(f => f.category === 'grammar'), [findings])
  const spellingFindings = useMemo(() => findings.filter(f => f.category === 'spelling'), [findings])
  const sentenceFindings = useMemo(() => findings.filter(f => f.category === 'sentence'), [findings])
  const compoundsFindings = useMemo(() => findings.filter(f => f.category === 'compounds' || f.category === 'compound'), [findings])
  const biasFindings = useMemo(() => findings.filter(f => f.category === 'bias' || f.category === 'article'), [findings])

  const activeCategoryFindings = useMemo(() => {
    let list: Finding[] = []
    if (activeRightTab === 'all') list = findings
    else if (activeRightTab === 'grammar') list = grammarFindings
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
  }, [activeRightTab, findings, grammarFindings, spellingFindings, sentenceFindings, compoundsFindings, biasFindings, searchQuery])

  // Realtime progress statistics
  const totalFindingsCount = job?.total_findings || findings.length || 0
  const resolvedCount = (job?.accepted_count || 0) + (job?.edited_count || 0) + (job?.rejected_count || 0)
  const remainingCount = Math.max(0, totalFindingsCount - resolvedCount)
  const progressPercentage = totalFindingsCount > 0 ? Math.min(100, Math.round((resolvedCount / totalFindingsCount) * 100)) : 0

  return (
    <div className="h-screen flex flex-col bg-slate-50 text-slate-800 font-sans antialiased overflow-hidden">
      
      {/* Dynamic CSS for Clarity design system highlights & diffs */}
      <style>{`
        .diff-old { text-decoration: line-through; color: #b91c1c; background-color: #fee2e2; }
        .diff-new { color: #047857; background-color: #d1fae5; }
        .chip { transition: all 0.15s ease; }
        .card-enter { animation: cardIn 0.25s ease; }
        @keyframes cardIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

        .occurrence-highlight { border-radius: 3px; padding: 0 2px; cursor: pointer; transition: all 0.15s ease; box-decoration-break: clone; }
        .occurrence-highlight:hover { filter: brightness(0.95); }
        .occurrence-grammar { background-color: #fef3c7; box-shadow: inset 0 -2px 0 0 #f59e0b; }
        .occurrence-spelling { background-color: #e0f2fe; box-shadow: inset 0 -2px 0 0 #0ea5e9; }
        .occurrence-sentence { background-color: #f3e8ff; box-shadow: inset 0 -2px 0 0 #a855f7; }
        .occurrence-compounds { background-color: #d1fae5; box-shadow: inset 0 -2px 0 0 #10b981; }
        .occurrence-bias { background-color: #ffe4e6; box-shadow: inset 0 -2px 0 0 #f43f5e; }
        .occurrence-highlight-selected { outline: 2px solid #8b5cf6; box-shadow: 0 0 10px rgba(139, 92, 246, 0.4); }
      `}</style>

      {/* ══ HEADER BAR (CLARITY DESIGN) ════════════════════════════════════════ */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between flex-shrink-0 shadow-sm z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(uiPaths.chapterDetail(parsedProjectId, parsedChapterId))}
            className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title="Back to Chapter"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Link to={uiPaths.projectDetail(parsedProjectId)} className="hover:text-slate-600">
                Project #{parsedProjectId}
              </Link>
              <span>/</span>
              <Link to={uiPaths.chapterDetail(parsedProjectId, parsedChapterId)} className="hover:text-slate-600">
                Chapter #{parsedChapterId}
              </Link>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800 text-sm">{fileName}</span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-violet-100 text-violet-600">
                Language Review
              </span>
            </div>
          </div>
        </div>

        {/* Realtime Progress Bar */}
        <div className="flex items-center gap-3 flex-1 max-w-md mx-8">
          <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
            {resolvedCount} of {totalFindingsCount} resolved
          </span>
          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-violet-600">{progressPercentage}%</span>
        </div>

        {/* Action Pills */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleAcceptAll}
            className="px-3.5 py-2 rounded-full text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
          >
            <Check size={14} /> Accept remaining
          </button>
          <button
            onClick={handleHighlightAll}
            className="px-3.5 py-2 rounded-full text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1.5"
          >
            <Highlighter size={14} /> Highlight pending
          </button>
          <button
            onClick={handleExportRedline}
            disabled={exporting}
            className="px-4 py-2 rounded-full text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 shadow-sm shadow-violet-200 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Export clean copy
          </button>
        </div>
      </header>

      {/* ══ SPLIT SCREEN WORKSPACE ═════════════════════════════════════════════ */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500 bg-slate-50">
          <Loader2 className="animate-spin text-violet-600" size={32} />
          <p className="text-sm font-medium">Running Language Editing engine on document...</p>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          
          {/* ── LEFT SIDE: WYSIWYG MANUSCRIPT CANVAS (FULL WIDTH) ── */}
          <main className="flex-1 bg-white flex flex-col border-r border-slate-200 overflow-hidden relative w-full h-full">
            <div className="w-full flex-1 flex flex-col overflow-hidden relative">
              <div className="h-10 bg-slate-50 border-b border-slate-100 px-6 flex items-center justify-between text-xs text-slate-500 flex-shrink-0">
                <span className="font-semibold text-slate-700">Document Manuscript Canvas</span>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span> Grammar
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-400"></span> Spelling
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-400"></span> Sentence
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span> Compounds
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-400"></span> Inclusive
                  </span>
                </div>
              </div>

              <div className="flex-1 relative min-h-0 overflow-hidden bg-white text-slate-800">
                {xhtmlQuery.isPending ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center space-y-3 bg-white text-slate-500">
                    <RefreshCw className="w-8 h-8 text-violet-600 animate-spin" />
                    <div className="text-sm font-bold text-slate-800">Loading Document Manuscript...</div>
                    <div className="text-xs text-slate-400">Preparing interactive document layout</div>
                  </div>
                ) : xhtmlQuery.isError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center space-y-3 bg-white">
                    <AlertTriangle className="w-8 h-8 text-rose-500" />
                    <div className="text-sm font-bold text-slate-800">Manuscript View Unavailable</div>
                    <div className="text-xs text-slate-400 max-w-sm">Failed to fetch XHTML document. Verify file status.</div>
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
                    onSelectionChange={(text) => setSelectedEditorText(text)}
                    onCommentClick={(commentId) => {
                      setActiveRightTab('comments')
                      setSelectedCommentId(commentId)
                    }}
                    currentUser={currentUser}
                    fileId={parsedFileId.toString()}
                  />
                )}
              </div>
            </div>
          </main>

          {/* ── RIGHT SIDE: SIDE PANEL (CLARITY DESIGN) ── */}
          <aside className="w-[420px] bg-white border-l border-slate-100 flex flex-col flex-shrink-0 overflow-hidden">
            
            {/* Header Greeting & Search & Chips */}
            <div className="p-5 border-b border-slate-100 flex-shrink-0">
              <p className="text-sm font-semibold text-slate-800">👋 Nice progress, Editor!</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {remainingCount > 0 ? `${remainingCount} suggestions left to look at. You've got this.` : 'All suggestions reviewed! Excellent work.'}
              </p>

              {/* Pill Search Input */}
              {activeRightTab !== 'rules' && activeRightTab !== 'comments' && (
                <div className="relative mt-4">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search suggestions…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-full pl-9 pr-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 transition-all"
                  />
                </div>
              )}

              {/* Category Filter Chips */}
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                <button
                  onClick={() => setActiveRightTab('all')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-semibold ${
                    activeRightTab === 'all'
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All {findings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('grammar')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'grammar'
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                  }`}
                >
                  Grammar {grammarFindings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('spelling')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'spelling'
                      ? 'bg-sky-500 text-white shadow-sm'
                      : 'bg-sky-50 text-sky-700 hover:bg-sky-100'
                  }`}
                >
                  Spelling {spellingFindings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('sentence')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'sentence'
                      ? 'bg-purple-500 text-white shadow-sm'
                      : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                  }`}
                >
                  Sentence {sentenceFindings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('compounds')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'compounds'
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  Compounds {compoundsFindings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('bias')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'bias'
                      ? 'bg-rose-500 text-white shadow-sm'
                      : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                  }`}
                >
                  Inclusive {biasFindings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('comments')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 ${
                    activeRightTab === 'comments'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                  }`}
                >
                  <MessageSquare size={12} />
                  Comments {comments.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('rules')}
                  className={`chip p-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'rules'
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  title="CE Support Rules Manager"
                >
                  <Sliders size={14} />
                </button>
              </div>
            </div>

            {/* Panel Content Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
              {activeRightTab === 'comments' ? (
                /* ── DEDICATED COMMENTS / AUTHOR QUERIES (AQ) TAB ── */
                <div className="space-y-4">
                  {/* Compose New AQ Comment */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                        <MessageCircle size={14} className="text-violet-600" /> Post Author Query / AQ Comment
                      </span>
                      <span className="text-[10px] text-slate-400">Attached to document</span>
                    </div>

                    {/* Attached Selection Badge */}
                    {selectedEditorText ? (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-xs text-amber-800 flex items-center justify-between shadow-xs">
                        <span className="truncate max-w-[280px]">
                          <strong>Attached to selection:</strong> "{selectedEditorText}"
                        </span>
                        <span className="text-[10px] bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full font-bold uppercase shrink-0">Selected</span>
                      </div>
                    ) : (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-500 italic">
                        💡 Select text in the document editor to anchor your AQ comment directly.
                      </div>
                    )}

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
                          className="px-2 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-medium transition-colors flex items-center gap-1"
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
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200 resize-none"
                    />

                    <div className="flex justify-end">
                      <button
                        onClick={() => handleCreateComment()}
                        disabled={submittingComment || !newCommentText.trim()}
                        className="px-4 py-1.5 rounded-full bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
                      >
                        {submittingComment ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />}
                        Post AQ Comment
                      </button>
                    </div>
                  </div>

                  {/* Filter Header */}
                  <div className="flex items-center justify-between px-1 text-xs text-slate-500">
                    <span>
                      Total Comments: <strong className="text-slate-800">{comments.length}</strong>
                    </span>
                    <button
                      onClick={() => setFilterUnresolved(prev => !prev)}
                      className={`text-[11px] font-medium transition-colors ${
                        filterUnresolved ? 'text-violet-600 underline' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {filterUnresolved ? 'Showing Open AQ Only' : 'Show Open AQ Only'}
                    </button>
                  </div>

                  {/* Comments List */}
                  {commentsLoading ? (
                    <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
                      <Loader2 className="animate-spin text-violet-600" size={20} />
                      Loading file comments...
                    </div>
                  ) : comments.filter(c => !filterUnresolved || !c.resolved).length === 0 ? (
                    <div className="py-12 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                      <MessageSquare size={24} className="mx-auto mb-2 text-slate-300" />
                      No comments or author queries found. Post a comment above to get started.
                    </div>
                  ) : (
                    comments
                      .filter(c => !filterUnresolved || !c.resolved)
                      .map(comment => (
                        <div
                          key={comment.comment_uuid}
                          ref={(el) => (commentCardRefs.current[comment.comment_uuid] = el)}
                          onClick={() => {
                            setSelectedCommentId(comment.comment_uuid)
                            editorRef.current?.scrollToComment(comment.comment_uuid)
                          }}
                          className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                            selectedCommentId === comment.comment_uuid
                              ? 'ring-2 ring-violet-400 border-violet-400 shadow-md bg-violet-50/20'
                              : comment.resolved
                              ? 'bg-slate-50/60 border-slate-100 opacity-60'
                              : 'bg-white border-slate-100 shadow-sm hover:shadow-md'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 font-bold text-[10px] flex items-center justify-center">
                                {(comment.author_name || 'AQ').slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="text-xs font-semibold text-slate-800">
                                  {comment.author_name || 'Reviewer'}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {comment.created_at ? new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                </div>
                              </div>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                comment.resolved
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                  : 'bg-amber-50 text-amber-700 border border-amber-100'
                              }`}
                            >
                              {comment.resolved ? 'Resolved' : 'Open AQ'}
                            </span>
                          </div>

                          <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed mb-3">
                            {comment.text}
                          </p>

                          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2 text-[11px]">
                            <button
                              onClick={() => handleToggleResolve(comment.comment_uuid, comment.resolved)}
                              className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors flex items-center gap-1 ${
                                comment.resolved
                                  ? 'text-slate-500 hover:text-slate-800 bg-slate-100'
                                  : 'text-emerald-700 hover:bg-emerald-100 bg-emerald-50 border border-emerald-200'
                              }`}
                            >
                              <CheckCircle2 size={12} />
                              {comment.resolved ? 'Reopen AQ' : 'Resolve AQ'}
                            </button>

                            <button
                              onClick={() => handleDeleteComment(comment.comment_uuid)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded-full hover:bg-slate-100 transition-colors"
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
                  <div className="py-12 text-center text-slate-400 text-xs">
                    No suggestions found in this category.
                  </div>
                ) : (
                  activeCategoryFindings.map(f => {
                    const isSelected = f.id === selectedFindingId
                    const isAccepted = f.status === 'accepted'
                    const isEdited = f.status === 'edited'
                    const isRejected = f.status === 'rejected'

                    const catColorMap: Record<string, { border: string; text: string; bg: string }> = {
                      grammar: { border: 'border-l-amber-400', text: 'text-amber-600', bg: 'bg-amber-50' },
                      spelling: { border: 'border-l-sky-400', text: 'text-sky-600', bg: 'bg-sky-50' },
                      sentence: { border: 'border-l-purple-400', text: 'text-purple-600', bg: 'bg-purple-50' },
                      compounds: { border: 'border-l-emerald-400', text: 'text-emerald-600', bg: 'bg-emerald-50' },
                      compound: { border: 'border-l-emerald-400', text: 'text-emerald-600', bg: 'bg-emerald-50' },
                      bias: { border: 'border-l-rose-400', text: 'text-rose-600', bg: 'bg-rose-50' },
                      article: { border: 'border-l-rose-400', text: 'text-rose-600', bg: 'bg-rose-50' },
                    }

                    const catStyle = catColorMap[f.category] || { border: 'border-l-violet-400', text: 'text-violet-600', bg: 'bg-violet-50' }

                    return (
                      <div
                        key={f.id}
                        ref={(el) => (cardRefs.current[f.id] = el)}
                        onClick={() => setSelectedFindingId(f.id)}
                        className={`finding-card card-enter p-4 rounded-2xl border border-slate-100 bg-white shadow-sm hover:shadow-md transition-all cursor-pointer border-l-4 ${catStyle.border} ${
                          isSelected
                            ? 'ring-2 ring-violet-400 border-violet-400 shadow-md'
                            : isAccepted
                            ? 'bg-emerald-50/40 opacity-70 border-emerald-200'
                            : isEdited
                            ? 'bg-amber-50/40 opacity-80 border-amber-200'
                            : isRejected
                            ? 'bg-slate-100/60 opacity-40'
                            : ''
                        }`}
                      >
                        {/* Card Header */}
                        <div className="flex items-center justify-between">
                          <span className={`text-[11px] font-bold uppercase tracking-wide ${catStyle.text}`}>
                            {f.category}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Para {f.para_index + 1}
                          </span>
                        </div>

                        {/* Finding Message */}
                        <p className="text-sm text-slate-700 mt-1.5 font-medium leading-snug">
                          {f.message}
                        </p>

                        {/* Visual Diff Box */}
                        <div className="mt-3 flex items-center gap-2 text-sm font-medium flex-wrap">
                          <span className="diff-old px-2 py-1 rounded-lg">
                            {f.original_text}
                          </span>
                          <ArrowRight size={14} className="text-slate-300 flex-shrink-0" />
                          <span className="diff-new px-2 py-1 rounded-lg">
                            {f.edited_text || f.suggestion}
                          </span>
                        </div>

                        {/* Action Buttons */}
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDecide(f.id, 'accepted')
                            }}
                            className="flex-1 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1 shadow-sm"
                          >
                            <Check size={13} /> Accept
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingFindingId(prev => prev === f.id ? null : f.id)
                            }}
                            className="px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-600 transition-colors"
                          >
                            Edit
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDecide(f.id, 'highlighted')
                            }}
                            className="px-3 py-1.5 rounded-full border border-amber-200 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-700 transition-colors"
                          >
                            Highlight
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDecide(f.id, 'rejected')
                            }}
                            className="px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-400 transition-colors"
                          >
                            Ignore
                          </button>
                        </div>

                        {/* Inline Custom Edit Row */}
                        {editingFindingId === f.id && (
                          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editedInputs[f.id] ?? f.suggestion}
                              onChange={(e) => setEditedInputs({ ...editedInputs, [f.id]: e.target.value })}
                              className="flex-1 text-sm border border-violet-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-200 bg-slate-50"
                              placeholder="Type custom text..."
                            />
                            <button
                              onClick={() => handleDecide(f.id, 'edited')}
                              className="px-3.5 py-1.5 rounded-full bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
                            >
                              Save Edit
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })
                )
              ) : (
                /* ── CE SUPPORT RULES MANAGER TAB ── */
                <div className="space-y-4">
                  <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-800">CE Support Rules Manager</h3>
                      <button
                        onClick={handleSaveRulesToCESupport}
                        disabled={savingRules}
                        className="px-3.5 py-1.5 rounded-full bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 shadow-sm"
                      >
                        {savingRules ? 'Saving...' : 'Save to CE Support'}
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">Select active style profile template for project:</p>
                    <select
                      value={selectedProfileKey}
                      onChange={e => setSelectedProfileKey(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-200 font-medium"
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
